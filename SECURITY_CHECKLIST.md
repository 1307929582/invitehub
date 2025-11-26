# 安全检查清单

## ✅ 已实施的安全措施

### 认证与授权
- [x] JWT Token 认证，7天有效期
- [x] 所有管理员接口都需要 `get_current_user` 验证
- [x] 密码使用 bcrypt 加密存储
- [x] 首次部署强制初始化设置
- [x] 初始化后无法重复设置
- [x] 移除了硬编码的管理员账号

### 接口保护
- [x] 公开接口和管理接口严格分离
- [x] 前端路由守卫，未登录无法访问管理后台
- [x] 未初始化强制跳转设置页
- [x] 401 自动跳转登录页

### 数据安全
- [x] 敏感字段（session_token, cookie）不在 API 响应中暴露
- [x] JWT Secret Key 在初始化时自动生成
- [x] 数据库文件已加入 .gitignore
- [x] 环境变量文件已加入 .gitignore

### 输入验证
- [x] 邮箱格式验证
- [x] 密码长度验证（最少6位）
- [x] 用户名长度验证（最少3位）
- [x] Token 自动清理首尾空格

### 防护措施
- [x] 兑换码防暴力破解（5分钟内最多5次失败）
- [x] CORS 配置（需要在生产环境修改）
- [x] 速率限制保护

## ⚠️ 部署前必须检查

### 生产环境配置
- [ ] 修改 CORS 配置为生产域名
- [ ] 配置 HTTPS 证书
- [ ] 设置强密码的管理员账号
- [ ] 配置防火墙规则
- [ ] 设置 Nginx 反向代理
- [ ] 配置定期数据库备份

### 敏感信息检查
- [ ] 确认 .gitignore 包含所有敏感文件
- [ ] 确认没有硬编码的密码或 Token
- [ ] 确认 .env 文件不会被上传
- [ ] 确认 data/ 目录不会被上传

### LinuxDO OAuth 配置
- [ ] 在 LinuxDO 创建 OAuth 应用
- [ ] 配置正确的回调地址
- [ ] 在系统设置中填写 Client ID 和 Secret

## 🔍 安全审计要点

### 1. 认证绕过检查
```bash
# 测试未登录访问管理接口
curl http://localhost:4567/api/v1/teams
# 应返回 401 Unauthorized
```

### 2. 初始化保护检查
```bash
# 测试重复初始化
curl -X POST http://localhost:4567/api/v1/setup/initialize \
  -H "Content-Type: application/json" \
  -d '{"username":"test","email":"test@test.com","password":"123456","confirm_password":"123456"}'
# 已初始化后应返回 403 Forbidden
```

### 3. 兑换码暴力破解检查
```bash
# 连续尝试错误的兑换码
for i in {1..6}; do
  curl -X POST http://localhost:4567/api/v1/public/redeem \
    -H "Content-Type: application/json" \
    -d '{"email":"test@test.com","redeem_code":"WRONG","linuxdo_token":"xxx"}'
done
# 第6次应返回 429 Too Many Requests
```

### 4. SQL 注入检查
```bash
# 测试 SQL 注入
curl "http://localhost:4567/api/v1/teams?id=1' OR '1'='1"
# 应正常处理或返回错误，不应泄露数据库信息
```

### 5. XSS 检查
- 在所有输入框测试 `<script>alert('xss')</script>`
- 应被正确转义，不执行脚本

## 🚨 已知风险点

### 1. LinuxDO OAuth Token 存储
**风险**：用户的 LinuxDO token 存储在前端 localStorage
**影响**：XSS 攻击可能窃取 token
**缓解**：
- 定期清理过期 token
- 考虑改为后端 Session 管理
- 使用 HttpOnly Cookie

### 2. 兑换码暴力破解
**风险**：8位兑换码可能被暴力破解
**影响**：未授权用户可能获取访问权限
**缓解**：
- ✅ 已实施：5分钟内最多5次失败尝试
- 建议：添加 IP 级别的速率限制
- 建议：使用更长的兑换码（12位）

### 3. Session Token 泄露
**风险**：ChatGPT Session Token 存储在数据库
**影响**：数据库泄露会导致 Team 访问权限泄露
**缓解**：
- 定期检查 Token 有效期
- 及时更新过期 Token
- 考虑加密存储 Token

### 4. CORS 配置
**风险**：当前允许所有域名访问
**影响**：可能被恶意网站利用
**缓解**：
- ⚠️ 生产环境必须修改为指定域名
- 参考 DEPLOYMENT.md 修改配置

## 🛡️ 安全最佳实践

### 1. 密码策略
- 最少6位（建议提高到8位）
- 建议包含大小写字母、数字、特殊字符
- 定期提醒管理员修改密码

### 2. Token 管理
- JWT Token 7天有效期
- Session Token 定期检查和更新
- 考虑实施 Token 刷新机制

### 3. 日志审计
- 所有关键操作都记录在 operation_logs
- 定期检查异常操作
- 保留至少30天的日志

### 4. 备份策略
- 每天自动备份数据库
- 保留至少30天的备份
- 定期测试备份恢复

### 5. 更新维护
- 定期更新依赖包
- 关注安全漏洞公告
- 及时应用安全补丁

## 📞 应急响应

### 管理员密码泄露
1. 立即登录修改密码
2. 检查操作日志
3. 如无法登录，删除数据库重新初始化

### Session Token 泄露
1. 在 ChatGPT 官网登出所有设备
2. 重新获取 Token
3. 在管理后台更新 Team 配置

### 数据库泄露
1. 立即修改所有管理员密码
2. 重新生成所有兑换码
3. 通知所有用户可能的数据泄露

### 发现未授权访问
1. 检查操作日志确认影响范围
2. 修改所有敏感凭证
3. 加强访问控制
4. 考虑报警

## 📚 参考资料

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [FastAPI Security](https://fastapi.tiangolo.com/tutorial/security/)
- [JWT Best Practices](https://tools.ietf.org/html/rfc8725)
