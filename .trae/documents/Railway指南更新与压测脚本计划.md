# Railway 部署指南更新 + Locust 压测脚本 + 验证 计划

> 本计划承接前序会话已完成的工作（10D 审查报告 `COMPREHENSIVE_REVIEW_10D.md`、本地部署指南 `LOCAL_DEPLOYMENT_GUIDE.md`），聚焦剩余 3 个交付物。

---

## 一、当前状态分析

### 已完成（前序会话）
- ✅ `docs/COMPREHENSIVE_REVIEW_10D.md`（543 行，29 项问题，88/100 就绪度）
- ✅ `docs/LOCAL_DEPLOYMENT_GUIDE.md`（794 行，10 章节）

### 待完成（本计划范围）
1. ⏳ 更新 `docs/RAILWAY_DEPLOYMENT_GUIDE.md`（现有 942 行，缺少 Resend 邮件配置、注册审批流程、完整环境变量表、10D 审查注意事项）
2. ⏳ 创建 `kb_qa_system/backend/tests/load/locustfile.py` + `README.md`（10D 报告 D4-01 引用了此文件但尚不存在）
3. ⏳ 验证：后端 pytest + 前端 tsc/vitest/build + 文档链接

### 关键发现（Phase 1 探索结果）
- Railway 指南现有 16 章节，**4.5 超级管理员**已存在（无需新增，仅需交叉引用）
- **环境变量参考表（L532-615）严重不全**：缺邮件相关 13 项变量、限流、向量检索、文档处理、缓存等配置
- `.env.example` 有完整邮件配置（SMTP_HOST/PORT/PASSWORD、EMAIL_FROM、ADMIN_NOTIFY_EMAIL、FRONTEND_BASE_URL 等）
- locust 不在 requirements.txt 中（作为可选压测依赖，在 README 中说明安装方式）
- API 路由前缀确认：`/api/v1` + 各 router prefix（/auth, /documents, /chat）
- 限流配置：全局 100/min、登录 5/min、提问 20/min、上传 20/h（压测脚本需考虑）

---

## 二、实施步骤

### 步骤 1：更新 Railway 部署指南

**文件**：`docs/RAILWAY_DEPLOYMENT_GUIDE.md`

**修改方式**：在现有内容基础上增量编辑（Edit 工具，多处定点修改），不重写全文。

**具体修改点**：

#### 1.1 新增「邮件服务配置（Resend）」章节
- **位置**：在第 4 步（部署后端 API）的 4.4 和 4.5 之间，新增 `4.5 配置邮件服务（Resend）`
- **内容**：
  - Resend 简介（SMTP 代理服务，免费额度 3000 封/月）
  - 获取 API Key 步骤（resend.com/api-keys）
  - 在 Railway 后端服务 Variables 中添加邮件相关环境变量表（EMAIL_ENABLED、SMTP_HOST、SMTP_PORT、SMTP_PASSWORD、SMTP_USE_TLS、EMAIL_FROM、ADMIN_NOTIFY_EMAIL、FRONTEND_BASE_URL）
  - 验证邮件发送（触发一次注册申请，检查管理员邮箱）
  - 原有 4.5（超级管理员）顺延为 4.6，后续章节编号相应调整
- **注意**：由于章节重编号会涉及大量锚点修改，**改为在 4.4 后插入 4.5 邮件配置，原 4.5 超级管理员改为 4.6**，并更新目录和正文中所有交叉引用（如"见第 4.5 步"→"见第 4.6 步"）

#### 1.2 新增「注册审批流程部署说明」
- **位置**：在邮件服务配置章节之后，作为 4.7（或合并到邮件配置的验证部分）
- **内容**：
  - 注册审批全链路说明（申请→管理员邮件通知→审批→密码设置邮件→创建账号）
  - 部署后必须配置的变量：ADMIN_NOTIFY_EMAIL（接收申请通知）、FRONTEND_BASE_URL（拼接密码设置链接）
  - 管理员审批入口：前端管理员审批页面
  - Token 安全说明：24h 过期、一次性使用、SHA-256 哈希存储
  - 注意事项：EMAIL_ENABLED=False 时邮件不发但申请记录仍创建（降级模式）

