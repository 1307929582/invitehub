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
from app.config import settings
from app.database import SessionLocal
from app.models import InviteRecord, InviteStatus, InviteQueue, InviteQueueStatus, RedeemCode, Order, OrderStatus, Plan
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
    is_rebind: bool = False,
    consume_rebind_count: bool = False,  # 是否消耗换车次数（用于回滚）
    old_team_id: int = None,  # 原 Team ID（用于踢人）
    old_team_chatgpt_user_id: str = None,  # 原 chatgpt_user_id（用于踢人）
    used_redis: bool = False,  # 是否使用了 Redis 令牌桶（用于回滚判断）
    consume_immediately: bool = True,  # 是否在请求阶段已消耗次数
    reserved_team_id: int = None  # P0-1: 预占的 Team ID（已在 API 层预占座位）
):
    """
    处理单个邀请请求（Celery 任务）

    Args:
        email: 用户邮箱
        redeem_code: 兑换码
        group_id: 分组 ID（可选）
        is_rebind: 是否为换车操作
        consume_rebind_count: 是否消耗换车次数（用于回滚判断）
        old_team_id: 原 Team ID（换车时踢出原 Team）
        old_team_chatgpt_user_id: 原 chatgpt_user_id（换车时踢出原 Team）
        used_redis: 是否使用了 Redis 令牌桶（用于回滚判断）
        reserved_team_id: 预占的 Team ID（P0-1 核心：API 层已预占座位，Celery 直接使用）

    Raises:
        Retry: 失败时自动重试（最多3次）
    """
    try:
        logger.info(f"Processing invite task: {email}, is_rebind: {is_rebind}, reserved_team_id: {reserved_team_id}, used_redis: {used_redis}")

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
                "consume_rebind_count": consume_rebind_count,
                "old_team_id": old_team_id,
                "old_team_chatgpt_user_id": old_team_chatgpt_user_id,
                "consume_immediately": consume_immediately,
                "reserved_team_id": reserved_team_id,  # P0-1: 传递预占的 Team ID
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
                processed_at=datetime.utcnow(),
                is_rebind=is_rebind,
                old_team_id=old_team_id,
                old_team_chatgpt_user_id=old_team_chatgpt_user_id,
                consume_immediately=consume_immediately
            )
            self.db.add(queue_record)
            self.db.commit()
        except Exception as db_err:
            logger.error(f"Failed to record error: {db_err}")

        # 最终失败时回滚兑换码使用次数和 RESERVED 记录
        if is_final_failure and redeem_code:
            try:
                _rollback_redeem_code_usage(
                    self.db,
                    redeem_code,
                    email,
                    is_rebind,
                    consume_rebind_count,
                    used_redis,
                    reserved_team_id,
                    consume_immediately
                )
                logger.info(f"Rolled back redeem code usage for {redeem_code} after final failure")
            except Exception as rollback_err:
                logger.error(f"Failed to rollback redeem code: {rollback_err}")

        # 抛出异常触发重试（如果还有重试次数）
        raise self.retry(exc=e)


