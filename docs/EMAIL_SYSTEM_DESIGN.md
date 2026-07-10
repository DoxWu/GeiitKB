# GeiIt 企业知识库 — 邮件系统设计方案

> 本文档设计注册审批流程中的邮件发送体系，覆盖用户和管理员的所有邮件场景。
>
> **设计原则**：安全、异步、可观测、容错降级

---

## 1. 整体架构

### 1.1 注册审批流程

```
┌──────────┐     ①提交申请      ┌──────────┐     ④审批通过      ┌──────────┐
│  用户     │ ──────────────────▶│  系统     │ ──────────────────▶│  用户     │
│ (浏览器)  │                    │ (后端API) │                    │ (邮箱)    │
└──────────┘                    └────┬─────┘                    └────┬─────┘
                                     │                                │
                          ②邮件通知   │                    ⑤点击链接   │
                          ┌──────────▼──────────┐         ┌──────────▼──────────┐
                          │   管理员 (邮箱)       │         │  用户设置密码页面    │
                          │   收到审核通知        │         │  /set-password?token│
                          └──────────┬──────────┘         └──────────┬──────────┘
                                     │                                │
                          ③管理员登录 │                    ⑥提交密码   │
                          后台审批    │                                │
                                     ▼                                ▼
                              ┌──────────────────────────────────────────┐
                              │            后端 API                       │
                              │  POST /auth/register/approve             │
                              │  POST /auth/set-password                 │
                              │  → 创建用户账号 + 激活                    │
                              └──────────────────────────────────────────┘
```

### 1.2 邮件发送链路

```
API 请求 → 创建数据库记录 → 投递 Celery 异步任务 → Worker 发送邮件 → 记录发送结果
                                    ↓
                            EmailService（aiosmtplib）
                                    ↓
                            SMTP 服务商（Resend / SendGrid）
                                    ↓
                            用户 / 管理员邮箱
```

**为什么用 Celery 异步发送？**
- 邮件发送耗时 1–5 秒，同步发送会阻塞 API 响应
- SMTP 服务商可能临时不可用，Celery 支持自动重试
- 高并发时不阻塞主线程

---

## 2. 邮件场景清单

### 2.1 用户邮件

| 场景 | 触发时机 | 收件人 | 内容 | 优先级 |
|------|---------|--------|------|--------|
| **密码设置邀请** | 管理员批准注册申请 | 申请用户 | 包含一次性密码设置链接（24h 有效） | 高 |
| **注册被拒绝** | 管理员拒绝注册申请 | 申请用户 | 拒绝原因（可选） | 中 |
| **账号创建确认** | 用户成功设置密码 | 新用户 | 账号已激活，可登录 | 低 |
| **账号被禁用** | 管理员禁用用户 | 被禁用用户 | 账号已被禁用，联系管理员 | 中 |

### 2.2 管理员邮件

| 场景 | 触发时机 | 收件人 | 内容 | 优先级 |
|------|---------|--------|------|--------|
| **新注册申请通知** | 用户提交注册申请 | 所有管理员 | 申请人信息 + 审批链接 | 高 |

---

## 3. 技术选型

### 3.1 SMTP 服务商推荐

| 服务商 | 免费额度 | 优势 | 推荐度 |
|--------|---------|------|--------|
| **Resend** | 100 封/天，3000 封/月 | API-first，Python SDK 好用，5 分钟接入 | ⭐⭐⭐⭐⭐ |
| SendGrid | 100 封/天 | 老牌稳定，文档丰富 | ⭐⭐⭐⭐ |
| Amazon SES | 200 封/天（沙箱） | 最便宜（$0.1/千封），但配置复杂 | ⭐⭐⭐ |
| 腾讯云 SES | 1000 封/免费试用 | 国内速度快 | ⭐⭐⭐⭐ |
| 阿里云邮件推送 | 200 封/天 | 国内速度快，与阿里云生态集成 | ⭐⭐⭐⭐ |

