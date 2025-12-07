# 开发规范

## 分支工作流

为确保生产环境稳定，所有新功能和修复必须通过分支开发和测试后再合并到 main。

### 分支命名规范

- **功能分支**：`feature/功能描述`
  - 示例：`feature/add-team-statistics`
- **修复分支**：`fix/问题描述`
  - 示例：`fix/celery-connection-error`
- **紧急修复**：`hotfix/问题描述`
  - 示例：`hotfix/security-patch`

### 开发流程

#### 1. 创建功能分支

```bash
git checkout main
git pull origin main
git checkout -b feature/your-feature-name
```

#### 2. 本地开发和测试

```bash
# 启动完整的 Docker 环境
docker-compose -f docker-compose.postgres.yml up -d --build

# 验证所有 6 个容器运行正常
docker-compose -f docker-compose.postgres.yml ps

# 应该看到：
# - db (PostgreSQL)
# - redis
# - backend
# - celery_worker
# - celery_beat
# - frontend

# 测试关键功能
# - 兑换码创建
# - 兑换码使用
# - 邮件发送（检查日志）
# - 换车功能
```

#### 3. 提交更改

```bash
git add .
git commit -m "feat: 添加功能描述"

# 提交信息格式：
# - feat: 新功能
# - fix: 修复
# - docs: 文档
# - refactor: 重构
# - test: 测试
# - chore: 构建/工具
```

#### 4. 推送到远程分支

```bash
git push -u origin feature/your-feature-name
```

#### 5. 在测试环境部署验证

```bash
# 在测试服务器上
cd /path/to/invitehub
git fetch origin
git checkout feature/your-feature-name
./team update

# 完整测试所有功能
```

#### 6. 创建 Pull Request

在 GitHub 上创建 PR：
- 标题：清晰描述改动内容
- 描述：
  - 改动内容
  - 测试步骤
  - 相关 issue（如果有）
  - 截图（如果是 UI 改动）

#### 7. 审查和合并

- 代码审查通过
- 所有测试通过
- 测试环境验证成功

```bash
git checkout main
git merge feature/your-feature-name
git push origin main
```

#### 8. 生产环境部署

```bash
# 在生产服务器上
cd /path/to/invitehub
./team update

# 监控日志确认无异常
./team logs-backend -f
./team logs-worker -f
```

#### 9. 清理分支

```bash
# 删除本地分支
git branch -d feature/your-feature-name

# 删除远程分支
git push origin --delete feature/your-feature-name
```

## 紧急修复流程（Hotfix）

如果生产环境出现严重问题需要紧急修复：

```bash
# 1. 从 main 创建 hotfix 分支
git checkout main
git pull origin main
git checkout -b hotfix/urgent-fix

# 2. 快速修复并测试
# ... 修复代码 ...

# 3. 直接推送到 main（跳过长时间测试）
git checkout main
git merge hotfix/urgent-fix
git push origin main

# 4. 立即部署
# 在服务器上执行 ./team update

# 5. 事后补充完整测试和文档
```

## 本地测试检查清单

在推送分支前，确保通过以下检查：

### 容器健康检查
- [ ] 所有 6 个容器都在运行
- [ ] Backend 健康检查通过：`curl http://localhost:18000/health`
- [ ] Redis 可访问：`docker-compose exec redis redis-cli ping`
- [ ] Celery Worker 注册了所有任务队列

### 功能测试
- [ ] 创建兑换码成功
- [ ] 使用兑换码兑换成功
- [ ] 邮件发送成功（检查日志）
- [ ] 换车功能正常
- [ ] 前端页面加载正常
- [ ] API 请求正常（无 502/500 错误）

### 日志检查
- [ ] Backend 日志无错误：`./team logs-backend --tail=100`
- [ ] Worker 日志显示任务执行：`./team logs-worker --tail=100`
- [ ] 无 Redis 连接错误
- [ ] 无数据库连接错误

## 回滚流程

如果部署后发现严重问题：

```bash
# 1. 快速回滚到上一个稳定版本
git checkout main
git log --oneline -10  # 找到上一个稳定的 commit
git reset --hard <stable-commit-hash>
git push origin main --force

# 2. 在服务器上更新
./team update

# 3. 验证系统恢复正常
./team status
```

## 监控和告警

部署后持续监控（至少 30 分钟）：

```bash
# 实时监控日志
./team logs-backend -f &
./team logs-worker -f &

# 检查 Celery 任务执行
./team celery

# 监控系统指标
curl http://localhost:18000/metrics | grep -E "(error|failed)"
```

## 常见问题排查

### Celery Worker 未启动
```bash
./team logs-worker
# 检查 Redis 连接和队列配置
```

### 502 Bad Gateway
```bash
# 检查 Nginx 配置
cat frontend/nginx.conf
# 检查 Backend 是否运行
curl http://localhost:18000/health
```

### 邮件未发送
```bash
# 检查 Worker 日志
./team logs-worker --tail=100 | grep "process_invite_task"
# 验证队列配置
./team celery
```

## 生产环境最佳实践

1. **永远不要在生产环境直接修改代码**
2. **所有改动必须通过 Git 部署**
3. **部署前备份数据库**：`./team backup`
4. **分阶段部署**：先测试环境，再生产环境
5. **保留回滚计划**：知道如何快速回退
6. **监控告警**：部署后持续监控至少 30 分钟