def _rollback_redeem_code_usage(
    db: Session,
    code_str: str,
    email: str,
    is_rebind: bool,
    consume_rebind_count: bool = False,
    used_redis: bool = False,
    reserved_team_id: int = None,
    consume_immediately: bool = True
):
    """
    回滚兑换码使用次数和 RESERVED 记录

    当邀请最终失败时，回滚 Redis 令牌桶、数据库中的使用计数和 RESERVED 记录。

    Args:
        db: 数据库会话
        code_str: 兑换码
        email: 用户邮箱
        is_rebind: 是否为换车操作
        consume_rebind_count: 是否消耗了换车次数（只有 True 时才回滚 rebind_count）
        used_redis: 是否使用了 Redis 令牌桶（只有 True 时才回滚 Redis）
        reserved_team_id: 预占的 Team ID（用于删除 RESERVED 记录）
    """
    from sqlalchemy import update
    from app.cache import get_redis
    from app.services.redeem_limiter import RedeemLimiter

    # 先查询兑换码，获取 max_uses 信息
    code = db.query(RedeemCode).filter(RedeemCode.code == code_str).first()
    if not code:
        logger.warning(f"RedeemCode {code_str} not found for rollback")
        return

    # 0. 删除 RESERVED 记录（P0-1 新增）
    if reserved_team_id:
        try:
            deleted = db.query(InviteRecord).filter(
                InviteRecord.email == email.lower().strip(),
                InviteRecord.redeem_code == code_str,
                InviteRecord.status == InviteStatus.RESERVED,
                InviteRecord.team_id == reserved_team_id
            ).delete()
            if deleted > 0:
                db.commit()
                logger.info(f"Deleted RESERVED record for {email} in team {reserved_team_id}")
        except Exception as e:
            logger.error(f"Failed to delete RESERVED record: {e}")

    if not consume_immediately:
        return

    # 1. 回滚 Redis 令牌桶（仅当确实使用了 Redis 时才回滚）
    redis_client = get_redis()
    if redis_client and used_redis and code.max_uses > 0:
        limiter = RedeemLimiter(redis_client)
        limiter.refund(code_str)
        logger.info(f"Refunded Redis token for code {code_str}")

    # 2. 回滚数据库使用计数（仅当 bound_email 匹配时才回滚，防止误回滚他人的码）
    if code.used_count > 0 and code.bound_email and code.bound_email.lower() == email.lower():
        db.execute(
            update(RedeemCode)
            .where(RedeemCode.code == code_str)
            .where(RedeemCode.used_count > 0)
            .where(RedeemCode.bound_email == code.bound_email)  # 保护：确保是绑定邮箱的码
            .values(used_count=RedeemCode.used_count - 1)
        )
        db.commit()
        logger.info(f"Rolled back database used_count for code {code_str}")
    elif code.used_count > 0:
        logger.warning(f"Skip rollback used_count: bound_email mismatch for code {code_str}, email={email}, bound={code.bound_email}")

    # 3. 如果是换车操作且消耗了次数，回滚换车计数
    if is_rebind and consume_rebind_count and code.rebind_count and code.rebind_count > 0:
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
        if not settings.REDEEM_REDIS_LIMITER_ENABLED:
            return
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

        # 跳过不限量码（不使用 Redis 令牌桶）
        if code.max_uses == 0:
            logger.debug(f"Skip sync for unlimited code: {code.code}")
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
        if not settings.REDEEM_REDIS_LIMITER_ENABLED:
            return
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
            # 跳过不限量码（不使用 Redis 令牌桶）
            if code.max_uses == 0:
                continue

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

                # ✅ 核心修复：检查用户是否还有其他有效兑换码（防止误踢续费用户）
                all_user_codes = self.db.query(RedeemCode).filter(
                    RedeemCode.bound_email == email,
                    RedeemCode.is_active == True,
                    RedeemCode.activated_at != None,
                    RedeemCode.id != code.id  # 排除当前兑换码
                ).all()

                # 过滤出真正有效的（未过期）
                valid_codes = [c for c in all_user_codes if not c.is_user_expired]

                if len(valid_codes) > 0:
                    # 用户还有其他有效兑换码，仅标记当前码为 REMOVED，不踢出用户
                    code.status = RedeemCodeStatus.REMOVED.value
                    code.removed_at = datetime.utcnow()
                    self.db.commit()
                    removed_count += 1
                    logger.info(f"Marked {code.code} as removed (user has {len(valid_codes)} other valid codes)", extra={
                        "email": email,
                        "code": code.code,
                        "valid_codes_count": len(valid_codes)
                    })

                    # 记录监控指标
                    from app.metrics import record_expired_user_cleanup
                    record_expired_user_cleanup(success=True, reason="has_valid_codes")
                    continue

                # 用户没有其他有效兑换码，执行踢出逻辑
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

                # 增加重试计数
                if code.removal_retry_count is None:
                    code.removal_retry_count = 0
                code.removal_retry_count += 1

                # 重试 5 次后标记为 REMOVAL_FAILED，不再自动重试
                if code.removal_retry_count >= 5:
                    code.status = RedeemCodeStatus.REMOVAL_FAILED.value
                    self.db.commit()

                    logger.error(f"Failed to remove {email} after 5 retries, marked as REMOVAL_FAILED", extra={
                        "email": email,
                        "code": code.code,
                        "team": team.name if team else "unknown",
                        "error": e.message
                    })

                    # 记录监控指标
                    from app.metrics import record_expired_user_cleanup
                    record_expired_user_cleanup(success=False, reason="max_retries_exceeded")

                    # 过期清理失败不再发送 Telegram 告警
                else:
                    # 回滚状态，下次重试
                    code.status = RedeemCodeStatus.BOUND.value
                    self.db.commit()

                    logger.warning(f"Failed to remove {email}, will retry ({code.removal_retry_count}/5): {e.message}", extra={
                        "email": email,
                        "code": code.code,
                        "retry_count": code.removal_retry_count
                    })

                    # 记录监控指标
                    from app.metrics import record_expired_user_cleanup
                    record_expired_user_cleanup(success=False, reason="api_error")

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




