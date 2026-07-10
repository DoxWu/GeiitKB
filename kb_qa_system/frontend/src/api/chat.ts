/**
 * 聊天相关 API 接口
 *
 * 作用：
 *   封装问答、流式问答、对话列表、对话详情、删除对话等接口调用。
 *
 * 对齐后端路由：kb_qa_system/backend/app/api/routes/chat.py
 */

import { apiClient, type StreamCallbacks } from "./client";
import { API_PATHS } from "@/utils/constants";
import type {
  QuestionRequest,
  AnswerResponse,
  Conversation,
  ConversationListResponse,
} from "@/types/chat";

/**
 * 非流式提问
 *
 * 调用 POST /chat/ask，一次性返回完整回答。
 *
 * @param data - 提问请求
 * @returns 回答响应
 */
export async function ask(data: QuestionRequest): Promise<AnswerResponse> {
  return apiClient.post<AnswerResponse>(API_PATHS.CHAT_ASK, data);
}

/**
 * 流式提问（SSE）
 *
 * 调用 POST /chat/ask/stream，通过 Server-Sent Events 逐块返回回答。
 * 实现打字机效果，支持通过 AbortSignal 取消。
 *
 * @param data - 提问请求（stream 字段会被忽略，后端固定流式）
 * @param callbacks - SSE 事件回调（onSources/onChunk/onDone/onError）
 * @param signal - AbortSignal，用于取消流式请求
 * @throws HttpClientError 当请求失败（非 2xx）时抛出
 * @throws DOMException 当通过 signal 取消时抛出 AbortError
 */
export async function askStream(
  data: QuestionRequest,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  return apiClient.streamPost(
    API_PATHS.CHAT_ASK_STREAM,
    data,
    callbacks,
    signal,
  );
}

/**
 * 获取对话列表（分页）
 *
 * 调用 GET /chat/conversations，按更新时间倒序返回。
 *
 * @param page - 页码，默认 1
 * @param pageSize - 每页数量，默认 20
 * @returns 对话列表响应
 */
export async function getConversations(
  page = 1,
  pageSize = 20,
): Promise<ConversationListResponse> {
  const query = new URLSearchParams();
  query.set("page", String(page));
  query.set("page_size", String(pageSize));
  return apiClient.get<ConversationListResponse>(
    `${API_PATHS.CONVERSATIONS}?${query.toString()}`,
  );
}

/**
 * 获取对话详情（含消息历史）
 *
 * 调用 GET /chat/conversations/{id}，返回对话信息和所有历史消息。
 *
 * @param id - 对话ID
 * @returns 对话详情（含 messages 数组）
 */
export async function getConversationDetail(
  id: number,
): Promise<Conversation> {
  return apiClient.get<Conversation>(API_PATHS.CONVERSATION_DETAIL(id));
}

/**
 * 删除对话（软删除）
 *
 * 调用 DELETE /chat/conversations/{id}，将对话标记为非活跃。
 *
 * @param id - 对话ID
 */
export async function deleteConversation(id: number): Promise<void> {
  await apiClient.delete(API_PATHS.CONVERSATION_DETAIL(id));
}
