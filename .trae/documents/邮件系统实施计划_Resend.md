# 邮件系统实施计划（Resend SMTP）

## Context

项目注册流程采用审批制（用户申请 → 管理员审批 → 邮件发送密码设置链接），但后端完全缺失邮件基础设施：无 SMTP 库、无邮件服务、无注册申请模型。前端 `auth.ts` 中 3 个接口用 localStorage Mock，等待后端实现后切换。

本计划实施完整的邮件发送体系，使用 Resend 作为 SMTP 服务商，覆盖注册审批全流程的 6 个 API 端点、4 种邮件场景、2 张新数据表、Celery 异步发送、安全防护（Token 哈希存储/一次性/过期/限流/防注入），以及前端 Mock → 真实 API 切换 + 管理员审批页面。

## 关键技术决策

1. **aiosmtplib + asyncio.run()**：Celery task 是同步函数，用 `asyncio.run()` 包装异步 `aiosmtplib.send()`。Celery prefork 子进程无运行中的事件循环，`asyncio.run()` 安全可用。
2. **路由独立文件**：新建 `app/api/routes/registration.py`（`prefix="/auth"`），不修改已 847 行的 `auth.py`。
3. **Token 哈希存储**：数据库存 SHA-256 哈希（`password_token_hash`），明文仅出现在邮件链接和内存。
4. **email_logs 表存渲染后 HTML**：Celery task 从 email_logs 读取 `html_body` 字段直接发送，无需重新查关联表和渲染。
5. **Resend SMTP**：`smtp.resend.com:465`，SSL 隐式 TLS（`use_tls=True, start_tls=False`），用户名固定 `resend`，密码为 API Key `re_xxx`。

## 实施步骤（按依赖顺序）

### 阶段 1：后端基础设施

#### 1.1 `backend/requirements.txt`（修改）
在"工具库"区块后新增：
```
# ============================================
# 邮件发送（Resend SMTP）
# ============================================
aiosmtplib==3.0.2
```

#### 1.2 `backend/app/core/config.py`（修改）
在 Settings 类中新增邮件配置区块（参照现有 CORS_ORIGINS 区块的注释风格）：
- `EMAIL_ENABLED: bool = False`（默认关闭）
- `SMTP_HOST: str = "smtp.resend.com"`
- `SMTP_PORT: int = 465`
- `SMTP_USER: str = "resend"`
- `SMTP_PASSWORD: str = ""`（API Key）
- `SMTP_USE_TLS: bool = True` / `SMTP_START_TLS: bool = False`
- `SMTP_TIMEOUT: int = 30`
- `EMAIL_FROM: str = "GeiIt企业知识库 <onboarding@resend.dev>"`
- `ADMIN_NOTIFY_EMAIL: str = ""`
- `FRONTEND_BASE_URL: str = "http://localhost:5173"`
- `PASSWORD_TOKEN_EXPIRE_HOURS: int = 24`

在 `validate_required_for_production()` 中追加：EMAIL_ENABLED=True 时校验 SMTP_PASSWORD、ADMIN_NOTIFY_EMAIL 非空。

#### 1.3 `backend/app/models/registration.py`（新建）
`RegistrationApplication(Base)` 表 `registration_applications`：
- 核心字段：email, username, status(pending/approved/rejected), password_token_hash(String(64)), password_token_expires_at, password_token_used_at
- 审批字段：submitted_at, reviewed_at, reviewed_by(FK users.id SET NULL), reject_reason
- 关联字段：created_user_id(FK users.id SET NULL)
- 索引：email, status, (email, submitted_at) 复合, (status, submitted_at) 复合

#### 1.4 `backend/app/models/email_log.py`（新建）
`EmailLog(Base)` 表 `email_logs`：
- 字段：recipient, subject, email_type, status(pending/sent/failed), error_message(脱敏), retry_count, html_body(Text, 渲染后内容), application_id(FK), celery_task_id, sent_at
- 索引：status, email_type, (status, created_at) 复合

#### 1.5 `backend/app/models/__init__.py`（修改）
导出 `RegistrationApplication`, `EmailLog`。

#### 1.6 `backend/alembic/env.py`（修改）
L29-31 的模型导入追加 `RegistrationApplication, EmailLog`。

#### 1.7 `backend/alembic/versions/20260710_0003_add_registration_and_email_logs.py`（新建）
- `revision = "20260710_0003"`, `down_revision = "20260708_0002"`
- `upgrade()`: create_table registration_applications + email_logs + 所有索引
- `downgrade()`: 逆序 drop