async def _send_expiration_warning_email(email: str, code: str, days_left: int, expires_at: str):
    """发送过期提醒邮件"""
    from app.services.email import send_email

    subject = f"【重要】您的 ChatGPT Team 座位将在 {days_left} 天后过期"

    body = f"""
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
    <h2 style="color: #ff9500;">⏰ 座位即将过期提醒</h2>

    <p>您好，</p>

    <p>您的 ChatGPT Team 座位即将到期：</p>

    <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 10px 0;"><strong>兑换码：</strong> <code>{code}</code></p>
        <p style="margin: 10px 0;"><strong>剩余天数：</strong> <span style="color: #ff3b30; font-size: 18px; font-weight: bold;">{days_left} 天</span></p>
        <p style="margin: 10px 0;"><strong>过期时间：</strong> {expires_at}</p>
    </div>

    <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
        <p style="margin: 0;"><strong>重要提示：</strong></p>
        <p style="margin: 10px 0 0;">过期后您将自动从 Team 中移除，请及时续费以保持座位。</p>
    </div>

    <p>如需续费，请访问我们的商店页面购买新的兑换码。</p>

    <p style="color: #86868b; font-size: 12px; margin-top: 30px;">
        此邮件为系统自动发送，请勿直接回复。
    </p>
</div>
    """

    try:
        await send_email(
            to_email=email,
            subject=subject,
            body=body
        )
        logger.info(f"Sent expiration warning to {email}, {days_left} days left")
    except Exception as e:
        logger.error(f"Failed to send expiration warning to {email}: {e}")


@celery_app.task(bind=True, base=DatabaseTask)
def send_expiration_warnings(self):
    """
    发送过期提醒邮件

    定时任务：每天执行一次
    提醒时间：7 天、3 天、1 天
    """
    from app.cache import get_redis
    from datetime import datetime, timedelta

    logger.info("Starting expiration warnings task")

    # 使用 Redis 锁防止重复执行
    redis_client = get_redis()
    if not redis_client:
        logger.warning("Redis not available, skipping expiration warnings")
        return

    lock_key = "celery:expiration_warnings:lock"
    lock = redis_client.lock(lock_key, timeout=1800)  # 30 分钟超时

    if not lock.acquire(blocking=False):
        logger.info("Expiration warnings task is already running")
        return

    try:
        now = datetime.utcnow()
        warning_periods = [7, 3, 1]  # 提前 7 天、3 天、1 天提醒
        total_sent = 0

        for days in warning_periods:
            # 计算目标日期范围（当天的 00:00 到 23:59）
            target_date = now + timedelta(days=days)
            day_start = target_date.replace(hour=0, minute=0, second=0, microsecond=0)
            day_end = day_start + timedelta(days=1)

            # 查找即将在 X 天后过期的兑换码
            expiring_codes = self.db.query(RedeemCode).filter(
                RedeemCode.is_active == True,
                RedeemCode.activated_at != None,
                RedeemCode.bound_email != None,
                RedeemCode.status.in_([None, RedeemCodeStatus.BOUND.value])
            ).all()

            # 过滤出过期时间在目标日期的
            codes_to_warn = []
            for code in expiring_codes:
                if code.user_expires_at:
                    # 检查是否在目标日期范围内
                    if day_start <= code.user_expires_at < day_end:
                        codes_to_warn.append(code)

            # 去重：同一用户只发送一次（选择最早过期的兑换码）
            email_to_code = {}
            for code in codes_to_warn:
                email = code.bound_email
                if email not in email_to_code or code.user_expires_at < email_to_code[email].user_expires_at:
                    email_to_code[email] = code

            # 发送提醒邮件
            for email, code in email_to_code.items():
                try:
                    # 检查是否已发送过该天数的提醒（使用 Redis 缓存）
                    cache_key = f"expiration_warning:{email}:{days}"
                    if redis_client.exists(cache_key):
                        logger.debug(f"Already sent {days}-day warning to {email}")
                        continue

                    # 发送邮件
                    expires_at_str = code.user_expires_at.strftime('%Y-%m-%d')
                    asyncio.get_event_loop().run_until_complete(
                        _send_expiration_warning_email(email, code.code, days, expires_at_str)
                    )

                    # 标记为已发送（缓存 7 天）
                    redis_client.setex(cache_key, 604800, "1")
                    total_sent += 1

                except Exception as e:
                    logger.error(f"Failed to send warning to {email}: {e}")

        logger.info(f"Expiration warnings completed: sent={total_sent}")

    except Exception as e:
        logger.exception(f"Expiration warnings task failed: {e}")
    finally:
        lock.release()


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
                    is_rebind=record.is_rebind,
                    old_team_id=getattr(record, "old_team_id", None),
                    old_team_chatgpt_user_id=getattr(record, "old_team_chatgpt_user_id", None),
                    consume_immediately=getattr(record, "consume_immediately", True)
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


