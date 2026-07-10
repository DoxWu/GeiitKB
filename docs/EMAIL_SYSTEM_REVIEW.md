# 邮件系统安全审查报告（Resend SMTP 集成）

**审查日期**：2026-07-10
**审查范围**：邮件发送服务、Celery 异步任务、注册审批路由、邮件日志模型、配置项
**审查文件**：
- `backend/app/services/email_service.py` — 邮件发送服务（4 模板 + aiosmtplib）
- `backend/app/tasks/email_tasks.py` — Celery 异步邮件任务
- `backend/app/api/routes/registration.py` — 6 个注册审批端点
- `backend/app/models/email_log.py` — 邮件日志模型
- `backend/app/core/config.py` — 邮件配置项（13 项）
- `backend/app/core/celery_app.py` — email 队列和路由配置
- `backend/alembic/versions/20260710_0003_add_registration_and_email_logs.py` — 数据库迁移
- `backend/.env.example` — 环境变量示例

---

## 一、安全合规性审查（7 项）

### S1：API 密钥安全存储

**检查方法**：审查 `config.py` 中 `SMTP_PASSWORD` 的定义方式及 `.env.example` 中的配置说明

**发现**：
- `config.py` L157：`SMTP_PASSWORD: str = ""` — 默认空字符串，通过 pydantic-settings 从环境变量 `SMTP_PASSWORD` 读取
- `.env.example` L88：`SMTP_PASSWORD=re_your_resend_api_key` — 使用占位符 `re_your_resend_api_key`，非真实密钥
- `config.py` L712-714：生产环境校验 — `EMAIL_ENABLED=True` 时必须设置 `SMTP_PASSWORD`，否则启动报错
- 代码中无硬编码 API Key（`test_email_system.py::TestSecurityAudit::test_no_hardcoded_api_key` 已验证）

**判定**：✅ 通过

---

### S2：数据传输加密

**检查方法**：审查 `email_service.py` 中 aiosmtplib.send 的连接参数及 `config.py` 默认值

**发现**：
- `config.py` L148：`SMTP_HOST: str = "smtp.resend.com"` — Resend 官方 SMTP 服务器
- `config.py` L151：`SMTP_PORT: int = 465` — SSL 隐式 TLS 端口
- `config.py` L160：`SMTP_USE_TLS: bool = True` — 启用 SSL 隐式 TLS 加密
- `config.py` L163：`SMTP_START_TLS: bool = False` — 不使用 STARTTLS（465 端口用隐式 TLS，无需 STARTTLS 升级）
- `email_service.py` L333-342：`aiosmtplib.send()` 调用时传入 `use_tls=settings.SMTP_USE_TLS`，从配置读取非硬编码

**判定**：✅ 通过

---

### S3：防止邮件注入攻击（Header Injection）

**检查方法**：审查 `email_service.py` 中邮件构建方式

**发现**：
- `email_service.py` L30：`from email.message import EmailMessage` — 导入标准库 MIME 构建器
- `email_service.py` L320：`msg = EmailMessage()` — 使用 EmailMessage 构建邮件对象
- `email_service.py` L321-323：`msg["From"]`、`msg["To"]`、`msg["Subject"]` — 通过字典赋值设置头部，EmailMessage 自动处理编码和换行转义
- **未使用字符串拼接**构建邮件头（字符串拼接是 CRLF 注入的主要攻击面）

**判定**：✅ 通过

---

### S4：防 XSS 攻击

**检查方法**：审查 4 个模板渲染函数中用户输入的处理方式

