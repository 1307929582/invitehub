"""
Redis 令牌桶限流器 - 解决 RedeemCode 热点问题

原问题：
- RedeemCode.used_count 在高并发下频繁更新同一行，导致数据库锁竞争
- 大量请求阻塞在数据库行锁上，吞吐量受限

解决方案：
- 使用 Redis 存储每个兑换码的剩余次数
- 通过 Lua 脚本实现原子性扣减（无锁竞争）
- 异步回写数据库（批量同步，降低写压力）
- 故障恢复：定时任务确保 Redis 与数据库最终一致

性能提升：
- 数据库写入从 N 次减少到 1 次（异步批量）
- 锁竞争从数据库行锁转移到 Redis 内存操作（毫秒级）
- 支持每秒数千次并发兑换
"""
import redis
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Lua 脚本：原子性扣减令牌
REDEEM_SCRIPT = """
local key = KEYS[1]
local remaining = tonumber(redis.call('GET', key) or '0')
if remaining > 0 then
    redis.call('DECR', key)
    return remaining - 1
else
    return -1
end
"""


class RedeemLimiter:
    """Redis 令牌桶限流器"""

    def __init__(self, redis_client: redis.Redis):
        """
        初始化限流器

        Args:
            redis_client: Redis 客户端实例
        """
        self.redis = redis_client
        # 注册 Lua 脚本（提升执行效率）
        self.script = self.redis.register_script(REDEEM_SCRIPT)

    def try_redeem(self, code: str) -> bool:
        """
        尝试扣减兑换次数（原子操作）

        Args:
            code: 兑换码

        Returns:
            bool: 扣减成功返回 True，余额不足返回 False
        """
        try:
            key = self._get_key(code)
            remaining = self.script(keys=[key])

            if remaining >= 0:
                logger.debug(f"Redeem success: {code}, remaining: {remaining}")
                return True
            else:
                logger.warning(f"Redeem failed: {code} exhausted")
                return False

        except redis.RedisError as e:
            logger.error(f"Redis error in try_redeem: {e}")
            # Redis 故障时返回 False，防止超售
            return False

    def init_code(self, code: str, max_uses: int, used_count: int, ttl: int = 86400):
        """
        初始化兑换码余额到 Redis

        注意：max_uses == 0 表示不限量，不会初始化到 Redis（走数据库路径）

        Args:
            code: 兑换码
            max_uses: 最大使用次数（0 表示不限量）
            used_count: 已使用次数
            ttl: 过期时间（秒），默认24小时
        """
        try:
            # 不限量码不使用 Redis 令牌桶，让它走数据库路径
            if max_uses == 0:
                logger.info(f"Skip Redis init for unlimited code: {code}")
                return

            key = self._get_key(code)
            remaining = max(0, max_uses - used_count)
            self.redis.setex(key, ttl, remaining)
            logger.info(f"Initialized redeem code: {code}, remaining: {remaining}")

        except redis.RedisError as e:
            logger.error(f"Redis error in init_code: {e}")

    def get_remaining(self, code: str) -> Optional[int]:
        """
        获取兑换码剩余次数

        Args:
            code: 兑换码

        Returns:
            Optional[int]: 剩余次数，Redis 故障返回 None
        """
        try:
            key = self._get_key(code)
            remaining = self.redis.get(key)
            return int(remaining) if remaining else None

        except redis.RedisError as e:
            logger.error(f"Redis error in get_remaining: {e}")
            return None

    def increment_remaining(self, code: str, amount: int = 1):
        """
        增加剩余次数（用于退款等场景）

        Args:
            code: 兑换码
            amount: 增加数量
        """
        try:
            key = self._get_key(code)
            self.redis.incrby(key, amount)
            logger.info(f"Incremented redeem code: {code}, amount: {amount}")

        except redis.RedisError as e:
            logger.error(f"Redis error in increment_remaining: {e}")

    def refund(self, code: str, amount: int = 1):
        """
        退还令牌（Celery 任务失败时的补偿）

        Args:
            code: 兑换码
            amount: 退还数量，默认1
        """
        self.increment_remaining(code, amount)

    def delete_code(self, code: str):
        """
        删除兑换码缓存（用于兑换码失效等场景）

        Args:
            code: 兑换码
        """
        try:
            key = self._get_key(code)
            self.redis.delete(key)
            logger.info(f"Deleted redeem code: {code}")

        except redis.RedisError as e:
            logger.error(f"Redis error in delete_code: {e}")

    def batch_init_codes(self, codes: list):
        """
        批量初始化兑换码（优化启动性能）

        注意：max_uses == 0 表示不限量，不会初始化到 Redis

        Args:
            codes: [(code, max_uses, used_count), ...]
        """
        try:
            pipe = self.redis.pipeline()
            count = 0

            for code, max_uses, used_count in codes:
                # 跳过不限量码
                if max_uses == 0:
                    continue

                key = self._get_key(code)
                remaining = max(0, max_uses - used_count)
                pipe.setex(key, 86400, remaining)
                count += 1

            pipe.execute()
            logger.info(f"Batch initialized {count} redeem codes (skipped {len(codes) - count} unlimited codes)")

        except redis.RedisError as e:
            logger.error(f"Redis error in batch_init_codes: {e}")

    @staticmethod
    def _get_key(code: str) -> str:
        """
        生成 Redis 键名

        Args:
            code: 兑换码

        Returns:
            str: Redis 键名
        """
        return f"redeem:{code}:remaining"