@celery_app.task(bind=True, base=DatabaseTask)
def detect_orphan_users(self):
    """
    检测孤儿用户（同时在多个 Team 的用户）

    定时任务：每 30 分钟执行一次
    这是关键的健康检查，理论上孤儿用户数应该永远为 0
    """
    from app.models import TeamMember, Team, TeamStatus
    from app.metrics import orphan_users_count
    from sqlalchemy import func
    import asyncio

    try:
        # 查找同时在多个健康 Team 中的用户
        # 只检查健康的 Team（is_active=True AND status=ACTIVE）
        orphan_query = (
            self.db.query(TeamMember.email, func.count(func.distinct(TeamMember.team_id)).label('team_count'))
            .join(Team, TeamMember.team_id == Team.id)
            .filter(
                Team.is_active == True,
                Team.status == TeamStatus.ACTIVE
            )
            .group_by(TeamMember.email)
            .having(func.count(func.distinct(TeamMember.team_id)) > 1)
        )

        orphan_users = orphan_query.all()
        orphan_count = len(orphan_users)

        # 更新监控指标
        orphan_users_count.set(orphan_count)

        if orphan_count > 0:
            logger.error(f"Detected {orphan_count} orphan users!", extra={
                "orphan_users": [(email, count) for email, count in orphan_users]
            })

            # 发送 P0 告警到 Telegram
            try:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    loop.run_until_complete(_send_orphan_alert(orphan_users))
                finally:
                    loop.close()
            except Exception as e:
                logger.error(f"Failed to send orphan alert: {e}")
        else:
            logger.info("No orphan users detected - system healthy")

    except Exception as e:
        logger.exception(f"Orphan user detection failed: {e}")


@celery_app.task(bind=True, base=DatabaseTask)
def sync_temp_mailboxes(self):
    """
    同步临时邮箱列表并绑定到 Team（基于邮箱地址解析 Team ID）

    定时任务：每小时执行一次
    """
    from app.models import Team, OperationLog
    from app.services.mail_api import (
        get_mail_settings,
        list_emails,
        extract_email_fields,
        extract_team_suffix_from_address,
    )
    from datetime import datetime
    from sqlalchemy import func

    settings = get_mail_settings(self.db)
    if not settings.get("enabled"):
        return

    logger.info("Starting temp mailbox sync")
    cursor = None
    updated = 0
    scanned = 0
    matched = 0

    while True:
        items, next_cursor = list_emails(settings, cursor)
        if not items:
            break

        for item in items:
            scanned += 1
            email_id, address = extract_email_fields(item)
            if not email_id or not address:
                continue

            suffix = extract_team_suffix_from_address(address, settings)
            if not suffix:
                continue

            team = None
            if suffix.isdigit():
                team = self.db.query(Team).filter(Team.id == int(suffix)).first()
            if not team:
                team = self.db.query(Team).filter(
                    func.lower(Team.name) == f"team+{suffix}".lower()
                ).first()
            if not team and suffix.isdigit():
                team = self.db.query(Team).filter(
                    func.lower(Team.name) == f"team+{int(suffix)}".lower()
                ).first()
            if not team:
                continue
            matched += 1

            changed = False
            if team.mailbox_id != email_id:
                team.mailbox_id = email_id
                changed = True
            if team.mailbox_email != address:
                team.mailbox_email = address
                changed = True

            if changed:
                team.mailbox_synced_at = datetime.utcnow()
                updated += 1

        if not next_cursor or next_cursor == cursor:
            break
        cursor = next_cursor

    if updated:
        self.db.commit()
        logger.info(f"Temp mailbox sync updated {updated} teams")

    # 记录操作日志
    try:
        log = OperationLog(
            user_id=None,
            action="mail_sync",
            target="temp_mailbox",
            details=f"scanned={scanned}, matched={matched}, updated={updated}",
            ip_address="system"
        )
        self.db.add(log)
        self.db.commit()
    except Exception as e:
        logger.warning(f"Failed to write mail_sync log: {e}")