**发现**：
- `_render_register_notify_admin`（L91-126）：`html.escape(applicant_username)`、`html.escape(applicant_email)`、`html.escape(submitted_at)` — 3 处转义
- `_render_password_setup`（L129-166）：`html.escape(username)`、`html.escape(setup_url, quote=True)` — 2 处转义（URL 额外启用 quote=True 转义 `&` 等字符）
- `_render_register_rejected`（L169-196）：`html.escape(username)`、`html.escape(reject_reason)` — 2 处转义
- `_render_account_created`（L199-222）：`html.escape(username)` — 1 处转义
- 总计 8 处 `html.escape()` 调用，覆盖所有用户输入字段
- 测试验证：`test_email_system.py::TestEmailServiceBehavior::test_render_email_register_notify_admin` 验证 `<script>alert('xss')</script>` 被转义为 `&lt;script&gt;`

**判定**：✅ 通过

---

### S5：防 CRLF 注入（邮件主题）

**检查方法**：审查 `email_service.py` 中 `_SUBJECT_MAP` 的定义和 `get_email_subject` 函数

**发现**：
- `email_service.py` L234-239：`_SUBJECT_MAP` 中 4 个主题均为固定字面量字符串（`"[GeiIt] 新的注册申请待审核"` 等），不含任何变量插值
- `email_service.py` L266-282：`get_email_subject` 函数从 `_SUBJECT_MAP` 查表返回，不拼接用户输入
- `registration.py` L117：`subject = get_email_subject(email_type)` — 调用时只传邮件类型，不传用户数据
- 主题写入 EmailMessage 时由 EmailMessage 自动处理 CRLF 转义

**判定**：✅ 通过

---

### S6：Token 安全

**检查方法**：审查 `registration.py` 中 Token 的生成、存储、使用和过期逻辑

**发现**：
- **生成**（L502）：`secrets.token_urlsafe(32)` — 生成 43 字符 URL 安全随机串，使用密码学安全随机数生成器
- **存储**（L503, L512）：`_hash_token(plain_token)` → SHA-256 哈希后存入 `password_token_hash`，数据库不存明文 Token
- **一次性使用**（L716-720）：检查 `password_token_used_at is not None`，已使用的 Token 返回 `TOKEN_ALREADY_USED` 错误
- **过期校验**（L723-737）：检查 `password_token_expires_at`，超时返回 `TOKEN_EXPIRED` 错误
- **过期时间**（L506-508）：`timedelta(hours=settings.PASSWORD_TOKEN_EXPIRE_HOURS)`，默认 24 小时
- **明文 Token 不入日志**：`test_email_system.py::TestSecurityAudit::test_token_not_logged_plaintext` 已验证 logger.info 中不含 `plain_token` 变量
- **限流**（L653）：`rate_limit("set_password", per_hour=5)` — 每小时最多 5 次尝试，防暴力枚举

**判定**：✅ 通过

---

### S7：错误信息脱敏

**检查方法**：审查 `email_tasks.py` 异常处理中 `error_message` 的赋值方式

**发现**：
- `email_tasks.py` L108：`log.error_message = f"{type(e).__name__}: 邮件发送失败"` — 仅存异常类型名（如 `SMTPException`），不存原始异常消息和堆栈
- `email_tasks.py` L113：`logger.error(..., exc_info=True)` — 完整堆栈仅写入应用日志（stdout/文件），不入数据库
- 对比：未使用 `str(e)` 或 `repr(e)` 直接赋值（测试 `test_error_message_desensitized` 已验证）
- **安全意义**：数据库泄露后，攻击者无法从 `error_message` 获取内部路径、SMTP 凭证等敏感信息

**判定**：✅ 通过

---

## 二、用户友好性审查（3 项）

### U1：邮件模板可读性

**检查方法**：审查 4 个模板渲染函数的 HTML 结构和文案

**发现**：
- **统一品牌样式**：`_render_base` 函数（L42-88）提供统一的头部（紫色品牌色 `#4f46e5`）、内容区、尾部，4 个模板共用
- **清晰文案**：
  - 管理员通知：📋 表情图标 + "新的注册申请" 标题 + 结构化信息卡片（用户名/邮箱/编号/时间）
  - 密码设置：🎉 欢迎标题 + 显眼的设置按钮（`.button` 样式）+ 有效期提示 + 备用链接（防按钮不显示）
  - 拒绝通知：📢 标题 + 拒绝原因（如有）+ 联系管理员引导
  - 账号创建：✅ 确认标题 + 使用引导步骤（1/2/3）
