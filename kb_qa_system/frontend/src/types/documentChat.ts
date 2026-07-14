/**
 * 文档对话相关类型定义
 *
 * 作用：
 *   定义文档上传、文档对话等相关的 TypeScript 类型，
 *   与后端文档对话接口的响应结构对齐。
 */

/** 文档上传响应（对齐后端 DocumentChatUploadResponse） */
export interface DocumentChatUploadResponse {
  /** 会话ID（用于后续提问） */
  session_id: string;
  /** 文件名 */
  file_name: string;
  /** 文件类型（扩展名，如 .pdf） */
  file_type: string;
  /** 文件大小（字节） */
  file_size: number;
  /** 解析得到的字符数 */
  char_count: number;
  /** 是否被截断（超出最大字符数限制） */
  truncated: boolean;
}

/** 文档对话提问请求（对齐后端 DocumentChatRequest） */
export interface DocumentChatRequest {
  /** 会话ID（由上传响应返回） */
  session_id: string;
  /** 问题内容 */
  question: string;
  /**
   * 对话ID（可选）
   *
   * 作用：
   *   首次提问不传，后端自动创建 Conversation 并在 done 事件返回 conversation_id；
   *   后续追问传入该 ID，使多轮问答归属于同一对话记录（在侧边栏对话历史中显示）。
   */
  conversation_id?: number;
}

/** 文档对话消息（前端展示用） */
export interface DocumentChatMessage {
  /** 角色：user 用户 / assistant AI */
  role: "user" | "assistant";
  /** 消息内容 */
  content: string;
}
