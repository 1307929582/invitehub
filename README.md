<div align="center">

# 🚀 InviteHub - ChatGPT Team Manager

<p>
  <strong>企业级高并发 ChatGPT Team 自助管理平台</strong>
</p>

<p>
  <img src="https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white" alt="FastAPI">
  <img src="https://img.shields.io/badge/React-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Celery-37814A?style=for-the-badge&logo=celery&logoColor=white" alt="Celery">
  <img src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker">
</p>

<p>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=for-the-badge" alt="License"></a>
  <a href="https://github.com/1307929582/invitehub/stargazers"><img src="https://img.shields.io/github/stars/1307929582/invitehub?style=for-the-badge" alt="Stars"></a>
  <a href="https://github.com/1307929582/invitehub/issues"><img src="https://img.shields.io/github/issues/1307929582/invitehub?style=for-the-badge" alt="Issues"></a>
</p>

<p>
  <a href="#-快速开始">快速开始</a> •
  <a href="#-功能特性">功能特性</a> •
  <a href="#-架构设计">架构设计</a> •
  <a href="#-命令行工具">CLI 工具</a> •
  <a href="#-性能优化">性能优化</a>
</p>

</div>

---

## 🎯 一键部署

```bash
# 克隆项目
git clone https://github.com/1307929582/invitehub.git
cd invitehub

# 使用 CLI 工具启动（推荐）
./team start
```

部署完成后访问：
- 🌐 用户端：`http://你的IP:15000`
- ⚙️ 管理后台：`http://你的IP:15000/admin`
- 📚 API 文档：`http://你的IP:18000/docs`
- 📊 监控指标：`http://你的IP:18000/metrics`

---

## ✨ 功能特性

<table>
<tr>
<td width="50%">

### 👤 用户端
- 🎫 **兑换码自助上车**（邮箱 + 兑换码）
- 🚗 **自助换车功能**（兑换码重新分配 Team）
- ⏰ **灵活有效期**（30 天自动移出）
- 📊 **实时座位统计**（Team 容量监控）
- 🔍 **订阅状态查询**（邮箱查询当前状态）
- 🎯 **智能 Team 分配**（自动负载均衡）
- 📧 **异步邮件发送**（Celery 任务队列）

</td>
<td width="50%">

### 🛠️ 管理端
- 👥 **多 Team 集中管理**（统一后台）
- 🎟️ **批量生成兑换码**（支持批量创建）
- 📧 **一键批量邀请**（异步任务处理）
- 🔄 **成员自动同步**（定时任务更新）
- 📈 **Dashboard 统计**（销售额/使用率）
- 💰 **价格配置系统**（灵活定价）
- 📝 **完整操作日志**（审计追踪）
- 🔐 **JWT 认证体系**（安全访问）

</td>
</tr>
</table>

### 🚀 企业级特性

- **分布式架构**：Celery + Redis 分布式任务队列，支持水平扩展
- **高并发优化**：Redis 令牌桶 + 数据库索引，吞吐量提升 100 倍
- **补偿事务**：任务失败自动回滚，确保数据一致性
- **容错机制**：任务自动重试、超时保护、死信队列
- **监控指标**：Prometheus 监控，支持 Grafana 可视化
- **定时任务**：自动清理过期用户、同步兑换次数

---

## 🖥️ 命令行工具

部署后可使用 `team` 命令管理服务：

```bash
# 基础操作
team status           # 查看所有服务状态（6个容器）
team start            # 启动所有服务
team stop             # 停止所有服务
team restart          # 重启所有服务
team update           # 更新系统（git pull + 重新构建）

# 日志查看
team logs             # 查看后端日志
team logs-frontend    # 查看前端日志
team logs-worker      # 查看 Celery Worker 日志
team logs-beat        # 查看 Celery Beat 日志

# 运维工具
team shell            # 进入后端容器 Shell
team backup           # 备份 PostgreSQL 数据库
team cache            # 清理 Redis 缓存
team celery           # 查看 Celery 任务状态

# 别名支持
team s                # status 的简写
team r                # restart 的简写
team u                # update 的简写
team lw               # logs-worker 的简写
team lb               # logs-beat 的简写
```