**推荐方案：Resend（海外）或 阿里云邮件推送（国内）**

- Resend 接入最简单：注册 → 获取 API Key → 配置 `SMTP_HOST=smtp.resend.com` + `SMTP_PASSWORD=re_xxx`
- 支持标准 SMTP 协议，也支持 HTTP API
- Railway 部署友好，无需额外网络配置

### 3.2 后端技术栈

| 组件 | 选择 | 说明 |
|------|------|------|
| SMTP 客户端 | `aiosmtplib==3.0.2` | 异步 SMTP，适合 FastAPI 异步环境 |
| 邮件模板引擎 | `jinja2`（已通过 FastAPI 间接安装） | HTML 邮件模板渲染 |
| 邮件格式构建 | `email.message.EmailMessage` | Python 标准库，构建 MIME 邮件 |
| 异步发送 | Celery（已安装） | 复用现有 Celery 基础设施 |
| 重试机制 | Celery `autoretry_for` + `tenacity`（已安装） | 发送失败自动重试 3 次 |

### 3.3 不选择 fastapi-mail 的原因

- fastapi-mail 强耦合 FastAPI 生命周期，不适合 Celery Worker 中使用
- aiosmtplib 更轻量，可在任何异步上下文中使用
- 邮件发送逻辑应在 Worker 中执行，而非 API 进程

---

## 4. 数据库模型设计

### 4.1 注册申请表 `registration_applications`

```python
class RegistrationApplication(Base):
    """注册申请表

    作用：
        存储用户提交的注册申请，管理员审批后创建用户账号。
        支持申请状态追踪和审批记录。
    """
    __tablename__ = "registration_applications"

    # 主键 ID
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    # 申请人邮箱（唯一，防止重复申请）
    email: Mapped[str] = mapped_column(String(100), unique=True, index=True)

    # 申请用户名（唯一，防止重复申请）
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)

    # 申请状态：pending / approved / rejected
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)

    # 申请说明（可选，用户填写申请理由）
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # 提交时间
    submitted_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    # 审批时间（管理员审批时填充）
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # 审批管理员 ID（外键关联 users 表）
    reviewed_by: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=True
    )

    # 拒绝原因（status=rejected 时填充）
    reject_reason: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # 密码设置 Token（审批通过时生成，设置密码后清除）
    password_token: Mapped[Optional[str]] = mapped_column(
        String(255), unique=True, nullable=True, index=True
    )

    # Token 过期时间（默认审批后 24 小时）
    password_token_expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime, nullable=True
    )

    # 创建时间 / 更新时间
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
```

### 4.2 邮件发送记录表 `email_logs`（可选，用于追踪）

```python
class EmailLog(Base):
    """邮件发送记录表

    作用：
        记录所有发出的邮件，便于追踪和排查。
        生产环境建议保留 30 天后自动清理。
    """
    __tablename__ = "email_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    # 收件人
    recipient: Mapped[str] = mapped_column(String(100), index=True)

    # 邮件类型：register_apply_notify / password_setup / register_rejected / account_created
    email_type: Mapped[str] = mapped_column(String(50), index=True)

    # 邮件主题
    subject: Mapped[str] = mapped_column(String(200))

    # 发送状态：sent / failed
    status: Mapped[str] = mapped_column(String(20), default="sent")

    # 失败原因（status=failed 时填充）
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # 关联的申请 ID（可选）
    application_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("registration_applications.id"), nullable=True
    )

    # 发送时间
    sent_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
```

---

## 5. 配置项设计

### 5.1 config.py 新增配置

