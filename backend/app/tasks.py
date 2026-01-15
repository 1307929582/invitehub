# 异步任务队列 - 批量处理版
import asyncio
import logging
from typing import Optional, List, Dict
from datetime import datetime

logger = logging.getLogger(__name__)

# 邀请队列
_invite_queue: asyncio.Queue = None
_worker_task: asyncio.Task = None

# 批量处理配置
BATCH_SIZE = 10  # 每批处理数量
BATCH_INTERVAL = 3  # 批次间隔秒数


async def get_invite_queue() -> asyncio.Queue:
    global _invite_queue
    if _invite_queue is None:
        _invite_queue = asyncio.Queue(maxsize=5000)
    return _invite_queue


async def enqueue_invite(
    email: str,
    redeem_code: str,
    group_id: int = None,
    linuxdo_user_id: int = None,
    is_rebind: bool = False,
    consume_immediately: bool = True,
    old_team_id: int = None,
    old_team_chatgpt_user_id: str = None
) -> str:
    """添加邀请到队列，返回队列 ID
    
    Args:
        email: 邮箱地址
        redeem_code: 兑换码
        group_id: 分组 ID
        linuxdo_user_id: LinuxDO 用户 ID (已废弃)
        is_rebind: 是否为换车操作
    """
    queue = await get_invite_queue()
    queue_id = f"q-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}-{queue.qsize()}"
    
    task = {
        "queue_id": queue_id,
        "email": email.lower().strip(),
        "redeem_code": redeem_code,
        "group_id": group_id,
        "linuxdo_user_id": linuxdo_user_id,
        "is_rebind": is_rebind,
        "consume_immediately": consume_immediately,
        "old_team_id": old_team_id,
        "old_team_chatgpt_user_id": old_team_chatgpt_user_id,
        "created_at": datetime.utcnow()
    }
    
    try:
        queue.put_nowait(task)
        logger.info(f"Invite enqueued: {email}, is_rebind: {is_rebind}, queue size: {queue.qsize()}")
        return queue_id
    except asyncio.QueueFull:
        logger.warning(f"Invite queue full!")
        raise Exception("系统繁忙，请稍后再试")


async def get_queue_status() -> dict:
    """获取队列状态"""
    queue = await get_invite_queue()
    return {
        "queue_size": queue.qsize(),
        "max_size": 5000,
        "batch_size": BATCH_SIZE,
        "batch_interval": BATCH_INTERVAL
    }