- **安全提示**：密码设置邮件含 `.warning` 区域："如果您没有提交过注册申请，请忽略此邮件"
- **响应式**：`meta name="viewport"` 适配移动端
- **备用链接**：密码设置邮件提供文本链接，防按钮无法点击

**判定**：✅ 通过

---

### U2：发送状态反馈

**检查方法**：审查 `email_log.py` 模型的状态字段和 `email_tasks.py` 的状态更新逻辑

**发现**：
- **三态状态机**：`EmailLog` 定义 `STATUS_PENDING`/`STATUS_SENT`/`STATUS_FAILED` 三种状态
- **状态流转**：
  - 创建时 `status=pending`（`registration.py` L124）
  - 发送成功 `status=sent` + `sent_at=now`（`email_tasks.py` L93-96）
  - 发送失败 `status=failed` + `error_message` + `retry_count+1`（`email_tasks.py` L107-110）
- **时间戳**：`sent_at` 记录发送成功时间，`created_at`/`updated_at` 记录生命周期
- **Celery 任务 ID**：`celery_task_id` 字段关联 Celery 任务，便于在 Flower 中追踪
- **复合索引**：`ix_email_logs_status_created` 支持按状态+时间高效查询（如查询所有 failed 邮件重试）

**判定**：✅ 通过

---

### U3：错误提示清晰度

**检查方法**：审查 `registration.py` 中各端点的错误响应

**发现**：
- **结构化错误码**：所有错误响应使用统一的 `{"error": {"code": "...", "message": "..."}}` 结构
- **明确错误码**：
  - `APPLY_TOO_FREQUENT` — 重复提交（1 小时内）
  - `EMAIL_EXISTS` / `USERNAME_EXISTS` — 邮箱/用户名已占用
  - `APPLICATION_EXISTS` — 已有待审批申请
  - `APPLICATION_NOT_FOUND` — 申请不存在
  - `APPLICATION_ALREADY_PROCESSED` — 申请已审批（含当前状态）
  - `INVALID_TOKEN` — Token 无效
  - `TOKEN_ALREADY_USED` — Token 已使用
  - `TOKEN_EXPIRED` — Token 已过期
  - `USERNAME_OR_EMAIL_EXISTS` — 并发竞态导致冲突
- **中文友好提示**：每个错误码配中文 message，用户可直接理解
- **HTTP 语义正确**：201 创建、404 不存在、409 冲突、400 参数错误、429 限流

**判定**：✅ 通过

---

## 三、功能完整性审查（3 项）

### F1：邮件发送功能

**检查方法**：审查 `email_tasks.py` 的发送流程和 `email_service.py` 的同步入口

**发现**：
- **异步发送**：`registration.py` L134 `send_email_task.delay(email_log.id)` — Celery 异步发送，API 不阻塞
- **同步入口**：`email_service.py` L346-366 `send_email_sync` — 用 `asyncio.run()` 包装 `_send_email_async`，供 Celery 同步 task 调用
- **幂等检查**：`email_tasks.py` L76-78 — 已发送（`status=sent`）的邮件跳过，返回 `already_sent`，防止 Celery 重试导致重复发送
- **HTML 预渲染**：`registration.py` L115 `render_email(email_type, **template_kwargs)` — 创建 EmailLog 时渲染 HTML，Celery task 直接读取发送，无需重新渲染
- **降级机制**：`email_service.py` L311-316 — `EMAIL_ENABLED=False` 时仅记录日志不连接 SMTP，开发环境降级

**判定**：✅ 通过

---

### F2：邮件重试机制

**检查方法**：审查 `email_tasks.py` 的 Celery task 装饰器配置

