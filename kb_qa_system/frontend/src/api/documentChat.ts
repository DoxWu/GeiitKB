/**
 * 文档对话相关 API
 *
 * 作用：
 *   封装文档上传、文档对话等接口调用。
 *
 * 对齐后端路由：kb_qa_system/backend/app/api/routes/document_chat.py
 */

import { apiClient, type StreamCallbacks } from "./client";
import { API_PATHS } from "@/utils/constants";
import type {
  DocumentChatUploadResponse,
  DocumentChatRequest,
} from "@/types/documentChat";

/**
 * 上传文档
 *
 * 调用 POST /document-chat/upload，上传文件并解析文本。
 *
 * @param file - 上传的文件
 * @param onProgress - 上传进度回调（0-100）
 * @param signal - AbortSignal，用于取消上传
 * @returns 上传响应（含 session_id）
 * @throws {DOMException} 当通过 signal 取消时抛出 AbortError
 */
export async function uploadDocument(
  file: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<DocumentChatUploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return apiClient.upload<DocumentChatUploadResponse>(
    API_PATHS.DOCUMENT_CHAT_UPLOAD,
    formData,
    onProgress,
    signal,
  );
}

/**
 * 文档对话（流式）
 *
 * 调用 POST /document-chat/ask/stream，通过 SSE 逐块返回回答。
 * 实现打字机效果，支持通过 AbortSignal 取消。
 *
 * @param data - 提问请求（含 session_id 和 question）
 * @param callbacks - SSE 事件回调（onSources/onChunk/onDone/onError）
 * @param signal - AbortSignal，用于取消流式请求
 * @throws HttpClientError 当请求失败（非 2xx）时抛出
 * @throws DOMException 当通过 signal 取消时抛出 AbortError
 */
export async function askDocumentStream(
  data: DocumentChatRequest,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  return apiClient.streamPost(
    API_PATHS.DOCUMENT_CHAT_ASK_STREAM,
    data,
    callbacks,
    signal,
  );
}