@celery_app.task(bind=True, base=DatabaseTask)
def scan_ban_emails(self):
    """
    扫描临时邮箱中的封禁邮件并更新 Team 状态为 BANNED

    定时任务：每 5 分钟执行一次
    """
    from app.models import Team, TeamStatus, TeamMember, OperationLog
    from app.services.mail_api import (
        get_mail_settings,
        list_messages,
        get_message,
        extract_message_fields,
        extract_body,
        is_ban_message,
        get_mail_cursor,
        set_mail_cursor,
    )
    from app.services.telegram import send_admin_notification
    from datetime import datetime

    settings = get_mail_settings(self.db)
    if not settings.get("enabled"):
        return

    teams = self.db.query(Team).filter(Team.mailbox_id.isnot(None)).all()
    if not teams:
        try:
            summary = OperationLog(
                user_id=None,
                action="mail_scan",
                target="ban_email",
                details="mailboxes=0, matched=0, banned=0 (no mailboxes)",
                ip_address="system"
            )
            self.db.add(summary)
            self.db.commit()
        except Exception as e:
            logger.warning(f"Failed to write mail_scan log (no mailboxes): {e}")
        return

    logger.info(f"Scanning ban emails for {len(teams)} mailboxes")
    scanned_boxes = 0
    matched_messages = 0
    banned_teams = 0

    for team in teams:
        email_id = team.mailbox_id
        if not email_id:
            continue
        scanned_boxes += 1

        cursor = get_mail_cursor(self.db, email_id)
        messages, next_cursor = list_messages(settings, email_id, cursor)

        for item in messages:
            message_id, subject, sender, snippet = extract_message_fields(item)
            if not message_id:
                continue

            # 先用摘要判断，命中后再拉取详情
            if not is_ban_message(sender, subject, snippet, settings):
                continue

            detail = get_message(settings, email_id, message_id) or {}
            body = extract_body(detail) or snippet

            if not is_ban_message(sender, subject, body, settings):
                continue

            matched_messages += 1
            if team.status != TeamStatus.BANNED:
                team.status = TeamStatus.BANNED
                team.status_message = f"Email detected: {subject[:160]}"
                team.status_changed_at = datetime.utcnow()
                self.db.commit()
                banned_teams += 1

                # 记录日志（按 Team）
                try:
                    log = OperationLog(
                        user_id=None,
                        team_id=team.id,
                        action="mail_ban",
                        target=team.name,
                        details=f"subject={subject[:160]}",
                        ip_address="system"
                    )
                    self.db.add(log)
                    self.db.commit()
                except Exception as e:
                    logger.warning(f"Failed to write mail_ban log for team {team.id}: {e}")

                # 发送 Telegram 通知
                try:
                    member_count = self.db.query(TeamMember).filter(TeamMember.team_id == team.id).count()
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)
                    try:
                        loop.run_until_complete(
                            send_admin_notification(
                                self.db,
                                "team_banned",
                                team_name=team.name,
                                team_id=team.id,
                                member_count=member_count,
                                error_message=team.status_message or ""
                            )
                        )
                    finally:
                        loop.close()
                except Exception as e:
                    logger.warning(f"Failed to send ban alert for team {team.id}: {e}")

        if next_cursor and next_cursor != cursor:
            set_mail_cursor(self.db, email_id, next_cursor)

    # 扫描汇总日志
    try:
        summary = OperationLog(
            user_id=None,
            action="mail_scan",
            target="ban_email",
            details=f"mailboxes={scanned_boxes}, matched={matched_messages}, banned={banned_teams}",
            ip_address="system"
        )
        self.db.add(summary)
        self.db.commit()
    except Exception as e:
        logger.warning(f"Failed to write mail_scan log: {e}")

