# Team 状态管理和换车逻辑升级文档

## 📋 升级概述

本次升级解决了 Team 状态管理和换车逻辑的关键问题，主要包括：

1. **修复分配逻辑** - 系统现在会正确过滤不健康的 Team
2. **Team 状态批量管理** - 管理员可以批量修改 Team 状态
3. **优化换车逻辑** - 封禁车免费换 + 正常车自动踢出
4. **监控告警** - 孤儿用户检测和换车成功率监控

---

## 🎯 解决的核心问题

### 问题 1：系统无法区分 Token 失效和封禁
**现状**：ChatGPT API 返回 403 时，系统只能通过关键词猜测是 Token 失效还是被封禁。

**解决方案**：
- 管理员可以手动标记 Team 状态（ACTIVE/BANNED/TOKEN_INVALID/PAUSED）
- 支持单次和批量修改
- 系统只会向健康的 Team（`is_active=True AND status=ACTIVE`）分配用户

### 问题 2：换车不区分原 Team 状态
**现状**：无论从什么状态的 Team 换车，都消耗换车次数。

**解决方案**：
- 从封禁车（BANNED/TOKEN_INVALID）换车：**不消耗次数**，且绕过上限
- 从正常车（ACTIVE）换车：消耗次数 + 立即踢出原 Team

### 问题 3：换车后不会退出原 Team
**现状**：换车后用户同时在两个 Team，浪费资源。

**解决方案**：
- 实现"先邀再踢"流程：新邀请成功后，自动从原 Team 踢出
- 踢人失败不影响整体流程（已记录日志）

---

## 📦 修改的文件清单

### 后端（Backend）

#### 核心逻辑修改
1. **backend/app/services/seat_calculator.py**
   - 统一可分配条件：`is_active=True AND status=ACTIVE`

2. **backend/app/main.py**
   - 定时同步：只同步健康的 Team
   - 告警检查：只检查健康的 Team

3. **backend/app/routers/teams.py**
   - 新增：`PATCH /teams/status/bulk` 批量状态修改接口
   - 修改：`GET /teams/all-pending-invites` 只获取健康 Team

4. **backend/app/routers/public.py**
   - 修改：`_do_rebind` 函数
     - 检测原 Team 状态
     - 决定是否消耗换车次数
     - 获取 chatgpt_user_id 用于踢人
     - 传递新参数到 Celery 任务
   - 修改：`can_rebind` 检查健康状态

5. **backend/app/tasks.py**
   - 修改：`_process_team_invites_with_lock` 锁内二次校验
   - 新增：`_remove_from_old_team` 踢人函数
   - 修改：批量处理传递新字段

6. **backend/app/tasks_celery.py**
   - 修改：`process_invite_task` 增加参数（consume_rebind_count, old_team_id, old_team_chatgpt_user_id）
   - 修改：`_rollback_redeem_code_usage` 只回滚付费换车
   - 新增：`detect_orphan_users` 孤儿用户检测任务

7. **backend/app/services/batch_allocator.py**
   - 修改：`InviteTask` 数据类增加新字段

8. **backend/app/routers/telegram_bot.py**
   - 修改：Bot `/invite` 命令使用 SeatCalculator

#### Schema 和监控
9. **backend/app/schemas.py**
   - 新增：`TeamBulkStatusUpdate` - 批量状态更新请求
   - 新增：`TeamBulkStatusResponse` - 批量状态更新响应

10. **backend/app/metrics.py**
    - 新增：`orphan_users_count` - 孤儿用户监控指标
    - 新增：`zombie_rebind_tasks` - 僵尸换车任务监控

### 前端（Frontend）

11. **frontend/src/api/index.ts**
    - 新增：`teamApi.updateStatusBulk` - 批量状态修改 API

12. **frontend/src/pages/Teams.tsx**
    - 新增：批量状态修改模态框
    - 新增：批量操作菜单项（修改状态）
    - 新增：状态修改处理函数

---

## 🔍 核心逻辑解析

### 1. 统一可分配条件

**位置**：`backend/app/services/seat_calculator.py:125-131`

```python
# 统一可分配条件：is_active=True AND status=ACTIVE
team_query = db.query(Team)
if only_active:
    team_query = team_query.filter(
        Team.is_active == True,
        Team.status == TeamStatus.ACTIVE
    )
```

**影响范围**：
- 公共兑换接口
- 换车分配
- 等待队列消费
- Telegram Bot 邀请
- 所有自动分配逻辑

### 2. 封禁车免费换车逻辑

**位置**：`backend/app/routers/public.py:925-957`

