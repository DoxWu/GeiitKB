# 贡献指南 — GeiIt企业知识库

> 感谢您为 GeiIt企业知识库 项目贡献力量！本文档描述了开发环境搭建、分支策略、提交规范和 PR 流程。

---

## 1. 开发环境搭建

### 1.1 环境要求

| 工具 | 版本要求 | 说明 |
|------|----------|------|
| Python | ≥ 3.11 | 后端运行时 |
| Node.js | ≥ 20 LTS | 前端构建 |
| PostgreSQL | ≥ 15 | 需安装 pgvector 扩展 |
| Redis | ≥ 7 | 缓存与分布式锁 |

### 1.2 后端搭建

```bash
cd kb_qa_system/backend

# 创建虚拟环境
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 安装依赖（含开发依赖）
pip install -r requirements-dev.txt

# 配置环境变量
cp .env.example .env
# 编辑 .env 填写 DATABASE_URL、REDIS_URL 等

# 执行数据库迁移
alembic upgrade head

# 启动开发服务器
uvicorn app.main:app --reload --port 8000
```

### 1.3 前端搭建

```bash
cd kb_qa_system/frontend

# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 运行测试
npm run test

# 生产构建
npm run build
```

### 1.4 详细部署指南

- 本地开发：参考 [docs/LOCAL_DEPLOYMENT_GUIDE.md](docs/LOCAL_DEPLOYMENT_GUIDE.md)
- 生产部署：参考 [docs/RAILWAY_DEPLOYMENT_GUIDE.md](docs/RAILWAY_DEPLOYMENT_GUIDE.md)

---

## 2. 分支策略

采用 Git Flow 精简版：

| 分支 | 用途 | 命名规范 | 合并规则 |
|------|------|----------|----------|
| `main` | 生产分支 | - | 只接受 PR 合并，禁止直接 push |
| `develop` | 开发分支 | - | 定期合并到 main |
| `feature/*` | 功能分支 | `feature/E1-03-rate-limit-middleware` | 合并到 develop |
| `fix/*` | 修复分支 | `fix/login-redirect-bug` | 合并到 develop |
| `release/*` | 发布分支 | `release/v1.2.0` | 合并到 main + develop |
| `hotfix/*` | 紧急修复 | `hotfix/security-patch` | 合并到 main + develop |

### 分支保护规则

- `main` 分支禁止直接 push，必须通过 PR
- PR 必须通过 CI 检查（测试 + lint + build）
- PR 至少需要 1 人 Approve
- 合并后自动删除源分支

---

## 3. Commit 规范

