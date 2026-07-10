# 邮件系统 Resend 实施计划（续）

## 概述

本文档是邮件系统（Resend SMTP）实施的续接计划。前序会话已完成 Task #104（后端基础设施：依赖、配置、模型、迁移、Schema）和 Task #105 的主要部分（email_service.py、email_tasks.py）。本计划覆盖剩余工作：完成 Celery 配置、注册审批路由、配置文档与测试、前端对接、全量验证与安全审查报告。

## 当前状态分析

### 已完成
| 任务 | 文件 | 状态 |
|------|------|------|
| #104 依赖 | `requirements.txt`（aiosmtplib==3.0.2） | ✅ |
| #104 配置 | `app/core/config.py`（13 个邮件配置项 + 生产校验） | ✅ |
| #104 模型 | `app/models/registration.py`、`app/models/email_log.py` | ✅ |
| #104 迁移 | `alembic/versions/20260710_0003_add_registration_and_email_logs.py` | ✅ |
| #104 Schema | `app/schemas/registration.py`（9 个 Schema） | ✅ |
| #104 导出 | `models/__init__.py`、`schemas/__init__.py`、`alembic/env.py` | ✅ |
| #105 邮件服务 | `app/services/email_service.py`（4 模板 + SMTP 发送） | ✅ |
| #105 Celery 任务 | `app/tasks/email_tasks.py`（send_email_task） | ✅ |

### 待完成
| 任务 | 内容 |
|------|------|
| #105 剩余 | 修改 `celery_app.py`（include + 队列 + 路由）、`tasks/__init__.py`（导入） |
| #106 | 新建 `app/api/routes/registration.py`（6 端点）+ 注册到 `main.py` |
| #107 | 更新 `.env.example` + 新建 `tests/test_email_system.py` |
| #108 | 前端对接：替换 Mock、新增管理员审批页面、AdminRoute、路由 |
| #109 | 全量验证（pytest + tsc + vitest + build）+ 安全审查报告 |

## 实施步骤

### 步骤 1：完成 Celery 配置（Task #105 剩余）

**文件 1：`kb_qa_system/backend/app/core/celery_app.py`**

修改 3 处：
1. `include` 列表（第 48 行）：追加 `"app.tasks.email_tasks"`
   ```python
   include=["app.tasks.document_tasks", "app.tasks.email_tasks"],
   ```
2. `task_queues`（第 99-103 行）：追加 email 队列
   ```python
   Queue("email", routing_key="email.#"),  # 邮件发送队列
   ```
3. `task_routes`（第 104-113 行）：追加 email task 路由
   ```python
   "app.tasks.email_tasks.send_email": {
       "queue": "email",
       "routing_key": "email.send",
   },
   ```

**文件 2：`kb_qa_system/backend/app/tasks/__init__.py`**

追加 email_tasks 导入：
```python
from app.tasks.email_tasks import send_email_task

__all__ = [
    "process_document_task",
    "reprocess_document_task",
    "send_email_task",
]
```

### 步骤 2：注册审批路由（Task #106）

**新建文件：`kb_qa_system/backend/app/api/routes/registration.py`**

路由器：`router = APIRouter(prefix="/auth", tags=["注册审批"])`

6 个端点设计：

| # | 方法 | 路径 | 权限 | 限流 | 功能 |
|---|------|------|------|------|------|
| 1 | POST | `/register/apply` | 公开 | rate_limit("register_apply", per_hour=3) + 邮箱级 Redis 1h/次 | 提交注册申请，触发管理员通知邮件 |
| 2 | GET | `/register/status` | 公开 | rate_limit("register_status", per_minute=10) | 按邮箱查询申请状态（不含 token） |
| 3 | GET | `/register/applications` | 管理员 | 无 | 分页查询申请列表（支持 status 筛选） |
| 4 | POST | `/register/approve` | 管理员 | 无 | 批准申请，生成 Token，发送密码设置邮件 |
| 5 | POST | `/register/reject` | 管理员 | 无 | 拒绝申请，发送拒绝通知邮件 |
| 6 | POST | `/set-password` | 公开 | rate_limit("set_password", per_hour=5) | 用 Token 设置密码，创建用户账号 |