async def _send_orphan_alert(orphan_users: list):
    """发送孤儿用户告警到 Telegram"""
    from app.models import SystemConfig, TeamMember, Team
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

        # 构建详细信息
        details = []
        for email, team_count in orphan_users[:10]:  # 最多显示 10 个
            # 查找该用户所在的所有 Team
            members = db.query(TeamMember).join(Team).filter(
                TeamMember.email == email,
                Team.is_active == True,
                Team.status == TeamStatus.ACTIVE
            ).all()
            team_names = [db.query(Team).filter(Team.id == m.team_id).first().name for m in members]
            details.append(f"• {email}: {', '.join(team_names)}")

        # 先构建详情字符串，避免 f-string 中使用反斜杠
        details_text = '\n'.join(details)

        message_text = f"""
🚨 **P0 告警：检测到孤儿用户！**

⚠️ 发现 {len(orphan_users)} 个用户同时存在于多个 Team 中。
这是严重的数据一致性问题，需要立即处理！

详情（前 10 个）：
{details_text}

可能原因：
- 换车逻辑未正确踢出原 Team
- 清理任务失败
- 并发操作导致的数据不一致

请立即检查并修复！
        """

        await send_telegram_message(bot_token.value, chat_id.value, message_text)

    except Exception as e:
        logger.error(f"Failed to send orphan alert: {e}")
    finally:
        db.close()


@celery_app.task(bind=True, base=DatabaseTask)
def cleanup_stale_reserved_records(self):
    """
    清理过期的 RESERVED 记录（P0-1 防超员补充逻辑）

    定时任务：每 15 分钟执行一次
    处理逻辑：
    1. 查找 1 小时前创建的 RESERVED 状态记录（这些记录应该已经被处理）
    2. 删除这些过期记录，释放预占的座位
    3. 记录清理日志

    Note: RESERVED 记录正常情况下会在 Celery 任务中被更新为 SUCCESS 或 FAILED。
    如果长时间保持 RESERVED 状态，说明 Celery 任务执行失败且未正确回滚。
    """
    from app.cache import get_redis, invalidate_seat_cache
    from datetime import timedelta

    # 使用 Redis 分布式锁防止重复执行
    redis_client = get_redis()
    if not redis_client:
        logger.warning("Redis not available, skipping stale RESERVED cleanup")
        return

    lock_key = "celery:cleanup_stale_reserved:lock"
    lock = redis_client.lock(lock_key, timeout=300, blocking_timeout=1)

    if not lock.acquire(blocking=False):
        logger.info("Another stale RESERVED cleanup task is running, skipping")
        return

    try:
        logger.info("Starting stale RESERVED records cleanup")

        # 1 小时前的记录被视为过期
        stale_cutoff = datetime.utcnow() - timedelta(hours=1)

        # 查找过期的 RESERVED 记录
        stale_records = self.db.query(InviteRecord).filter(
            InviteRecord.status == InviteStatus.RESERVED,
            InviteRecord.created_at < stale_cutoff
        ).all()

        if not stale_records:
            logger.info("No stale RESERVED records found")
            return

        logger.warning(f"Found {len(stale_records)} stale RESERVED records to clean up")

        cleaned_count = 0
        failed_count = 0

        for record in stale_records:
            try:
                # 记录日志
                logger.info(f"Cleaning stale RESERVED: email={record.email}, "
                           f"team_id={record.team_id}, code={record.redeem_code}, "
                           f"created_at={record.created_at}")

                # 尝试回滚兑换码使用次数（如果有关联的兑换码）
                if record.redeem_code:
                    try:
                        code = self.db.query(RedeemCode).filter(
                            RedeemCode.code == record.redeem_code
                        ).first()

                        if code and code.used_count > 0:
                            # 回滚 used_count（只有当 bound_email 匹配时才回滚）
                            if code.bound_email and code.bound_email.lower() == record.email.lower():
                                code.used_count = max(0, code.used_count - 1)
                                logger.info(f"Rolled back used_count for code {code.code}")
                    except Exception as rollback_err:
                        logger.warning(f"Failed to rollback code usage: {rollback_err}")

                # 删除 RESERVED 记录
                self.db.delete(record)
                cleaned_count += 1

            except Exception as e:
                logger.error(f"Failed to clean RESERVED record {record.id}: {e}")
                failed_count += 1

        # 提交更改
        self.db.commit()

        # 清除座位缓存
        invalidate_seat_cache()

        logger.info(f"Stale RESERVED cleanup completed: cleaned={cleaned_count}, failed={failed_count}")

        # 发送告警（如果清理了大量记录，可能存在系统问题）
        if cleaned_count >= 5:
            try:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    loop.run_until_complete(
                        _send_stale_reserved_alert(cleaned_count, failed_count)
                    )
                finally:
                    loop.close()
            except Exception as e:
                logger.warning(f"Failed to send stale RESERVED alert: {e}")

    except Exception as e:
        logger.exception(f"Stale RESERVED cleanup task failed: {e}")
    finally:
        lock.release()


