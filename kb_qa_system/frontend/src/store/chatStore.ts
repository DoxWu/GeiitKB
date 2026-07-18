/**
 * 聊天状态管理 Store
 *
 * 作用：
 *   使用 Zustand 管理聊天页面的状态，包括：
 *   - 对话列表与当前选中对话
 *   - 当前对话的消息历史
 *   - 流式输出状态（累积文本、引用来源、是否输出中）
 *   - 流式请求取消（AbortController）
 *   - 加载状态与错误处理
 *
 * 使用方式：
 *   import { useChatStore } from '@/store/chatStore';
 *   const { messages, sendMessage, streaming } = useChatStore();
 */

import { create } from "zustand";
import * as chatApi from "@/api/chat";
import type {
  Conversation,
  ChatMessage,
  SourceItem,
} from "@/types/chat";

/**
 * 模块级流式请求控制器
 *
 * 作用：
 *   存储 currentStreaming 请求的 AbortController，支持取消流式输出。
 *   使用模块级变量而非 Store 状态，避免非序列化对象进入状态树。
 */
let streamingController: AbortController | null = null;

/** 聊天 Store 状态接口 */
interface ChatState {
  // ===== 对话列表状态 =====
  /** 对话列表 */
  conversations: Conversation[];
  /** 对话列表加载中 */
  loadingConversations: boolean;

  // ===== 当前对话状态 =====
  /** 当前对话ID（null 表示新对话） */
  currentConversationId: number | null;
  /** 当前对话的消息列表 */
  messages: ChatMessage[];
  /** 消息加载中 */
  loadingMessages: boolean;

  // ===== 流式输出状态 =====
  /** 是否正在流式输出 */
  streaming: boolean;
  /** 流式输出中累积的文本 */
  streamingContent: string;
  /** 流式输出中收到的引用来源 */
  streamingSources: SourceItem[];

  // ===== 错误状态 =====
  /** 错误信息 */
  error: string | null;

  // ===== 对话操作 =====
  /** 加载对话列表 */
  loadConversations: () => Promise<void>;
  /** 选择对话，加载消息历史 */
  selectConversation: (id: number) => Promise<void>;
  /** 开始新对话（清空当前对话和消息） */
  startNewConversation: () => void;

  // ===== 消息操作 =====
  /**
   * 发送消息（流式）
   *
   * 作用：
   *   1. 立即追加用户消息到 messages
   *   2. 启动流式请求，逐块累积回答
   *   3. 完成后追加完整 assistant 消息
   *   4. 新对话时刷新对话列表获取 conversation_id
   *
   * @param question - 用户问题
   */
  sendMessage: (question: string) => Promise<void>;
  /**
   * 重新生成最后一条 AI 回答（流式）
   *
   * 作用：
   *   1. 移除 messages 中最后一条 assistant 消息
   *   2. 调用 /chat/regenerate/stream 重新生成
   *   3. 流式累积新回答，完成后追加 assistant 消息（is_regenerated=true）
   *
   * @param messageId - 可选，要重新生成的 AI 消息 ID（默认最后一条）
   */
  regenerateMessage: (messageId?: number) => Promise<void>;
  /** 停止流式输出 */
  stopStreaming: () => void;

  // ===== 对话管理 =====
  /** 删除对话 */
  removeConversation: (id: number) => Promise<void>;

  /** 清除错误 */
  clearError: () => void;
}