**端点 1 详细设计 — POST /register/apply**：
- 请求体：`RegisterApplyRequest`（email, username）
- 校验：邮箱是否已有 pending 申请（Redis 键 `register:apply:lock:{email}` TTL 3600s，防止重复提交）
- 校验：邮箱和用户名是否已被注册用户占用
- 创建 `RegistrationApplication`（status=pending）
- 创建 `EmailLog`（type=register_notify_admin，recipient=ADMIN_NOTIFY_EMAIL）
- 调用 `send_email_task.delay(email_log_id)` 异步发送管理员通知
- 响应：`RegisterApplyResponse`（application_id, status="pending", message）
- 安全：ADMIN_NOTIFY_EMAIL 未配置时，跳过邮件但申请仍创建（降级）

**端点 2 详细设计 — GET /register/status?email=xxx**：
- 查询该邮箱最新的 RegistrationApplication
- 响应：`ApplicationStatusResponse`（不含 token 字段）
- 安全：不存在时返回 404，不泄露邮箱是否存在

**端点 3 详细设计 — GET /register/applications**：
- 依赖：`get_current_superuser`
- Query 参数：`status`（可选，pending/approved/rejected）、`page`（默认 1）、`page_size`（默认 20，最大 100）
- 查询申请列表（按 submitted_at 降序）
- 计算 pending_count
- 响应：`ApplicationListResponse`（items, total, pending_count）

**端点 4 详细设计 — POST /register/approve**：
- 依赖：`get_current_superuser`
- 请求体：`ApproveRequest`（application_id）
- 校验：申请存在且 status=pending
- 生成 Token：`secrets.token_urlsafe(32)` → 明文存内存，SHA-256 哈希存 DB
- 设置 `password_token_hash`、`password_token_expires_at`（now + 24h）
- 更新 status=approved、reviewed_at=now、reviewed_by=admin.id
- 拼接 setup_url：`{FRONTEND_BASE_URL}/set-password?token={plain_token}`
- 创建 EmailLog（type=password_setup，recipient=申请人邮箱）
- 调用 `send_email_task.delay(email_log_id)` 异步发送
- 响应：`{"message": "已批准申请，密码设置邮件已发送"}`

**端点 5 详细设计 — POST /register/reject**：
- 依赖：`get_current_superuser`
- 请求体：`RejectRequest`（application_id, reject_reason）
- 校验：申请存在且 status=pending
- 更新 status=rejected、reviewed_at=now、reviewed_by=admin.id、reject_reason
- 创建 EmailLog（type=register_rejected，recipient=申请人邮箱）
- 调用 `send_email_task.delay(email_log_id)` 异步发送
- 响应：`{"message": "已拒绝申请，通知邮件已发送"}`

**端点 6 详细设计 — POST /set-password**：
- 请求体：`SetPasswordRequest`（token, password）
- 计算 token 的 SHA-256 哈希，查询 RegistrationApplication
- 校验：申请存在、status=approved、token 未使用（password_token_used_at is None）、未过期
- 创建 User（username, email, hashed_password=hash_password(password)）
- 更新申请：password_token_used_at=now、created_user_id=new_user.id
- 创建 EmailLog（type=account_created，recipient=用户邮箱）
- 调用 `send_email_task.delay(email_log_id)` 异步发送确认邮件
- 响应：`SetPasswordResponse`（success=true, message）
- 安全：Token 一次性使用，使用后不可重复
- 并发保护：捕获 IntegrityError（用户名/邮箱竞态）

**修改文件：`kb_qa_system/backend/app/main.py`**
- 第 32 行后追加导入：`from app.api.routes.registration import router as registration_router`
- 第 302 行后追加注册：`app.include_router(registration_router, prefix=settings.API_V1_PREFIX)`