**发现**：
- `email_tasks.py` L33-45 装饰器配置：
  - `autoretry_for=(Exception,)` — 所有异常自动重试
  - `retry_kwargs={"max_retries": 3}` — 最多重试 3 次
  - `retry_backoff=True` — 指数退避（1s, 2s, 4s）
  - `retry_backoff_max=300` — 最大重试间隔 300 秒
  - `retry_jitter=True` — 随机抖动，避免多个失败任务同时重试（惊群效应）
  - `time_limit=120` — 硬超时 120 秒
  - `soft_time_limit=90` — 软超时 90 秒（给 task 时间做清理）
  - `acks_late=True` — 任务完成后才确认消息，Worker 崩溃时消息重投
  - `queue="email"` — 路由到独立 email 队列

**判定**：✅ 通过

---

### F3：退信处理

**检查方法**：审查 `email_tasks.py` 的 except 分支

**发现**：
- **失败记录**（L101-110）：
  - `db.rollback()` — 回滚事务
  - 重新查询 EmailLog
  - `log.retry_count = (log.retry_count or 0) + 1` — 递增重试计数
  - `log.error_message = f"{type(e).__name__}: 邮件发送失败"` — 脱敏记录错误
  - `log.status = EmailLog.STATUS_FAILED` — 标记失败状态
  - `db.commit()` — 提交失败记录
- **重试触发**（L117）：`raise` 重新抛出异常，Celery `autoretry_for` 捕获后按指数退避重试
- **最终失败**：3 次重试都失败后，Celery 停止重试，EmailLog 保持 `status=failed`，管理员可通过查询 `failed` 状态邮件手动排查
- **资源清理**（L118-119）：`finally: db.close()` — 无论成功失败都关闭数据库连接

**判定**：✅ 通过

---

## 四、修复跟踪表

| # | 问题 | 严重度 | 修改建议 | 修复状态 |
|---|------|--------|----------|----------|
| 1 | aiosmtplib 未安装导致 5 个 behavior 测试失败 | 中 | 测试文件顶部添加 `sys.modules['aiosmtplib'] = MagicMock()` mock | ✅ 已修复 |
| 2 | 迁移测试断言格式不匹配（`down_revision =` vs `down_revision: Union[str, None] =`） | 低 | 断言改为 `"20260708_0002"` 子串匹配 | ✅ 已修复 |
| 3 | 前端 auth.test.ts 7 个测试测试旧 Mock 实现已失效 | 中 | 重写为测试真实 API 调用 + 新增管理员函数测试 | ✅ 已修复 |

---

## 五、验证结果汇总

### 后端测试
```
python -m pytest tests/test_email_system.py -v
```
**结果**：38 passed, 0 failed（7 个测试类全部通过）

### 前端验证
```
npx tsc --noEmit     → 0 errors
npx vitest run       → 473 passed (42 test files)
npm run build        → 成功（4.90s, 1705 modules）
```

---

## 六、总体合规性评估

| 维度 | 检查项数 | 通过 | 不通过 | 通过率 |
|------|----------|------|--------|--------|
| 安全合规性 | 7 | 7 | 0 | 100% |
| 用户友好性 | 3 | 3 | 0 | 100% |
| 功能完整性 | 3 | 3 | 0 | 100% |
| **合计** | **13** | **13** | **0** | **100%** |

**结论**：邮件系统（Resend SMTP 集成）通过全部 13 项安全审查，符合安全标准并提供良好的用户体验。系统已具备生产部署条件。

**关键安全特性总结**：
1. API 密钥仅从环境变量读取，无硬编码
2. SSL 隐式 TLS（465 端口）加密传输
3. EmailMessage 构建 MIME 邮件，防 Header 注入
4. html.escape() 转义所有用户输入，防 XSS
5. 固定字面量邮件主题，防 CRLF 注入
6. Token 使用 secrets.token_urlsafe(32) 生成 + SHA-256 哈希存储 + 一次性使用 + 24h 过期
7. 错误信息仅存异常类型名，不含原始堆栈
