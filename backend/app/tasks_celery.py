"""
Celery 任务定义

将原有的 asyncio 队列任务改造为 Celery 任务，支持分布式部署。
"""
import asyncio
from datetime import datetime, timedelta
from typing import List, Dict
from celery import Task
from sqlalchemy.orm import Session

from app.celery_app import celery_app
from app.database import SessionLocal
from app.models import InviteRecord, InviteStatus, InviteQueue, InviteQueueStatus, RedeemCode
from app.cache import invalidate_seat_cache
from app.logger import get_logger

logger = get_logger(__name__)


class DatabaseTask(Task):
    """带数据库会话管理的 Celery 任务基类"""
    _db: Session = None

    def after_return(self, *args, **kwargs):
        """任务返回后清理数据库会话"""
        if self._db is not None:
            self._db.close()
            self._db = None

    @property
    def db(self) -> Session:
        """获取数据库会话（懒加载）"""
        if self._db is None:
            self._db = SessionLocal()
        return self._db


@celery_app.task(
    bind=True,
    base=DatabaseTask,
    max_retries=3,
    default_retry_delay=60,
    autoretry_for=(Exception,),
    retry_backoff=True,  # 指数退避
    retry_backoff_max=600,  # 最大退避10分钟
    retry_jitter=True  # 添加随机抖动防止重试风暴
)
def process_invite_task(
    self,
    email: str,
    redeem_code: str,
    group_id: int = None,
    is_rebind: bool = False
):
    """
    处理单个邀请请求（Celery 任务）

    Args:
        email: 用户邮箱
        redeem_code: 兑换码
        group_id: 分组 ID（可选）
        is_rebind: 是否为换车操作

    Raises:
        Retry: 失败时自动重试（最多3次）
    """
    try:
        logger.info(f"Processing invite task: {email}, is_rebind: {is_rebind}")

        # 复用现有的批量处理逻辑
        from app.tasks import process_invite_batch

        # 在 Celery worker 中运行异步函数
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        try:
            loop.run_until_complete(process_invite_batch([{
                "email": email,
                "redeem_code": redeem_code,
                "group_id": group_id,
                "is_rebind": is_rebind,
                "created_at": datetime.utcnow()
            }]))
        finally:
            loop.close()

        logger.info(f"Invite task completed: {email}")
        return {"success": True, "email": email}

    except Exception as e:
        logger.error(f"Invite task failed: {email}, error: {str(e)}, retry: {self.request.retries}/{self.max_retries}")

        is_final_failure = self.request.retries >= self.max_retries

        # 记录失败到数据库
        try:
            queue_record = InviteQueue(
                email=email,
                redeem_code=redeem_code,
                group_id=group_id,
                status=InviteQueueStatus.FAILED,
                error_message=str(e)[:200],
                retry_count=self.request.retries,
                processed_at=datetime.utcnow()
            )
            self.db.add(queue_record)
            self.db.commit()
        except Exception as db_err:
            logger.error(f"Failed to record error: {db_err}")

        # 最终失败时回滚兑换码使用次数
        if is_final_failure and redeem_code:
            try:
                _rollback_redeem_code_usage(self.db, redeem_code, email, is_rebind)
                logger.info(f"Rolled back redeem code usage for {redeem_code} after final failure")
            except Exception as rollback_err:
                logger.error(f"Failed to rollback redeem code: {rollback_err}")

        # 抛出异常触发重试（如果还有重试次数）
        raise self.retry(exc=e)


def _rollback_redeem_code_usage(db: Session, code_str: str, email: str, is_rebind: bool):
    """
    回滚兑换码使用次数

    当邀请最终失败时，回滚 Redis 令牌桶和数据库中的使用计数。
    """
    from sqlalchemy import update
    from app.cache import get_redis
    from app.services.redeem_limiter import RedeemLimiter

    # 1. 回滚 Redis 令牌桶
    redis_client = get_redis()
    if redis_client:
        limiter = RedeemLimiter(redis_client)
        limiter.refund(code_str)
        logger.info(f"Refunded Redis token for code {code_str}")

    # 2. 回滚数据库使用计数
    code = db.query(RedeemCode).filter(RedeemCode.code == code_str).first()
    if code and code.used_count > 0:
        db.execute(
            update(RedeemCode)
            .where(RedeemCode.code == code_str)
            .where(RedeemCode.used_count > 0)
            .values(used_count=RedeemCode.used_count - 1)
        )
        db.commit()
        logger.info(f"Rolled back database used_count for code {code_str}")

    # 3. 如果是换车操作，回滚换车计数
    if is_rebind and code and code.rebind_count and code.rebind_count > 0:
        db.execute(
            update(RedeemCode)
            .where(RedeemCode.code == code_str)
            .where(RedeemCode.rebind_count > 0)
            .values(rebind_count=RedeemCode.rebind_count - 1)
        )
        db.commit()
        logger.info(f"Rolled back rebind_count for code {code_str}")


