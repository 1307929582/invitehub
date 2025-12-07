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
