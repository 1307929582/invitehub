"""
Prometheus 监控指标

提供业务关键指标的监控，用于：
- 实时监控系统健康状况
- 性能分析和瓶颈定位
- 容量规划和告警
- 可视化 Dashboard（Grafana）

指标类别：
1. 业务指标：兑换请求数、成功率、队列长度
2. 性能指标：请求延迟、数据库查询时间
3. 资源指标：可用座位数、Redis 连接数
4. 错误指标：失败次数、重试次数
"""
from prometheus_client import Counter, Histogram, Gauge, Info
import time
from functools import wraps

# ========== 业务指标 ==========

# 兑换请求计数器
redeem_requests_total = Counter(
    'redeem_requests_total',
    'Total number of redeem requests',
    ['status', 'code_type']  # status: success/failed, code_type: direct/linuxdo
)

# 邀请请求计数器
invite_requests_total = Counter(
    'invite_requests_total',
    'Total number of invite requests',
    ['team_id', 'status']  # status: success/failed
)

# 换车请求计数器
rebind_requests_total = Counter(
    'rebind_requests_total',
    'Total number of rebind requests',
    ['status']  # status: success/failed
)

# ========== 性能指标 ==========

# 兑换请求延迟
redeem_duration_seconds = Histogram(
    'redeem_duration_seconds',
    'Duration of redeem requests in seconds',
    ['code_type'],
    buckets=[0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0]  # 响应时间分桶
)

# 邀请发送延迟
invite_duration_seconds = Histogram(
    'invite_duration_seconds',
    'Duration of invite sending in seconds',
    ['team_id'],
    buckets=[0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0]
)

# 数据库查询延迟
database_query_duration_seconds = Histogram(
    'database_query_duration_seconds',
    'Duration of database queries in seconds',
    ['query_type'],  # query_type: select/insert/update/delete
    buckets=[0.01, 0.05, 0.1, 0.5, 1.0, 5.0]
)

# ========== 资源指标 ==========

# 可用座位数
available_seats_total = Gauge(
    'available_seats_total',
    'Total number of available seats across all teams'
)

# 队列长度
invite_queue_size = Gauge(
    'invite_queue_size',
    'Current size of invite queue',
    ['status']  # status: pending/processing/done/failed
)

# Redis 连接数
redis_connections = Gauge(
    'redis_connections',
    'Number of Redis connections',
    ['pool']  # pool: broker/backend/cache
)

# 数据库连接池使用率
database_pool_usage = Gauge(
    'database_pool_usage',
    'Database connection pool usage',
    ['state']  # state: active/idle/overflow
)

# ========== 错误指标 ==========

# 错误计数器
errors_total = Counter(
    'errors_total',
    'Total number of errors',
    ['error_type', 'endpoint']  # error_type: validation/database/api/timeout
)

# Celery 任务重试次数
celery_task_retries_total = Counter(
    'celery_task_retries_total',
    'Total number of Celery task retries',
    ['task_name']
)

# ========== 系统信息 ==========

# 应用版本信息
app_info = Info(
    'app_info',
    'Application version and build information'
)

# ========== 装饰器：自动记录指标 ==========

def track_duration(metric: Histogram, label_values: dict = None):
    """
    装饰器：自动记录函数执行时间

    Args:
        metric: Prometheus Histogram 指标
        label_values: 标签值字典

    Example:
        @track_duration(redeem_duration_seconds, {'code_type': 'direct'})
        async def redeem_code(code):
            pass
    """
    def decorator(func):
        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            labels = label_values or {}
            start_time = time.time()
            try:
                result = await func(*args, **kwargs)
                return result
            finally:
                duration = time.time() - start_time
                metric.labels(**labels).observe(duration)

        @wraps(func)
        def sync_wrapper(*args, **kwargs):
            labels = label_values or {}
            start_time = time.time()
            try:
                result = func(*args, **kwargs)
                return result
            finally:
                duration = time.time() - start_time
                metric.labels(**labels).observe(duration)

        import asyncio
        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        else:
            return sync_wrapper

    return decorator


def track_counter(metric: Counter, label_values: dict = None):
    """
    装饰器：自动记录函数调用次数

    Args:
        metric: Prometheus Counter 指标
        label_values: 标签值字典

    Example:
        @track_counter(redeem_requests_total, {'status': 'success', 'code_type': 'direct'})
        async def process_redeem():
            pass
    """
    def decorator(func):
        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            labels = label_values or {}
            metric.labels(**labels).inc()
            return await func(*args, **kwargs)

        @wraps(func)
        def sync_wrapper(*args, **kwargs):
            labels = label_values or {}
            metric.labels(**labels).inc()
            return func(*args, **kwargs)

        import asyncio
        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        else:
            return sync_wrapper

    return decorator


# ========== 辅助函数：更新指标 ==========

def update_seat_stats(total: int, used: int, pending: int, available: int):
    """更新座位统计"""
    available_seats_total.set(available)


def update_queue_stats(pending: int, processing: int, done: int, failed: int):
    """更新队列统计"""
    invite_queue_size.labels(status='pending').set(pending)
    invite_queue_size.labels(status='processing').set(processing)
    invite_queue_size.labels(status='done').set(done)
    invite_queue_size.labels(status='failed').set(failed)


def update_redis_stats(broker_conns: int, backend_conns: int, cache_conns: int):
    """更新 Redis 连接统计"""
    redis_connections.labels(pool='broker').set(broker_conns)
    redis_connections.labels(pool='backend').set(backend_conns)
    redis_connections.labels(pool='cache').set(cache_conns)


def update_database_pool_stats(active: int, idle: int, overflow: int):
    """更新数据库连接池统计"""
    database_pool_usage.labels(state='active').set(active)
    database_pool_usage.labels(state='idle').set(idle)
    database_pool_usage.labels(state='overflow').set(overflow)


def record_error(error_type: str, endpoint: str):
    """记录错误"""
    errors_total.labels(error_type=error_type, endpoint=endpoint).inc()