@celery_app.task(bind=True, base=DatabaseTask)
def sync_redeem_count_task(self, code_id: int):
    """
    异步同步兑换码使用次数（从 Redis 回写到数据库）

    Args:
        code_id: 兑换码 ID
    """
    try:
        from app.services.redeem_limiter import RedeemLimiter
        from app.cache import get_redis

        redis_client = get_redis()
        if not redis_client:
            logger.warning("Redis not available, skip sync")
            return

        limiter = RedeemLimiter(redis_client)
        code = self.db.query(RedeemCode).filter(RedeemCode.id == code_id).first()

        if not code:
            logger.warning(f"RedeemCode {code_id} not found")
            return

        # 从 Redis 获取当前余额
        redis_key = f"redeem:{code.code}:remaining"
        remaining = redis_client.get(redis_key)

        if remaining is None:
            return

        remaining = int(remaining)
        expected_remaining = code.max_uses - code.used_count

        # 如果 Redis 和数据库不一致，以 Redis 为准（更新数据库）
        if remaining != expected_remaining:
            new_used_count = code.max_uses - remaining
            code.used_count = new_used_count
            self.db.commit()
            logger.info(f"Synced RedeemCode {code.code}: used_count = {new_used_count}")

    except Exception as e:
        logger.error(f"Sync redeem count failed: {e}")


@celery_app.task(bind=True, base=DatabaseTask)
def batch_sync_redeem_counts(self):
    """
    批量同步所有活跃兑换码的使用次数

    定时任务：每5分钟执行一次
    """
    try:
        from app.services.redeem_limiter import RedeemLimiter
        from app.cache import get_redis

        redis_client = get_redis()
        if not redis_client:
            return

        limiter = RedeemLimiter(redis_client)

        # 获取所有活跃且已绑定的兑换码
        codes = self.db.query(RedeemCode).filter(
            RedeemCode.is_active == True,
            RedeemCode.bound_email != None
        ).all()

        synced_count = 0
        for code in codes:
            redis_key = f"redeem:{code.code}:remaining"
            remaining = redis_client.get(redis_key)

            if remaining is not None:
                remaining = int(remaining)
                new_used_count = code.max_uses - remaining

                if new_used_count != code.used_count:
                    code.used_count = new_used_count
                    synced_count += 1

        if synced_count > 0:
            self.db.commit()
            logger.info(f"Batch synced {synced_count} redeem codes")

    except Exception as e:
        logger.error(f"Batch sync failed: {e}")


@celery_app.task(bind=True, base=DatabaseTask)
def cleanup_old_invite_queue(self):
    """
    清理旧的邀请队列记录

    定时任务：每小时执行一次
    删除 30 天前的已完成/失败记录
    """
    try:
        cutoff_time = datetime.utcnow() - timedelta(days=30)

        deleted = self.db.query(InviteQueue).filter(
            InviteQueue.processed_at < cutoff_time,
            InviteQueue.status.in_([InviteQueueStatus.SUCCESS, InviteQueueStatus.FAILED])
        ).delete()

        self.db.commit()

        if deleted > 0:
            logger.info(f"Cleaned up {deleted} old invite queue records")

    except Exception as e:
        logger.error(f"Cleanup failed: {e}")


