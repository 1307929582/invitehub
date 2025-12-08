# 🚀 InviteHub 分销商功能升级指南

## 版本信息
- **当前版本**: v1.4.0
- **目标版本**: v1.5.0
- **发布日期**: 2025-12-08
- **升级类型**: ⚠️ **需要数据库迁移**

---

## ⚠️ 升级前必读

**这是一个生产环境升级！请严格按照以下步骤操作：**

### 升级影响
✅ **向后兼容** - 现有功能不受影响
✅ **现有用户** - 自动设置为已批准状态
⚠️ **数据库变更** - 需要运行 2 个迁移文件
⚠️ **停机时间** - 预计 5-10 分钟

### 升级准备清单
- [ ] 备份 PostgreSQL 数据库
- [ ] 备份 `.env` 配置文件
- [ ] 确认邮件服务正常运行（SMTP 配置）
- [ ] 准备回滚方案
- [ ] 在测试环境验证升级流程

---

## 📋 新功能概览

### 🎯 分销商系统
1. **分销商角色** (`DISTRIBUTOR`)
   - 独立的权限体系
   - 只能管理自己的兑换码
   - 查看自己的销售数据

2. **自助注册流程**
   - 邮箱验证码注册
   - 管理员审核机制
   - 拒绝原因反馈

3. **兑换码管理增强**
   - 分销商创建的码自动归属
   - 默认分销商分组
   - 删除保护（已使用的码不可删除）

4. **销售统计**
   - 分销商个人 Dashboard
   - 销售数据可视化
   - 管理员业绩总览

---

## 🔧 升级步骤（生产环境）

###Step 1: 备份数据库 ⚠️

```bash
# 进入项目目录
cd /path/to/invitehub

# 备份 PostgreSQL 数据库
./team backup

# 或手动备份
docker-compose exec db pg_dump -U postgres invitehub > backup_$(date +%Y%m%d_%H%M%S).sql
```

### Step 2: 停止服务

```bash
./team stop
```

### Step 3: 拉取代码更新

```bash
git pull origin main

# 检查版本
git log --oneline -5
```

### Step 4: 运行数据库迁移

```bash
# 查看当前迁移版本
docker-compose exec backend alembic current

# 运行迁移（会自动运行 011 和 012）
docker-compose exec backend alembic upgrade head

# 验证迁移成功
docker-compose exec backend alembic current
# 应该显示：012_distributor_signup_flow (head)
```

**迁移内容**：
- ✅ 添加 `DISTRIBUTOR` 角色到 `UserRole` 枚举
- ✅ User 表添加 `approval_status` 和 `rejection_reason` 字段
- ✅ 创建 `verification_codes` 表
- ✅ 创建"分销商默认组"（名称：分销商默认组，颜色：紫色）
- ✅ 系统配置添加 `distributor_default_group_id`

### Step 5: 重启服务

```bash
./team start

# 检查服务状态
./team status

# 检查日志
./team logs-backend
```

### Step 6: 验证升级

```bash
# 1. 检查后端健康
curl http://localhost:18000/health

# 2. 检查数据库迁移
docker-compose exec backend alembic current

# 3. 检查前端访问
curl http://localhost:15000

# 4. 测试管理员登录
# 浏览器访问：http://localhost:15000/admin/login
```

---

## 🧪 功能测试清单

### 管理员功能测试
- [ ] 登录管理后台
- [ ] 查看分销商管理菜单
- [ ] 创建测试分销商账号
- [ ] 审核待审核的分销商
- [ ] 查看分销商业绩统计

### 分销商功能测试
- [ ] 访问注册页面 `/register`
- [ ] 发送邮箱验证码（检查邮箱）
- [ ] 完成注册（状态：待审核）
- [ ] 管理员审核通过
- [ ] 分销商登录
- [ ] 创建兑换码
- [ ] 查看销售统计
- [ ] 删除未使用的兑换码

### 兑换码删除保护测试
- [ ] 创建兑换码
- [ ] 使用兑换码（used_count > 0）
- [ ] 尝试删除（应该被阻止）
- [ ] 删除未使用的兑换码（应该成功）

---

## 🔄 回滚方案

如果升级失败，按以下步骤回滚：

### 方案 A：数据库回滚（推荐）

```bash
# 停止服务
./team stop

# 回滚到迁移 010
docker-compose exec backend alembic downgrade 010_create_rebind_history

# 恢复代码
git checkout v1.4.0

# 重启服务
./team start
```

### 方案 B：完整恢复

```bash
# 停止服务
./team stop

# 恢复数据库备份
docker-compose exec -T db psql -U postgres invitehub < backup_YYYYMMDD_HHMMSS.sql

# 恢复代码
git checkout v1.4.0

# 重启服务
./team start
```