```python
# 检测原 Team 健康状态
consume_rebind_count = True
if current_team:
    # Team 不健康（BANNED 或 TOKEN_INVALID）则免费换车
    if current_team.status in [TeamStatus.BANNED, TeamStatus.TOKEN_INVALID]:
        consume_rebind_count = False
        logger.info(f"Free rebind from unhealthy team")

# 免费换车绕过上限（否则用户会被锁死在坏车上）
if consume_rebind_count and not redeem_code.can_rebind:
    raise HTTPException(status_code=400, detail="已达上限")
```

### 3. 先邀再踢流程

**位置**：`backend/app/tasks.py:283-290`

```python
# 邀请成功后，踢出原 Team（先邀再踢）
for task in tasks_to_process:
    if task.is_rebind and task.old_team_id and task.old_team_chatgpt_user_id:
        try:
            await _remove_from_old_team(db, task, team.name)
        except Exception as kick_err:
            logger.error(f"Failed to kick user: {kick_err}")
            # 踢人失败不影响整体流程
```

### 4. 竞态窗口修复

**位置**：`backend/app/tasks.py:206-220`

```python
# 锁内二次校验 Team 健康状态（防止竞态）
if not team.is_active or team.status != TeamStatus.ACTIVE:
    logger.warning(f"Team is no longer healthy, skipping")
    # 进入等待队列
    ...
```

---

## 🚀 部署步骤

### 1. 备份数据库
```bash
cd backend
cp data/app.db data/app.db.backup.$(date +%Y%m%d_%H%M%S)
```

### 2. 更新代码
```bash
git pull origin main
```

### 3. 安装依赖（如有新增）
```bash
cd backend
source .venv/bin/activate
pip install -r requirements.txt
```

### 4. 重启服务
```bash
# 后端
pm2 restart invitehub-backend

# Celery Worker（如有）
pm2 restart invitehub-celery

# 前端
cd frontend
npm run build
pm2 restart invitehub-frontend
```

---

## ✅ 部署后验证清单

### 测试 1：分配逻辑验证

**目标**：验证系统不会向不健康的 Team 分配用户

**步骤**：
1. 登录管理后台，选择一个 Team
2. 修改其状态为 `BANNED` 或 `TOKEN_INVALID`
3. 尝试使用兑换码（新用户或换车）
4. **预期结果**：该 Team 不应该被分配到

**验证方式**：
```bash
# 查看日志，应该看到该 Team 被过滤
tail -f backend/logs/app.log | grep "Found.*teams"
```

### 测试 2：批量状态管理

**目标**：验证批量修改 Team 状态功能

**步骤**：
1. 登录管理后台 → Teams 页面
2. 勾选多个 Team（例如 3 个）
3. 点击"批量操作" → "批量修改状态"
4. 选择目标状态（例如 `BANNED`）
5. 输入原因："测试批量修改"
6. 点击确认

**预期结果**：
- 弹出确认对话框，显示将要修改的 Team 数量
- 危险操作（BANNED/TOKEN_INVALID/PAUSED）显示警告
- 提交后显示成功统计
- Team 列表刷新，状态已更新

**API 验证**：
```bash
# 查看请求日志
curl -X PATCH http://localhost:8000/api/v1/teams/status/bulk \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "team_ids": [1, 2, 3],
    "status": "banned",
    "status_message": "测试批量修改"
  }'
```

### 测试 3A：从封禁车换车（免费）

**目标**：验证从封禁车换车不消耗次数

**前置条件**：
- 用户已在某个 Team A 中（该 Team 状态为 BANNED 或 TOKEN_INVALID）
- 用户的兑换码未过期

**步骤**：
1. 记录用户当前的换车次数（例如：1/3）
2. 前端：用户访问状态查询页面，输入邮箱或兑换码
3. 应该显示"可以换车"（因为 Team 不健康）
4. 用户点击"换车"
5. 查看换车后的次数

**预期结果**：
- 换车次数**不变**（仍然是 1/3）
- 用户被分配到新的健康 Team
- 日志显示：`Free rebind from unhealthy team`
- 用户被从原 Team A 踢出

**验证命令**：
```bash
# 查看换车日志
tail -f backend/logs/app.log | grep -E "Free rebind|Kicking.*from old team"

# 查询兑换码次数
sqlite3 backend/data/app.db "SELECT code, rebind_count, rebind_limit FROM redeem_codes WHERE code='YOUR_CODE';"
```

### 测试 3B：从正常车换车（消耗次数）

**目标**：验证从正常车换车消耗次数并踢出原 Team

**前置条件**：
- 用户已在某个 Team B 中（该 Team 状态为 ACTIVE）
- 用户的换车次数未达上限