@celery_app.task(bind=True, base=DatabaseTask)
def cleanup_expired_users(self):
    """
    清理过期用户（自动移出 Team）

    定时任务：每小时执行一次
    处理逻辑：
    1. 查找所有已过期但状态为 'bound' 的兑换码
    2. 使用状态机：bound -> removing -> removed
    3. 调用 ChatGPT API 移除用户
    4. 失败时重试，最终失败时发送 Telegram 告警
    """
    from app.models import Team, TeamMember, RebindHistory, RedeemCodeStatus
    from app.services.chatgpt_api import ChatGPTAPI, ChatGPTAPIError
    from app.cache import get_redis

    # 使用 Redis 分布式锁防止重复执行
    redis_client = get_redis()
    if not redis_client:
        logger.warning("Redis not available, skipping cleanup task")
        return

    lock_key = "celery:cleanup_expired_users:lock"
    lock = redis_client.lock(lock_key, timeout=300, blocking_timeout=1)

    if not lock.acquire(blocking=False):
        logger.info("Another cleanup task is running, skipping")
        return

    try:
        logger.info("Starting expired users cleanup")

        # 查找所有过期且状态为 'bound' 的兑换码
        expired_codes = self.db.query(RedeemCode).filter(
            RedeemCode.activated_at != None,
            RedeemCode.status.in_([None, RedeemCodeStatus.BOUND.value]),
            RedeemCode.is_active == True
        ).all()

        # 过滤出真正过期的（使用 @property is_user_expired）
        truly_expired = [code for code in expired_codes if code.is_user_expired]

        if not truly_expired:
            logger.info("No expired users found")
            return

        logger.info(f"Found {len(truly_expired)} expired users to clean up")

        removed_count = 0
        failed_count = 0

        for code in truly_expired:
            try:
                email = code.bound_email
                if not email:
                    continue

                # 查找用户所在的 Team
                invite_record = self.db.query(InviteRecord).filter(
                    InviteRecord.email == email,
                    InviteRecord.redeem_code == code.code,
                    InviteRecord.status == InviteStatus.SUCCESS
                ).order_by(InviteRecord.created_at.desc()).first()

                if not invite_record:
                    # 没有邀请记录，直接标记为 removed
                    code.status = RedeemCodeStatus.REMOVED.value
                    code.removed_at = datetime.utcnow()
                    removed_count += 1
                    logger.info(f"Marked {code.code} as removed (no invite record)")

                    # 记录监控指标
                    from app.metrics import record_expired_user_cleanup
                    record_expired_user_cleanup(success=True, reason="already_gone")
                    continue

                team = self.db.query(Team).filter(Team.id == invite_record.team_id).first()
                if not team:
                    # Team 不存在，直接标记为 removed
                    code.status = RedeemCodeStatus.REMOVED.value
                    code.removed_at = datetime.utcnow()
                    removed_count += 1
                    logger.info(f"Marked {code.code} as removed (team not found)")

                    # 记录监控指标
                    from app.metrics import record_expired_user_cleanup
                    record_expired_user_cleanup(success=True, reason="already_gone")
                    continue

                # 检查用户是否还在 Team 中
                member = self.db.query(TeamMember).filter(
                    TeamMember.team_id == team.id,
                    TeamMember.email == email
                ).first()

                if not member:
                    # 用户已经不在 Team 中了，直接标记为 removed
                    code.status = RedeemCodeStatus.REMOVED.value
                    code.removed_at = datetime.utcnow()
                    removed_count += 1
                    logger.info(f"Marked {code.code} as removed (user not in team)")

                    # 记录监控指标
                    from app.metrics import record_expired_user_cleanup
                    record_expired_user_cleanup(success=True, reason="already_gone")
                    continue

                # 尝试移除用户
                logger.info(f"Attempting to remove {email} from team {team.name}")

                # 更新状态为 removing
                code.status = RedeemCodeStatus.REMOVING.value
                self.db.commit()

                # 调用 ChatGPT API 移除用户
                api = ChatGPTAPI(team.session_token, team.device_id or "", team.cookie or "")
                result = asyncio.get_event_loop().run_until_complete(
                    api.remove_member(team.account_id, member.chatgpt_user_id)
                )

                # 移除成功，更新状态
                code.status = RedeemCodeStatus.REMOVED.value
                code.removed_at = datetime.utcnow()

                # 删除本地成员记录
                self.db.delete(member)

                # 创建历史记录
                history = RebindHistory(
                    redeem_code=code.code,
                    email=email,
                    from_team_id=team.id,
                    to_team_id=None,
                    reason="expired_cleanup",
                    notes=f"用户过期自动清理，过期时间: {code.user_expires_at.strftime('%Y-%m-%d')}"
                )
                self.db.add(history)

                self.db.commit()
                removed_count += 1

                logger.info(f"Successfully removed {email} from team {team.name}")

                # 记录监控指标
                from app.metrics import record_expired_user_cleanup
                record_expired_user_cleanup(success=True, reason="removed")

            except ChatGPTAPIError as e:
                failed_count += 1
                # API 错误，回滚状态
                code.status = RedeemCodeStatus.BOUND.value
                self.db.commit()

                logger.error(f"Failed to remove {email}: ChatGPT API error: {e.message}")

                # 记录监控指标
                from app.metrics import record_expired_user_cleanup
                record_expired_user_cleanup(success=False, reason="api_error")

                # 发送 Telegram 告警
                try:
                    asyncio.get_event_loop().run_until_complete(
                        _send_cleanup_failure_alert(email, code.code, team.name if team else "unknown", str(e))
                    )
                except Exception as tg_error:
                    logger.error(f"Failed to send Telegram alert: {tg_error}")

            except Exception as e:
                failed_count += 1
                # 其他错误，回滚状态
                code.status = RedeemCodeStatus.BOUND.value
                self.db.commit()

                logger.exception(f"Failed to remove {email}: {str(e)}")

        # 清除座位缓存
        invalidate_seat_cache()

        logger.info(f"Cleanup completed: removed={removed_count}, failed={failed_count}")

    except Exception as e:
        logger.exception(f"Cleanup task failed: {e}")
    finally:
        lock.release()


