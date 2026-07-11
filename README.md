# GeiIt企业知识库

> 基于 RAG（检索增强生成）的企业内部知识库智能问答系统，支持文档上传、向量检索、AI 问答、多用户权限管理。

## 项目简介

GeiIt企业知识库是一个生产级 RAG 智能问答系统，帮助企业构建私有知识库并提供 AI 驱动的问答服务。系统支持多种文档格式（PDF、Word、Markdown、TXT 等），通过 pgvector 向量检索和大语言模型实现精准问答，并提供完善的用户权限管理和文档访问控制。

### 核心功能

- 📄 **文档管理**：支持 PDF/Word/Markdown/TXT 上传、自动分块、向量化、质量评估
- 🔍 **智能问答**：基于 RAG 的检索增强生成，支持流式输出和上下文记忆
- 👥 **权限控制**：公共文档库 + 个人文档库，用户只能访问授权范围内的文档
- 🔒 **安全认证**：JWT 双 Token 认证、注册审批流程、邮箱验证
- 📊 **审计日志**：敏感操作全记录，数据保留策略自动清理
- 🌙 **多端适配**：PWA 支持、暗色模式、IME 输入法兼容

## 技术栈

| 层级 | 技术选型 |
|------|----------|
| **前端** | React 18 + TypeScript + Vite 6 + Tailwind CSS + Zustand |
| **后端** | FastAPI + SQLAlchemy 2.0 + Pydantic 2 + structlog |
| **数据库** | PostgreSQL 16 + pgvector（向量存储）|
| **缓存** | Redis（缓存 + 限流 + 分布式锁）|
| **任务队列** | Celery + Flower（异步文档处理）|
| **AI/RAG** | LangChain + OpenAI + sentence-transformers |
| **监控** | Prometheus + Grafana + Alertmanager + Sentry |
| **部署** | Railway + Docker + nginx |

## 项目结构

```
企业知识库问答系统/
├── .github/                    # CI/CD 配置
│   ├── workflows/ci.yml       # GitHub Actions 流水线
│   └── dependabot.yml         # 依赖漏洞扫描
├── .trae/documents/            # 开发文档与计划
├── docs/                       # 项目文档
│   ├── COMPREHENSIVE_REVIEW_10D.md  # 十维度审查报告
│   ├── LOCAL_DEPLOYMENT_GUIDE.md    # 本地部署指南
│   ├── RAILWAY_DEPLOYMENT_GUIDE.md  # Railway 部署指南
│   ├── ROLLBACK_SOP.md              # 回滚 SOP
│   ├── CANARY_RELEASE.md            # 灰度发布方案
│   ├── ONLINE_MIGRATION_GUIDE.md    # 在线迁移策略
│   └── RUNBOOK.md                   # 事故响应手册
├── kb_qa_system/
│   ├── backend/                # FastAPI 后端
│   │   ├── app/
│   │   │   ├── api/routes/     # API 路由
│   │   │   ├── core/           # 配置、安全、数据库
│   │   │   ├── middleware/     # 中间件
│   │   │   ├── models/         # 数据模型
│   │   │   ├── schemas/        # Pydantic Schema
│   │   │   ├── services/       # 业务服务层
│   │   │   ├── tasks/          # Celery 异步任务
│   │   │   └── utils/          # 工具函数
│   │   ├── tests/              # 测试文件
│   │   ├── scripts/            # 运维脚本
│   │   ├── alembic/            # 数据库迁移
│   │   └── requirements.txt
│   ├── frontend/               # React 前端
│   │   ├── src/
│   │   │   ├── api/            # API 客户端
│   │   │   ├── components/     # UI 组件
│   │   │   ├── pages/          # 页面
│   │   │   ├── store/          # Zustand 状态管理
│   │   │   ├── types/          # TypeScript 类型
│   │   │   └── utils/          # 工具函数
│   │   └── package.json
│   └── monitoring/             # 监控配置
│       ├── docker-compose.monitoring.yml
│       ├── prometheus.yml
│       ├── alertmanager.yml
│       └── alerts.yml
└── README.md                   # 本文件
```

## 快速开始

### 本地开发

详见 [本地部署指南](docs/LOCAL_DEPLOYMENT_GUIDE.md)

```bash
# 1. 克隆仓库
git clone <repo-url>
cd 企业知识库问答系统

# 2. 后端启动
cd kb_qa_system/backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env  # 编辑环境变量
alembic upgrade head
uvicorn app.main:app --reload

# 3. 前端启动
cd kb_qa_system/frontend
npm install
cp .env.example .env  # 编辑环境变量
npm run dev
```

### 生产部署

详见 [Railway 部署指南](docs/RAILWAY_DEPLOYMENT_GUIDE.md)

## 文档索引

| 文档 | 说明 |
|------|------|
| [本地部署指南](docs/LOCAL_DEPLOYMENT_GUIDE.md) | 本地开发环境搭建 |
| [Railway 部署指南](docs/RAILWAY_DEPLOYMENT_GUIDE.md) | 生产环境部署流程 |
| [十维度审查报告](docs/COMPREHENSIVE_REVIEW_10D.md) | 全面代码审查报告 |
| [改进实施报告](.trae/documents/改进实施报告.md) | 29 项改进落实记录 |
| [项目全面评估与维护方案](.trae/documents/项目全面评估与维护方案.md) | 评估与维护体系 |
| [回滚 SOP](docs/ROLLBACK_SOP.md) | 代码/数据库回滚流程 |
| [灰度发布方案](docs/CANARY_RELEASE.md) | 灰度发布策略 |
| [在线迁移策略](docs/ONLINE_MIGRATION_GUIDE.md) | 数据库在线迁移 |
| [事故响应手册](docs/RUNBOOK.md) | 故障处理流程 |

## 开发规范

- **Commit 规范**：遵循 [Conventional Commits](https://www.conventionalcommits.org/)
- **代码审查**：所有 PR 需至少 1 人审查，核心路径需 2 人
- **测试要求**：新功能需配套单元测试，CI 必须通过
- **文档同步**：API 变更需同步更新文档

## 许可证

私有项目，版权所有 © 2026 GeiIt
