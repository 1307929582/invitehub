# 更新日志

所有重要更改都会记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.0.0] - 2025-11-28

### 新增

- 🎉 首次发布
- 👥 多 Team 管理 - 集中管理多个 ChatGPT Team
- 🎟️ 兑换码系统 - 支持 LinuxDO 登录兑换和直接链接兑换
- 📧 批量邀请 - 一键邀请多个用户加入 Team
- 🔄 成员同步 - 自动同步 Team 成员列表
- 📈 数据统计 - Dashboard 展示关键指标
- 📝 操作日志 - 完整的审计日志
- 🔐 LinuxDO OAuth - 集成 LinuxDO 登录认证
- 📊 Team 分组 - 支持按分组管理 Team
- ⚠️ 预警系统 - Token 过期和成员超限预警
- 📧 邮件通知 - 支持 SMTP 邮件预警

### 技术栈

- 后端: FastAPI + SQLAlchemy + JWT
- 前端: React 18 + TypeScript + Ant Design
- 数据库: SQLite / PostgreSQL
- 部署: Docker Compose

---

## 版本说明

- **主版本号**: 不兼容的 API 修改
- **次版本号**: 向下兼容的功能性新增
- **修订号**: 向下兼容的问题修正
