# 🚀 生产环境 Celery 启动指南

## 📋 当前状态分析

根据你的状态报告：
```
前端服务     : ● 运行中  ✅
后端服务     : ● 运行中  ✅
数据库       : ● 运行中  ✅
Redis 缓存   : ● 运行中  ✅
Celery Worker: ● 未运行  ❌ <- 需要启动
Celery Beat  : ● 未运行  ❌ <- 需要启动
```

---

## 🔧 启动 Celery 服务

### 方法 1：使用 team 脚本（推荐）

```bash
# 在生产服务器上执行
cd /path/to/invitehub

# 启动 Celery Worker 和 Beat
./team start-celery

# 或者重启所有服务（包括 Celery）
./team restart
```

### 方法 2：使用 Docker Compose

```bash
# 只启动 Celery Worker
docker compose -f docker-compose.postgres.yml up -d celery_worker

# 只启动 Celery Beat
docker compose -f docker-compose.postgres.yml up -d celery_beat

# 或一起启动
docker compose -f docker-compose.postgres.yml up -d celery_worker celery_beat
```

### 方法 3：重启所有服务

```bash
# 重启所有服务（包括 Celery）
docker compose -f docker-compose.postgres.yml restart

# 或者
./team restart
```

---

## 🔍 排查启动失败原因

### 步骤 1：查看 Celery Worker 日志

```bash
# 查看最近 100 行日志
./team logs-worker --tail=100

# 或直接用 docker
docker compose -f docker-compose.postgres.yml logs celery_worker --tail=100
```

**常见错误和解决方案**：

#### 错误 1：ModuleNotFoundError
```
ModuleNotFoundError: No module named 'app.celery_app'
```

**原因**：代码未更新或镜像未重新构建

**解决**：
```bash
# 重新构建镜像
docker compose -f docker-compose.postgres.yml build celery_worker
docker compose -f docker-compose.postgres.yml up -d celery_worker
```

#### 错误 2：Redis 连接失败
```
Error: Redis connection failed
kombu.exceptions.OperationalError: [Errno 111] Connection refused
```

**原因**：Redis 未运行或连接配置错误

**解决**：
```bash
# 1. 检查 Redis 是否运行
docker compose -f docker-compose.postgres.yml ps redis

# 2. 测试 Redis 连接
docker compose -f docker-compose.postgres.yml exec redis redis-cli ping
# 应该返回: PONG

# 3. 检查环境变量
docker compose -f docker-compose.postgres.yml exec celery_worker env | grep REDIS
```

#### 错误 3：数据库连接失败
```
sqlalchemy.exc.OperationalError: could not connect to server
```

**原因**：PostgreSQL 未就绪或连接配置错误

**解决**：
```bash
# 检查数据库连接
docker compose -f docker-compose.postgres.yml exec db psql -U teamadmin -d team_manager -c "SELECT 1;"
```

#### 错误 4：任务导入失败
```
ImportError: cannot import name 'detect_orphan_users' from 'app.tasks_celery'
```

**原因**：镜像未更新到最新代码

**解决**：
```bash
# 重新构建并启动
docker compose -f docker-compose.postgres.yml build celery_worker celery_beat
docker compose -f docker-compose.postgres.yml up -d celery_worker celery_beat
```

---

## ✅ 验证 Celery 启动成功

### 检查进程状态
```bash
# 查看容器状态
docker compose -f docker-compose.postgres.yml ps celery_worker celery_beat

# 应该显示 "Up"
```

### 查看注册的任务
```bash
# 进入 Worker 容器
docker compose -f docker-compose.postgres.yml exec celery_worker celery -A app.celery_app inspect registered

# 应该看到:
# - app.tasks_celery.process_invite_task
# - app.tasks_celery.detect_orphan_users  <- 新增
# - app.tasks_celery.cleanup_expired_users
# - 等等
```

### 测试任务执行
```bash
# 手动触发一个测试任务
docker compose -f docker-compose.postgres.yml exec backend python3 -c "
from app.tasks_celery import detect_orphan_users
result = detect_orphan_users.delay()
print('任务已提交，ID:', result.id)
"
```

---

## 🎯 Celery 未运行的影响

### ❌ 受影响的功能

如果 Celery Worker 未运行：
1. **换车功能**：换车请求会提交到队列，但不会被处理
   - 用户看到"换车请求已提交"
   - 但实际上邀请不会发送
   - **新的踢人逻辑不会执行**

