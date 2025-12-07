# Celery 故障修复指南

## 🐛 问题描述

用户在使用兑换码时遇到以下问题：

1. **第一次点击"立即上车"**：
   ```
   Retry limit exceeded while trying to reconnect to the Celery redis result store backend.
   The Celery application must be restarted.
   ```

2. **第二次尝试**：
   ```
   POST https://mmw-team.zenscaleai.com/api/v1/public/redeem 400 (Bad Request)
   兑换码已用完
   ```

## 🔍 根本原因

### 问题 1：缺少 Celery Worker 容器
- `docker-compose.postgres.yml` 中配置了 Redis，但**没有 Celery worker 容器**
- 任务被提交到 Redis 队列后，没有 worker 处理，导致任务积压
- Backend 尝试连接 Redis 获取结果，但 worker 不存在，最终超时

### 问题 2：兑换码错误扣减
- 代码先 commit 数据库（扣减 `used_count`）
- 然后才调用 Celery 任务
- 如果 Celery 失败，使用次数已经扣减，无法回滚

## ✅ 修复方案

### 1. 添加 Celery Worker 和 Beat 容器

**已修复的文件**：`docker-compose.postgres.yml`

新增两个容器：
- **celery_worker**：处理异步任务（邀请发送）
- **celery_beat**：定时任务调度器（过期用户清理）

### 2. 添加补偿事务回滚逻辑

**已修复的文件**：
- `backend/app/routers/public.py`
- `backend/app/services/redeem_limiter.py`

**修复内容**：
- 在 Celery 任务失败时，自动回滚使用次数
- Redis 模式：退还令牌
- 数据库模式：减少 `used_count`
- 首次使用失败：清除 `activated_at` 和 `bound_email`

### 3. 临时修复脚本

**新增文件**：`backend/scripts/reset_failed_redeem.py`

用于重置受影响的兑换码使用次数。

## 🚀 部署步骤

### 步骤 1：更新代码

```bash
# 在云服务器上
team update
# 或手动 git pull
cd /path/to/invitehub
git pull origin main
```

### 步骤 2：重启容器

```bash
# 停止所有容器
docker-compose -f docker-compose.postgres.yml down

# 重新构建并启动（包含新的 Celery 容器）
docker-compose -f docker-compose.postgres.yml up -d --build
```

### 步骤 3：验证服务状态

```bash
# 检查所有容器是否运行
docker-compose -f docker-compose.postgres.yml ps

# 应该看到以下容器都在运行：
# - db (PostgreSQL)
# - redis
# - backend
# - celery_worker  ← 新增
# - celery_beat    ← 新增
# - frontend
```

### 步骤 4：查看 Celery 日志

```bash
# 查看 worker 日志
docker-compose -f docker-compose.postgres.yml logs celery_worker -f

# 查看 beat 日志
docker-compose -f docker-compose.postgres.yml logs celery_beat -f

# 应该看到类似输出：
# celery@xxx ready.
# celery beat v5.3.x is starting.
```

### 步骤 5：重置受影响的兑换码（可选）

如果已经有兑换码被错误扣减，使用修复脚本：

```bash
# 进入 backend 容器
docker-compose -f docker-compose.postgres.yml exec backend bash

# 运行修复脚本
python scripts/reset_failed_redeem.py <兑换码>

# 示例输出：
# 📊 兑换码信息：
#    代码：ABC123
#    当前使用次数：1
#    实际成功邀请：0
#    最大使用次数：5
# ✅ 已重置使用次数：1 → 0
```

### 步骤 6：测试兑换功能

1. 访问 `https://mmw-team.zenscaleai.com/invite`
2. 输入邮箱和兑换码
3. 点击"立即上车"
4. 应该看到："已加入队列，邀请将在几秒内发送，请查收邮箱"
5. 检查邮箱是否收到邀请

## 🔍 故障排查

### 问题：Celery worker 无法启动

```bash
# 查看错误日志
docker-compose -f docker-compose.postgres.yml logs celery_worker --tail=100

# 常见错误：
# 1. 模块导入错误：确保 requirements-celery.txt 已安装
# 2. Redis 连接失败：检查 REDIS_URL 环境变量
# 3. 数据库连接失败：检查 DATABASE_URL 环境变量
```

### 问题：任务仍然失败

```bash
# 1. 检查 Redis 是否正常
docker-compose -f docker-compose.postgres.yml exec redis redis-cli ping
# 应该返回：PONG

# 2. 检查 worker 是否注册了任务
docker-compose -f docker-compose.postgres.yml exec celery_worker celery -A app.celery_app inspect registered

# 应该看到：
# - app.tasks_celery.process_invite_task
# - app.tasks_celery.sync_redeem_count_task
# - app.tasks_celery.cleanup_expired_users

# 3. 手动测试任务
docker-compose -f docker-compose.postgres.yml exec backend python -c "
from app.tasks_celery import process_invite_task
result = process_invite_task.delay(
    email='test@example.com',
    redeem_code='TEST123',
    group_id=None,
    is_rebind=False
)
print('Task ID:', result.id)
"
```

### 问题：定时任务不执行

```bash
# 检查 beat 状态
docker-compose -f docker-compose.postgres.yml logs celery_beat --tail=50

# 应该看到定时任务调度记录：
# Scheduler: Sending due task cleanup-expired-users
```

## 📊 监控指标

使用 Prometheus 监控 Celery 任务：

访问 `https://mmw-team.zenscaleai.com/metrics` 查看：

- `redeem_requests_total` - 兑换请求总数
- `errors_total{error_type="celery_error"}` - Celery 错误次数
- `expired_user_cleanup_total` - 过期用户清理统计

## 📝 预防措施

1. **监控 Celery 健康状态**：
   - 定期检查 worker 和 beat 容器是否运行
   - 监控 Redis 连接状态

2. **设置告警**：
   - Celery 错误率 > 5%
   - Worker 容器重启次数异常
   - Redis 连接失败

3. **日志审计**：
   - 定期查看 `docker-compose logs celery_worker`
   - 检查是否有大量任务失败

## 🎯 验收标准

修复完成后，应满足以下条件：

- ✅ 所有容器（6个）都在运行
- ✅ Celery worker 日志显示 "ready"
- ✅ Celery beat 日志显示定时任务调度记录
- ✅ 用户可以成功兑换码兑换
- ✅ 邮箱收到邀请邮件
- ✅ 如果 Celery 失败，兑换码使用次数会自动回滚
- ✅ 第二次尝试仍然可以使用同一个兑换码

## 📞 支持

如遇到其他问题，请提供以下信息：

```bash
# 1. 容器状态
docker-compose -f docker-compose.postgres.yml ps

# 2. Backend 日志
docker-compose -f docker-compose.postgres.yml logs backend --tail=100

# 3. Celery worker 日志
docker-compose -f docker-compose.postgres.yml logs celery_worker --tail=100

# 4. Redis 状态
docker-compose -f docker-compose.postgres.yml exec redis redis-cli info stats
```