### 步骤 3：配置文档与后端测试（Task #107）

**修改文件：`kb_qa_system/backend/.env.example`**

在"JWT 认证配置"区块后、LLM 配置前，新增邮件配置区块：
```env
# ============================================
# 邮件 SMTP 配置（Resend）
# ============================================
# 是否启用邮件发送（开发环境关闭，仅记录日志；生产环境必须开启）
EMAIL_ENABLED=False

# Resend SMTP 配置
# 获取 API Key：https://resend.com/api-keys
# 格式：re_xxxxxxxxxxxx
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USER=resend
SMTP_PASSWORD=re_your_resend_api_key
SMTP_USE_TLS=True
SMTP_START_TLS=False
SMTP_TIMEOUT=30

# 发件人地址
# 开发环境：Resend 默认域 onboarding@resend.dev（仅可发送到管理员邮箱）
# 生产环境：改为已验证域名的邮箱，如 GeiIt企业知识库 <noreply@yourdomain.com>
EMAIL_FROM=GeiIt企业知识库 <onboarding@resend.dev>

# 管理员通知邮箱（接收注册申请通知）
ADMIN_NOTIFY_EMAIL=admin@example.com

# 前端基础 URL（用于拼接邮件中的密码设置链接）
# 开发环境：http://localhost:5173
# 生产环境：https://your-frontend-domain.com
FRONTEND_BASE_URL=http://localhost:5173

# 密码设置 Token 有效期（小时）
PASSWORD_TOKEN_EXPIRE_HOURS=24
```

**新建文件：`kb_qa_system/backend/tests/test_email_system.py`**

遵循 `test_account_deletion.py` 的静态源码分析 + monkeypatch 模式，测试维度：

1. **email_service.py 结构验证**
   - 4 个模板渲染函数存在
   - `html.escape` 调用存在（XSS 防护）
   - `EmailMessage` 使用（非字符串拼接，防注入）
   - `EMAIL_ENABLED` 降级检查存在
   - `aiosmtplib.send` 调用参数正确

2. **email_tasks.py 结构验证**
   - `@celery_app.task` 装饰器配置（autoretry, max_retries=3, backoff）
   - 幂等检查逻辑（status == STATUS_SENT 提前返回）
   - 错误脱敏（error_message 仅存异常类型名）
   - `acks_late=True` 配置

3. **registration.py 路由结构验证**
   - 6 个端点路由路径和函数定义存在
   - 公开端点配置限流
   - 管理员端点依赖 `get_current_superuser`
   - Token 生成使用 `secrets.token_urlsafe`
   - Token 存储使用 SHA-256 哈希
   - Token 一次性使用检查

4. **behavior 测试（monkeypatch）**
   - `render_email` 各类型返回含转义内容
   - `get_email_subject` 返回固定主题
   - `_send_email_async` 在 EMAIL_ENABLED=False 时不连接 SMTP
   - `send_email_sync` 调用 `asyncio.run`

5. **config.py 邮件配置验证**
   - 13 个邮件配置项默认值存在
   - `validate_required_for_production` 包含邮件配置校验

6. **安全审查项验证**
   - 无硬编码 API Key
   - 主题不含用户输入（CRLF 注入防护）
   - 错误信息脱敏

### 步骤 4：前端对接（Task #108）

**修改文件 1：`frontend/src/utils/constants.ts`**

API_PATHS 追加（第 36 行后）：
```typescript
REGISTER_APPLICATIONS: "/auth/register/applications",
REGISTER_REJECT: "/auth/register/reject",
```

**修改文件 2：`frontend/src/types/user.ts`**

追加类型定义：
```typescript
/** 申请列表项（管理员查看） */
export interface ApplicationListItem {
  id: number;
  email: string;
  username: string;
  status: ApplicationStatus;
  submitted_at: string;
  reviewed_at: string | null;
  reviewed_by: number | null;
  reject_reason: string | null;
}

/** 申请列表响应（管理员查看） */
export interface ApplicationListResponse {
  items: ApplicationListItem[];
  total: number;
  pending_count: number;
}

/** 批准申请请求 */
export interface ApproveRequest {
  application_id: number;
}

/** 拒绝申请请求 */
export interface RejectRequest {
  application_id: number;
  reject_reason: string;
}

/** 设置密码响应 */
export interface SetPasswordResponse {
  success: boolean;
  message: string;
}
```

