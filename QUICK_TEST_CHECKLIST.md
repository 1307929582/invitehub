# 快速测试检查清单

## ✅ 部署后快速验证（5分钟）

### 1. 检查分配逻辑（1分钟）
```bash
# 步骤 1：标记一个 Team 为 BANNED
# - 登录管理后台 → Teams
# - 选择任意 Team → 点击更多 → 修改状态 → BANNED

# 步骤 2：查看可分配 Team
curl http://localhost:8000/api/v1/dashboard/stats \
  -H "Authorization: Bearer YOUR_TOKEN" | jq

# ✅ 验证：total_teams 应该不包含 BANNED 的 Team
```

### 2. 测试批量状态修改（1分钟）
```bash
# 步骤 1：批量修改（通过前端或 API）
curl -X PATCH http://localhost:8000/api/v1/teams/status/bulk \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "team_ids": [1, 2],
    "status": "token_invalid",
    "status_message": "测试"
  }'

# ✅ 预期响应：{"success_count": 2, "failed_count": 0}
```

### 3. 测试封禁车免费换（2分钟）
```bash
# 前置：确保有一个用户在 BANNED 的 Team 中

# 步骤 1：记录当前换车次数
sqlite3 backend/data/app.db \
  "SELECT code, rebind_count, rebind_limit FROM redeem_codes WHERE code='YOUR_CODE';"

# 步骤 2：执行换车
curl -X POST http://localhost:8000/api/v1/public/rebind \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "code": "YOUR_CODE"}'

# 步骤 3：再次查询次数
sqlite3 backend/data/app.db \
  "SELECT code, rebind_count, rebind_limit FROM redeem_codes WHERE code='YOUR_CODE';"

# ✅ 验证：rebind_count 不应该变化
# ✅ 日志应该显示：Free rebind from unhealthy team
```

### 4. 测试正常车换车+踢人（2分钟）
```bash
# 前置：确保有一个用户在 ACTIVE 的 Team 中

# 步骤 1：查询用户在哪些 Team
sqlite3 backend/data/app.db \
  "SELECT t.name, tm.email FROM team_members tm JOIN teams t ON tm.team_id=t.id WHERE tm.email='test@example.com';"

# 步骤 2：执行换车（同上）

# 步骤 3：再次查询
sqlite3 backend/data/app.db \
  "SELECT t.name, tm.email FROM team_members tm JOIN teams t ON tm.team_id=t.id WHERE tm.email='test@example.com';"

# ✅ 验证 1：rebind_count 应该增加 1
# ✅ 验证 2：用户应该只在新 Team 中（原 Team 记录被删除）
# ✅ 日志应该显示：Successfully kicked ... from old team
```

### 5. 检测孤儿用户（1分钟）
```bash
# 直接查询
sqlite3 backend/data/app.db <<EOF
SELECT tm.email, COUNT(DISTINCT tm.team_id) as team_count
FROM team_members tm
JOIN teams t ON tm.team_id = t.id
WHERE t.is_active = 1 AND t.status = 'active'
GROUP BY tm.email
HAVING COUNT(DISTINCT tm.team_id) > 1;
EOF

# ✅ 验证：应该返回空（没有孤儿用户）
# ⚠️  如果有结果：说明踢人逻辑有问题，需要调查
```

---

## 🔥 压力测试（可选）

### 并发换车测试
```bash
# 创建 10 个并发换车请求
for i in {1..10}; do
  curl -X POST http://localhost:8000/api/v1/public/rebind \
    -H "Content-Type: application/json" \
    -d '{"email": "test@example.com", "code": "YOUR_CODE"}' &
done
wait

# ✅ 验证：
# - 只有 1 个请求成功（悲观锁生效）
# - rebind_count 只增加 1 次
# - 没有产生孤儿用户
```

### 批量状态修改测试
```bash
# 批量修改 100 个 Team
curl -X PATCH http://localhost:8000/api/v1/teams/status/bulk \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"team_ids\": $(seq 1 100 | jq -s), \"status\": \"paused\"}"

# ✅ 验证：
# - 响应时间 < 3秒
# - success_count = 实际存在的 Team 数
# - 数据库一致性正常
```

---

## 🎯 关键验证点总结

| 测试项 | 验证方法 | 预期结果 |
|--------|----------|----------|
| 分配过滤 | 查询可分配 Team | 不包含 BANNED/TOKEN_INVALID 的 Team |
| 批量修改 | 调用 API | success_count 正确 |
| 封禁车免费换 | 检查 rebind_count | 次数不变 |
| 正常车换车 | 检查 rebind_count | 次数 +1 |
| 自动踢人 | 查询 team_members | 只在新 Team 中 |
| 孤儿检测 | SQL 查询 | 返回空 |
| 并发安全 | 并发请求 | 无数据错误 |

---

## 📋 回归测试清单

确保现有功能未受影响：

- [ ] 正常兑换功能正常
- [ ] 定时同步 Team 成员正常
- [ ] Telegram Bot 邀请正常
- [ ] 导出功能正常
- [ ] 迁移功能正常
- [ ] Dashboard 统计正常

---

**测试完成后，请在生产环境开启孤儿用户检测任务，持续监控系统健康度。**