#### 1.3 更新「环境变量完整参考」表
- **位置**：L532-615 的环境变量参考部分
- **修改**：在现有后端 API 和 Worker 的 env 块中补充以下分组变量：
  ```
  # ===== 邮件 SMTP（Resend）=====
  EMAIL_ENABLED=True
  SMTP_HOST=smtp.resend.com
  SMTP_PORT=465
  SMTP_USER=resend
  SMTP_PASSWORD=re_xxxxxxxxxxxx
  SMTP_USE_TLS=True
  SMTP_START_TLS=False
  SMTP_TIMEOUT=30
  EMAIL_FROM=GeiIt企业知识库 <noreply@yourdomain.com>
  ADMIN_NOTIFY_EMAIL=admin@yourcompany.com
  FRONTEND_BASE_URL=https://你的前端域名.up.railway.app
  PASSWORD_TOKEN_EXPIRE_HOURS=24

  # ===== 限流 =====
  ENABLE_RATE_LIMIT=True
  RATE_LIMIT_GLOBAL_PER_MINUTE=100
  RATE_LIMIT_LOGIN_PER_MINUTE=5
  RATE_LIMIT_ASK_PER_MINUTE=20
  RATE_LIMIT_UPLOAD_PER_HOUR=20

  # ===== 向量检索 =====
  SEARCH_TOP_K=4
  SIMILARITY_THRESHOLD=0.5
  ENABLE_HYBRID_SEARCH=True
  KEYWORD_SEARCH_WEIGHT=0.3

  # ===== 文档处理 =====
  CHUNK_SIZE=500
  CHUNK_OVERLAP=50
  ENABLE_OCR=True

  # ===== LLM 容错 =====
  LLM_TIMEOUT=30
  LLM_STREAM_FIRST_TOKEN_TIMEOUT=5
  CIRCUIT_BREAKER_THRESHOLD=5
  CIRCUIT_BREAKER_RECOVERY_TIME=60

  # ===== Prometheus =====
  ENABLE_PROMETHEUS=True
  PROMETHEUS_AUTH_ENABLED=True
  PROMETHEUS_AUTH_USER=prometheus
  PROMETHEUS_AUTH_PASSWORD=<生成的密码>
  PROMETHEUS_INCLUDE_PATH_LABEL=False
  ```
- Worker 服务也需补充邮件相关变量（Worker 发送邮件任务需要 SMTP 配置）

#### 1.4 更新「部署检查清单」
- **位置**：L730-765
- **补充项**：
  - 基础设施区：邮件服务（Resend）API Key 已配置、ADMIN_NOTIFY_EMAIL 已设置
  - 环境变量区：EMAIL_ENABLED=True、SMTP_PASSWORD 已设置、FRONTEND_BASE_URL 指向前端域名、PROMETHEUS_AUTH_ENABLED=True
  - 功能验证区：注册申请提交后管理员收到邮件、审批后申请人收到密码设置邮件、密码设置链接可正常打开
  - 安全检查区：/metrics 端点需 Basic Auth（PROMETHEUS_AUTH_ENABLED=True）

#### 1.5 更新「常见问题排查」
- **位置**：L769-883
- **新增 FAQ**：
  - Q11：注册申请提交后管理员未收到邮件 → 检查 EMAIL_ENABLED、SMTP_PASSWORD、ADMIN_NOTIFY_EMAIL、Resend API Key 有效性、Resend 发件域名验证状态
  - Q12：密码设置链接打开报"Token 无效或已过期" → Token 24h 过期/一次性使用/FRONTEND_BASE_URL 配置错误导致链接拼接错误
  - Q13：Resend 邮件发送失败（日志显示 SMTP 错误）→ 检查 SMTP_HOST/PORT/TLS 配置、发件域名是否在 Resend 验证、免费额度是否用尽
  - Q14：多副本部署时数据库迁移冲突 → 建议配置 releaseCommand 替代 entrypoint.sh 中的迁移（D9-01）

#### 1.6 添加 10D 审查注意事项
- **位置**：在相关章节末尾以 `> ⚠️ **10D 审查提醒**` 引用框形式添加
- **D9-01**（多副本迁移冲突）：在第 4.3 确认部署配置部分，提醒生产多副本场景建议用 `releaseCommand` 替代 entrypoint.sh 迁移
- **D3-02**（/metrics 默认无认证）：在监控与日志章节的 Prometheus 部分，强制提醒生产环境必须 `PROMETHEUS_AUTH_ENABLED=True`
- **D7-01**（无自动备份脚本）：在备份策略章节，提醒建议创建 pg_dump 定时备份脚本
- **D9-02**（回滚未含迁移回滚）：在回滚流程章节，提醒制定回滚 SOP 包含 alembic downgrade 判断流程

#### 1.7 更新文档末尾信息
- 更新"最后更新"日期为 2026-07-11
- 附录项目架构速查中补充 `docs/COMPREHENSIVE_REVIEW_10D.md` 和 `docs/LOCAL_DEPLOYMENT_GUIDE.md`

---

### 步骤 2：创建 Locust 压测脚本