**修改文件 3：`frontend/src/api/auth.ts`**

- 删除 L118-212 的 Mock 实现（mockDelay, MOCK_APPLICATION_KEY, 三个 Mock 函数）
- 替换为真实 API 调用：
  ```typescript
  export async function submitRegisterApply(data: RegisterApplyRequest): Promise<RegisterApplyResponse> {
    return apiClient.post<RegisterApplyResponse>(API_PATHS.REGISTER_APPLY, data);
  }

  export async function getApplicationStatus(email: string): Promise<ApplicationStatusResponse> {
    return apiClient.get<ApplicationStatusResponse>(`${API_PATHS.REGISTER_STATUS}?email=${encodeURIComponent(email)}`);
  }

  export async function setPassword(data: SetPasswordRequest): Promise<SetPasswordResponse> {
    return apiClient.post<SetPasswordResponse>(API_PATHS.SET_PASSWORD, data);
  }
  ```
- 新增管理员函数：
  ```typescript
  export async function listApplications(params?: { status?: string; page?: number; page_size?: number }): Promise<ApplicationListResponse> {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    if (params?.page) query.set("page", String(params.page));
    if (params?.page_size) query.set("page_size", String(params.page_size));
    const qs = query.toString();
    return apiClient.get<ApplicationListResponse>(`${API_PATHS.REGISTER_APPLICATIONS}${qs ? `?${qs}` : ""}`);
  }

  export async function approveApplication(applicationId: number): Promise<{ message: string }> {
    return apiClient.post<{ message: string }>(API_PATHS.REGISTER_APPROVE, { application_id: applicationId });
  }

  export async function rejectApplication(applicationId: number, rejectReason: string): Promise<{ message: string }> {
    return apiClient.post<{ message: string }>(API_PATHS.REGISTER_REJECT, { application_id: applicationId, reject_reason: rejectReason });
  }
  ```

**新建文件 4：`frontend/src/components/auth/AdminRoute.tsx`**

基于 ProtectedRoute 模式，额外检查 `user.is_superuser`：
```typescript
export function AdminRoute({ children }: AdminRouteProps) {
  const { isAuthenticated, user } = useAuthStore();
  const location = useLocation();
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  if (!user?.is_superuser) {
    return <Navigate to="/documents" replace />;
  }
  return <>{children}</>;
}
```

**新建文件 5：`frontend/src/pages/AdminApplicationsPage.tsx`**

管理员审批页面，功能：
- 申请列表表格（邮箱、用户名、状态、提交时间、审批时间）
- 状态筛选标签（全部/待审批/已批准/已拒绝）
- 批准操作按钮（确认对话框）
- 拒绝操作按钮（弹窗输入拒绝原因，必填）
- 分页控件
- Toast 反馈操作结果
- 遵循现有 UI 风格（Tailwind + lucide-react）

**修改文件 6：`frontend/src/App.tsx`**

追加管理员路由（在 settings 路由后）：
```typescript
import { AdminRoute } from "@/components/auth/AdminRoute";
import AdminApplicationsPage from "@/pages/AdminApplicationsPage";
// ...
<Route
  path="/admin/applications"
  element={
    <AdminRoute>
      <AdminApplicationsPage />
    </AdminRoute>
  }
/>
```

**修改文件 7：`frontend/src/pages/SettingsPage.tsx`**

管理员快捷入口：当 `user.is_superuser` 为 true 时，显示"注册申请管理"入口卡片，点击跳转 `/admin/applications`。

### 步骤 5：全量验证与安全审查报告（Task #109）

**验证步骤**：