#### 1.8 `backend/app/schemas/registration.py`（新建）
Pydantic v2 Schema（参照 `schemas/user.py` 风格）：
- `RegisterApplyRequest`(email: EmailStr, username: str + 校验正则)
- `RegisterApplyResponse`(application_id, status, message)
- `ApplicationStatusResponse`(status, email, username, submitted_at, reviewed_at, reject_reason) — **不含 token**
- `ApplicationListItem` + `ApplicationListResponse`(items, total, pending_count)
- `ApproveRequest`(application_id)
- `RejectRequest`(application_id, reject_reason: str min_length=1 max_length=500)
- `SetPasswordRequest`(token: str, password: str + 复杂度校验)
- `SetPasswordResponse`(success, message)

#### 1.9 `backend/app/schemas/__init__.py`（修改）
导出 registration 相关 Schema。

### 阶段 2：邮件服务与任务

#### 2.1 `backend/app/services/email_service.py`（新建）
- `async def _send_email_async(to, subject, html_body)`: 用 `EmailMessage` 构建 MIME 邮件，`aiosmtplib.send()` 发送；EMAIL_ENABLED=False 时仅日志不连接
- `def send_email_sync(to, subject, html_body)`: `asyncio.run(_send_email_async(...))` 同步包装
- `def render_email(email_type, **kwargs) -> str`: 根据 email_type 渲染 HTML 模板（内联 HTML 字符串，所有用户输入经 `html.escape()` 转义），返回 HTML 字符串
- 4 种模板：register_notify_admin / password_setup / register_rejected / account_created

#### 2.2 `backend/app/tasks/email_tasks.py`（新建）
```python
@celery_app.task(
    name="app.tasks.email_tasks.send_email",
    bind=True, autoretry_for=(Exception,),
    retry_kwargs={"max_retries": 3},
    retry_backoff=True, retry_backoff_max=300, retry_jitter=True,
    time_limit=120, soft_time_limit=90, acks_late=True, queue="email",
)
def send_email_task(self, email_log_id: int) -> dict:
```
- 查 EmailLog by id，幂等检查（status=="sent" 提前返回）
- 调用 `email_service.send_email_sync(to, subject, html_body)`
- 成功：status="sent", sent_at=now；失败：error_message 脱敏(`f"{type(e).__name__}: 邮件发送失败"`)，retry_count+1，raise 触发重试

#### 2.3 `backend/app/core/celery_app.py`（修改）
- `include` 追加 `"app.tasks.email_tasks"`
- `task_queues` 追加 `Queue("email", routing_key="email.#")`
- `task_routes` 追加 email task 路由

#### 2.4 `backend/app/tasks/__init__.py`（修改）
导入 `send_email_task`。

### 阶段 3：注册审批路由

#### 3.1 `backend/app/api/routes/registration.py`（新建）
`router = APIRouter(prefix="/auth", tags=["注册审批"])`，6 个端点：

1. **POST /register/apply**（公开，限流 per_hour=5 + 邮箱级 Redis 1h/次）
   - 校验 email/username 未在 users 表注册
   - 创建 RegistrationApplication(status="pending")
   - 创建 EmailLog(register_notify_admin) → send_email_task.delay()
   
2. **GET /register/status?email=xxx**（公开，限流 per_minute=10）
   - 查最新申请，返回 ApplicationStatusResponse（**不含 token**）

3. **GET /register/applications**（管理员，`Depends(get_current_superuser)`）
   - 分页查询，返回 ApplicationListResponse

4. **POST /register/approve**（管理员）
   - 校验 pending 状态 → 生成 token(`secrets.token_urlsafe(32)`) + SHA-256 哈希入库
   - 设 password_token_expires_at = now + 24h
   - 创建 EmailLog(password_setup, 链接=FRONTEND_BASE_URL/set-password?token=xxx) → delay()

5. **POST /register/reject**（管理员）
   - 校验 pending 状态 → 更新 status/reject_reason
   - 创建 EmailLog(register_rejected) → delay()

6. **POST /set-password**（公开，限流 per_hour=5）
   - token SHA-256 哈希后查库 → 校验未使用 + 未过期
   - 创建 User(hash_password, is_active=True, is_superuser=False)
   - 标记 password_token_used_at → 创建 EmailLog(account_created) → delay()

#### 3.2 `backend/app/main.py`（修改）
注册 `registration_router`。

### 阶段 4：配置与文档

#### 4.1 `backend/.env.example`（修改）
新增邮件配置区块，含 Resend 配置示例和说明。

#### 4.2 `backend/tests/test_email_system.py`（新建）
静态源码分析 + monkeypatch 行为测试（参照 `test_account_deletion.py` 模式）：
- TestRegistrationModel: 字段、token_hash 字段名、索引
- TestRegistrationRoutes: 6 端点装饰器、限流、管理员依赖、错误码
- TestEmailService: aiosmtplib 导入、asyncio.run 包装、EMAIL_ENABLED 分支、html.escape
- TestEmailTask: queue/max_retries/backoff/幂等/脱敏
- TestSecurity: token 哈希存储/secrets.token_urlsafe/一次性/24h 过期/状态响应无 token
- TestSetPasswordFlow: hash_password 调用/IntegrityError 捕获/is_superuser=False

