/**
 * chatStore 单元测试
 *
 * 覆盖范围：
 *   - loadConversations：加载对话列表
 *   - selectConversation：选择对话并加载消息
 *   - startNewConversation：开始新对话
 *   - sendMessage：流式发送消息（onSources/onChunk/onDone 回调流程）
 *   - stopStreaming：取消流式输出
 *   - removeConversation：删除对话
 *   - clearError：清除错误
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock chat API
const { mockChatApi } = vi.hoisted(() => ({
  mockChatApi: {
    ask: vi.fn(),
    askStream: vi.fn(),
    getConversations: vi.fn(),
    getConversationDetail: vi.fn(),
    deleteConversation: vi.fn(),
  },
}));

vi.mock("@/api/chat", () => mockChatApi);

import { useChatStore } from "@/store/chatStore";
import type { Conversation, ConversationListResponse } from "@/types/chat";

/** 创建测试用对话数据 */
function createMockConversation(overrides?: Partial<Conversation>): Conversation {
  return {
    id: 1,
    title: "测试对话",
    is_active: true,
    created_at: "2026-07-10T00:00:00Z",
    updated_at: "2026-07-10T00:00:00Z",
    messages: [],
    ...overrides,
  };
}

describe("chatStore", () => {
  beforeEach(() => {
    // 重置 store 到初始状态
    useChatStore.setState({
      conversations: [],
      loadingConversations: false,
      currentConversationId: null,
      messages: [],
      loadingMessages: false,
      streaming: false,
      streamingContent: "",
      streamingSources: [],
      error: null,
    });
    vi.clearAllMocks();
  });

  describe("loadConversations", () => {
    it("成功加载对话列表", async () => {
      const mockConversations = [
        createMockConversation({ id: 1, title: "对话1" }),
        createMockConversation({ id: 2, title: "对话2" }),
      ];
      const mockResponse: ConversationListResponse = {
        items: mockConversations,
        total: 2,
        page: 1,
        page_size: 20,
      };
      mockChatApi.getConversations.mockResolvedValueOnce(mockResponse);

      await useChatStore.getState().loadConversations();

      const state = useChatStore.getState();
      expect(state.conversations).toEqual(mockConversations);
      expect(state.loadingConversations).toBe(false);
      expect(state.error).toBeNull();
    });

    it("加载失败时设置错误", async () => {
      mockChatApi.getConversations.mockRejectedValueOnce(new Error("网络错误"));

      await useChatStore.getState().loadConversations();

      const state = useChatStore.getState();
      expect(state.error).toBe("网络错误");
      expect(state.loadingConversations).toBe(false);
    });
  });

  describe("selectConversation", () => {
    it("选择对话并加载消息历史", async () => {
      const mockConversation = createMockConversation({
        id: 5,
        messages: [
          { id: 1, role: "user", content: "你好", created_at: "2026-07-10T00:00:00Z" },
          { id: 2, role: "assistant", content: "你好！", created_at: "2026-07-10T00:00:01Z" },
        ],
      });
      mockChatApi.getConversationDetail.mockResolvedValueOnce(mockConversation);

      await useChatStore.getState().selectConversation(5);

      const state = useChatStore.getState();
      expect(state.currentConversationId).toBe(5);
      expect(state.messages).toHaveLength(2);
      expect(state.loadingMessages).toBe(false);
    });

    it("加载详情失败时设置错误", async () => {
      mockChatApi.getConversationDetail.mockRejectedValueOnce(new Error("未找到"));

      await useChatStore.getState().selectConversation(99);

      const state = useChatStore.getState();
      expect(state.error).toBe("未找到");
      expect(state.loadingMessages).toBe(false);
    });
  });

  describe("startNewConversation", () => {
    it("清空当前对话和消息", () => {
      // 先设置一些状态
      useChatStore.setState({
        currentConversationId: 5,
        messages: [{ id: 1, role: "user", content: "测试", created_at: "" }],
      });

      useChatStore.getState().startNewConversation();

      const state = useChatStore.getState();
      expect(state.currentConversationId).toBeNull();
      expect(state.messages).toEqual([]);
    });
  });

  describe("sendMessage", () => {
    it("流式发送消息：用户消息立即追加，完成后追加 AI 回答", async () => {
      // 模拟 askStream：捕获回调并手动触发
      let capturedCallbacks: {
        onSources?: (s: unknown[]) => void;
        onChunk?: (t: string) => void;
        onDone?: (d: { content: string; degraded?: boolean }) => void;
      } = {};

      mockChatApi.askStream.mockImplementationOnce(
        async (_data: unknown, callbacks: typeof capturedCallbacks) => {
          capturedCallbacks = callbacks;
        },
      );
      // 模拟新对话后刷新列表
      mockChatApi.getConversations.mockResolvedValueOnce({
        items: [createMockConversation({ id: 10, title: "新对话" })],
        total: 1,
        page: 1,
        page_size: 20,
      });

      // 发送消息
      const sendPromise = useChatStore.getState().sendMessage("你好");

      // 验证用户消息已追加
      let state = useChatStore.getState();
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0].role).toBe("user");
      expect(state.messages[0].content).toBe("你好");
      expect(state.streaming).toBe(true);

      // 模拟流式回调
      capturedCallbacks.onSources?.([{ title: "文档1", content: "内容", score: 0.9 }]);
      state = useChatStore.getState();
      expect(state.streamingSources).toHaveLength(1);

      capturedCallbacks.onChunk?.("你好");
      capturedCallbacks.onChunk?.("！");
      state = useChatStore.getState();
      expect(state.streamingContent).toBe("你好！");

      capturedCallbacks.onDone?.({ content: "你好！有什么可以帮助你的？", degraded: false });

      await sendPromise;

      // 验证最终状态
      state = useChatStore.getState();
      expect(state.messages).toHaveLength(2);
      expect(state.messages[1].role).toBe("assistant");
      expect(state.messages[1].content).toBe("你好！有什么可以帮助你的？");
      expect(state.streaming).toBe(false);
      expect(state.streamingContent).toBe("");
      // 新对话应获取到 conversation_id
      expect(state.currentConversationId).toBe(10);
    });

    it("空消息不发送", async () => {
      await useChatStore.getState().sendMessage("   ");

      expect(mockChatApi.askStream).not.toHaveBeenCalled();
      const state = useChatStore.getState();
      expect(state.messages).toHaveLength(0);
    });

    it("流式输出中不允许发送新消息", async () => {
      useChatStore.setState({ streaming: true });

      await useChatStore.getState().sendMessage("新消息");

      expect(mockChatApi.askStream).not.toHaveBeenCalled();
    });

    it("请求失败时设置错误", async () => {
      mockChatApi.askStream.mockRejectedValueOnce(new Error("请求失败"));

      await useChatStore.getState().sendMessage("测试");

      const state = useChatStore.getState();
      expect(state.error).toBe("请求失败");
      expect(state.streaming).toBe(false);
    });
  });

  describe("stopStreaming", () => {
    it("调用 AbortController.abort", async () => {
      // 开始一次流式请求以创建 AbortController
      mockChatApi.askStream.mockImplementationOnce(
        async (_data: unknown, _callbacks: unknown, signal: AbortSignal) => {
          // 等待 abort
          return new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => {
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            });
          });
        },
      );
      mockChatApi.getConversations.mockResolvedValueOnce({
        items: [],
        total: 0,
        page: 1,
        page_size: 20,
      });

      const sendPromise = useChatStore.getState().sendMessage("测试");

      // 验证正在流式输出
      expect(useChatStore.getState().streaming).toBe(true);

      // 停止
      useChatStore.getState().stopStreaming();

      await sendPromise;

      // 验证流式已停止
      const state = useChatStore.getState();
      expect(state.streaming).toBe(false);
    });
  });

  describe("removeConversation", () => {
    it("成功删除对话并从列表移除", async () => {
      useChatStore.setState({
        conversations: [
          createMockConversation({ id: 1 }),
          createMockConversation({ id: 2 }),
        ],
      });
      mockChatApi.deleteConversation.mockResolvedValueOnce(undefined);

      await useChatStore.getState().removeConversation(1);

      const state = useChatStore.getState();
      expect(state.conversations).toHaveLength(1);
      expect(state.conversations[0].id).toBe(2);
    });

    it("删除当前对话时清空消息", async () => {
      useChatStore.setState({
        conversations: [createMockConversation({ id: 1 })],
        currentConversationId: 1,
        messages: [{ id: 1, role: "user", content: "测试", created_at: "" }],
      });
      mockChatApi.deleteConversation.mockResolvedValueOnce(undefined);

      await useChatStore.getState().removeConversation(1);

      const state = useChatStore.getState();
      expect(state.currentConversationId).toBeNull();
      expect(state.messages).toEqual([]);
    });

    it("删除失败时抛出错误并设置 error", async () => {
      mockChatApi.deleteConversation.mockRejectedValueOnce(new Error("删除失败"));

      await expect(
        useChatStore.getState().removeConversation(1),
      ).rejects.toThrow("删除失败");

      expect(useChatStore.getState().error).toBe("删除失败");
    });
  });

  describe("clearError", () => {
    it("清除错误状态", () => {
      useChatStore.setState({ error: "某个错误" });

      useChatStore.getState().clearError();

      expect(useChatStore.getState().error).toBeNull();
    });
  });
});
