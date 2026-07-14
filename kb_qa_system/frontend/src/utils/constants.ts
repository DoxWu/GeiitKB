/**
 * 常量定义
 *
 * 作用：
 *   集中管理 API 路径、文件类型映射、支持的上传格式等常量。
 */

/** API 基础路径（从环境变量读取） */
export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api/v1";

/** 应用标题 */
export const APP_TITLE =
  import.meta.env.VITE_APP_TITLE || "GeiIt企业知识库";

/** Token 在 localStorage 中的存储键 */
export const TOKEN_STORAGE_KEY = "kb_auth_tokens";

/** 用户信息在 localStorage 中的存储键 */
export const USER_STORAGE_KEY = "kb_auth_user";

/** API 路径常量 */
export const API_PATHS = {
  // 认证相关
  LOGIN: "/auth/login",
  GUEST_LOGIN: "/auth/guest-login",
  REGISTER: "/auth/register",
  REFRESH: "/auth/refresh",
  LOGOUT: "/auth/logout",
  ME: "/auth/me",
  ACCOUNT_DELETE: "/auth/account",
  EXPORT_DATA: "/auth/export-data",
  // 注册审批流程
  REGISTER_APPLY: "/auth/register/apply",
  REGISTER_STATUS: "/auth/register/status",
  REGISTER_APPLICATIONS: "/auth/register/applications",
  REGISTER_APPROVE: "/auth/register/approve",
  REGISTER_REJECT: "/auth/register/reject",
  SET_PASSWORD: "/auth/set-password",
  // 文档相关
  DOCUMENTS: "/documents",
  DOCUMENT_UPLOAD: "/documents/upload",
  DOCUMENT_URL: "/documents/import-url",
  DOCUMENT_REPROCESS: (id: number) => `/documents/${id}/reprocess`,
  // 修复 Issue 6：移动文档到其他分支
  DOCUMENT_MOVE: (id: number) => `/documents/${id}/move`,
  // 批量操作（多选功能）
  DOCUMENT_BATCH_DELETE: "/documents/batch-delete",
  DOCUMENT_BATCH_MOVE: "/documents/batch-move",
  DOCUMENT_DETAIL: (id: number) => `/documents/${id}`,
  DOCUMENT_TASK_STATUS: (documentId: number) =>
    `/documents/${documentId}/task-status`,
  DOCUMENT_STATS: "/documents/stats/overview",
  // 文档库分支（需后端新增）
  FOLDERS: "/documents/folders",
  FOLDER_DETAIL: (id: number) => `/documents/folders/${id}`,
  // 对话相关
  CHAT_ASK: "/chat/ask",
  CHAT_ASK_STREAM: "/chat/ask/stream",
  CONVERSATIONS: "/chat/conversations",
  CONVERSATION_DETAIL: (id: number) => `/chat/conversations/${id}`,
  // 文档对话相关
  DOCUMENT_CHAT_UPLOAD: "/document-chat/upload",
  DOCUMENT_CHAT_ASK_STREAM: "/document-chat/ask/stream",
} as const;

/** 支持上传的文件类型 */
export const SUPPORTED_FILE_TYPES = [
  ".pdf",
  ".doc",
  ".docx",
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".xlsx",
  ".xls",
  ".ppt",
  ".pptx",
  ".html",
  ".htm",
];

/** 最大上传文件大小（50MB） */
export const MAX_FILE_SIZE = 50 * 1024 * 1024;

/** 文档状态徽章颜色映射 */
export const STATUS_BADGE_STYLES: Record<string, string> = {
  pending: "bg-muted text-ink-secondary",
  processing: "bg-brand-light text-brand",
  completed: "bg-green-50 text-success",
  failed: "bg-red-50 text-danger",
  low_quality: "bg-amber-50 text-warning",
};

/** 文件类型图标映射（lucide-react 图标名） */
export const FILE_TYPE_ICONS: Record<string, string> = {
  ".pdf": "FileText",
  ".doc": "FileType",
  ".docx": "FileType",
  ".txt": "FileText",
  ".md": "FileCode",
  ".markdown": "FileCode",
  ".csv": "Sheet",
  ".xlsx": "Sheet",
  ".xls": "Sheet",
  ".ppt": "Presentation",
  ".pptx": "Presentation",
  ".html": "Globe",
  ".htm": "Globe",
};

/** 排序选项配置 */
export const SORT_OPTIONS = [
  { field: "created_at", label: "创建时间" },
  { field: "updated_at", label: "修改时间" },
  { field: "file_name", label: "文件名称" },
  { field: "file_type", label: "文件类型" },
] as const;

/** 每页默认文档数量 */
export const DEFAULT_PAGE_SIZE = 20;

/** 文档处理状态轮询间隔（毫秒） */
export const POLL_INTERVAL = 3000;

/** 轮询最大次数 */
export const MAX_POLL_COUNT = 100;

/**
 * 文档对话支持的文件类型
 *
 * 作用：
 *   限定文档对话功能允许上传的文件格式。
 *   仅支持文本型文档（PDF、Word、Markdown、纯文本），
 *   不包含表格、演示文稿等不适合纯对话场景的格式。
 */
export const DOCUMENT_CHAT_FILE_TYPES = [".pdf", ".docx", ".md", ".txt"];

/** 文档对话最大上传文件大小（10MB） */
export const DOCUMENT_CHAT_MAX_FILE_SIZE = 10 * 1024 * 1024;
