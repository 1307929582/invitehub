# 贡献指南

感谢你对 ChatGPT Team Manager 项目的关注！我们欢迎任何形式的贡献。

## 如何贡献

### 报告 Bug

1. 先搜索 [Issues](https://github.com/1307929582/team-invite/issues) 确认问题是否已被报告
2. 如果没有，创建新 Issue，包含：
   - 清晰的问题描述
   - 复现步骤
   - 期望行为 vs 实际行为
   - 环境信息（操作系统、Docker 版本等）

### 提交功能建议

1. 创建 Issue 描述你的想法
2. 说明使用场景和预期效果
3. 等待维护者反馈后再开始开发

### 提交代码

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feature/your-feature`
3. 提交更改：`git commit -m 'feat: 添加某功能'`
4. 推送分支：`git push origin feature/your-feature`
5. 创建 Pull Request

## 开发环境

### 后端

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 4567
```

### 前端

```bash
cd frontend
npm install
npm run dev
```

## 代码规范

### 提交信息格式

使用 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

- `feat:` 新功能
- `fix:` Bug 修复
- `docs:` 文档更新
- `style:` 代码格式（不影响功能）
- `refactor:` 重构
- `test:` 测试相关
- `chore:` 构建/工具相关

### 代码风格

- Python: 遵循 PEP 8
- TypeScript/React: 使用 ESLint 默认规则
- 保持代码简洁，添加必要注释

## 项目结构

```
├── backend/          # FastAPI 后端
│   ├── app/
│   │   ├── routers/  # API 路由
│   │   ├── services/ # 业务逻辑
│   │   └── models.py # 数据模型
│   └── alembic/      # 数据库迁移
├── frontend/         # React 前端
│   └── src/
│       ├── pages/    # 页面组件
│       ├── components/
│       └── api/      # API 封装
└── docs/             # 文档
```

## 许可证

提交代码即表示你同意将代码以 MIT 许可证发布。