1. 后端测试：
   ```bash
   cd kb_qa_system/backend
   python -m pytest tests/test_email_system.py -v
   python -m pytest tests/ -v  # 全量回归
   ```

2. 前端验证：
   ```bash
   cd kb_qa_system/frontend
   npx tsc --noEmit                    # TypeScript 类型检查
   npx vitest run                      # 单元测试
   npm run build                       # 生产构建
   ```

**新建文件：`docs/EMAIL_SYSTEM_REVIEW.md`**

安全审查报告，覆盖用户要求的 3 大维度 13 项检查：

### 1. 安全合规性（7 项）
| # | 检查项 | 验证方法 | 预期结果 |
|---|--------|----------|----------|
| 1.1 | API 密钥存储 | 检查 SMTP_PASSWORD 是否硬编码 | 仅通过环境变量加载，无硬编码 |
| 1.2 | 数据传输加密 | 检查 SMTP_USE_TLS/STARTTLS 配置 | 端口 465 + use_tls=True（SSL 隐式 TLS） |
| 1.3 | 邮件注入防护（CRLF） | 检查 Subject 是否含用户输入 | 固定主题，不含用户输入 |
| 1.4 | 邮件注入防护（Header） | 检查邮件构建方式 | EmailMessage 对象，非字符串拼接 |
| 1.5 | XSS 防护 | 检查模板渲染 | 所有用户输入经 html.escape() |
| 1.6 | Token 安全 | 检查 Token 生成/存储/使用 | secrets.token_urlsafe(32) + SHA-256 哈希 + 一次性 + 24h 过期 |
| 1.7 | 错误信息脱敏 | 检查 error_message 存储 | 仅存异常类型名，不含原始堆栈 |

### 2. 用户友好性（3 项）
| # | 检查项 | 预期结果 |
|---|--------|----------|
| 2.1 | 邮件模板可读性 | 统一品牌样式、清晰文案、操作按钮、备用链接、有效期提示 |
| 2.2 | 发送状态反馈 | EmailLog 记录 pending/sent/failed，管理员可查 |
| 2.3 | 错误提示清晰度 | 前端友好错误提示，后端结构化错误码 |

### 3. 功能完整性（3 项）
| # | 检查项 | 预期结果 |
|---|--------|----------|
| 3.1 | 邮件发送 | Celery 异步发送 + 重试（3 次指数退避）+ 幂等 |
| 3.2 | 退信处理 | SMTP 异常捕获 → EmailLog.failed → Celery 重试 → 3 次失败后停止 |
| 3.3 | 开发环境降级 | EMAIL_ENABLED=False 时仅记日志不连接 SMTP |

报告格式：每项含【检查方法】【实际发现】【结论】【改进建议】，发现问题跟踪至修复。

## 假设与决策

1. **路由独立文件**：新建 `registration.py` 而非修改 847 行的 `auth.py`，降低冲突风险
2. **邮件发送异步化**：所有邮件通过 Celery task 异步发送，API 响应不阻塞
3. **Token 哈希存储**：DB 存 SHA-256 哈希，明文仅出现在邮件链接和内存
4. **email_logs 存渲染后 HTML**：Celery task 直接读取发送，无需重新渲染
5. **ADMIN_NOTIFY_EMAIL 未配置时降级**：申请仍创建，仅跳过管理员通知邮件
6. **测试策略**：静态源码分析 + monkeypatch，避免运行时依赖（psycopg/celery/aiosmtplib）
7. **管理员路由守卫**：AdminRoute 基于 ProtectedRoute 扩展，检查 is_superuser
8. **前端 Mock 删除**：后端就绪后完全替换 Mock，不保留双模式

## 验证步骤

1. 后端：`pytest tests/test_email_system.py -v` + 全量回归
2. 前端：`tsc --noEmit` + `vitest run` + `npm run build`
3. 安全审查报告：`docs/EMAIL_SYSTEM_REVIEW.md`（13 项检查清单）
4. 集成验证：前端管理员页面 → 后端 API → Celery task → EmailLog 状态流转