async def _send_cleanup_failure_alert(email: str, code: str, team_name: str, error_msg: str):
    """发送清理失败告警到 Telegram"""
    from app.models import SystemConfig
    from app.services.telegram import send_telegram_message

    db = SessionLocal()
    try:
        tg_enabled = db.query(SystemConfig).filter(SystemConfig.key == "telegram_enabled").first()
        if not tg_enabled or tg_enabled.value != "true":
            return

        bot_token_config = db.query(SystemConfig).filter(SystemConfig.key == "telegram_bot_token").first()
        chat_id_config = db.query(SystemConfig).filter(SystemConfig.key == "telegram_chat_id").first()

        if not bot_token_config or not chat_id_config:
            return

        message = f"""
⚠️ **过期用户清理失败**

📧 邮箱: `{email}`
🔑 兑换码: `{code}`
🏢 Team: `{team_name}`
❌ 错误: {error_msg}

请手动介入处理。
        """

        await send_telegram_message(bot_token_config.value, chat_id_config.value, message)

    except Exception as e:
        logger.error(f"Failed to send cleanup failure alert: {e}")
    finally:
        db.close()


@celery_app.task(
    bind=True,
    base=DatabaseTask,
    max_retries=3,
    default_retry_delay=60,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=300
)
def execute_migration_task(
    self,
    task_id: str,
    source_team_ids: List[int],
    destination_team_id: int,
    emails: List[str],
    operator: str
):
    """
    执行成员批量迁移任务

    Args:
        task_id: 任务 ID（用于跟踪）
        source_team_ids: 源 Team ID 列表
        destination_team_id: 目标 Team ID
        emails: 待迁移的邮箱列表
        operator: 操作人

    Returns:
        dict: 迁移结果
    """
    from app.models import Team, TeamMember, RebindHistory
    from app.services.chatgpt_api import ChatGPTAPI, ChatGPTAPIError
    from app.cache import get_redis
    import time

    logger.info(f"Starting migration task {task_id}: {len(emails)} emails")

    # 使用 Redis 分布式锁防止重复执行
    redis_client = get_redis()
    lock = None
    if redis_client:
        lock_key = f"celery:migration:{task_id}:lock"
        lock = redis_client.lock(lock_key, timeout=3600)  # 1小时超时
        if not lock.acquire(blocking=False):
            logger.warning(f"Migration task {task_id} is already running")
            return {"success": False, "error": "Task already running"}

    try:
        # 获取目标 Team
        dest_team = self.db.query(Team).filter(Team.id == destination_team_id).first()
        if not dest_team:
            logger.error(f"Destination team {destination_team_id} not found")
            return {"success": False, "error": "Destination team not found"}

        source_teams = self.db.query(Team).filter(Team.id.in_(source_team_ids)).all()

        api = ChatGPTAPI(dest_team.session_token, dest_team.device_id or "", dest_team.cookie or "")

        success_count = 0
        fail_count = 0
        failed_emails = []
        results = []

        for email in emails:
            try:
                # 在 Celery worker 中运行异步函数
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    loop.run_until_complete(
                        api.invite_members(dest_team.account_id, [email])
                    )
                finally:
                    loop.close()

                # 记录迁移历史
                source_member = self.db.query(TeamMember).filter(
                    TeamMember.email == email,
                    TeamMember.team_id.in_(source_team_ids)
                ).first()

                if source_member:
                    history = RebindHistory(
                        redeem_code="",
                        email=email,
                        from_team_id=source_member.team_id,
                        to_team_id=destination_team_id,
                        reason="admin_migration",
                        notes=f"批量迁移任务 {task_id} by {operator}"
                    )
                    self.db.add(history)

                success_count += 1
                results.append({"email": email, "success": True})
                logger.info(f"Migration task {task_id}: invited {email}")

            except ChatGPTAPIError as e:
                fail_count += 1
                failed_emails.append(email)
                results.append({"email": email, "success": False, "error": e.message})
                logger.warning(f"Migration task {task_id}: failed to invite {email}: {e.message}")

            except Exception as e:
                fail_count += 1
                failed_emails.append(email)
                results.append({"email": email, "success": False, "error": str(e)})
                logger.error(f"Migration task {task_id}: error inviting {email}: {e}")

            # 避免 API 限流
            time.sleep(1)

        self.db.commit()

        # 发送完成通知
        try:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                loop.run_until_complete(_send_migration_complete_notification(
                    source_teams=[t.name for t in source_teams],
                    target_team=dest_team.name,
                    success_count=success_count,
                    fail_count=fail_count,
                    operator=operator
                ))
            finally:
                loop.close()
        except Exception as e:
            logger.warning(f"Failed to send migration notification: {e}")

        logger.info(f"Migration task {task_id} completed: success={success_count}, failed={fail_count}")

        return {
            "success": True,
            "task_id": task_id,
            "total": len(emails),
            "success_count": success_count,
            "fail_count": fail_count,
            "failed_emails": failed_emails,
            "results": results
        }

    except Exception as e:
        logger.exception(f"Migration task {task_id} failed: {e}")
        raise self.retry(exc=e)

    finally:
        if lock:
            try:
                lock.release()
            except:
                pass