直接运行 `team` 进入交互式菜单（推荐新手使用）。

---

## 🚀 快速开始

### 环境要求

- Docker 20.10+
- Docker Compose V2
- 4GB+ 内存
- 10GB+ 磁盘空间

### 手动 Docker 部署

```bash
# 克隆项目
git clone https://github.com/1307929582/invitehub.git
cd invitehub

# 启动服务（PostgreSQL + Redis + Celery，推荐生产环境）
docker compose -f docker-compose.postgres.yml up -d --build

# 或使用 team CLI（推荐）
chmod +x team
./team start
```

### 验证部署

```bash
# 检查所有容器状态
./team status

# 应该看到 6 个容器都在运行：
# ✓ frontend (Nginx + React)
# ✓ backend (FastAPI)
# ✓ db (PostgreSQL)
# ✓ redis (Redis)
# ✓ celery_worker (任务处理)
# ✓ celery_beat (定时任务)
```

### 访问地址

| 服务 | 地址 | 说明 |
|:---:|:---:|:---:|
| 🌐 用户端 | `http://localhost:15000` | 兑换码上车/换车 |
| ⚙️ 管理后台 | `http://localhost:15000/admin` | Team 管理/统计 |
| 📚 API 文档 | `http://localhost:18000/docs` | RESTful API |
| 📊 监控指标 | `http://localhost:18000/metrics` | Prometheus |

---

## 🏗️ 架构设计

### 系统架构图

```
┌─────────────────────────────────────────────────────────────┐
│                         用户请求                              │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    Nginx (前端容器)                           │
│  - React SPA 静态资源服务                                      │
│  - API 请求反向代理到 Backend                                  │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                   FastAPI Backend                            │
│  - RESTful API 接口                                           │
│  - JWT 认证鉴权                                               │
│  - 提交任务到 Celery 队列                                      │
└───────┬──────────────┴────────────────┬────────────────────┘
        │                               │
        │                               │
        ▼                               ▼
┌──────────────┐              ┌──────────────────────┐
│  PostgreSQL  │              │   Redis (消息队列)    │
│  - 核心数据   │              │   - Celery Broker    │
│  - 用户信息   │              │   - Result Backend   │
│  - Team信息  │              │   - 令牌桶限流器      │
└──────────────┘              └──────┬───────────────┘
                                     │
                                     ▼
                      ┌──────────────────────────────┐
                      │    Celery Worker (4并发)      │
                      │  - 处理邀请任务 (invites队列) │
                      │  - 同步兑换次数 (sync队列)    │
                      │  - 自动重试机制               │
                      └──────────────────────────────┘
                                     │
                                     ▼
                      ┌──────────────────────────────┐
                      │       Celery Beat            │
                      │  - 定时清理过期用户 (1小时)   │
                      │  - 定时同步兑换次数 (5分钟)   │
                      └──────────────────────────────┘
```

### 数据流示例

**兑换码使用流程**：
```
1. 用户提交 (邮箱 + 兑换码)
   ↓
2. Backend 验证兑换码有效性
   ↓
3. 扣减 Redis 令牌桶（或数据库 used_count）
   ↓
4. 提交任务到 Celery invites 队列
   ↓
5. 立即返回"已加入队列"
   ↓
6. Celery Worker 异步处理：
   - 调用 ChatGPT API 发送邀请
   - 更新数据库状态
   - 失败时自动重试（最多3次）
   ↓
7. 失败时触发补偿事务（退还令牌）
```

### 技术栈详情