**步骤**：
1. 记录用户当前的换车次数（例如：0/3）
2. 手动触发换车（或使用测试接口）
3. 查看换车后的次数

**预期结果**：
- 换车次数**增加 1**（变成 1/3）
- 用户被分配到新的 Team
- 用户被从原 Team B **踢出**
- TeamMember 表中该用户在 Team B 的记录被删除

**验证命令**：
```bash
# 查看踢人日志
tail -f backend/logs/app.log | grep "Successfully kicked"

# 查询用户在哪些 Team
sqlite3 backend/data/app.db "SELECT team_id, email FROM team_members WHERE email='test@example.com';"
```

### 测试 4：孤儿用户检测

**目标**：验证孤儿用户检测任务工作正常

**步骤**：
1. 手动触发检测任务（或等待定时任务）：
   ```python
   from app.tasks_celery import detect_orphan_users
   detect_orphan_users.delay()
   ```
2. 查看 Prometheus 指标：
   ```bash
   curl http://localhost:8000/metrics | grep orphan_users_count
   ```

**预期结果**：
- 正常情况：`orphan_users_count 0`
- 如果有孤儿用户：收到 Telegram P0 告警
- 日志显示详细的孤儿用户列表

### 测试 5：前端批量操作 UI

**目标**：验证前端批量状态修改功能

**步骤**：
1. 登录管理后台
2. 进入 Teams 页面
3. 勾选 2-3 个 Team（复选框）
4. 顶部应该显示"已选择 X 项"
5. 点击"批量操作" → "批量修改状态"
6. 选择目标状态（例如 TOKEN_INVALID）
7. 输入原因："测试批量修改"
8. 确认

**预期结果**：
- 弹出确认对话框
- 显示警告（如果是危险操作）
- 确认按钮为红色（危险操作）
- 提交后显示成功提示
- Team 列表自动刷新
- 状态已更新

---

## 🔧 API 接口清单

### 1. 批量状态修改

**接口**：`PATCH /api/v1/teams/status/bulk`

**请求体**：
```json
{
  "team_ids": [1, 2, 3],
  "status": "banned",
  "status_message": "测试批量修改（可选）"
}
```

**响应**：
```json
{
  "success_count": 2,
  "failed_count": 1,
  "failed_teams": [
    {
      "team_id": 3,
      "error": "Team 不存在"
    }
  ]
}
```

### 2. 换车接口（已优化）

**接口**：`POST /api/v1/public/rebind`

**请求体**：
```json
{
  "email": "user@example.com",
  "code": "ABC123"
}
```

**响应**：
```json
{
  "success": true,
  "message": "换车请求已提交（免费换车），新邀请将在几秒内发送",
  "new_team_name": null
}
```

**新增逻辑**：
- 自动检测原 Team 状态
- 封禁车：显示"（免费换车）"
- 正常车：显示"（1/3）"

---

## 📊 监控指标

### Prometheus 指标

访问 `http://localhost:8000/metrics` 查看：

```prometheus
# 孤儿用户数量（应该永远为 0）
orphan_users_count 0

# 换车请求总数
rebind_requests_total{status="success"} 42

# 换车任务僵尸数量
zombie_rebind_tasks 0
```

### 告警规则建议

#### P0 级告警（立即处理）
```yaml
- alert: OrphanUsersDetected
  expr: orphan_users_count > 0
  for: 5m
  annotations:
    summary: "检测到孤儿用户！"
    description: "{{ $value }} 个用户同时在多个 Team 中"
```

#### P1 级告警（关注）
```yaml
- alert: RebindSuccessRateLow
  expr: rate(rebind_requests_total{status="success"}[1h]) / rate(rebind_requests_total[1h]) < 0.9
  for: 10m
  annotations:
    summary: "换车成功率下降"
```

---

## 🐛 常见问题排查

### 问题 1：Team 状态修改后仍然被分配

**可能原因**：
- 数据库迁移未执行（status 字段为 NULL）
- 缓存未清除

**排查**：
```sql
-- 检查 NULL 状态
SELECT id, name, status FROM teams WHERE status IS NULL;

-- 应该为空，如果有记录：
UPDATE teams SET status = 'active' WHERE status IS NULL;
```

### 问题 2：换车后用户仍在原 Team

**可能原因**：
- 踢人 API 调用失败
- 原 Team Token 失效导致无法踢人

**排查**：
```bash
# 查看踢人日志
grep "Failed to kick" backend/logs/app.log

# 手动检测孤儿用户
sqlite3 backend/data/app.db <<EOF
SELECT email, COUNT(DISTINCT team_id) as team_count
FROM team_members
GROUP BY email
HAVING COUNT(DISTINCT team_id) > 1;
EOF
```

