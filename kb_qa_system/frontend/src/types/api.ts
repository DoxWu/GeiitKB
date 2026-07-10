/**
 * API 通用类型定义
 *
 * 作用：
 *   定义 HTTP 请求/响应的通用类型，供 API 客户端使用。
 */

/** API 错误响应（对齐后端 FastAPI 异常格式） */
export interface ApiError {
  /** 错误详情对象 */
  detail: string | { msg: string; type: string; loc?: string[] }[];
}

/** 分页响应通用接口 */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

/** 请求配置选项（扩展 RequestInit） */
export interface RequestOptions extends RequestInit {
  /** 是否需要认证 Token（默认 true） */
  auth?: boolean;
  /** 是否自动刷新 Token（默认 true） */
  autoRefresh?: boolean;
}

/** Toast 通知类型 */
export type ToastType = "success" | "error" | "warning" | "info";

/** Toast 通知项 */
export interface ToastItem {
  /** 唯一ID */
  id: string;
  /** 通知类型 */
  type: ToastType;
  /** 通知标题 */
  title: string;
  /** 通知描述（可选） */
  description?: string;
  /** 自动关闭时长（毫秒），0 表示不自动关闭 */
  duration?: number;
}
