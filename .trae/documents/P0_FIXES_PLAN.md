# P0 阻塞上线问题修复计划

## Context（背景）

八维度全面代码审查（`docs/COMPREHENSIVE_REVIEW_8D.md`）识别出 3 个 P0 阻塞上线问题：

1. **前端缺少聊天/问答页面** — 后端已实现完整 5 个 chat 端点（`/chat/ask`、`/chat/ask/stream`、`/chat/conversations` 等），但前端无对应 UI，核心问答功能用户无法使用
2. **无用户账号删除功能** — GDPR/PIPL 合规要求用户有权删除账号及数据，当前无此端点
3. **无隐私政策页面** — 法规要求收集个人数据需明示政策

本计划按选项 A 修复全部 3 个 P0 问题。修复后系统具备完整的核心问答能力并满足合规要求。

## 现有可复用资产

**后端（无需改动 chat 部分）**：
- [chat.py](file:///c:/Users/DOXIA/Desktop/企业知识库问答系统/kb_qa_system/backend/app/api/routes/chat.py) — 5 端点已完整实现，SSE 格式 `data: {json}\n\n`，事件类型 `sources`/`chunk`/`done`/`error`
- [schemas/chat.py](file:///c:/Users/DOXIA/Desktop/企业知识库问答系统/kb_qa_system/backend/app/schemas/chat.py) — `QuestionRequest`、`AnswerResponse`、`SourceItem`、`ConversationResponse`、`MessageResponse`
- User 模型级联删除已配置：User→documents/conversations（CASCADE），Document→chunks，Conversation→messages；QAEvent.user_id 为 SET NULL（保留分析数据）

**前端可复用**：
- [client.ts](file:///c:/Users/DOXIA/Desktop/企业知识库问答系统/kb_qa_system/frontend/src/api/client.ts) — `apiClient`（get/post/patch/delete/upload），Token 自动注入 + 401 刷新
- [constants.ts](file:///c:/Users/DOXIA/Desktop/企业知识库问答系统/kb_qa_system/frontend/src/utils/constants.ts) — `API_PATHS` 已预留 `CHAT_ASK`、`CHAT_ASK_STREAM`、`CONVERSATIONS`
- 通用组件：`Modal`、`Button`、`Input`、`Spinner`、`EmptyState`、`Badge`、`Toast`、`ErrorState`
- [authStore.ts](file:///c:/Users/DOXIA/Desktop/企业知识库问答系统/kb_qa_system/frontend/src/store/authStore.ts) — `login`/`logout`/`restoreSession` 模式可参照
- 测试模式：`vi.hoisted` + `vi.mock`，Store 测试用 `setState/getState`，组件测试用 `render+screen`

## 实施方案

---

### P0-1：聊天/问答页面（前端，最大工作量）

#### 1.1 新增流式请求方法

**修改** [client.ts](file:///c:/Users/DOXIA/Desktop/企业知识库问答系统/kb_qa_system/frontend/src/api/client.ts)：
- 在 `ApiClient` 接口和 `apiClient` 实例中新增 `streamPost` 方法
- 实现：`fetch` POST + `ReadableStream` reader 逐行读取，解析 `data: {json}\n\n` SSE 格式
- 支持回调：`onSources`、`onChunk`、`onDone`、`onError`
- 支持 `AbortSignal` 取消（参照 `upload` 方法的 signal 处理）
- 复用 `buildHeaders` 注入 Token；401 时不自动刷新（流式场景失败由调用方处理）
- 生成幂等键 `idempotency_key`（`crypto.randomUUID()`）

#### 1.2 类型定义

**新建** `frontend/src/types/chat.ts`：
- `QuestionRequest`：`{ question: string; conversation_id?: number; stream?: boolean; idempotency_key?: string }`
- `SourceItem`：`{ document_id?: number; title: string; content: string; score: number }`
- `AnswerResponse`：`{ answer: string; sources: SourceItem[]; conversation_id: number; message_id?: number; degraded: boolean; degrade_reason?: string }`
- `ChatMessage`：`{ id: number; role: "user"|"assistant"; content: string; sources?: SourceItem[]; created_at: string; is_degraded?: boolean }`
- `Conversation`：`{ id: number; title: string; is_active: boolean; created_at: string; updated_at: string; messages?: ChatMessage[] }`
- `ConversationListResponse`：`{ items: Conversation[]; total: number; page: number; page_size: number }`
- `StreamCallbacks`：`{ onSources?; onChunk?; onDone?; onError? }`
- `StreamChunkType`：`"sources" | "chunk" | "done" | "error"`

#### 1.3 API 层

**新建** `frontend/src/api/chat.ts`：
- `ask(data: QuestionRequest): Promise<AnswerResponse>` — 调用 `apiClient.post(API_PATHS.CHAT_ASK, data)`
- `askStream(data: QuestionRequest, callbacks: StreamCallbacks, signal?: AbortSignal): Promise<void>` — 调用 `apiClient.streamPost(API_PATHS.CHAT_ASK_STREAM, data, callbacks, signal)`
- `getConversations(page=1, pageSize=20): Promise<ConversationListResponse>` — GET 列表
- `getConversationDetail(id: number): Promise<Conversation>` — GET 详情（含 messages）
- `deleteConversation(id: number): Promise<void>` — DELETE（204）

**修改** [constants.ts](file:///c:/Users/DOXIA/Desktop/企业知识库问答系统/kb_qa_system/frontend/src/utils/constants.ts)：
- 新增 `CONVERSATION_DETAIL: (id: number) => \`/chat/conversations/${id}\``

#### 1.4 Store

**新建** `frontend/src/store/chatStore.ts`（参照 `documentStore.ts` 模式）：
- 状态：`conversations`、`currentConversation`、`messages`、`streaming`、`streamingContent`、`loading`、`error`
- Actions：
  - `loadConversations()` — 加载对话列表
  - `selectConversation(id)` — 切换对话，加载历史消息
  - `sendMessage(text)` — 发送问题，流式接收回答（更新 `messages` + `streamingContent`）
  - `stopStreaming()` — 中止当前流式请求（AbortController）
  - `deleteConversation(id)` — 删除对话
  - `newConversation()` — 清空当前对话，开始新对话
- 模块级 `AbortController` 引用（仿 `pollingManager` 模式）

#### 1.5 组件

**新建** `frontend/src/components/chat/`：
- `MessageBubble.tsx` — 消息气泡，区分 user/assistant，assistant 显示 sources 折叠列表 + 降级标记
- `ChatInput.tsx` — 输入框 + 发送按钮，Enter 发送 / Shift+Enter 换行，流式中禁用输入或显示停止按钮
- `ConversationList.tsx` — 左侧对话列表，新建对话按钮，删除对话，当前选中高亮
- `SourceCard.tsx` — 引用来源卡片（标题 + 内容片段 + 相关度）
- `TypingIndicator.tsx` — 流式打字指示器（三点动画）

#### 1.6 页面与路由

**新建** `frontend/src/pages/ChatPage.tsx`：
- 布局：左侧 `ConversationList`（可折叠）+ 右侧消息区（`MessageBubble` 列表 + `ChatInput`）
- 空状态：`EmptyState` 提示"开始新的对话"
- 自动滚动到底部（`useRef` + `scrollIntoView`）
- 流式中显示 `TypingIndicator` + 已接收内容
- 错误时 `Toast` 提示

**修改** [App.tsx](file:///c:/Users/DOXIA/Desktop/企业知识库问答系统/kb_qa_system/frontend/src/App.tsx)：
- 新增路由 `/chat`（ProtectedRoute）
- 根路径重定向改为 `/chat`（或保留 `/documents`，在 Sidebar 加切换链接）

**修改** Sidebar（若存在共享导航）或在各页面顶部加导航链接：文档管理 ↔ 问答对话 ↔ 设置

---

### P0-2：账号删除功能（后端 + 前端）

#### 2.1 后端

**修改** [schemas/user.py](file:///c:/Users/DOXIA/Desktop/企业知识库问答系统/kb_qa_system/backend/app/schemas/user.py)：
- 新增 `AccountDeleteRequest(BaseModel)`：`password: str = Field(..., min_length=1, max_length=100)`

**修改** [auth.py](file:///c:/Users/DOXIA/Desktop/企业知识库问答系统/kb_qa_system/backend/app/api/routes/auth.py)：
- 新增 `DELETE /auth/account` 端点
- 依赖：`get_current_active_user` + `rate_limit("account_delete", per_hour=3)` 防误用
- 请求体：`AccountDeleteRequest`（密码确认，防 CSRF/误操作）
- 流程：
  1. `verify_password(password, current_user.hashed_password)` — 密码错误返回 401
  2. 遍历用户文档，删除物理文件（`document.file_path`，使用 `settings.UPLOAD_DIR` 拼接绝对路径），文件不存在忽略
  3. `db.delete(current_user)` + `db.commit()` — 级联删除 documents/chunks/conversations/messages，QAEvent.user_id SET NULL
  4. 从 `Request` header 提取 access token + 请求体提取 refresh_token，`blacklist_token()` 立即吊销
  5. 返回 `{ "message": "账号已删除" }`
- 异常处理：文件删除失败记日志但不阻塞（DB 删除优先）

#### 2.2 前端 API + Store

**修改** `frontend/src/api/auth.ts`：
- 新增 `deleteAccount(password: string): Promise<{ message: string }>` — `apiClient.delete(API_PATHS.ACCOUNT_DELETE, { body: { password } })`（注意：delete 方法需支持 body，检查 `client.ts` 是否支持，若不支持则用 `request` 方法）

**修改** [constants.ts](file:///c:/Users/DOXIA/Desktop/企业知识库问答系统/kb_qa_system/frontend/src/utils/constants.ts)：
- 新增 `ACCOUNT_DELETE: "/auth/account"`

**修改** [authStore.ts](file:///c:/Users/DOXIA/Desktop/企业知识库问答系统/kb_qa_system/frontend/src/store/authStore.ts)：
- 新增 `deleteAccount(password: string)` action：调用 API → `clearTokens()` → 清除 localStorage → 重置 state（复用 logout 的清理逻辑，但不调用 logout API 避免重复黑名单）

#### 2.3 前端页面

**新建** `frontend/src/pages/SettingsPage.tsx`：
- 账号信息展示（用户名、邮箱、注册时间）
- "危险操作"区：删除账号按钮 → 打开 `DeleteAccountModal`
- 预留扩展（后续可加修改密码等）

**新建** `frontend/src/components/settings/DeleteAccountModal.tsx`：
- 复用 `Modal` 组件
- 内容：警告文字 + 密码输入框 + "确认删除"按钮（红色危险样式）
- 输入用户名二次确认（防误删，输入用户名匹配后才允许提交）
- 提交后调用 `authStore.deleteAccount`，成功后 `navigate("/login")` + Toast 提示

**修改** [App.tsx](file:///c:/Users/DOXIA/Desktop/企业知识库问答系统/kb_qa_system/frontend/src/App.tsx)：
- 新增路由 `/settings`（ProtectedRoute）

---

### P0-3：隐私政策页面（前端）

**新建** `frontend/src/pages/PrivacyPage.tsx`：
- 静态内容，中文，包含以下章节：
  1. 数据收集范围（用户名、邮箱、上传文档、对话记录）
  2. 数据使用目的（知识库问答、质量分析）
  3. 数据存储与保护（加密存储、Token 认证、访问隔离）
  4. 数据保留期限（账号删除即删除）
  5. 用户权利（访问、更正、删除——指引至设置页删除账号）
  6. Cookie 与 Token 说明
  7. 第三方服务说明（LLM 服务）
  8. 联系方式
- 顶部返回按钮（返回登录页或上一页）

**修改** [App.tsx](file:///c:/Users/DOXIA/Desktop/企业知识库问答系统/kb_qa_system/frontend/src/App.tsx)：
- 新增路由 `/privacy`（PublicRoute，无需登录即可访问）

**修改** [AuthLayout.tsx](file:///c:/Users/DOXIA/Desktop/企业知识库问答系统/kb_qa_system/frontend/src/components/auth/AuthLayout.tsx)：
- 底部新增"隐私政策"链接 → `/privacy`

**修改** LoginPage / RegisterApplyPage：
- 提交按钮下方新增"注册即代表同意《隐私政策》"链接

---

## 测试计划

### 前端测试（遵循现有 vitest 模式）

**新建测试文件**：
- `frontend/src/api/__tests__/chat.test.ts` — mock apiClient，验证 ask/askStream/getConversations/deleteConversation 路径与回调
- `frontend/src/store/__tests__/chatStore.test.ts` — mock chatApi，验证 sendMessage 流式状态更新、selectConversation、deleteConversation、stopStreaming
- `frontend/src/components/chat/__tests__/MessageBubble.test.tsx` — 渲染 user/assistant 消息、sources 折叠
- `frontend/src/components/chat/__tests__/ChatInput.test.tsx` — Enter 发送、Shift+Enter 换行、流式中禁用
- `frontend/src/pages/__tests__/ChatPage.test.tsx` — 空状态、消息列表渲染
- `frontend/src/pages/__tests__/SettingsPage.test.tsx` — 删除账号弹窗交互
- `frontend/src/pages/__tests__/PrivacyPage.test.tsx` — 内容渲染

**修改测试文件**：
- `frontend/src/store/__tests__/authStore.test.ts` — 新增 deleteAccount 测试
- `frontend/src/api/__tests__/auth.test.ts` — 新增 deleteAccount 路径测试

**流式测试技巧**：mock `apiClient.streamPost`，用回调模拟 chunk/done 事件（不依赖真实 ReadableStream）

### 后端测试

**新建** `backend/tests/test_account_deletion.py`（遵循现有 pytest 模式）：
- 密码错误返回 401
- 密码正确删除用户 + 级联删除文档/对话
- QAEvent.user_id 被置 NULL
- Token 被加入黑名单（后续请求 401）
- 物理文件删除（mock os.remove）
- 限流生效（per_hour=3）

## 验证步骤

1. **前端单元测试**：`npx.cmd vitest run --coverage`（在 `frontend` 目录）— 全部通过，覆盖率 ≥80%
2. **TypeScript 检查**：`npx.cmd tsc --noEmit` — 0 错误
3. **生产构建**：`npx.cmd vite build` — 成功
4. **后端测试**：`pytest tests/test_account_deletion.py -v`（在 `backend` 目录）— 全部通过
5. **手动验证**（可选）：
   - 启动前后端，登录后访问 `/chat` 发起问答，验证流式打字效果
   - 访问 `/settings` 删除账号，验证跳转登录页
   - 访问 `/privacy` 查看隐私政策

## 执行顺序

1. P0-3 隐私政策（最简单，纯静态页面，快速完成）
2. P0-2 账号删除（后端 + 前端，中等复杂度）
3. P0-1 聊天页面（最复杂，SSE 流式 + 多组件，放最后集中处理）
4. 统一运行所有测试 + 构建验证
5. 更新审查报告状态，生成 P0 修复报告

## 风险与约束

- **PowerShell 环境**：使用 `.cmd` 扩展名（`npx.cmd`），避免 `&&`，用 `cwd` 参数切换目录
- **同文件并行 Edit**：对同一文件的多次编辑顺序执行（防竞态覆盖）
- **delete 方法 body**：`apiClient.delete` 当前不支持 body 参数，账号删除需用 `request` 方法或扩展 delete 签名
- **流式 401 刷新**：SSE 流式中 token 过期不自动刷新（复杂场景），由用户重新发起提问处理