2. **异步邀请**：所有异步邀请都会卡在队列中
   - 兑换码使用
   - 批量邀请

3. **等待队列**：WAITING 队列不会被消费

如果 Celery Beat 未运行：
1. **孤儿用户检测**：不会自动运行（新功能）
2. **过期用户清理**：不会自动清理
3. **兑换次数同步**：Redis → 数据库同步不会执行

### ✅ 不受影响的功能

1. **批量状态修改**：正常工作 ✅
2. **Team 管理**：正常工作 ✅
3. **Team update 修改状态**：正常工作 ✅
4. **Dashboard 统计**：正常工作 ✅
5. **分配逻辑修复**：正常工作 ✅（这是同步逻辑）

---

## 🚨 紧急启动方案

如果你现在在生产服务器上，想立即启动 Celery：

```bash
# 在生产服务器执行：

# 1. 进入项目目录
cd /path/to/invitehub

# 2. 拉取最新代码
git pull origin main

# 3. 重新构建 Celery 相关镜像
docker compose -f docker-compose.postgres.yml build celery_worker celery_beat

# 4. 启动 Celery
docker compose -f docker-compose.postgres.yml up -d celery_worker celery_beat

# 5. 检查状态
./team status

# 6. 查看日志确认启动成功
./team logs-worker --tail=50
./team logs-beat --tail=50
```

---

## 📝 启动失败常见原因

### 原因 1：镜像未更新
**问题**：代码更新了但 Docker 镜像没重建

**解决**：
```bash
docker compose -f docker-compose.postgres.yml build celery_worker celery_beat
```

### 原因 2：依赖缺失
**问题**：新代码引入了新依赖（celery、redis）

**检查**：
```bash
# 查看 backend/requirements.txt 是否包含
# - celery>=5.3.0
# - redis>=5.0.0
```

### 原因 3：环境变量未配置
**问题**：REDIS_URL 等环境变量未设置

**检查**：
```bash
# 查看 .env 文件或环境变量
cat .env | grep REDIS
```

### 原因 4：端口冲突或资源不足
**问题**：服务器资源不足

**检查**：
```bash
# 查看容器资源使用
docker stats

# 查看容器退出原因
docker compose -f docker-compose.postgres.yml logs celery_worker | grep -i error
```

---

## 💡 推荐的完整启动流程

```bash
# === 在生产服务器上执行 ===

# 1. 备份数据库（安全第一）
./team backup

# 2. 拉取最新代码
git pull origin main

# 3. 停止所有服务
docker compose -f docker-compose.postgres.yml down

# 4. 重新构建镜像（包含最新代码）
docker compose -f docker-compose.postgres.yml build

# 5. 启动所有服务
docker compose -f docker-compose.postgres.yml up -d

# 6. 检查状态
./team status

# 7. 查看日志排查问题
./team logs-worker --tail=100
./team logs-beat --tail=100
```

---

## 📊 成功启动的标志

### Celery Worker 日志应该显示：
```
[INFO] Connected to redis://redis:6379/0
[INFO] celery@hostname ready.
[INFO] Registered tasks:
    app.tasks_celery.process_invite_task
    app.tasks_celery.detect_orphan_users     <- 新增
    app.tasks_celery.cleanup_expired_users
    ...
```

### Celery Beat 日志应该显示：
```
[INFO] beat: Starting...
[INFO] Scheduler: Sending due task detect-orphan-users  <- 新增
[INFO] Scheduler: Sending due task cleanup-expired-users
```

---

## 🎯 没有 Celery 的临时方案

如果 Celery 暂时无法启动，**核心功能仍然可以使用**：

### ✅ 可以立即使用的功能
1. **批量状态修改**（同步操作）
2. **分配逻辑修复**（同步逻辑）
3. **健康检查过滤**（同步逻辑）

### ⚠️ 暂时无法使用的功能
1. **换车功能**（需要 Worker 处理异步任务）
2. **孤儿用户检测**（需要 Beat 定时任务）
3. **过期用户清理**（需要 Beat 定时任务）

---

**你现在需要做的**：
1. 在生产服务器上查看 Celery 日志找出启动失败原因
2. 根据错误信息选择对应的解决方案
3. 重新构建镜像并启动

**需要我帮你分析具体的错误日志吗？请把日志内容发给我！**