```python
# ============================================
# 邮件 SMTP 配置
# ============================================

# 是否启用邮件发送（开发环境可关闭，邮件不发送只记录日志）
EMAIL_ENABLED: bool = False

# SMTP 服务器地址
SMTP_HOST: str = ""

# SMTP 端口（465=SSL, 587=STARTTLS, 25=明文不推荐）
SMTP_PORT: int = 587

# SMTP 用户名（通常为发件邮箱或 API Key）
SMTP_USER: str = ""

# SMTP 密码（Resend 用 API Key：re_xxx）
SMTP_PASSWORD: str = ""

# 是否使用 TLS（587 端口用 STARTTLS，465 端口用 SSL）
SMTP_USE_TLS: bool = True

# 发件人邮箱（需在 SMTP 服务商中验证域名）
EMAILS_FROM_EMAIL: str = "noreply@yourdomain.com"

# 发件人显示名称
EMAILS_FROM_NAME: str = "GeiIt企业知识库"

# 管理员通知邮箱（接收注册申请通知，多个用逗号分隔）
ADMIN_NOTIFY_EMAILS: List[str] = []

# 密码设置链接有效期（小时）
PASSWORD_TOKEN_EXPIRE_HOURS: int = 24

# 前端基础 URL（用于拼接邮件中的链接）
FRONTEND_BASE_URL: str = "http://localhost:5173"
```

### 5.2 .env.example 配置

```env
# ============================================
# 邮件 SMTP 配置
# ============================================
# 作用：注册审批流程的邮件发送
# 服务商选择：
#   - Resend（推荐）：SMTP_HOST=smtp.resend.com, SMTP_PORT=465, SMTP_USER=resend, SMTP_PASSWORD=re_xxx
#   - SendGrid：SMTP_HOST=smtp.sendgrid.net, SMTP_PORT=587, SMTP_USER=apikey, SMTP_PASSWORD=SG.xxx
#   - 阿里云：SMTP_HOST=smtpdm.aliyun.com, SMTP_PORT=465, SMTP_USER=yourdomain, SMTP_PASSWORD=xxx
#
# 开发环境：EMAIL_ENABLED=False，邮件不发送，仅记录日志
# 生产环境：EMAIL_ENABLED=True，必须配置有效的 SMTP 服务商

EMAIL_ENABLED=False
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USER=resend
SMTP_PASSWORD=re_your_api_key_here
SMTP_USE_TLS=True
EMAILS_FROM_EMAIL=noreply@yourdomain.com
EMAILS_FROM_NAME=GeiIt企业知识库
ADMIN_NOTIFY_EMAILS=admin@yourcompany.com
PASSWORD_TOKEN_EXPIRE_HOURS=24
FRONTEND_BASE_URL=https://your-frontend.up.railway.app
```

---

## 6. API 端点设计

### 6.1 注册审批流程端点

| 方法 | 路径 | 权限 | 作用 |
|------|------|------|------|
| POST | `/auth/register/apply` | 公开 | 用户提交注册申请 |
| GET | `/auth/register/status` | 公开 | 查询申请状态（需邮箱） |
| GET | `/auth/register/applications` | 管理员 | 查看所有申请列表 |
| POST | `/auth/register/approve` | 管理员 | 批准申请 → 发送密码设置邮件 |
| POST | `/auth/register/reject` | 管理员 | 拒绝申请 → 发送拒绝通知邮件 |
| POST | `/auth/set-password` | 公开（Token） | 设置密码 → 创建用户账号 |

### 6.2 接口详细设计

#### POST /auth/register/apply（提交注册申请）

```python
@router.post("/register/apply")
def submit_register_application(
    request: RegisterApplyRequest,  # email + username
    db: Session = Depends(get_db),
) -> RegisterApplyResponse:
    """
    用户提交注册申请

    流程：
    1. 校验邮箱和用户名是否已被注册/申请
    2. 创建申请记录（status=pending）
    3. 异步发送邮件通知管理员
    4. 返回申请 ID 和状态

    安全：
    - 限流：同一邮箱 1 小时最多 1 次申请
    - 校验邮箱和用户名格式
    - 不泄露已注册用户信息（统一返回"申请已提交"）
    """
```