### 问题 3：免费换车仍然扣次数

**可能原因**：
- Team 状态标记不正确
- 逻辑判断有误

**排查**：
```sql
-- 检查换车历史
SELECT * FROM rebind_history
WHERE email = 'user@example.com'
ORDER BY created_at DESC
LIMIT 5;

-- 查看 notes 字段，应该显示"免费"或"消耗次数"
```

---

## 🔒 安全注意事项

### 1. 批量状态修改权限
- 该功能只允许**管理员**调用
- 前端已有 `get_current_user` 鉴权
- 建议记录操作日志

### 2. 换车频率限制
- 已有接口级限流：`@limiter.limit("3/minute")`
- Celery 任务有重试和超时保护
- Redis 分布式锁防止并发

### 3. 数据一致性保护
- 使用 `SELECT FOR UPDATE` 悲观锁
- 锁内二次校验状态
- 回滚逻辑完善

---

## 📈 性能影响评估

### 分配逻辑
- **优化前**：只检查 `is_active`
- **优化后**：增加 `status` 检查
- **性能影响**：基本无影响（都是索引字段）

### 换车逻辑
- **增加操作**：查询原 Team + 查询 TeamMember（获取 chatgpt_user_id）
- **增加 API 调用**：踢人 API（异步执行）
- **性能影响**：可接受（单次换车增加 ~100ms）

### 孤儿用户检测
- **查询复杂度**：`GROUP BY + HAVING + JOIN`
- **建议频率**：每 30 分钟（非高峰期可以更频繁）
- **性能影响**：轻量（通常 <100ms）

---

## 🎯 回滚方案

如果部署后发现问题，可以快速回滚：

### 代码回滚
```bash
git revert HEAD
git push origin main
pm2 restart all
```

### 数据库回滚
数据库结构未变更，无需回滚。

### 功能降级
如果需要临时禁用新功能：

1. **禁用批量状态修改**：
   - 前端：隐藏批量操作按钮
   - 后端：注释掉 `/teams/status/bulk` 路由

2. **恢复旧换车逻辑**：
   - 修改 `_do_rebind` 函数，强制 `consume_rebind_count = True`
   - 注释掉踢人逻辑

---

## 📚 后续优化建议

### 1. 自动状态检测
- 定时同步时自动更新 Team 状态（当前已实现）
- 检测到 Token 失效自动标记 `TOKEN_INVALID`
- 检测到封禁自动标记 `BANNED`

### 2. 换车流程优化
- 增加换车历史页面（用户可查看）
- 回填 `RebindHistory.to_team_id`（当前为 NULL）
- 换车成功后发送邮件通知

### 3. 监控完善
- Grafana Dashboard 展示换车趋势
- 孤儿用户自动修复（可选）
- 换车失败率告警

### 4. WAITING 队列优化
- `InviteQueue` 增加 `is_rebind` 字段
- 重试时保持换车标记
- 优先处理换车请求

---

## 📝 数据字典更新

### Team 表
| 字段 | 类型 | 说明 |
|------|------|------|
| status | Enum | 状态：active/banned/token_invalid/paused |
| status_message | String | 状态变更原因 |
| status_changed_at | DateTime | 状态变更时间 |

### RedeemCode 表
| 字段 | 类型 | 说明 |
|------|------|------|
| rebind_count | Integer | 已换车次数（封禁车换车不增加） |
| rebind_limit | Integer | 最大换车次数限制 |

### RebindHistory 表
| 字段 | 类型 | 说明 |
|------|------|------|
| notes | Text | 换车备注（包含"免费"或"消耗次数"） |

---

## 🎉 升级亮点

### 1. 解决了严重的分配 Bug
**Before**: 系统会继续向封禁/Token 失效的 Team 分配用户
**After**: 统一过滤，只向健康 Team 分配

### 2. 人性化的换车策略
**Before**: 无论什么情况都扣次数
**After**:
- 车坏了（不是用户的错）→ 免费换
- 用户主动换 → 扣次数

### 3. 资源优化
**Before**: 换车后用户占用两个 Team 的席位
**After**: 自动踢出原 Team，释放资源

### 4. 强大的监控
**Before**: 数据异常无法及时发现
**After**:
- 孤儿用户检测（P0 告警）
- 换车成功率监控
- Prometheus 指标完善

---

## 📞 支持

如有问题，请查看：
- 日志：`backend/logs/app.log`
- Metrics：`http://localhost:8000/metrics`
- Swagger 文档：`http://localhost:8000/docs`

---

生成时间：2025-12-13
版本：v2.1.0