async def process_invite_batch(batch: List[Dict]):
    """
    批量处理邀请 - 使用智能分配算法

    改进点：
    1. 使用 SeatCalculator 精确计算可用座位（包含 pending 邀请）
    2. 使用 BatchAllocator 智能分配到多个 Team
    3. 使用数据库锁防止并发超载
    4. 【P0-1】支持预占座位：reserved_team_id 直接使用，跳过分配

    Requirements: 1.1, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3
    """
    from app.services.chatgpt_api import ChatGPTAPI, ChatGPTAPIError
    from app.database import SessionLocal
    from app.models import Team, InviteRecord, InviteStatus, InviteQueue, InviteQueueStatus
    from app.cache import invalidate_seat_cache
    from app.services.seat_calculator import get_all_teams_with_seats, get_team_available_seats
    from app.services.batch_allocator import BatchAllocator, InviteTask
    from sqlalchemy import text

    if not batch:
        return

    db = SessionLocal()
    try:
        # P0-1: 分离有预占 Team 的和需要分配的
        reserved_items = [item for item in batch if item.get("reserved_team_id")]
        allocate_items = [item for item in batch if not item.get("reserved_team_id")]

        # 处理预占的邀请（直接使用指定 Team，不走分配逻辑）
        if reserved_items:
            await _process_reserved_invites(db, reserved_items)

        # 处理需要分配的邀请（原有逻辑）
        if not allocate_items:
            db.commit()
            invalidate_seat_cache()
            return

        # 按 group_id 分组
        groups: Dict[int, List[Dict]] = {}
        for item in allocate_items:
            gid = item.get("group_id") or 0
            if gid not in groups:
                groups[gid] = []
            groups[gid].append(item)
        
        for group_id, items in groups.items():
            # 1. 使用 SeatCalculator 获取所有 Team 的精确座位信息
            teams_with_seats = get_all_teams_with_seats(
                db,
                group_id=group_id if group_id else None,
                only_active=True
            )

            logger.info(f"Group {group_id}: Found {len(teams_with_seats)} teams, "
                       f"total available: {sum(t.available_seats for t in teams_with_seats)}")

            if not teams_with_seats or all(t.available_seats <= 0 for t in teams_with_seats):
                # 没有空位，进入等待队列（而不是标记失败）
                for item in items:
                    record = InviteQueue(
                        email=item["email"],
                        redeem_code=item.get("redeem_code"),
                        linuxdo_user_id=item.get("linuxdo_user_id"),
                        group_id=group_id if group_id else None,
                        is_rebind=item.get("is_rebind", False),
                        old_team_id=item.get("old_team_id"),
                        old_team_chatgpt_user_id=item.get("old_team_chatgpt_user_id"),
                        consume_immediately=item.get("consume_immediately", True),
                        status=InviteQueueStatus.WAITING,  # 等待空位
                        error_message="所有 Team 已满，等待空位",
                        processed_at=None  # 未处理
                    )
                    db.add(record)
                db.commit()
                logger.info(f"No available team for group {group_id}, {len(items)} invites queued for waiting")
                continue

            # 2. 转换为 InviteTask 列表
            invite_tasks = [
                InviteTask(
                    email=item["email"],
                    redeem_code=item.get("redeem_code"),
                    group_id=group_id if group_id else None,
                    is_rebind=item.get("is_rebind", False),
                    consume_immediately=item.get("consume_immediately", True),
                    consume_rebind_count=item.get("consume_rebind_count", False),
                    old_team_id=item.get("old_team_id"),
                    old_team_chatgpt_user_id=item.get("old_team_chatgpt_user_id")
                )
                for item in items
            ]

            # 3. 使用 BatchAllocator 智能分配
            allocation_result = BatchAllocator.allocate(invite_tasks, teams_with_seats)

            logger.info(f"Allocation result: {len(allocation_result.allocated)} teams, "
                       f"{len(allocation_result.unallocated)} unallocated")

            # 4. 处理未分配的邀请（进入等待队列）
            for task in allocation_result.unallocated:
                record = InviteQueue(
                    email=task.email,
                    redeem_code=task.redeem_code,
                    group_id=task.group_id,
                    is_rebind=task.is_rebind,
                    old_team_id=task.old_team_id,
                    old_team_chatgpt_user_id=task.old_team_chatgpt_user_id,
                    consume_immediately=task.consume_immediately,
                    status=InviteQueueStatus.WAITING,  # 等待空位
                    error_message="座位不足，等待空位",
                    processed_at=None  # 未处理
                )
                db.add(record)

            # 5. 处理每个 Team 的分配（带数据库锁）
            for team_id, allocated_tasks in allocation_result.allocated.items():
                await _process_team_invites_with_lock(
                    db, team_id, allocated_tasks, teams_with_seats
                )

            db.commit()
            invalidate_seat_cache()
                
    except Exception as e:
        logger.error(f"Process batch error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()


async def _process_reserved_invites(db, items: List[Dict]):
    """
    处理预占座位的邀请（P0-1 核心逻辑）

    当 API 层已经创建了 RESERVED 记录时，直接使用该 Team 发送邀请，
    成功后将 RESERVED 状态更新为 SUCCESS。

    Args:
        db: 数据库会话
        items: 带有 reserved_team_id 的邀请项列表
    """
    from app.services.chatgpt_api import ChatGPTAPI, ChatGPTAPIError
    from app.models import Team, InviteRecord, InviteStatus, TeamStatus

    # 按 team_id 分组
    team_groups: Dict[int, List[Dict]] = {}
    for item in items:
        tid = item["reserved_team_id"]
        if tid not in team_groups:
            team_groups[tid] = []
        team_groups[tid].append(item)

    for team_id, team_items in team_groups.items():
        try:
            # 获取 Team（使用锁防止并发问题）
            team = db.query(Team).filter(Team.id == team_id).with_for_update().first()

            if not team:
                logger.error(f"Reserved team {team_id} not found")
                # 更新 RESERVED 记录为失败
                for item in team_items:
                    db.query(InviteRecord).filter(
                        InviteRecord.email == item["email"],
                        InviteRecord.redeem_code == item.get("redeem_code"),
                        InviteRecord.status == InviteStatus.RESERVED,
                        InviteRecord.team_id == team_id
                    ).update({"status": InviteStatus.FAILED, "error_message": "Team not found"})
                continue

            # 二次校验 Team 健康状态
            if not team.is_active or team.status != TeamStatus.ACTIVE:
                logger.warning(f"Reserved team {team_id} is not healthy")
                for item in team_items:
                    db.query(InviteRecord).filter(
                        InviteRecord.email == item["email"],
                        InviteRecord.redeem_code == item.get("redeem_code"),
                        InviteRecord.status == InviteStatus.RESERVED,
                        InviteRecord.team_id == team_id
                    ).update({"status": InviteStatus.FAILED, "error_message": f"Team {team.name} is not healthy"})
                continue

            # 发送邀请
            emails = [item["email"] for item in team_items]
            batch_id = f"reserved-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"

            try:
                api = ChatGPTAPI(team.session_token, team.device_id or "")
                await api.invite_members(team.account_id, emails)

                # 成功：更新 RESERVED -> SUCCESS
                for item in team_items:
                    db.query(InviteRecord).filter(
                        InviteRecord.email == item["email"],
                        InviteRecord.redeem_code == item.get("redeem_code"),
                        InviteRecord.status == InviteStatus.RESERVED,
                        InviteRecord.team_id == team_id
                    ).update({
                        "status": InviteStatus.SUCCESS,
                        "batch_id": batch_id,
                        "is_rebind": item.get("is_rebind", False)
                    })
                    if item.get("redeem_code"):
                        from app.services.email import send_invite_ready_email
                        send_invite_ready_email(db, item["email"], team.name, is_rebind=item.get("is_rebind", False))

                logger.info(f"Reserved invite success: {len(emails)} emails to {team.name}")

                # 处理换车：踢出原 Team
                for item in team_items:
                    if item.get("is_rebind") and item.get("old_team_id") and item.get("old_team_chatgpt_user_id"):
                        try:
                            from app.services.batch_allocator import InviteTask
                            task = InviteTask(
                                email=item["email"],
                                redeem_code=item.get("redeem_code"),
                                group_id=item.get("group_id"),
                                is_rebind=True,
                                consume_rebind_count=item.get("consume_rebind_count", False),
                                old_team_id=item.get("old_team_id"),
                                old_team_chatgpt_user_id=item.get("old_team_chatgpt_user_id")
                            )
                            await _remove_from_old_team(db, task, team.name)
                        except Exception as kick_err:
                            logger.error(f"Failed to kick {item['email']} from old team: {kick_err}")

                # 发送 Telegram 通知
                rebind_items = [i for i in team_items if i.get("is_rebind")]
                normal_items = [i for i in team_items if not i.get("is_rebind")]

                if normal_items:
                    from app.services.batch_allocator import InviteTask
                    tasks = [InviteTask(email=i["email"], redeem_code=i.get("redeem_code"), group_id=i.get("group_id"))
                             for i in normal_items]
                    await send_batch_telegram_notify(db, tasks, team.name, is_rebind=False)
                if rebind_items:
                    from app.services.batch_allocator import InviteTask
                    tasks = [InviteTask(email=i["email"], redeem_code=i.get("redeem_code"), group_id=i.get("group_id"), is_rebind=True)
                             for i in rebind_items]
                    await send_batch_telegram_notify(db, tasks, team.name, is_rebind=True)

            except ChatGPTAPIError as e:
                logger.error(f"Reserved invite to {team.name} failed: {e.message}")
                # 更新 RESERVED 记录为失败
                for item in team_items:
                    db.query(InviteRecord).filter(
                        InviteRecord.email == item["email"],
                        InviteRecord.redeem_code == item.get("redeem_code"),
                        InviteRecord.status == InviteStatus.RESERVED,
                        InviteRecord.team_id == team_id
                    ).update({"status": InviteStatus.FAILED, "error_message": str(e.message)[:200]})
                raise  # 触发 Celery 重试

        except Exception as e:
            logger.error(f"Error processing reserved invites for team {team_id}: {e}")
            raise  # 触发 Celery 重试


async def _process_team_invites_with_lock(
    db, 
    team_id: int, 
    tasks: List, 
    teams_info: List
) -> None:
    """
    使用数据库锁处理单个 Team 的邀请
    
    1. SELECT FOR UPDATE 锁定 Team 行
    2. 重新验证可用座位
    3. 发送邀请
    4. 记录结果
    
    Requirements: 3.1, 3.2, 3.3
    """
    from app.services.chatgpt_api import ChatGPTAPI, ChatGPTAPIError
    from app.models import Team, InviteRecord, InviteStatus, InviteQueue, InviteQueueStatus, TeamStatus
    from app.services.seat_calculator import get_team_available_seats
    from sqlalchemy import text

    MAX_RETRIES = 3

    for retry in range(MAX_RETRIES):
        try:
            # 1. 使用 SELECT FOR UPDATE 锁定 Team 行
            team = db.query(Team).filter(Team.id == team_id).with_for_update().first()

            if not team:
                logger.error(f"Team {team_id} not found")
                return

            # 2. 二次校验 Team 健康状态（防止竞态：分配后、发邀请前状态变更）
            if not team.is_active or team.status != TeamStatus.ACTIVE:
                logger.warning(f"Team {team_id} is no longer healthy (is_active={team.is_active}, status={team.status}), skipping")
                # 进入等待队列，等待 Team 恢复或分配到其他 Team
                for task in tasks:
                    record = InviteQueue(
                        email=task.email,
                        redeem_code=task.redeem_code,
                        group_id=task.group_id,
                        is_rebind=task.is_rebind,
                        old_team_id=task.old_team_id,
                        old_team_chatgpt_user_id=task.old_team_chatgpt_user_id,
                        consume_immediately=task.consume_immediately,
                        status=InviteQueueStatus.WAITING,
                        error_message=f"Team {team.name} 状态异常，等待重新分配",
                        processed_at=None
                    )
                    db.add(record)
                return

            # 3. 重新验证可用座位
            seat_info = get_team_available_seats(db, team_id)

            if seat_info.available_seats <= 0:
                logger.warning(f"Team {team_id} has no available seats after lock")
                # 进入等待队列（而不是标记失败）
                for task in tasks:
                    record = InviteQueue(
                        email=task.email,
                        redeem_code=task.redeem_code,
                        group_id=task.group_id,
                        is_rebind=task.is_rebind,
                        old_team_id=task.old_team_id,
                        old_team_chatgpt_user_id=task.old_team_chatgpt_user_id,
                        consume_immediately=task.consume_immediately,
                        status=InviteQueueStatus.WAITING,  # 等待空位
                        error_message=f"Team {team.name} 已满，等待空位",
                        processed_at=None
                    )
                    db.add(record)
                return

            # 3. 只处理可用座位数量的邀请
            tasks_to_process = tasks[:seat_info.available_seats]
            tasks_overflow = tasks[seat_info.available_seats:]

            if tasks_overflow:
                logger.warning(f"Team {team_id}: {len(tasks_overflow)} tasks overflow due to concurrent allocation")
                # 溢出的任务进入等待队列
                for task in tasks_overflow:
                    record = InviteQueue(
                        email=task.email,
                        redeem_code=task.redeem_code,
                        group_id=task.group_id,
                        is_rebind=task.is_rebind,
                        old_team_id=task.old_team_id,
                        old_team_chatgpt_user_id=task.old_team_chatgpt_user_id,
                        consume_immediately=task.consume_immediately,
                        status=InviteQueueStatus.WAITING,  # 等待空位
                        error_message=f"Team {team.name} 座位不足，等待空位",
                        processed_at=None
                    )
                    db.add(record)
            
            # 4. 发送邀请
            emails = [task.email for task in tasks_to_process]
            batch_id = f"batch-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
            
            try:
                api = ChatGPTAPI(team.session_token, team.device_id or "")
                await api.invite_members(team.account_id, emails)
                
                # 记录成功
                for task in tasks_to_process:
                    invite = InviteRecord(
                        team_id=team.id,
                        email=task.email,
                        status=InviteStatus.SUCCESS,
                        redeem_code=task.redeem_code,
                        batch_id=batch_id,
                        is_rebind=task.is_rebind
                    )
                    db.add(invite)
                    if task.redeem_code:
                        from app.services.email import send_invite_ready_email
                        send_invite_ready_email(db, task.email, team.name, is_rebind=task.is_rebind)
                
                logger.info(f"Batch invite success: {len(emails)} emails to {team.name}")

                # 换车操作：邀请成功后，踢出原 Team（先邀再踢）
                for task in tasks_to_process:
                    if task.is_rebind and task.old_team_id and task.old_team_chatgpt_user_id:
                        try:
                            await _remove_from_old_team(db, task, team.name)
                        except Exception as kick_err:
                            logger.error(f"Failed to kick {task.email} from old team {task.old_team_id}: {kick_err}")
                            # 踢人失败不影响整体流程，只记录日志

                # 发送 Telegram 通知（分别通知换车和普通上车）
                rebind_tasks = [t for t in tasks_to_process if t.is_rebind]
                normal_tasks = [t for t in tasks_to_process if not t.is_rebind]

                if normal_tasks:
                    await send_batch_telegram_notify(db, normal_tasks, team.name, is_rebind=False)
                if rebind_tasks:
                    await send_batch_telegram_notify(db, rebind_tasks, team.name, is_rebind=True)
                
            except ChatGPTAPIError as e:
                logger.error(f"Batch invite to {team.name} failed: {e.message}")
                # 批量失败，逐个重试
                for task in tasks_to_process:
                    try:
                        await api.invite_members(team.account_id, [task.email])
                        invite = InviteRecord(
                            team_id=team.id,
                            email=task.email,
                            status=InviteStatus.SUCCESS,
                            redeem_code=task.redeem_code,
                            batch_id=f"retry-{batch_id}",
                            is_rebind=task.is_rebind
                        )
                        db.add(invite)
                        if task.redeem_code:
                            from app.services.email import send_invite_ready_email
                            send_invite_ready_email(db, task.email, team.name, is_rebind=task.is_rebind)
                    except Exception as e2:
                        invite = InviteRecord(
                            team_id=team.id,
                            email=task.email,
                            status=InviteStatus.FAILED,
                            redeem_code=task.redeem_code,
                            error_message=str(e2)[:200],
                            is_rebind=task.is_rebind
                        )
                        db.add(invite)
                    await asyncio.sleep(0.5)
            
            # 成功处理，退出重试循环
            return
            
        except Exception as e:
            if "lock" in str(e).lower() or "deadlock" in str(e).lower():
                logger.warning(f"Lock conflict on team {team_id}, retry {retry + 1}/{MAX_RETRIES}")
                await asyncio.sleep(1)
                continue
            raise
    
    # 重试耗尽 - 进入等待队列
    logger.error(f"Failed to process team {team_id} after {MAX_RETRIES} retries, queuing for later")
    for task in tasks:
        record = InviteQueue(
            email=task.email,
            redeem_code=task.redeem_code,
            group_id=task.group_id,
            is_rebind=task.is_rebind,
            old_team_id=task.old_team_id,
            old_team_chatgpt_user_id=task.old_team_chatgpt_user_id,
            consume_immediately=task.consume_immediately,
            status=InviteQueueStatus.WAITING,  # 等待重试
            error_message="处理超时，等待自动重试",
            processed_at=None
        )
        db.add(record)


async def _remove_from_old_team(db, task, new_team_name: str):
    """
    从原 Team 踢出用户（换车操作）

    Args:
        db: 数据库会话
        task: InviteTask 对象
        new_team_name: 新 Team 名称（用于日志）
    """
    from app.services.chatgpt_api import ChatGPTAPI, ChatGPTAPIError
    from app.models import Team, TeamMember

    # 获取原 Team 信息
    old_team = db.query(Team).filter(Team.id == task.old_team_id).first()
    if not old_team:
        logger.warning(f"Old team {task.old_team_id} not found, skipping kick")
        return

    logger.info(f"Kicking {task.email} from old team {old_team.name} (moving to {new_team_name})")

    try:
        # 调用 ChatGPT API 踢人
        api = ChatGPTAPI(old_team.session_token, old_team.device_id or "")
        await api.remove_member(old_team.account_id, task.old_team_chatgpt_user_id)

        # 从本地缓存删除成员记录
        db.query(TeamMember).filter(
            TeamMember.team_id == task.old_team_id,
            TeamMember.email == task.email
        ).delete()
        db.commit()

        logger.info(f"Successfully kicked {task.email} from old team {old_team.name}")

    except ChatGPTAPIError as e:
        logger.error(f"Failed to kick {task.email} from old team {old_team.name}: {e.message}")
        # 可能原 Team 已经不健康，不影响整体流程
    except Exception as e:
        logger.error(f"Unexpected error kicking {task.email}: {e}")


async def send_batch_telegram_notify(
    db,
    tasks: List,
    team_name: str,
    is_rebind: bool = False,
    old_team_name: str = None
):
    """
    批量发送 Telegram 通知

    Args:
        db: 数据库会话
        tasks: InviteTask 列表（包含 email 和 redeem_code）
        team_name: Team 名称
        is_rebind: 是否为换车操作
        old_team_name: 原 Team 名称（换车时使用）
    """
    from app.models import SystemConfig, RedeemCode, User, UserRole
    from app.services.telegram import send_telegram_message, send_admin_notification
    from app.utils.timezone import get_today_range_utc8
    from sqlalchemy import func

    if not tasks:
        return

    try:
        def get_cfg(key):
            c = db.query(SystemConfig).filter(SystemConfig.key == key).first()
            return c.value if c else None

        if get_cfg("telegram_enabled") != "true" or get_cfg("telegram_notify_invite") != "true":
            return

        bot_token = get_cfg("telegram_bot_token")
        chat_id = get_cfg("telegram_chat_id")
        if not bot_token or not chat_id:
            return

        if is_rebind:
            msg = f"🔄 <b>用户换车</b>\n\n"
            if old_team_name:
                msg += f"📤 原 Team: {old_team_name}\n"
            msg += f"📥 新 Team: {team_name}\n"
            msg += f"📧 人数: {len(tasks)}\n\n"
        else:
            msg = f"🎉 <b>新用户上车</b>\n\n👥 Team: {team_name}\n📧 人数: {len(tasks)}\n\n"

        # 显示详情（包含兑换码）
        if len(tasks) <= 5:
            for task in tasks:
                code_str = f" | 🎫 <code>{task.redeem_code}</code>" if task.redeem_code else ""
                msg += f"• <code>{task.email}</code>{code_str}\n"
        else:
            for task in tasks[:5]:
                code_str = f" | 🎫 <code>{task.redeem_code}</code>" if task.redeem_code else ""
                msg += f"• <code>{task.email}</code>{code_str}\n"
            msg += f"\n... 等 {len(tasks)} 人"

        await send_telegram_message(bot_token, chat_id, msg)

        # 发送分销商专属通知（每个分销商单独通知）
        today_start, today_end = get_today_range_utc8()

        for task in tasks:
            if not task.redeem_code:
                continue

            # 查找兑换码的创建者
            code = db.query(RedeemCode).filter(RedeemCode.code == task.redeem_code).first()
            if not code or not code.created_by:
                continue

            # 检查是否为分销商创建的兑换码
            distributor = db.query(User).filter(
                User.id == code.created_by,
                User.role == UserRole.DISTRIBUTOR
            ).first()

            if not distributor:
                continue

            # 统计分销商今日和总销售
            from app.models import InviteRecord, InviteStatus
            total_sales = db.query(func.coalesce(func.sum(RedeemCode.used_count), 0)).filter(
                RedeemCode.created_by == distributor.id
            ).scalar() or 0

            today_sales = db.query(func.count(InviteRecord.id)).filter(
                InviteRecord.redeem_code.in_(
                    db.query(RedeemCode.code).filter(RedeemCode.created_by == distributor.id)
                ),
                InviteRecord.status == InviteStatus.SUCCESS,
                InviteRecord.created_at >= today_start,
                InviteRecord.created_at < today_end
            ).scalar() or 0

            # 发送分销商销售通知
            await send_admin_notification(
                db, "distributor_code_used",
                distributor_name=distributor.username,
                email=task.email,
                team_name=team_name,
                redeem_code=task.redeem_code,
                today_sales=today_sales,
                total_sales=int(total_sales)
            )

    except Exception as e:
        logger.warning(f"Telegram batch notify failed: {e}")


async def invite_worker():
    """邀请处理 worker - 批量处理"""
    queue = await get_invite_queue()
    logger.info("Invite worker started (batch mode)")
    
    while True:
        try:
            batch = []
            
            # 收集一批任务
            try:
                # 等待第一个任务
                first = await asyncio.wait_for(queue.get(), timeout=BATCH_INTERVAL)
                batch.append(first)
                queue.task_done()
                
                # 快速收集更多（不等待）
                while len(batch) < BATCH_SIZE:
                    try:
                        item = queue.get_nowait()
                        batch.append(item)
                        queue.task_done()
                    except asyncio.QueueEmpty:
                        break
                        
            except asyncio.TimeoutError:
                # 超时没有新任务，继续等待
                continue
            
            if batch:
                logger.info(f"Processing batch of {len(batch)} invites")
                await process_invite_batch(batch)
                
            # 批次间隔
            await asyncio.sleep(1)
            
        except asyncio.CancelledError:
            logger.info("Invite worker cancelled")
            break
        except Exception as e:
            logger.error(f"Invite worker error: {e}")
            await asyncio.sleep(1)


async def start_task_worker():
    """启动任务 worker"""
    global _worker_task
    if _worker_task is None or _worker_task.done():
        _worker_task = asyncio.create_task(invite_worker())
        logger.info("Invite worker started")


async def stop_task_worker():
    """停止任务 worker"""
    global _worker_task
    if _worker_task and not _worker_task.done():
        _worker_task.cancel()
        try:
            await _worker_task
        except asyncio.CancelledError:
            pass
        logger.info("Invite worker stopped")