### 阶段 5：前端对接

#### 5.1 `frontend/src/utils/constants.ts`（修改）
API_PATHS 追加：`REGISTER_APPLICATIONS`, `REGISTER_REJECT`。

#### 5.2 `frontend/src/types/user.ts`（修改）
追加类型：`ApplicationListItem`, `ApplicationListResponse`, `ApproveRequest`, `RejectRequest`, `SetPasswordResponse`。

#### 5.3 `frontend/src/api/auth.ts`（修改）
- 删除 L118-212 Mock 实现（mockDelay, MOCK_APPLICATION_KEY, Mock 版三函数）
- 替换为真实 API：
  - `submitRegisterApply` → `apiClient.post(API_PATHS.REGISTER_APPLY, data)`
  - `getApplicationStatus` → `apiClient.get(API_PATHS.REGISTER_STATUS + "?email=" + encodeURIComponent(email))`
  - `setPassword` → `apiClient.post(API_PATHS.SET_PASSWORD, data)`
- 新增管理员函数：`listApplications`, `approveApplication`, `rejectApplication`

#### 5.4 `frontend/src/components/auth/AdminRoute.tsx`（新建）
参照 ProtectedRoute，额外检查 `user.is_superuser`，非管理员重定向 `/documents`。

#### 5.5 `frontend/src/pages/AdminApplicationsPage.tsx`（新建）
管理员审批页面：申请列表 + 状态筛选 + 批准/拒绝按钮 + 拒绝原因 Modal。

#### 5.6 `frontend/src/App.tsx`（修改）
新增 `/admin/applications` 路由，用 AdminRoute 包裹。

#### 5.7 `frontend/src/pages/SettingsPage.tsx`（修改）
管理员显示"注册审批"快捷入口。

## 安全审查清单

| 审查项 | 措施 | 验证方式 |
|--------|------|---------|
| API Key 存储 | SMTP_PASSWORD 仅环境变量，不硬编码 | grep 源码无 re_xxx |
| 传输加密 | SMTP_USE_TLS=True (端口465 SSL) | 配置项检查 |
| 邮件注入防护 | EmailMessage 构建（非字符串拼接）+ html.escape 转义用户输入 | 源码审查 |
| Token 随机性 | secrets.token_urlsafe(32) 256位熵 | 源码审查 |
| Token 存储 | SHA-256 哈希存储，不存明文 | password_token_hash 字段 |
| Token 一次性 | password_token_used_at 标记，重复使用返回 410 | 测试验证 |
| Token 过期 | 24h 过期校验 | 测试验证 |
| 防邮箱枚举 | 状态查询限流 per_minute=10 | 限流配置检查 |
| 防申请滥用 | 同一邮箱 1h 限 1 次申请 | Redis key 检查 |
| 管理员鉴权 | approve/reject/applications 依赖 get_current_superuser | 装饰器检查 |
| 错误信息脱敏 | email_logs.error_message 存类型名不存原始异常 | 源码审查 |
| 状态响应不泄露 Token | ApplicationStatusResponse 无 token 字段 | Schema 审查 |
| 密码不回传 | 所有响应 Schema 无 password 字段 | Schema 审查 |

## 验证步骤

### 后端验证
1. `pip install -r requirements.txt`（安装 aiosmtplib）
2. `alembic upgrade head`（迁移成功，两张新表创建）
3. `alembic downgrade -1 && alembic upgrade head`（迁移可逆）
4. `python -m pytest tests/test_email_system.py -v`（全部通过）
5. `python -m pytest`（全量回归，无破坏）
6. 启动后端，Swagger UI 确认"注册审批"分组有 6 个端点
7. EMAIL_ENABLED=False 提交申请，日志输出"would send"且无 SMTP 错误

### 前端验证
1. `npx tsc --noEmit`（0 类型错误）
2. `npx vitest run`（全部通过，Mock 测试已更新为真实 API 测试）
3. `npx vite build`（构建成功）
4. 注册申请页提交 → 网络面板确认 POST /auth/register/apply（非 localStorage）
5. 管理员登录 → /admin/applications 显示列表 → 批准/拒绝操作
6. 普通用户访问 /admin/applications → 重定向 /documents

### 安全验证
1. 同一邮箱 1h 内申请 2 次 → 第二次 429
2. 重复使用已用 Token → 410 TOKEN_USED
3. 使用过期 Token → 410 TOKEN_EXPIRED
4. 普通用户调用 approve → 403
5. 检查 DB: password_token_hash 为 64 位十六进制，无明文
6. 检查 email_logs: error_message 无原始堆栈