/** 生成幂等性键（符合后端 [a-zA-Z0-9_-] 正则，长度 1-100） */
function generateIdempotencyKey(): string {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 聊天 Store */
export const useChatStore = create<ChatState>((set, get) => ({
  // ===== 初始状态 =====
  conversations: [],
  loadingConversations: false,

  currentConversationId: null,
  messages: [],
  loadingMessages: false,

  streaming: false,
  streamingContent: "",
  streamingSources: [],

  error: null,

  // ===== 对话操作 =====
  loadConversations: async () => {
    set({ loadingConversations: true, error: null });
    try {
      const response = await chatApi.getConversations();
      set({
        conversations: response.items,
        loadingConversations: false,
      });
    } catch (err) {
      set({
        loadingConversations: false,
        error: err instanceof Error ? err.message : "加载对话列表失败",
      });
    }
  },

  selectConversation: async (id: number) => {
    // 如果正在流式输出，先停止
    if (get().streaming) {
      get().stopStreaming();
    }

    set({
      currentConversationId: id,
      messages: [],
      loadingMessages: true,
      error: null,
    });

    try {
      const conversation = await chatApi.getConversationDetail(id);
      set({
        messages: conversation.messages || [],
        loadingMessages: false,
      });
    } catch (err) {
      set({
        loadingMessages: false,
        error: err instanceof Error ? err.message : "加载对话详情失败",
      });
    }
  },

  startNewConversation: () => {
    // 如果正在流式输出，先停止
    if (get().streaming) {
      get().stopStreaming();
    }
    set({
      currentConversationId: null,
      messages: [],
      streamingContent: "",
      streamingSources: [],
      error: null,
    });
  },

  // ===== 消息操作 =====
  sendMessage: async (question: string) => {
    const state = get();

    // 流式输出中不允许发送新消息
    if (state.streaming) return;

    // 空问题不发送
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) return;

    // 1. 立即追加用户消息到 messages（前端临时 ID）
    const userMessage: ChatMessage = {
      id: Date.now(),
      role: "user",
      content: trimmedQuestion,
      created_at: new Date().toISOString(),
    };

    set({
      messages: [...state.messages, userMessage],
      streaming: true,
      streamingContent: "",
      streamingSources: [],
      error: null,
    });

    // 2. 创建 AbortController
    streamingController = new AbortController();

    // 3. 构建请求
    const requestData = {
      question: trimmedQuestion,
      conversation_id: state.currentConversationId ?? undefined,
      stream: true,
      idempotency_key: generateIdempotencyKey(),
    };

    try {
      await chatApi.askStream(
        requestData,
        {
          onSources: (sources) => {
            set({ streamingSources: sources as SourceItem[] });
          },
          onChunk: (text) => {
            set((s) => ({ streamingContent: s.streamingContent + text }));
          },
          onDone: (data) => {
            // 追加完整的 assistant 消息到 messages
            const assistantMessage: ChatMessage = {
              id: Date.now() + 1,
              role: "assistant",
              content: data.content,
              sources: get().streamingSources,
              created_at: new Date().toISOString(),
              is_degraded: data.degraded,
            };
            set((s) => ({
              messages: [...s.messages, assistantMessage],
              streamingContent: "",
              streamingSources: [],
            }));
          },
          onError: (message) => {
            // 修复：LLM 流式错误时，追加一条 fallback 智能体消息气泡
            // 作用：此前只设置 error 状态（顶部提示条），不产生消息气泡，
            //       导致用户只能看见自己的提问，看不见智能体任何反馈。
            //       修复后：以"降级回复"形式追加 assistant 消息，明确告知失败原因。
            const errorMessage: ChatMessage = {
              id: Date.now() + 1,
              role: "assistant",
              content: "",
              created_at: new Date().toISOString(),
              is_degraded: true,
              degrade_reason: `智能体响应失败：${message}`,
            };
            set((s) => ({
              messages: [...s.messages, errorMessage],
              error: message,
              streamingContent: "",
              streamingSources: [],
            }));
          },
        },
        streamingController.signal,
      );

      // 4. 流式完成后，如果是新对话（无 conversation_id），刷新对话列表
      //    以获取新创建的对话 ID
      if (!state.currentConversationId) {
        await get().loadConversations();
        // 对话列表按 updated_at 倒序，首项即新对话
        const conversations = get().conversations;
        if (conversations.length > 0) {
          set({ currentConversationId: conversations[0].id });
        }
      } else {
        // 已有对话，刷新列表以更新 updated_at 排序
        await get().loadConversations();
      }
    } catch (err) {
      // 处理取消操作（AbortError）
      // 注意：DOMException 在部分环境中不是 Error 实例，需通过 name 判断
      if (err && typeof err === "object" && err.name === "AbortError") {
        // 用户主动取消，不设置错误状态
        // 如果已有部分内容，保存为降级回复
        const partialContent = get().streamingContent;
        if (partialContent.trim()) {
          const partialMessage: ChatMessage = {
            id: Date.now() + 1,
            role: "assistant",
            content: partialContent,
            sources: get().streamingSources,
            created_at: new Date().toISOString(),
            is_degraded: true,
            degrade_reason: "用户取消输出",
          };
          set((s) => ({
            messages: [...s.messages, partialMessage],
          }));
        }
      } else {
        // 修复：非取消错误时，追加 fallback 智能体消息气泡
        // 作用：此前只设置 error 状态，不产生消息气泡，用户看不见智能体反馈。
        //       修复后：以"降级回复"形式追加 assistant 消息，告知失败原因。
        const errMsg = err instanceof Error ? err.message : "发送消息失败，请重试";
        // 若已累积部分流式内容，保存为降级回复（保留已生成内容）
        const partialContent = get().streamingContent;
        const errorMessage: ChatMessage = {
          id: Date.now() + 1,
          role: "assistant",
          content: partialContent,
          sources: get().streamingSources,
          created_at: new Date().toISOString(),
          is_degraded: true,
          degrade_reason: partialContent.trim()
            ? `响应中断：${errMsg}（已保留部分内容）`
            : `响应失败：${errMsg}`,
        };
        set((s) => ({
          messages: [...s.messages, errorMessage],
          error: errMsg,
          streamingContent: "",
          streamingSources: [],
        }));
      }
    } finally {
      set({ streaming: false, streamingContent: "", streamingSources: [] });
      streamingController = null;
    }
  },

  /**
   * 重新生成最后一条 AI 回答（流式）
   *
   * 实现步骤：
   *   1. 校验：必须存在 currentConversationId 和 assistant 消息
   *   2. 移除 messages 中目标 assistant 消息（及之后的消息，通常无）
   *   3. 启动流式重新生成请求
   *   4. 流式累积内容到 streamingContent
   *   5. 完成后追加新 assistant 消息（is_regenerated=true）
   *   6. 异常时追加降级 assistant 消息
   */
  regenerateMessage: async (messageId?: number) => {
    const state = get();
    if (state.streaming) {
      get().stopStreaming();
    }

    const conversationId = state.currentConversationId;
    if (!conversationId) {
      set({ error: "当前无对话，无法重新生成" });
      return;
    }

    // 定位目标 assistant 消息（默认最后一条）
    const messages = state.messages;
    let targetIndex = -1;
    if (messageId) {
      targetIndex = messages.findIndex(
        (m) => m.role === "assistant" && m.id === messageId,
      );
    } else {
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "assistant") {
          targetIndex = i;
          break;
        }
      }
    }

    if (targetIndex === -1) {
      set({ error: "未找到可重新生成的 AI 消息" });
      return;
    }

    const targetMessage = messages[targetIndex];
    // 移除目标 assistant 消息（保留之前的所有消息）
    const remainingMessages = messages.slice(0, targetIndex);

    // 重置流式状态
    streamingController = new AbortController();
    set({
      messages: remainingMessages,
      streaming: true,
      streamingContent: "",
      streamingSources: [],
      error: null,
    });

    try {
      await chatApi.regenerateStream(
        {
          conversation_id: conversationId,
          message_id: targetMessage.id,
        },
        {
          onSources: (sources) => {
            set({ streamingSources: sources as SourceItem[] });
          },
          onChunk: (text) => {
            set((s) => ({
              streamingContent: s.streamingContent + text,
            }));
          },
          onDone: (data) => {
            const newMessage: ChatMessage = {
              id: Date.now() + 1,
              role: "assistant",
              content: data.content,
              sources: get().streamingSources,
              created_at: new Date().toISOString(),
              is_degraded: data.degraded,
              is_regenerated: true,
            };
            set((s) => ({
              messages: [...s.messages, newMessage],
              streamingContent: "",
              streamingSources: [],
            }));
          },
          onError: (msg) => {
            const errorMessage: ChatMessage = {
              id: Date.now() + 1,
              role: "assistant",
              content: "",
              created_at: new Date().toISOString(),
              is_degraded: true,
              degrade_reason: `智能体重新生成失败：${msg}`,
              is_regenerated: true,
            };
            set((s) => ({
              messages: [...s.messages, errorMessage],
              error: msg,
              streamingContent: "",
              streamingSources: [],
            }));
          },
        },
        streamingController.signal,
      );

      // 重新生成后刷新对话列表（更新 updated_at 排序）
      await get().loadConversations();
    } catch (err) {
      // 用户取消（AbortError）不报错，仅恢复原消息
      if (err instanceof DOMException && err.name === "AbortError") {
        // 用户取消：保留已生成的流式内容作为新消息
        const partialContent = get().streamingContent;
        if (partialContent.trim()) {
          const partialMessage: ChatMessage = {
            id: Date.now(),
            role: "assistant",
            content: partialContent + "\n\n_(重新生成已中断)_",
            created_at: new Date().toISOString(),
            is_regenerated: true,
            is_degraded: true,
            degrade_reason: "user_aborted",
          };
          set((s) => ({ messages: [...s.messages, partialMessage] }));
        } else {
          // 无内容：恢复原消息
          set((s) => ({ messages: [...s.messages, targetMessage] }));
        }
      } else {
        const errMsg =
          err instanceof Error ? err.message : "重新生成失败，请稍后重试";
        const errorMessage: ChatMessage = {
          id: Date.now(),
          role: "assistant",
          content: "",
          created_at: new Date().toISOString(),
          is_degraded: true,
          degrade_reason: errMsg,
          is_regenerated: true,
        };
        set((s) => ({
          messages: [...s.messages, errorMessage],
          error: errMsg,
        }));
      }
    } finally {
      set({ streaming: false, streamingContent: "", streamingSources: [] });
      streamingController = null;
    }
  },

  stopStreaming: () => {
    if (streamingController) {
      streamingController.abort();
    }
  },

  // ===== 对话管理 =====
  removeConversation: async (id: number) => {
    try {
      await chatApi.deleteConversation(id);
      set((state) => ({
        conversations: state.conversations.filter((c) => c.id !== id),
        // 如果删除的是当前对话，清空消息
        currentConversationId:
          state.currentConversationId === id ? null : state.currentConversationId,
        messages: state.currentConversationId === id ? [] : state.messages,
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "删除对话失败" });
      throw err;
    }
  },

  clearError: () => set({ error: null }),
}));