#### POST /auth/register/approve（管理员批准）

```python
@router.post("/register/approve")
def approve_application(
    application_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_superuser),  # 仅管理员
) -> dict:
    """
    管理员批准注册申请

    流程：
    1. 校验申请存在且状态为 pending
    2. 生成密码设置 Token（secrets.token_urlsafe(32)）
    3. 设置 Token 过期时间（24 小时后）
    4. 更新申请状态为 approved
    5. 异步发送密码设置邮件给用户
    6. 返回成功

    安全：
    - 仅超级管理员可操作
    - Token 为一次性，设置密码后立即失效
    """
```

#### POST /auth/set-password（设置密码）

```python
@router.post("/set-password")
def set_password(
    request: SetPasswordRequest,  # token + password
    db: Session = Depends(get_db),
) -> dict:
    """
    用户通过邮件链接设置密码

    流程：
    1. 校验 Token 有效性和过期时间
    2. 校验密码复杂度
    3. 创建用户账号（is_active=True）
    4. 清除 Token（一次性使用）
    5. 异步发送账号创建确认邮件
    6. 返回成功，前端跳转登录

    安全：
    - Token 为一次性，使用后立即失效
    - Token 过期后不可使用，需管理员重新审批
    - 密码复杂度校验与注册接口一致
    """
```

---

## 7. 邮件服务模块设计

### 7.1 目录结构

```
backend/app/
├── services/
│   └── email_service.py          # 邮件发送核心服务
├── tasks/
│   └── email_tasks.py            # Celery 邮件异步任务
├── templates/
│   └── emails/
│       ├── base.html             # 邮件基础模板（头部/尾部/样式）
│       ├── register_apply_notify.html  # 管理员收到的新申请通知
│       ├── password_setup.html         # 用户的密码设置邀请
│       ├── register_rejected.html      # 用户的申请被拒绝通知
│       └── account_created.html        # 用户的账号创建确认
├── models/
│   └── registration_application.py     # 注册申请模型
```

### 7.2 EmailService 核心类

```python
# app/services/email_service.py

class EmailService:
    """
    邮件发送服务

    作用：
        封装 SMTP 发送逻辑，支持 HTML 邮件和异步发送。
        所有邮件发送都通过 Celery 异步执行，不阻塞 API 响应。

    使用方式：
        # 在 Celery Task 中调用（异步）
        email_service = EmailService()
        await email_service.send_password_setup_email(
            to_email="user@example.com",
            username="alice",
            setup_url="https://xxx/set-password?token=abc123",
        )
    """

    def __init__(self):
        self.smtp_host = settings.SMTP_HOST
        self.smtp_port = settings.SMTP_PORT
        self.smtp_user = settings.SMTP_USER
        self.smtp_password = settings.SMTP_PASSWORD
        self.from_email = settings.EMAILS_FROM_EMAIL
        self.from_name = settings.EMAILS_FROM_NAME
        self.templates = Jinja2Templates(directory="app/templates/emails")

    async def _send_email(
        self,
        to_email: str,
        subject: str,
        html_content: str,
    ) -> None:
        """
        底层 SMTP 发送方法

        作用：
            构建 MIME 邮件并通过 aiosmtplib 发送。
            失败时抛出异常，由 Celery 重试机制处理。

        参数：
            to_email: str - 收件人邮箱
            subject: str - 邮件主题
            html_content: str - HTML 邮件内容
        """
        message = EmailMessage()
        message["From"] = f"{self.from_name} <{self.from_email}>"
        message["To"] = to_email
        message["Subject"] = subject
        message.set_content("请使用支持 HTML 的客户端查看此邮件", subtype="plain")
        message.add_alternative(html_content, subtype="html")

        await aiosmtplib.send(
            message,
            hostname=self.smtp_host,
            port=self.smtp_port,
            username=self.smtp_user,
            password=self.smtp_password,
            use_tls=settings.SMTP_USE_TLS,
        )

    # ============================================
    # 业务邮件方法
    # ============================================

    async def send_register_apply_notify(
        self,
        admin_emails: list[str],
        applicant_email: str,
        applicant_username: str,
        application_id: int,
    ) -> None:
        """发送新注册申请通知给管理员"""
        ...

    async def send_password_setup_email(
        self,
        to_email: str,
        username: str,
        setup_url: str,
        expires_hours: int,
    ) -> None:
        """发送密码设置邀请邮件给用户"""
        ...

    async def send_register_rejected_email(
        self,
        to_email: str,
        username: str,
        reject_reason: str | None,
    ) -> None:
        """发送注册被拒绝通知给用户"""
        ...

    async def send_account_created_email(
        self,
        to_email: str,
        username: str,
    ) -> None:
        """发送账号创建确认邮件给用户"""
        ...
```

