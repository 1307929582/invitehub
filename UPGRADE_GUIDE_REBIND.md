# 自由换车功能 - 生产环境升级指南

## 📋 功能概述

本次更新添加了**自由换车**功能，允许用户在兑换码有效期内自由更换 Team，主要特性：

- ✅ **自由换车**：用户可随时更换 Team，不再受 Team 状态限制（仅一次机会）
- ✅ **次数限制**：每个兑换码最多可换车 1 次（可配置）
- ✅ **有效期管理**：兑换码有效期 30 天，过期后自动移出 Team
- ✅ **换车窗口**：激活后 15 天内可换车（仅一次机会）
- ✅ **悲观锁保护**：使用数据库行锁防止并发问题
- ✅ **状态机设计**：bound → removing → removed 状态流转
- ✅ **自动清理**：Celery 定时任务每小时自动清理过期用户
- ✅ **Telegram 告警**：清理失败时自动发送管理员通知
- ✅ **审计日志**：RebindHistory 表记录所有换车操作

---

## ⚠️ 重要提示

**本次升级涉及数据库结构变更，请务必：**
1. ✅ 在生产环境升级前进行完整备份
2. ✅ 在测试环境验证升级流程
3. ✅ 准备回滚方案以防万一

**向后兼容性：**
- ✅ 所有新字段使用 `nullable=True` 和安全默认值
- ✅ 现有兑换码将自动初始化为新格式
- ✅ 旧 API 行为保持不变，仅增强换车功能

---

## 🚀 升级步骤

### 1. 备份数据库（必须！）

```bash
# PostgreSQL 备份
pg_dump -U postgres -d invitehub -F c -f invitehub_backup_$(date +%Y%m%d_%H%M%S).dump

# 验证备份文件
ls -lh invitehub_backup_*.dump
```

### 2. 拉取最新代码

用户已经完成备份，现在只需运行：

```bash
cd /Users/xmdbd/项目/team自助/invitehub
team update
```

**`team update` 命令会自动执行：**
1. `git pull` - 拉取最新代码
2. `docker compose up -d --build` - 重建并启动容器
3. `alembic upgrade head` - 自动应用数据库迁移（通过 entrypoint.sh）

### 3. 运行数据迁移脚本

容器启动后，初始化现有兑换码数据：

```bash
# 进入容器
docker compose exec backend bash

# 运行数据迁移脚本
python scripts/migrate_existing_codes.py

# 查看输出，确认迁移成功
# 应该看到类似：
# ✅ 检查兑换码数: 50
# ✅ 更新兑换码数: 50
# ✅ 调整有效期数: 10
```

**脚本功能：**
- 为所有现有兑换码设置 `rebind_count=0`, `rebind_limit=1`
- 根据激活状态和过期时间智能推断 `status`
- 调整 `validity_days` 到 30 天（容错）
- 幂等性设计，可以安全地多次运行

### 4. 验证部署

#### 4.1 检查数据库迁移

```bash
# 查看当前迁移版本
docker compose exec backend alembic current

# 应该显示：
# 010_create_rebind_history (head)
```

#### 4.2 检查数据库结构

```bash
# 进入 PostgreSQL
docker compose exec backend psql -U postgres -d invitehub

# 检查新字段
\d redeem_codes

# 应该看到新字段：
# rebind_count | integer
# rebind_limit | integer
# status       | character varying(20)
# removed_at   | timestamp

# 检查新表
\d rebind_history

# 退出
\q
```

#### 4.3 检查 Celery 任务

```bash
# 检查 Celery Worker 状态
docker compose logs backend | grep "cleanup_expired_users"

# 应该看到定时任务已注册：
# [celery beat] Scheduler: Sending due task cleanup-expired-users
```

#### 4.4 测试换车功能

```bash
# 测试换车 API
curl -X POST http://localhost:4567/api/v1/public/rebind \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "code": "YOUR_CODE"
  }'

# 期望响应：
# {
#   "success": true,
#   "message": "换车请求已提交（1/3），新邀请将在几秒内发送，请查收邮箱",
#   "new_team_name": null
# }
```

