"""
分布式限流器 - 替代进程内 asyncio.Semaphore

原问题：
- asyncio.Semaphore 只能在单个进程内生效
- 多个 FastAPI 实例部署时，每个实例独立限流，总并发无法控制

解决方案：
- 基于 Redis 实现分布式信号量
- 所有实例共享同一个并发计数器
- 使用 INCR/DECR 原子操作保证线程安全
- 自动超时释放，防止死锁

适用场景：
- 控制全局并发兑换请求数
- 保护下游 ChatGPT API 不被打爆
- 防止数据库连接池耗尽
"""
import asyncio
import redis
import logging
from typing import Optional

logger = logging.getLogger(__name__)


class DistributedLimiter:
    """基于 Redis 的分布式限流器（信号量模式）"""

    def __init__(
        self,
        redis_client: redis.Redis,
        key: str,
        max_concurrent: int = 10,
        timeout: int = 60,
        acquire_timeout: float = 30.0
    ):
        """
        初始化分布式限流器

        Args:
            redis_client: Redis 客户端实例
            key: Redis 键名（标识限流资源）
            max_concurrent: 最大并发数
            timeout: 单个请求最大占用时间（秒），超时自动释放
            acquire_timeout: 获取许可的最大等待时间（秒）
        """
        self.redis = redis_client
        self.key = key
        self.max_concurrent = max_concurrent
        self.timeout = timeout
        self.acquire_timeout = acquire_timeout
        self._acquired = False

    async def __aenter__(self):
        """异步上下文管理器：进入时获取许可"""
        await self.acquire()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """异步上下文管理器：退出时释放许可"""
        await self.release()

    async def acquire(self):
        """
        获取许可（阻塞直到成功或超时）

        Raises:
            TimeoutError: 超过 acquire_timeout 仍未获取到许可
        """
        start_time = asyncio.get_event_loop().time()

        while True:
            # 检查是否超时
            elapsed = asyncio.get_event_loop().time() - start_time
            if elapsed > self.acquire_timeout:
                raise TimeoutError(
                    f"Failed to acquire limiter within {self.acquire_timeout}s"
                )

            try:
                # 尝试原子性递增计数器
                current = self.redis.incr(self.key)

                if current <= self.max_concurrent:
                    # 获取成功，设置过期时间（防止死锁）
                    self.redis.expire(self.key, self.timeout)
                    self._acquired = True
                    logger.debug(
                        f"Limiter acquired: {self.key}, current: {current}/{self.max_concurrent}"
                    )
                    return
                else:
                    # 超出限制，回滚并等待重试
                    self.redis.decr(self.key)
                    await asyncio.sleep(0.1)  # 避免忙等

            except redis.RedisError as e:
                logger.error(f"Redis error in acquire: {e}")
                # Redis 故障时短暂等待后重试
                await asyncio.sleep(1)

    async def release(self):
        """释放许可"""
        if not self._acquired:
            return

        try:
            current = self.redis.decr(self.key)
            logger.debug(f"Limiter released: {self.key}, current: {current}")

            # 如果计数器归零，删除键（节省内存）
            if current <= 0:
                self.redis.delete(self.key)

            self._acquired = False

        except redis.RedisError as e:
            logger.error(f"Redis error in release: {e}")

    def get_current_count(self) -> int:
        """
        获取当前并发数

        Returns:
            int: 当前并发数，Redis 故障返回 0
        """
        try:
            count = self.redis.get(self.key)
            return int(count) if count else 0
        except redis.RedisError as e:
            logger.error(f"Redis error in get_current_count: {e}")
            return 0


class RateLimiter:
    """基于 Redis 的分布式速率限流器（令牌桶模式）"""

    def __init__(
        self,
        redis_client: redis.Redis,
        key: str,
        max_requests: int = 100,
        window: int = 60
    ):
        """
        初始化速率限流器

        Args:
            redis_client: Redis 客户端实例
            key: Redis 键名
            max_requests: 时间窗口内最大请求数
            window: 时间窗口（秒）
        """
        self.redis = redis_client
        self.key = key
        self.max_requests = max_requests
        self.window = window

    def is_allowed(self, identifier: str) -> bool:
        """
        检查请求是否被允许（滑动窗口算法）

        Args:
            identifier: 请求标识（如 user_id, IP）

        Returns:
            bool: 允许返回 True，超限返回 False
        """
        try:
            import time

            key = f"{self.key}:{identifier}"
            now = int(time.time())
            window_start = now - self.window

            pipe = self.redis.pipeline()

            # 1. 移除过期记录
            pipe.zremrangebyscore(key, 0, window_start)

            # 2. 统计当前窗口内的请求数
            pipe.zcard(key)

            # 3. 添加当前请求
            pipe.zadd(key, {now: now})

            # 4. 设置过期时间
            pipe.expire(key, self.window + 1)

            results = pipe.execute()
            current_count = results[1]

            if current_count < self.max_requests:
                logger.debug(
                    f"Rate limit passed: {identifier}, "
                    f"{current_count + 1}/{self.max_requests}"
                )
                return True
            else:
                logger.warning(
                    f"Rate limit exceeded: {identifier}, "
                    f"{current_count}/{self.max_requests}"
                )
                # 超限时不添加记录
                self.redis.zrem(key, now)
                return False

        except redis.RedisError as e:
            logger.error(f"Redis error in is_allowed: {e}")
            # Redis 故障时放行（fail-open 策略）
            return True
