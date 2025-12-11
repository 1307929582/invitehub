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


async def enqueue_invite(email: str, redeem_code: str, group_id: int = None, linuxdo_user_id: int = None, is_rebind: bool = False) -> str:
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
        # 按 group_id 分组
        groups: Dict[int, List[Dict]] = {}
        for item in batch:
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
                    is_rebind=item.get("is_rebind", False)
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
    from app.models import Team, InviteRecord, InviteStatus, InviteQueue, InviteQueueStatus
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

            # 2. 重新验证可用座位
            seat_info = get_team_available_seats(db, team_id)

            if seat_info.available_seats <= 0:
                logger.warning(f"Team {team_id} has no available seats after lock")
                # 进入等待队列（而不是标记失败）
                for task in tasks:
                    record = InviteQueue(
                        email=task.email,
                        redeem_code=task.redeem_code,
                        group_id=task.group_id,
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
                
                logger.info(f"Batch invite success: {len(emails)} emails to {team.name}")
                
                # 发送 Telegram 通知
                await send_batch_telegram_notify(db, emails, team.name)
                
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
            status=InviteQueueStatus.WAITING,  # 等待重试
            error_message="处理超时，等待自动重试",
            processed_at=None
        )
        db.add(record)


async def send_batch_telegram_notify(db, emails: List[str], team_name: str):
    """批量发送 Telegram 通知"""
    from app.models import SystemConfig
    from app.services.telegram import send_telegram_message
    
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
        
        msg = f"🎉 <b>批量上车成功</b>\n\n👥 Team: {team_name}\n📧 人数: {len(emails)}\n\n"
        if len(emails) <= 5:
            msg += "\n".join([f"• <code>{e}</code>" for e in emails])
        else:
            msg += "\n".join([f"• <code>{e}</code>" for e in emails[:5]])
            msg += f"\n... 等 {len(emails)} 人"
        
        await send_telegram_message(bot_token, chat_id, msg)
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
