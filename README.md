<div align="center">

# 🚀 ChatGPT Team Manager

<p>
  <strong>企业级 ChatGPT Team 自助上车管理平台</strong>
</p>

<p>
  <img src="https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white" alt="FastAPI">
  <img src="https://img.shields.io/badge/React-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker">
</p>

<p>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=for-the-badge" alt="License"></a>
  <a href="https://github.com/1307929582/team-invite/stargazers"><img src="https://img.shields.io/github/stars/1307929582/team-invite?style=for-the-badge" alt="Stars"></a>
  <a href="https://github.com/1307929582/team-invite/issues"><img src="https://img.shields.io/github/issues/1307929582/team-invite?style=for-the-badge" alt="Issues"></a>
</p>

<p>
  <a href="#-快速开始">快速开始</a> •
  <a href="#-功能特性">功能特性</a> •
  <a href="#-命令行工具">CLI 工具</a> •
  <a href="#-部署文档">部署文档</a>
</p>

</div>

---

## 🎯 一键部署

```bash
curl -fsSL https://raw.githubusercontent.com/1307929582/team-invite/main/install.sh | bash
```

部署完成后访问 `http://你的IP:3456` 即可使用。

---

## ✨ 功能特性

<table>
<tr>
<td width="50%">

### 👤 用户端
- 🎫 兑换码自助上车（邮箱 + 兑换码）
- ⏰ 30 天有效期机制
- 🔄 换车功能（Team 不可用时重新分配）
- 📊 实时座位统计
- 🔍 订阅状态查询
- 🎯 智能 Team 分配

</td>
<td width="50%">

### 🛠️ 管理端
- 👥 多 Team 集中管理
- 🎟️ 批量生成兑换码
- 📧 一键批量邀请
- 🔄 成员自动同步
- 📈 Dashboard 数据统计 + 销售统计
- 💰 价格配置与销售额计算
- 📝 完整操作日志

</td>
</tr>
</table>

---

## 🖥️ 命令行工具

部署后可使用 `team` 命令管理服务：

```bash
team status    # 查看服务状态
team start     # 启动服务
team stop      # 停止服务
team restart   # 重启服务
team update    # 更新系统
team logs      # 查看后端日志
team backup    # 备份数据库
team cache     # 清理缓存
```

直接运行 `team` 进入交互式菜单。

---

## 🚀 快速开始

### 手动 Docker 部署

```bash
# 克隆项目
git clone https://github.com/1307929582/team-invite.git
cd team-invite

# 启动服务（PostgreSQL 版本，推荐）
docker compose -f docker-compose.postgres.yml up -d --build
```

### 访问地址

| 服务 | 地址 |
|:---:|:---:|
| 🌐 用户端 | `http://localhost:3456` |
| ⚙️ 管理后台 | `http://localhost:3456/admin` |
| 📚 API 文档 | `http://localhost:4567/docs` |

---

## 📖 使用流程

```
1️⃣ 首次访问 → 初始化管理员账号
2️⃣ 管理后台 → 添加 Team → 填写 Token 信息
3️⃣ 生成兑换码 → 设置有效天数 → 分发给用户
4️⃣ 用户上车 → 输入邮箱 + 兑换码 → 完成
5️⃣ 用户查询 → 输入邮箱查看订阅状态
```

📖 Token 获取参考 [Token 指南](docs/TOKEN_GUIDE.md)

---

## 🔧 技术栈

| 后端 | 前端 | 数据库 | 部署 |
|:---:|:---:|:---:|:---:|
| FastAPI | React 18 | PostgreSQL | Docker |
| SQLAlchemy | TypeScript | Redis | Nginx |
| JWT | Ant Design | | |

---

## 🔄 更新升级

```bash
team update
```

或手动：

```bash
cd ~/team-invite
git pull
docker compose -f docker-compose.postgres.yml up -d --build
```

---

## 🔒 安全特性

- ✅ JWT Token 认证
- ✅ 密码 bcrypt 加密
- ✅ 兑换码防暴力破解
- ✅ 首次部署强制初始化
- ✅ 敏感数据不暴露

详见 [安全说明](docs/SECURITY.md) | [部署指南](docs/DEPLOYMENT.md)

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

详见 [贡献指南](CONTRIBUTING.md)

---

## 📄 License

[MIT License](LICENSE)

---

<div align="center">
  <sub>Made with ❤️ for ChatGPT Team managers</sub>
</div>