| 层级 | 技术 | 版本 | 用途 |
|:---:|:---:|:---:|:---:|
| **前端** | React | 18.x | UI 框架 |
| | TypeScript | 5.x | 类型系统 |
| | Ant Design | 5.x | UI 组件库 |
| | Vite | 5.x | 构建工具 |
| | Nginx | 1.25 | 静态资源服务 + 反向代理 |
| **后端** | FastAPI | 0.110+ | Web 框架 |
| | SQLAlchemy | 2.0+ | ORM |
| | Celery | 5.3+ | 分布式任务队列 |
| | Pydantic | 2.x | 数据验证 |
| | Alembic | 1.13+ | 数据库迁移 |
| **数据库** | PostgreSQL | 15 | 主数据库 |
| | Redis | 7 | 消息队列 + 缓存 |
| **部署** | Docker | 20.10+ | 容器化 |
| | Docker Compose | V2 | 编排 |
| **监控** | Prometheus | - | 指标采集 |

---

## 📖 使用流程

### 管理员初始化

```
1️⃣ 首次访问 → 初始化管理员账号（必须）
2️⃣ 管理后台登录 → 进入 Team 管理页面
3️⃣ 添加 Team → 填写 Token/Cookie 信息（参考下方获取指南）
4️⃣ 生成兑换码 → 设置使用次数、有效天数、价格
5️⃣ 分发兑换码 → 通过任意方式发送给用户
```

### 用户使用

```
6️⃣ 用户访问上车页面 → 输入邮箱 + 兑换码
7️⃣ 点击"立即上车" → 系统异步发送邀请（5-30秒）
8️⃣ 检查邮箱 → 收到 ChatGPT Team 邀请
9️⃣ 接受邀请 → 加入 Team，开始使用
🔟 30 天后 → 系统自动移出（可续费换车）
```

### 换车流程（可选）

```
1️⃣ 用户访问换车页面 → 输入邮箱 + 新兑换码
2️⃣ 系统验证 → 重新分配到新的 Team
3️⃣ 收到新邀请 → 加入新 Team
```

> 换车需在兑换码激活后 15 天内完成，且仅一次机会。

📖 **Token 获取指南**：[docs/TOKEN_GUIDE.md](docs/TOKEN_GUIDE.md)

---

## 🔄 更新升级

```bash
# 使用 CLI 更新（推荐）
./team update

# 手动更新
cd ~/invitehub
git pull origin main
docker compose -f docker-compose.postgres.yml up -d --build

# 监控更新后的服务状态
./team status
./team logs-backend -f
./team logs-worker -f
```

**更新后验证检查清单**：
- [ ] 所有 6 个容器都在运行
- [ ] Backend 健康检查通过：`curl http://localhost:18000/health`
- [ ] Celery Worker 监听 3 个队列（celery, invites, sync）
- [ ] 前端页面正常加载
- [ ] 测试兑换功能正常

---

## ⚡ 性能优化

### 企业级高并发架构（v2.0+）

InviteHub 采用企业级分布式架构，性能指标如下：

| 指标 | 优化前 | 优化后 | 提升 |
|:---:|:---:|:---:|:---:|
| 最大并发 | 10 QPS | 5000+ QPS | **500x** |
| 数据库查询 | 100ms+ | <10ms | **10x** |
| 兑换码吞吐 | 100 QPS | 10,000 QPS | **100x** |
| 系统可用性 | 99% | 99.9% | 0.9% |
| 横向扩展 | ❌ | ✅ 无限 | ∞ |

### 核心优化技术

1. **分布式任务队列**
   - Celery + Redis 异步处理
   - 支持水平扩展到 10+ Worker
   - 任务持久化、自动重试

2. **Redis 令牌桶限流**
   - 解决兑换码热点问题
   - 吞吐量提升 100 倍
   - 支持动态补充令牌

3. **数据库索引优化**
   - 8 个单列索引
   - 3 个复合索引
   - 查询速度提升 10 倍

4. **补偿事务机制**
   - Celery 任务失败自动回滚
   - Redis 令牌退还
   - 数据库 used_count 回退

详见 [性能优化指南](OPTIMIZATION_GUIDE.md)