### 7.3 Celery 邮件任务

```python
# app/tasks/email_tasks.py

@celery_app.task(
    bind=True,
    autoretry_for=(Exception,),
    retry_kwargs={"max_retries": 3, "countdown": 60},
    retry_backoff=True,          # 指数退避：60s, 120s, 240s
    retry_backoff_max=600,       # 最大退避 10 分钟
    retry_jitter=True,           # 随机抖动，避免重试风暴
)
def send_email_task(
    self,
    email_type: str,       # 邮件类型
    to_email: str,         # 收件人
    context: dict,         # 模板变量
) -> None:
    """
    异步邮件发送任务

    作用：
        在 Celery Worker 中异步执行邮件发送。
        支持自动重试（3 次）和指数退避。

    重试策略：
        - 第 1 次重试：60 秒后
        - 第 2 次重试：120 秒后
        - 第 3 次重试：240 秒后
        - 3 次都失败：记录到 email_logs 表，不再重试

    参数：
        email_type: str - 邮件类型（password_setup / register_rejected 等）
        to_email: str - 收件人邮箱
        context: dict - 模板渲染变量（username, setup_url 等）
    """
    ...
```

---

## 8. 邮件模板设计

### 8.1 基础模板 `base.html`

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #4f46e5; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
    .button { display: inline-block; background: #4f46e5; color: white; padding: 12px 32px;
              text-decoration: none; border-radius: 6px; font-weight: 600; }
    .footer { text-align: center; color: #6b7280; font-size: 12px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>GeiIt 企业知识库</h1>
    </div>
    <div class="content">
      {% block content %}{% endblock %}
    </div>
    <div class="footer">
      <p>此邮件由系统自动发送，请勿回复。</p>
      <p>© 2026 GeiIt 企业知识库</p>
    </div>
  </div>
</body>
</html>
```

### 8.2 密码设置邮件 `password_setup.html`

```html
{% extends "base.html" %}

{% block content %}
  <h2>欢迎加入 GeiIt 企业知识库！</h2>
  <p>您好，<strong>{{ username }}</strong>：</p>
  <p>您的注册申请已通过管理员审核。请点击下方按钮设置您的登录密码：</p>

  <p style="text-align: center; margin: 30px 0;">
    <a href="{{ setup_url }}" class="button">设置密码</a>
  </p>

  <p style="color: #6b7280; font-size: 14px;">
    ⏰ 此链接将在 <strong>{{ expires_hours }} 小时</strong> 后失效。<br>
    如果按钮无法点击，请复制以下链接到浏览器：<br>
    <a href="{{ setup_url }}">{{ setup_url }}</a>
  </p>

  <p style="color: #dc2626; font-size: 14px;">
    🔒 如果您没有提交过注册申请，请忽略此邮件，无需任何操作。
  </p>
{% endblock %}
```

### 8.3 管理员申请通知 `register_apply_notify.html`

```html
{% extends "base.html" %}

{% block content %}
  <h2>新的注册申请</h2>
  <p>有一位新用户提交了注册申请，请及时审核：</p>

  <table style="width: 100%; margin: 20px 0;">
    <tr><td style="padding: 8px; color: #6b7280;">申请人用户名：</td><td style="padding: 8px;"><strong>{{ applicant_username }}</strong></td></tr>
    <tr><td style="padding: 8px; color: #6b7280;">申请人邮箱：</td><td style="padding: 8px;"><strong>{{ applicant_email }}</strong></td></tr>
    <tr><td style="padding: 8px; color: #6b7280;">申请编号：</td><td style="padding: 8px;">#{{ application_id }}</td></tr>
    <tr><td style="padding: 8px; color: #6b7280;">提交时间：</td><td style="padding: 8px;">{{ submitted_at }}</td></tr>
  </table>

  <p style="text-align: center; margin: 30px 0;">
    <a href="{{ admin_url }}" class="button">前往审核</a>
  </p>
{% endblock %}
```

---

## 9. 安全设计

### 9.1 密码设置 Token 安全

| 安全措施 | 实现方式 |
|---------|---------|
| Token 随机性 | `secrets.token_urlsafe(32)`（256 位熵，不可预测） |
| Token 一次性 | 设置密码后立即清除 `password_token` 字段 |
| Token 有效期 | 默认 24 小时，过期需管理员重新审批 |
| Token 存储 | 哈希存储（不存明文），对比时哈希后比较 |
| Token 传输 | 邮件链接使用 HTTPS，前端通过 URL query 传递 |
| 暴力枚举防护 | Token 长度 43 字符（base64url），计算上不可枚举 |

### 9.2 防滥用设计

| 风险 | 防护措施 |
|------|---------|
| 大量虚假注册申请 | 同一邮箱 1 小时内限 1 次申请（Redis 限流） |
| 邮件轰炸 | 同一邮箱 24 小时内最多发送 5 封邮件 |
| 管理员审批接口滥用 | 仅超级管理员可调用，且有操作日志 |
| Token 被截获 | HTTPS 传输 + 一次性使用 + 24h 过期 |
| 用户名/邮箱枚举 | 申请接口统一返回"申请已提交"，不泄露是否已存在 |

### 9.3 邮件内容安全

- 邮件链接使用 HTTPS
- 邮件中不包含敏感信息（密码、Token 明文等）
- 邮件模板使用 Jinja2 自动转义，防 XSS
- 发件人地址使用已验证的域名（SMTP 服务商要求）

---

## 10. 容错与降级策略

### 10.1 邮件发送失败处理

```
邮件发送失败
    ↓
Celery 自动重试（3 次，指数退避）
    ↓
3 次都失败
    ↓
记录到 email_logs 表（status=failed）
    ↓
管理员可在后台手动重发
    ↓
（可选）发送告警通知管理员
```

### 10.2 邮件服务不可用降级

| 场景 | 降级策略 |
|------|---------|
| `EMAIL_ENABLED=False` | 邮件不发送，仅记录日志（开发环境） |
| SMTP 连接超时 | Celery 重试 3 次，失败后记录日志 |
| SMTP 认证失败 | 不重试（配置错误），记录错误日志 |
| 收件人不存在 | SMTP 返回 550，记录日志，不重试 |

### 10.3 前端 Mock 降级

在后端邮件功能未实现时，前端继续使用 Mock：
- `submitRegisterApply`：存入 localStorage，返回 pending
- `getApplicationStatus`：从 localStorage 读取
- `setPassword`：验证 Token 格式，返回成功

**后端实现后切换方式**：将 auth.ts 中 Mock 函数改为真实 API 调用，移除 localStorage 逻辑。

---

## 11. Railway 部署配置

### 11.1 SMTP 服务商配置（以 Resend 为例）

1. 注册 [resend.com](https://resend.com) 账号
2. 验证你的发件域名（添加 DNS 记录）
3. 获取 API Key（格式 `re_xxxxxxxxxxxx`）
4. 在 Railway 后端服务的 Variables 中配置：

```env
EMAIL_ENABLED=True
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USER=resend
SMTP_PASSWORD=re_your_api_key
SMTP_USE_TLS=True
EMAILS_FROM_EMAIL=noreply@yourdomain.com
EMAILS_FROM_NAME=GeiIt企业知识库
ADMIN_NOTIFY_EMAILS=admin@yourcompany.com
FRONTEND_BASE_URL=https://your-frontend.up.railway.app
PASSWORD_TOKEN_EXPIRE_HOURS=24
```

### 11.2 前端 URL 配置

邮件中的链接需要指向前端域名：

```
密码设置链接格式：
{FRONTEND_BASE_URL}/set-password?token={password_token}

示例：
https://geiit-frontend.up.railway.app/set-password?token=abc123def456
```

---

## 12. 实施路线图

### 阶段 1：基础设施（核心）

1. 新增 `RegistrationApplication` 数据模型 + Alembic 迁移
2. 新增 `EmailService` 邮件服务类
3. 新增 `email_tasks.py` Celery 邮件任务
4. 新增邮件模板（4 个 HTML 模板）
5. 在 config.py 中添加 SMTP 配置项
6. 在 requirements.txt 中添加 `aiosmtplib`

### 阶段 2：注册审批 API

1. `POST /auth/register/apply` — 提交申请
2. `GET /auth/register/status` — 查询状态
3. `GET /auth/register/applications` — 管理员查看列表
4. `POST /auth/register/approve` — 批准申请
5. `POST /auth/register/reject` — 拒绝申请
6. `POST /auth/set-password` — 设置密码

### 阶段 3：前端对接

1. 将 auth.ts 中 Mock 函数切换为真实 API
2. 新增管理员审批页面（查看/批准/拒绝申请）
3. 测试完整流程

### 阶段 4：测试与部署

1. 单元测试：EmailService、注册申请 CRUD
2. 集成测试：完整注册审批流程
3. 邮件模板渲染测试
4. Railway 部署配置
5. SMTP 连通性验证

---

## 13. 文件清单（实施时需创建/修改的文件）

### 新建文件

```
backend/app/models/registration_application.py   # 注册申请模型
backend/app/services/email_service.py             # 邮件服务
backend/app/tasks/email_tasks.py                  # Celery 邮件任务
backend/app/templates/emails/base.html            # 邮件基础模板
backend/app/templates/emails/password_setup.html  # 密码设置邮件
backend/app/templates/emails/register_apply_notify.html  # 申请通知邮件
backend/app/templates/emails/register_rejected.html      # 拒绝通知邮件
backend/app/templates/emails/account_created.html        # 创建确认邮件
backend/app/schemas/registration.py               # 注册申请 Schema
backend/alembic/versions/xxx_add_registration_applications.py  # 迁移脚本
backend/tests/test_email_service.py               # 邮件服务测试
backend/tests/test_registration_flow.py           # 注册流程测试
frontend/src/pages/AdminApplicationsPage.tsx      # 管理员审批页面
```

### 修改文件

```
backend/requirements.txt          # 添加 aiosmtplib
backend/app/core/config.py        # 添加 SMTP 配置项
backend/.env.example              # 添加 SMTP 配置说明
backend/app/api/routes/auth.py    # 添加注册审批路由
backend/app/models/__init__.py    # 导出新模型
backend/app/tasks/__init__.py     # 导入邮件任务（Celery 自动发现）
frontend/src/api/auth.ts          # Mock → 真实 API
frontend/src/utils/constants.ts   # 确认 API 路径
frontend/src/App.tsx              # 添加管理员审批页面路由
```

---

*本设计方案最后更新：2026-07-10*