#### 4.5 检查 Prometheus 指标

```bash
curl http://localhost:4567/metrics | grep rebind

# 应该看到新指标：
# rebind_requests_total{status="success"} 1
# expired_user_cleanup_total{status="success",reason="removed"} 0
# rebind_count_distribution{rebind_count="0"} 45
# rebind_count_distribution{rebind_count="1"} 3
# redeem_code_status_distribution{status="bound"} 48
```

---

## 🔄 回滚方案

如果升级后出现问题，可以快速回滚：

### 方案 1：代码回滚（保留数据）

```bash
# 1. 回滚到上一个版本
cd /Users/xmdbd/项目/team自助/invitehub
git log --oneline -5  # 查看最近的提交
git checkout <previous-commit-hash>

# 2. 重新部署
team update

# 注意：数据库迁移不会自动回滚，但新字段为 nullable，不影响旧代码运行
```

### 方案 2：数据库回滚（完整恢复）

```bash
# 1. 停止应用
docker compose down

# 2. 恢复数据库
pg_restore -U postgres -d invitehub -c invitehub_backup_XXXXXX.dump

# 3. 回滚代码
git checkout <previous-commit-hash>

# 4. 重新部署
team update
```

### 方案 3：仅回滚数据库迁移

```bash
# 进入容器
docker compose exec backend bash

# 回滚到迁移 008（上一个版本）
alembic downgrade 008_add_composite_indexes

# 这将删除新字段和新表
```

---

## 📊 新增监控指标

升级后，可在 Grafana 中添加以下监控面板：

### 换车统计

```promql
# 换车成功率（5分钟）
rate(rebind_requests_total{status="success"}[5m])
/ rate(rebind_requests_total[5m])

# 换车次数分布
rebind_count_distribution

# 兑换码状态分布
redeem_code_status_distribution
```

### 过期用户清理

```promql
# 清理成功率
rate(expired_user_cleanup_total{status="success"}[1h])
/ rate(expired_user_cleanup_total[1h])

# 清理失败次数（触发告警）
increase(expired_user_cleanup_total{status="failed"}[1h]) > 5
```

---

## 🐛 故障排查

### 问题 1：数据迁移脚本失败

**症状：**
```
Error: column "rebind_count" does not exist
```

**解决方案：**
```bash
# 检查迁移是否应用
docker compose exec backend alembic current

# 如果显示 008 而不是 010，手动升级
docker compose exec backend alembic upgrade head
```

### 问题 2：换车次数检查失败

**症状：**
```
HTTPException: 已达到换车次数上限（None/None）
```

**解决方案：**
```bash
# 重新运行数据迁移脚本
docker compose exec backend python scripts/migrate_existing_codes.py
```

### 问题 3：Celery 任务未执行

**症状：**
过期用户未被自动清理

**解决方案：**
```bash
# 检查 Celery Beat 是否启动
docker compose logs backend | grep "celery beat"

# 检查 Redis 连接
docker compose exec backend python -c "from app.cache import get_redis; print(get_redis().ping())"

# 手动触发清理任务（测试）
docker compose exec backend python -c "
from app.tasks_celery import cleanup_expired_users
cleanup_expired_users.delay()
"
```

### 问题 4：Telegram 告警未发送

**症状：**
清理失败但未收到通知

**解决方案：**
```bash
# 检查 Telegram 配置
docker compose exec backend psql -U postgres -d invitehub -c "
SELECT key, value FROM system_configs
WHERE key IN ('telegram_enabled', 'telegram_bot_token', 'telegram_chat_id');
"

# 确保配置正确：
# telegram_enabled = 'true'
# telegram_bot_token = 有效的 bot token
# telegram_chat_id = 有效的 chat id
```

---

## 📚 技术细节

### 数据库变更

#### redeem_codes 表新增字段