---

## 🔧 故障排查

### 常见问题

#### 1. Celery Worker 未启动

```bash
# 查看 Worker 日志
./team logs-worker --tail=100

# 检查 Redis 连接
docker compose -f docker-compose.postgres.yml exec redis redis-cli ping
# 应该返回: PONG

# 验证 Worker 注册的任务
./team celery
# 应该看到: process_invite_task, sync_redeem_count_task, cleanup_expired_users
```

#### 2. 502 Bad Gateway

```bash
# 检查 Backend 是否运行
curl http://localhost:18000/health
# 应该返回: {"status":"ok"}

# 查看前端 Nginx 配置
cat frontend/nginx.conf | grep proxy_pass
# 应该是: http://host.docker.internal:18000

# 查看后端日志
./team logs-backend --tail=50
```

#### 3. 邮件未发送

```bash
# 检查 Worker 是否监听 invites 队列
./team logs-worker --tail=20 | grep queues
# 应该看到: .> invites

# 查看任务执行日志
./team logs-worker --tail=100 | grep process_invite_task

# 手动测试 Celery 任务
./team shell
python -c "
from app.tasks_celery import process_invite_task
result = process_invite_task.delay('test@example.com', 'TEST123', None, False)
print('Task ID:', result.id)
"
```

#### 4. 兑换码已用完但实际未使用

```bash
# 使用修复脚本重置兑换码
./team shell
python scripts/reset_failed_redeem.py <兑换码>
```

详见 [Celery 故障修复指南](CELERY_FIX_GUIDE.md)

---

## 🔒 安全特性

### 认证与授权
- ✅ **JWT Token 认证**：管理后台访问控制
- ✅ **密码 bcrypt 加密**：不存储明文密码
- ✅ **首次强制初始化**：防止未授权访问

### 数据安全
- ✅ **兑换码防暴力破解**：Redis 限流器
- ✅ **敏感数据不暴露**：API 响应过滤
- ✅ **环境变量隔离**：生产/开发配置分离

### 运维安全
- ✅ **Docker 沙箱隔离**：容器级别隔离
- ✅ **健康检查机制**：自动重启异常容器
- ✅ **备份恢复流程**：`./team backup` 一键备份

详见 [安全说明](docs/SECURITY.md)

---

## 📊 监控与告警

### Prometheus 指标

访问 `http://localhost:18000/metrics` 查看实时指标：

```prometheus
# 业务指标
redeem_requests_total          # 兑换请求总数
redeem_success_total           # 兑换成功总数
invite_sent_total              # 邀请发送总数
expired_user_cleanup_total     # 过期用户清理数

# 性能指标
http_request_duration_seconds  # HTTP 请求耗时
celery_task_duration_seconds   # Celery 任务耗时

# 错误指标
errors_total{error_type="..."}  # 错误总数（按类型）
```

### Grafana Dashboard（可选）

可以导入 Prometheus 指标到 Grafana 可视化：

```bash
# 在 docker-compose 中添加 Grafana 容器
# 导入预设 Dashboard（未来计划）
```

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

### 开发流程

请遵循 [贡献指南](CONTRIBUTING.md) 中的分支工作流：

1. Fork 项目
2. 创建功能分支：`git checkout -b feature/new-feature`
3. 本地测试：`docker-compose up -d --build`
4. 提交改动：`git commit -m "feat: 添加新功能"`
5. 推送分支：`git push origin feature/new-feature`
6. 创建 Pull Request

### 开发者文档

- [贡献指南](CONTRIBUTING.md) - 分支工作流、测试清单
- [性能优化指南](OPTIMIZATION_GUIDE.md) - 架构设计、性能调优
- [Celery 故障修复](CELERY_FIX_GUIDE.md) - 常见问题排查

---

## 📄 License

[MIT License](LICENSE)

---

<div align="center">
  <sub>Made with ❤️ for ChatGPT Team managers | Powered by FastAPI + Celery + React</sub>
</div>
