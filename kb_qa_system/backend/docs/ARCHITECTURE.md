# 系统架构文档（M-20 修复：充实 docs 目录）

## 1. 系统概述

GeiIt企业知识库是一个基于 RAG（检索增强生成）的智能问答平台，支持文档上传、向量化检索、LLM 问答、流式输出等核心功能。

## 2. 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| Web 框架 | FastAPI | 异步 API，自动生成 OpenAPI 文档 |
| 数据库 | PostgreSQL + pgvector | 关系数据 + 向量存储一体化 |
| 缓存 | Redis | 限流、幂等、Token 黑名单、分布式锁 |
| 任务队列 | Celery | 异步文档处理流水线 |
| LLM 框架 | LangChain + ChatOpenAI | 主备模型 + 熔断 + 重试 |
| 监控 | Prometheus + Grafana | 指标采集 + 可视化告警 |
| 部署 | Railway | 支持 releaseCommand 自动迁移 |

## 3. 目录结构

```
backend/
├── app/
│   ├── api/routes/          # API 路由层
│   │   ├── auth.py          # 认证（注册/登录/登出/刷新）
│   │   ├── chat.py          # 对话问答（流式/非流式）
│   │   ├── documents.py     # 文档管理（上传/列表/详情/删除/重处理）
│   │   ├── stats.py         # 质量统计
│   │   └── metrics.py       # Prometheus 指标端点
│   ├── core/                # 核心基础设施
│   │   ├── config.py        # 配置管理（Pydantic Settings）
│   │   ├── database.py      # SQLAlchemy 引擎与会话
│   │   ├── redis.py         # Redis 管理器（分布式锁/限流/黑名单）
│   │   ├── security.py      # JWT Token + 密码哈希
│   │   ├── celery_app.py    # Celery 应用配置
│   │   ├── circuit_breaker.py # 熔断器
│   │   └── url_validator.py # URL 安全校验（防 SSRF）
│   ├── models/              # SQLAlchemy 数据模型
│   ├── schemas/             # Pydantic 请求/响应 Schema
│   ├── services/            # 业务逻辑层
│   │   ├── rag_chain.py     # RAG 核心（检索→生成）
│   │   ├── llm_resilience.py # LLM 容错（重试/降级/熔断）
│   │   ├── vector_store.py  # pgvector 向量存储
│   │   ├── document_pipeline/ # 文档处理流水线
│   │   ├── permission.py    # 权限隔离服务
│   │   ├── history_service.py # 对话历史 + 记忆衰退
│   │   └── qa_event_service.py # 质量埋点
│   ├── tasks/               # Celery 异步任务
│   ├── middleware/          # 中间件（Prometheus）
│   ├── utils/               # 通用工具函数
│   └── main.py              # FastAPI 应用入口
├── docs/                    # 项目文档
├── tests/                   # 测试用例
└── alembic/                 # 数据库迁移
```

## 4. 核心架构设计

### 4.1 RAG 问答流程

```
用户提问 → 意图识别 → 检索范围计算 → 向量检索 → Reranking → Prompt 构建 → LLM 生成 → 质量埋点
```

**权限隔离**：检索范围通过 `permission_service.get_accessible_document_ids()` 计算，
限定为"用户自有文档 + 公共文档库"，防止越权访问他人文档。

**记忆衰退**：`history_service` 在对话轮数达到阈值时，用 LLM 压缩旧对话为摘要，
注入到 Prompt 中作为长期上下文，避免 Token 爆炸。

**意图识别**：闲聊/追问/元问题走无检索路径，避免被预生成校验误拦截。

### 4.2 文档处理流水线

```
上传 → Celery 任务 → 解析 → 清洗 → 表格提取 → 图片处理 → 分块 → 向量化 → pgvector 存储
```

**幂等性**：文件哈希去重 + Celery 任务重试时先清理旧分块。

**质量评分**：流水线输出 quality_score，低于阈值的文档标记为 low_quality。

### 4.3 LLM 容错机制

```
主模型（带重试） → 失败降级 → 备用模型（单次尝试） → 仍失败 → 熔断器打开 → 兜底回复
```

**熔断器**：连续失败触发熔断，快速失败避免雪崩，半开状态探测恢复。

**ContextVar 指标**：每个请求独立的 LLM 调用指标（耗时、Token、重试次数），并发安全。

### 4.4 安全设计

| 威胁 | 防护措施 |
|------|----------|
| 越权访问 | user_id 贯穿检索全链路，无 user_id 拒绝检索 |
| SSRF | URL 校验：私有 IP 段过滤 + 重定向限制 + 大小限制 |
| 路径遍历 | sanitize_filename 剥离路径 + basename 提取 |
| 重复提交 | Redis 分布式锁 + 结果缓存（幂等性） |
| Token 泄露 | 双 Token 机制 + 黑名单 + fail-closed 校验 |
| 暴力破解 | 登录限流 + 锁定策略 |
| 信息泄露 | 错误信息脱敏 + 超管审计日志 |

## 5. 部署架构

```
Railway
├── Web 服务（FastAPI + Uvicorn）
├── Worker（Celery）
├── PostgreSQL（pgvector 扩展）
└── Redis（持久化开启）
```

**数据库迁移**：Railway `releaseCommand = "alembic upgrade head"` 在部署前自动执行。

**环境变量**：通过 `.env` 配置，敏感信息（SECRET_KEY、DATABASE_URL）从环境变量注入。
