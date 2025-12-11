"""
Celery 应用配置

用于异步处理邀请任务，支持分布式部署和自动重试。

特性：
- 基于 Redis 的消息队列和结果存储
- 任务自动重试和死信队列
- 超时保护（5分钟硬限制，4分钟软限制）
- 任务确认延迟（失败自动重新入队）
"""
from celery import Celery
from app.config import settings
import os

# Redis 配置（从环境变量获取）
# 优先使用 REDIS_URL（Docker 环境），否则使用单独的配置
REDIS_URL = os.getenv('REDIS_URL')

if REDIS_URL:
    # Docker 环境：使用 REDIS_URL（格式：redis://redis:6379/0）
    # 为 broker 和 backend 使用不同的数据库
    BROKER_URL = REDIS_URL.rsplit('/', 1)[0] + '/1'  # 数据库 1 用于 broker
    BACKEND_URL = REDIS_URL.rsplit('/', 1)[0] + '/2'  # 数据库 2 用于 backend
else:
    # 本地开发环境：使用单独配置
    REDIS_HOST = os.getenv('REDIS_HOST', 'localhost')
    REDIS_PORT = os.getenv('REDIS_PORT', '6379')
    REDIS_BROKER_DB = os.getenv('REDIS_BROKER_DB', '1')
    REDIS_BACKEND_DB = os.getenv('REDIS_BACKEND_DB', '2')

    BROKER_URL = f'redis://{REDIS_HOST}:{REDIS_PORT}/{REDIS_BROKER_DB}'
    BACKEND_URL = f'redis://{REDIS_HOST}:{REDIS_PORT}/{REDIS_BACKEND_DB}'

# 创建 Celery 应用
celery_app = Celery(
    'invitehub',
    broker=BROKER_URL,
    backend=BACKEND_URL,
    include=['app.tasks_celery']  # 自动发现任务模块
)

# Celery 配置
celery_app.conf.update(
    # 序列化
    task_serializer='json',
    result_serializer='json',
    accept_content=['json'],

    # 时区
    timezone='UTC',
    enable_utc=True,

    # 任务执行
    task_acks_late=True,  # 任务执行完成后才确认（失败会重新入队）
    task_reject_on_worker_lost=True,  # Worker 崩溃时拒绝任务（触发重试）
    task_time_limit=300,  # 硬超时：5分钟
    task_soft_time_limit=240,  # 软超时：4分钟（抛出 SoftTimeLimitExceeded）

    # 结果存储
    result_expires=3600,  # 结果保留1小时
    result_backend_transport_options={'master_name': 'mymaster'},  # Redis Sentinel 支持

    # Worker 配置
    worker_prefetch_multiplier=4,  # 每个 worker 预取4个任务
    worker_max_tasks_per_child=1000,  # 每个子进程最多执行1000个任务后重启（防止内存泄漏）

    # 重试配置
    task_default_retry_delay=60,  # 默认重试延迟60秒
    task_max_retries=3,  # 默认最多重试3次

    # 队列配置
    task_routes={
        'app.tasks_celery.process_invite_task': {'queue': 'invites'},
        'app.tasks_celery.sync_redeem_count_task': {'queue': 'sync'},
    },

    # 优先级队列
    task_queue_max_priority=10,
    task_default_priority=5,

    # 监控
    worker_send_task_events=True,  # 发送任务事件（用于 Flower 监控）
    task_send_sent_event=True,
)

# Celery Beat 定时任务配置（可选）
celery_app.conf.beat_schedule = {
    # 每5分钟同步 Redis 兑换次数到数据库
    'sync-redeem-counts': {
        'task': 'app.tasks_celery.batch_sync_redeem_counts',
        'schedule': 300.0,  # 5分钟
    },
    # 每小时清理过期任务结果
    'cleanup-old-results': {
        'task': 'app.tasks_celery.cleanup_old_invite_queue',
        'schedule': 3600.0,  # 1小时
    },
    # 每小时清理过期用户（自动移出 Team）
    'cleanup-expired-users': {
        'task': 'app.tasks_celery.cleanup_expired_users',
        'schedule': 3600.0,  # 1小时
    },
    # 每15分钟重试失败的邀请
    'retry-failed-invites': {
        'task': 'app.tasks_celery.retry_failed_invites',
        'schedule': 300.0,  # 5分钟（处理等待队列）
    },
}