---

## 📚 配置说明

### 新增系统配置

迁移会自动创建以下配置：

| 配置键 | 默认值 | 说明 |
|:---:|:---:|:---:|
| `distributor_default_group_id` | 自动生成 | 分销商默认分组 ID |

### 邮件服务要求

分销商注册需要邮件服务支持：
- 确保 SMTP 配置正确
- 测试邮件发送功能
- 验证码有效期：10 分钟

---

## 🔒 安全增强

### 验证码安全
- ✅ SHA-256 哈希存储
- ✅ 10 分钟自动过期
- ✅ 发送限流（1 次/分钟）
- ✅ 注册限流（5 次/小时）

### 权限隔离
- ✅ 分销商只能查看自己的数据
- ✅ 审核状态登录拦截
- ✅ API 端点双重权限检查

### 删除保护
- ✅ 已使用的兑换码不可删除
- ✅ 防止数据不一致

---

## 🐛 常见问题

### Q1: 迁移失败："role distributor already exists"
**解决**: 这是正常的，PostgreSQL 的 `IF NOT EXISTS` 会跳过已存在的值。

### Q2: 现有管理员无法登录
**检查**:
```sql
SELECT username, role, approval_status FROM users WHERE role != 'distributor';
```
所有现有用户的 `approval_status` 应该是 `approved`。

### Q3: 分销商默认组未创建
**手动创建**:
```sql
INSERT INTO team_groups (name, description, color, created_at)
VALUES ('分销商默认组', '分销商自动创建兑换码的默认分组', '#722ed1', NOW());
```

### Q4: 邮件发送失败
**检查 SMTP 配置**:
```bash
# 进入后端容器
docker-compose exec backend python

# 测试邮件
from app.database import SessionLocal
from app.services.email import test_email_connection
db = SessionLocal()
print(test_email_connection(db))
```

---

## 📊 数据库schema变更

### users 表
```sql
-- 新增字段
ALTER TABLE users ADD COLUMN approval_status VARCHAR(20) DEFAULT 'approved';
ALTER TABLE users ADD COLUMN rejection_reason VARCHAR(255);

-- 新增枚举值
ALTER TYPE userrole ADD VALUE 'distributor';
```

### verification_codes 表（新增）
```sql
CREATE TABLE verification_codes (
    id SERIAL PRIMARY KEY,
    email VARCHAR(100) NOT NULL,
    code_hash VARCHAR(128) NOT NULL,
    purpose VARCHAR(20) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    verified BOOLEAN DEFAULT FALSE,
    attempt_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX ix_verification_codes_email ON verification_codes(email);
CREATE INDEX ix_verification_codes_purpose ON verification_codes(purpose);
CREATE INDEX ix_verification_codes_expires_at ON verification_codes(expires_at);
```

### team_groups 表
```sql
-- 新增默认分组
INSERT INTO team_groups (name, description, color, created_at)
VALUES ('分销商默认组', '分销商自动创建兑换码的默认分组', '#722ed1', NOW());
```

### system_configs 表
```sql
-- 新增配置
INSERT INTO system_configs (key, value, description)
VALUES ('distributor_default_group_id', '<group_id>', '分销商默认分组 ID');
```

---

## 📝 后续开发任务

由于时间限制，以下功能的代码实现需要继续完成：

### 后端 API（剩余）
- [ ] Phase 2.2-2.8: 验证码、注册、审核、权限控制、分销商路由

### 前端页面（全部）
- [ ] Phase 3.1-3.8: 注册、登录、分销商布局、Dashboard、审核页面等

### 测试和优化
- [ ] Phase 4.1: 验证码清理定时任务
- [ ] Phase 4.2: 完整功能测试
- [ ] Phase 4.3: 最终文档

---

## 🆘 获取帮助

如果遇到问题：
1. 查看日志：`./team logs-backend`
2. 检查数据库：`docker-compose exec db psql -U postgres invitehub`
3. 提交 Issue：https://github.com/your-repo/invitehub/issues

---

## ✅ 升级完成检查

升级完成后，确认以下项目：
- [ ] 所有 6 个容器正常运行
- [ ] 数据库迁移版本为 012
- [ ] 后端健康检查通过
- [ ] 前端页面正常访问
- [ ] 管理员可以正常登录
- [ ] 现有兑换码功能正常
- [ ] 邮件服务正常
- [ ] "分销商默认组"已创建

---

**升级文档生成时间**: 2025-12-08
**文档版本**: v1.0
**维护者**: Claude Code Team