async def _send_stale_reserved_alert(cleaned_count: int, failed_count: int):
    """发送过期 RESERVED 记录清理告警到 Telegram"""
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
⚠️ **RESERVED 记录清理告警**

🧹 清理了 {cleaned_count} 条过期 RESERVED 记录
❌ 失败: {failed_count} 条

这些记录在创建 1 小时后仍未被处理，可能原因：
- Celery 任务执行失败
- 系统重启导致任务丢失
- 网络或 API 故障

请检查 Celery 日志和系统健康状态。
        """

        await send_telegram_message(bot_token.value, chat_id.value, message)

    except Exception as e:
        logger.error(f"Failed to send stale RESERVED alert: {e}")
    finally:
        db.close()


@celery_app.task(bind=True, base=DatabaseTask)
def cleanup_expired_orders(self):
    """
    清理过期订单并释放预扣库存

    处理逻辑：
    1. 查找所有 PENDING 状态且已过期的 linuxdo 订单
    2. 将状态更新为 EXPIRED
    3. 释放预扣的库存（sold_count - 1）
    """
    from app.services.distributed_limiter import DistributedLock

    lock = DistributedLock("cleanup_expired_orders", timeout=300)
    if not lock.acquire(blocking=False):
        logger.info("cleanup_expired_orders: Another instance is running, skipping")
        return

    try:
        now = datetime.utcnow()

        # 查找过期的 PENDING 订单 ID（仅限 linuxdo：创建时已预扣库存）
        expired_order_ids = [
            o.id for o in self.db.query(Order.id).filter(
                Order.status == OrderStatus.PENDING,
                Order.order_type == "linuxdo",
                Order.expire_at < now,
            ).all()
        ]

        if not expired_order_ids:
            logger.debug("No expired orders to clean up")
            return

        logger.info(f"Found {len(expired_order_ids)} expired orders to clean up")

        expired_count = 0
        released_stock_count = 0
        skipped_count = 0

        for order_id in expired_order_ids:
            try:
                # 加锁获取订单，skip_locked 避免阻塞支付回调
                order = self.db.query(Order).filter(
                    Order.id == order_id
                ).with_for_update(skip_locked=True).first()

                if not order:
                    continue

                # 再次检查状态（可能已被支付回调处理）
                if order.status != OrderStatus.PENDING:
                    skipped_count += 1
                    logger.info(f"Order {order.order_no} status changed to {order.status}, skipping")
                    continue

                # 更新订单状态
                order.status = OrderStatus.EXPIRED

                # 释放预扣库存（仅限有库存限制的套餐）
                if order.plan_id:
                    plan = self.db.query(Plan).filter(Plan.id == order.plan_id).with_for_update().first()
                    if plan and plan.stock is not None and (plan.sold_count or 0) > 0:
                        plan.sold_count = max(0, (plan.sold_count or 0) - 1)
                        released_stock_count += 1
                        logger.info(f"Released stock for expired order {order.order_no}, plan {plan.name}")

                # 每个订单单独提交，避免一个失败影响全部
                self.db.commit()
                expired_count += 1

            except Exception as e:
                logger.error(f"Failed to expire order id={order_id}: {e}")
                self.db.rollback()

        logger.info(f"Expired orders cleanup: expired={expired_count}, stock_released={released_stock_count}, skipped={skipped_count}")

    except Exception as e:
        logger.exception(f"cleanup_expired_orders failed: {e}")
        self.db.rollback()
    finally:
        lock.release()