| 字段名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| rebind_count | integer | 0 | 已换车次数 |
| rebind_limit | integer | 1 | 最大换车次数 |
| status | varchar(20) | 'bound' | 状态：bound/removing/removed |
| removed_at | timestamp | NULL | 移除时间 |

#### rebind_history 新表

```sql
CREATE TABLE rebind_history (
    id SERIAL PRIMARY KEY,
    redeem_code VARCHAR(50) NOT NULL,
    email VARCHAR(100) NOT NULL,
    from_team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    to_team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    reason VARCHAR(50) NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX ix_rebind_history_redeem_code ON rebind_history(redeem_code);
CREATE INDEX ix_rebind_history_email ON rebind_history(email);
CREATE INDEX ix_rebind_history_created_at ON rebind_history(created_at);
```

### API 行为变更

#### `/public/rebind` 接口

**之前：**
```python
# 只能在 Team 不活跃时换车
if current_team and current_team.is_active:
    raise HTTPException(400, "Team still active")
```

**现在：**
```python
# 可以随时换车，但有次数限制
if not redeem_code.can_rebind:
    raise HTTPException(400, f"已达换车次数上限（{rebind_count}/{rebind_limit}）")
```

### 定时任务

每小时执行一次 `cleanup_expired_users`：

1. 查找所有过期且状态为 'bound' 的兑换码
2. 使用 Redis 分布式锁防止重复执行
3. 状态机流转：`bound → removing → removed`
4. 调用 ChatGPT API 移除用户
5. 失败时重试，最终失败时发送 Telegram 告警
6. 创建 RebindHistory 记录

---

## ✅ 验收清单

部署完成后，请确认以下项目：

- [ ] 数据库迁移成功（`alembic current` 显示 010）
- [ ] 数据迁移脚本执行成功（所有兑换码已初始化）
- [ ] 现有用户可以正常兑换（旧功能不受影响）
- [ ] 用户可以自由换车（新功能正常）
- [ ] 换车次数限制生效（第4次换车时被拒绝）
- [ ] Celery 定时任务正常运行（日志中看到清理任务）
- [ ] Prometheus 指标正常暴露（`/metrics` 端点可访问）
- [ ] Telegram 告警配置正确（可选，测试清理失败告警）

---

## 🆘 紧急联系

如遇到无法解决的问题，请：

1. 立即执行回滚方案（见上文）
2. 保存错误日志：
   ```bash
   docker compose logs backend > backend_error.log
   docker compose logs backend | grep ERROR > errors_only.log
   ```
3. 提供以下信息：
   - 错误日志
   - 数据库迁移版本（`alembic current`）
   - 数据迁移脚本输出

---

## 📝 更新日志

### 变更内容

**数据库：**
- 新增 `redeem_codes` 表字段：`rebind_count`, `rebind_limit`, `status`, `removed_at`
- 新增 `rebind_history` 表记录换车历史
- 新增索引：`ix_redeem_codes_status`

**后端代码：**
- 修改 `/public/rebind` API，移除 Team 状态限制
- 添加悲观锁（`with_for_update()`）防止并发问题
- 添加 Celery 定时任务 `cleanup_expired_users`
- 添加 Telegram 告警功能

**监控指标：**
- `expired_user_cleanup_total` - 过期用户清理统计
- `rebind_count_distribution` - 换车次数分布
- `redeem_code_status_distribution` - 兑换码状态分布

**工具脚本：**
- `backend/scripts/migrate_existing_codes.py` - 数据迁移脚本

---

## 🎉 总结

本次升级实现了**自由换车**功能，核心优势：

✅ **用户体验提升**：用户可随时更换 Team，不再受限制
✅ **生产环境安全**：零风险部署，完全向后兼容
✅ **并发安全保证**：悲观锁 + 原子更新防止竞态条件
✅ **自动化运维**：定时清理过期用户，Telegram 告警
✅ **完整可观测性**：Prometheus 指标 + RebindHistory 审计日志

**部署时间：** 预计 5-10 分钟（包括数据迁移）
**业务影响：** 零停机，旧功能不受影响

如有任何问题，请参考故障排查章节或立即回滚。