采用 [Conventional Commits](https://www.conventionalcommits.org/)：

```
<type>(<scope>): <subject>

<body>

<footer>
```

### type 类型

| 类型 | 用途 | 示例 |
|------|------|------|
| `feat` | 新功能 | `feat(documents): 添加文档库分支管理` |
| `fix` | bug 修复 | `fix(auth): 修复登录重定向循环` |
| `docs` | 文档变更 | `docs(api): 更新 API 文档` |
| `style` | 代码格式 | `style(format): 统一缩进` |
| `refactor` | 重构 | `refactor(store): 拆分 documentStore` |
| `test` | 测试相关 | `test(cleanup): 添加清理任务测试` |
| `chore` | 构建/工具 | `chore(deps): 更新依赖版本` |
| `security` | 安全修复 | `security(jwt): 修复 Token 验证漏洞` |

### 示例

```
feat(chat): 添加流式回答取消功能

- 新增 CancelButton 组件
- chatStore 添加 cancelStreaming action
- 支持用户中途终止 LLM 响应

Closes #123
```

---

## 4. PR 流程

### 4.1 提交 PR

1. 从 `develop` 创建功能分支：`git checkout -b feature/your-feature`
2. 编写代码并添加测试
3. 确保本地测试通过：`npm run test` + `pytest`
4. 提交代码并推送到远程
5. 创建 PR，填写描述：
   - 变更说明（做了什么、为什么）
   - 测试方式（如何验证）
   - 关联 Issue（`Closes #123`）

### 4.2 代码审查清单

| 维度 | 检查项 |
|------|--------|
| 功能正确性 | 是否实现预期功能？边界条件是否处理？ |
| 安全性 | 是否有 SQL 注入/XSS/SSRF 风险？权限校验是否完整？ |
| 性能 | 是否有 N+1 查询？缓存使用是否合理？ |
| 测试 | 是否有对应单元测试？测试是否验证行为？ |
| 代码规范 | 命名是否清晰？注释是否充分（中文）？ |
| 文档 | API 变更是否更新文档？CHANGELOG 是否更新？ |

### 4.3 审查权限

| 变更类型 | 审查人数 | 要求 |
|----------|----------|------|
| 普通功能/修复 | 1 人 | 任何团队成员 |
| 核心路径（认证/权限） | 2 人 | 至少 1 名核心维护者 |
| 架构变更 | 2 人 | 技术负责人 + 1 名核心维护者 |
| 紧急 hotfix | 1 人 | 核心维护者（事后补审） |

---

## 5. 测试要求

### 5.1 后端测试

```bash
cd kb_qa_system/backend

# 运行全部测试
pytest

# 运行并查看覆盖率
pytest --cov=app --cov-report=term-missing

# 运行单个测试文件
pytest tests/test_email_system.py -v
```

- 覆盖率阈值：≥ 60%（`pyproject.toml` 中配置 `fail_under = 60`）
- 测试策略：静态分析（读源码）+ 行为测试（monkeypatch），避免运行时依赖

### 5.2 前端测试

```bash
cd kb_qa_system/frontend

# 运行全部测试
npm run test

# 运行并查看覆盖率
npm run test -- --coverage

# 运行单个测试文件
npx vitest run src/pages/__tests__/LoginPage.test.tsx
```

- 覆盖率阈值：≥ 80%（`vitest.config.ts` 中配置）
- 使用 Vitest + Testing Library
- Mock 策略：`vi.hoisted()` 确保 mock 在 `vi.mock()` 提升时可用

### 5.3 测试规范

- 测试文件放在 `__tests__/` 目录下，与被测文件同级
- 测试文件命名：`<ComponentName>.test.tsx` 或 `test_<module>.py`
- 每个测试覆盖：正常路径、边界条件、错误状态
- 使用中文描述测试用例，与代码注释语言一致

---

## 6. 代码规范

### 6.1 后端（Python）

- 格式化：ruff（`pyproject.toml` 配置规则）
- 类型检查：mypy
- 注释：函数需包含中文 docstring（作用、参数、返回值）

### 6.2 前端（TypeScript/React）

- 格式化：ESLint + Prettier
- 类型检查：`tsc --noEmit`
- 注释：函数需包含 JSDoc 注释（作用、参数、返回值）
- 命名：组件用 PascalCase，函数/变量用 camelCase，常量用 UPPER_SNAKE_CASE

---

## 7. 版本发布

### 7.1 版本号策略

采用 [Semantic Versioning](https://semver.org/)：`MAJOR.MINOR.PATCH`

### 7.2 发布流程

1. 创建 release 分支（`release/vX.Y.Z`）
2. 更新 [CHANGELOG.md](CHANGELOG.md)
3. 在 release 分支运行全量测试
4. 合并到 `main` 并打 Git tag（`vX.Y.Z`）
5. Railway 自动部署
6. 部署后验证（健康检查 + 核心功能测试）

### 7.3 回滚

参考 [docs/ROLLBACK_SOP.md](docs/ROLLBACK_SOP.md)：
- Railway Dashboard → 选择上一个部署 → Redeploy
- 数据库回滚：`alembic downgrade -1`（需评估兼容性）

---

## 8. 问题反馈

- **Bug 报告**：创建 Issue，使用 `bug` 标签
- **功能请求**：创建 Issue，使用 `enhancement` 标签
- **安全漏洞**：请勿公开 Issue，私聊核心维护者

---

> 本指南随项目发展持续更新，如有建议请提交 PR。
