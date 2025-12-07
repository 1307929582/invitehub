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
        logger.error(f"Invite task failed: {email}, error: {str(e)}")
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

        # 抛出异常触发重试
        raise self.retry(exc=e)


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