async def _send_migration_complete_notification(
    source_teams: List[str],
    target_team: str,
    success_count: int,
    fail_count: int,
    operator: str
):
    """发送迁移完成通知到 Telegram"""
    from app.models import SystemConfig
    from app.services.telegram import notify_migration_completed

    db = SessionLocal()
    try:
        tg_enabled = db.query(SystemConfig).filter(SystemConfig.key == "telegram_enabled").first()
        if not tg_enabled or tg_enabled.value != "true":
            return

        bot_token = db.query(SystemConfig).filter(SystemConfig.key == "telegram_bot_token").first()
        chat_id = db.query(SystemConfig).filter(SystemConfig.key == "telegram_chat_id").first()

        if not bot_token or not chat_id:
            return

        await notify_migration_completed(
            bot_token.value,
            chat_id.value,
            source_teams,
            target_team,
            success_count,
            fail_count,
            operator
        )

    except Exception as e:
        logger.error(f"Failed to send migration notification: {e}")
    finally:
        db.close()


@celery_app.task(bind=True, base=DatabaseTask)
def retry_failed_invites(self):
    """
    处理等待队列中的邀请任务

    定时任务：每 5 分钟执行一次
    处理逻辑：
    1. 检查是否有可用座位
    2. 查找状态为 WAITING 的邀请（按创建时间排序，先进先出）
    3. 按可用座位数量消费等待队列
    4. 重新提交 Celery 任务处理邀请
    """
    from app.cache import get_redis
    from app.services.seat_calculator import get_all_teams_with_seats

    # 使用 Redis 分布式锁防止重复执行
    redis_client = get_redis()
    if not redis_client:
        logger.warning("Redis not available, skipping waiting queue task")
        return

    lock_key = "celery:process_waiting_queue:lock"
    lock = redis_client.lock(lock_key, timeout=300, blocking_timeout=1)

    if not lock.acquire(blocking=False):
        logger.info("Another waiting queue task is running, skipping")
        return

    try:
        logger.info("Starting waiting queue processing task")

        # 1. 检查是否有可用座位
        teams_with_seats = get_all_teams_with_seats(self.db, only_active=True)
        total_available = sum(t.available_seats for t in teams_with_seats)

        if total_available == 0:
            logger.info("No available seats, skipping waiting queue processing")
            return

        logger.info(f"Found {total_available} available seats, processing waiting queue")

        # 2. 按分组统计可用座位
        group_seats = {}  # group_id -> available_seats
        for team in teams_with_seats:
            gid = team.group_id or 0
            group_seats[gid] = group_seats.get(gid, 0) + team.available_seats

        # 3. 查找等待中的邀请（按创建时间排序，先进先出）
        waiting_records = self.db.query(InviteQueue).filter(
            InviteQueue.status == InviteQueueStatus.WAITING
        ).order_by(InviteQueue.created_at.asc()).limit(100).all()

        if not waiting_records:
            logger.info("No waiting invites in queue")
            return

        logger.info(f"Found {len(waiting_records)} waiting invites")

        processed_count = 0
        skipped_count = 0

        for record in waiting_records:
            # 检查该分组是否有空位
            gid = record.group_id or 0
            available_for_group = group_seats.get(gid, 0)

            # 如果指定了分组但该分组没有空位，检查无分组的 Team
            if available_for_group <= 0 and gid != 0:
                available_for_group = group_seats.get(0, 0)

            if available_for_group <= 0:
                skipped_count += 1
                continue

            # 检查兑换码是否仍然有效
            if record.redeem_code:
                code = self.db.query(RedeemCode).filter(
                    RedeemCode.code == record.redeem_code,
                    RedeemCode.is_active == True
                ).first()

                if not code:
                    logger.info(f"Skipping {record.email}: redeem code inactive")
                    record.status = InviteQueueStatus.FAILED
                    record.error_message = "兑换码已失效"
                    record.processed_at = datetime.utcnow()
                    skipped_count += 1
                    continue

                # 检查有效期
                if code.expires_at and code.expires_at < datetime.utcnow():
                    logger.info(f"Skipping {record.email}: redeem code expired")
                    record.status = InviteQueueStatus.FAILED
                    record.error_message = "兑换码已过期"
                    record.processed_at = datetime.utcnow()
                    skipped_count += 1
                    continue

            # 更新状态为 PROCESSING
            record.status = InviteQueueStatus.PROCESSING
            record.retry_count += 1
            record.error_message = f"从等待队列取出处理 (第{record.retry_count}次)"
            self.db.commit()

            # 减少该分组的可用座位计数（本地跟踪，避免超发）
            if gid in group_seats:
                group_seats[gid] -= 1
            else:
                group_seats[0] = group_seats.get(0, 1) - 1

            # 重新提交 Celery 任务
            try:
                process_invite_task.delay(
                    email=record.email,
                    redeem_code=record.redeem_code,
                    group_id=record.group_id,
                    is_rebind=False
                )
                processed_count += 1
                logger.info(f"Processed waiting invite for {record.email}")

            except Exception as e:
                logger.error(f"Failed to submit task for {record.email}: {e}")
                record.status = InviteQueueStatus.WAITING  # 重新等待
                record.error_message = f"任务提交失败: {str(e)[:100]}"
                self.db.commit()

        self.db.commit()

        logger.info(f"Waiting queue processing completed: processed={processed_count}, skipped={skipped_count}")

        # 发送 Telegram 汇报
        if processed_count > 0:
            try:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    loop.run_until_complete(
                        _send_waiting_queue_notification(processed_count, skipped_count, total_available)
                    )
                finally:
                    loop.close()
            except Exception as e:
                logger.warning(f"Failed to send notification: {e}")

    except Exception as e:
        logger.exception(f"Waiting queue processing task failed: {e}")
    finally:
        lock.release()


async def _send_waiting_queue_notification(processed: int, skipped: int, available_seats: int):
    """发送等待队列处理通知到 Telegram"""
    from app.models import SystemConfig
    from app.services.telegram import send_telegram_message

    db = SessionLocal()
    try:
        tg_enabled = db.query(SystemConfig).filter(SystemConfig.key == "telegram_enabled").first()
        if not tg_enabled or tg_enabled.value != "true":
            return

        bot_token = db.query(SystemConfig).filter(SystemConfig.key == "telegram_bot_token").first()
        chat_id = db.query(SystemConfig).filter(SystemConfig.key == "telegram_chat_id").first()

        if not bot_token or not chat_id:
            return

        message = f"""
🔄 **等待队列处理报告**

✅ 已处理: {processed} 个邀请
⏭️ 跳过: {skipped} 个（无空位或兑换码失效）
💺 当前可用座位: {available_seats}

系统已自动处理等待中的邀请请求。
        """

        await send_telegram_message(bot_token.value, chat_id.value, message)

    except Exception as e:
        logger.error(f"Failed to send waiting queue notification: {e}")
    finally:
        db.close()