**新建文件**：
1. `kb_qa_system/backend/tests/load/__init__.py`（空文件，确保包可导入）
2. `kb_qa_system/backend/tests/load/locustfile.py`（主压测脚本）
3. `kb_qa_system/backend/tests/load/README.md`（使用说明）

#### 2.1 `locustfile.py` 设计
- **4 个场景**（TaskSet）：
  1. **HealthCheckUser**：只访问 `/health`（基线，验证服务存活）
  2. **ReadOnlyUser**：登录→获取用户信息→浏览文档列表→查看文档统计→查看对话列表（读密集型）
  3. **QAUser**：登录→提问（/chat/ask）→查看对话列表（RAG 链路压测）
  4. **MixedUser**：登录→上传文档→列表→提问→删除文档（混合读写）
- **公共逻辑**：
  - `on_start` 方法：使用环境变量配置的测试账号登录获取 Token
  - 请求头携带 `Authorization: Bearer {token}`
  - 所有 URL 基于环境变量 `TARGET_HOST`（默认 http://localhost:8000）
  - 响应状态码校验 + 失败日志
- **环境变量配置**：
  - `TARGET_HOST`：目标地址
  - `TEST_USERNAME` / `TEST_PASSWORD`：测试账号
  - `TEST_USER2_USERNAME` / `TEST_USER2_PASSWORD`：第二个测试账号（混合场景用）
- **注意事项**：
  - 限流配置考虑（登录 5/min，所以登录放在 on_start 而非每次请求）
  - 提问频率受 RATE_LIMIT_ASK_PER_MINUTE=20 限制，wait_time 设为 3-5 秒
  - 上传使用小文件（内存生成 txt）避免大文件 IO 瓶颈
- **代码规范**：
  - 中文注释，函数级 docstring（用法、参数、返回值）
  - 类型提示
  - 遵循项目代码风格

#### 2.2 `README.md` 设计
- 安装 locust（`pip install locust`，不在 requirements.txt 中，作为可选压测工具）
- 前置准备（创建测试账号、准备测试数据）
- 运行命令（Web UI 模式 + Headless 模式）
- 4 个场景说明
- 环境变量配置表
- 结果指标解读（RPS、P95、失败率）
- 性能基线建议值（参考 10D 报告 D4）
- 注意事项（限流、Worker 依赖、LLM API 成本）

---

### 步骤 3：验证

#### 3.1 后端测试
- 命令：`cd kb_qa_system/backend && python -m pytest tests/ -v`
- 预期：38 passed, 0 failed
- 目的：确认本次文档更新和压测脚本添加未影响现有测试

#### 3.2 前端验证
- TypeScript 编译：`cd kb_qa_system/frontend && npx tsc --noEmit`（预期 0 errors）
- 单元测试：`npx vitest run`（预期 473 passed）
- 生产构建：`npx vite build`（预期成功）
- 目的：确认未因文档修改影响前端（虽然本计划不改前端代码，但做完整验证确保交付质量）

#### 3.3 文档链接检查
- 检查 Railway 指南中新增的内部锚点链接有效性
- 检查 10D 报告中对 `tests/load/locustfile.py` 的引用是否已生效（文件已创建）

---

## 三、假设与决策

1. **不修改代码**：本计划仅更新文档和新增压测脚本，不修改后端/前端业务代码（用户已选择"仅审查+记录建议"）
2. **locust 作为可选依赖**：不加入 requirements.txt，在 README 中说明独立安装（避免增加生产镜像体积）
3. **章节编号策略**：在 4.4 和原 4.5 之间插入新章节，原 4.5 超级管理员改为 4.6，后续编号顺延，同时更新目录和交叉引用
4. **测试账号**：压测脚本假设已通过前端或脚本创建测试账号，不自动创建（避免压测脚本有副作用）
5. **语言**：所有文档和注释使用中文（符合用户偏好）

---

## 四、验证标准

- [ ] Railway 指南新增邮件服务配置章节，环境变量表补全（含邮件/限流/向量/容错/Prometheus）
- [ ] Railway 指南部署检查清单补充邮件验证、注册流程验证、/metrics 认证检查
- [ ] Railway 指南新增 4 个 FAQ（Q11-Q14）
- [ ] Railway 指南在相关章节添加 10D 审查注意事项（D9-01, D3-02, D7-01, D9-02）
- [ ] `tests/load/locustfile.py` 包含 4 个场景，含中文注释和类型提示
- [ ] `tests/load/README.md` 包含安装、运行、配置、指标解读
- [ ] 后端 38 测试通过
- [ ] 前端 0 TypeScript 错误 + 473 测试通过 + 构建成功
- [ ] 文档最后更新日期改为 2026-07-11
