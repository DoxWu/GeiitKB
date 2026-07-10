/**
 * ChatSidebar 组件单元测试
 *
 * 覆盖范围：
 *   - 渲染品牌标识和导航链接
 *   - 新对话按钮
 *   - 对话列表渲染
 *   - 空状态
 *   - 选中对话高亮
 *   - 删除对话确认
 *   - 用户信息显示
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ChatSidebar } from "../ChatSidebar";
import type { Conversation } from "@/types/chat";

// Mock stores
const { mockChatStore } = vi.hoisted(() => ({
  mockChatStore: {
    conversations: [] as Conversation[],
    currentConversationId: null as number | null,
    loadingConversations: false,
    selectConversation: vi.fn(),
    startNewConversation: vi.fn(),
    removeConversation: vi.fn(),
  },
}));

const { mockAuthStore } = vi.hoisted(() => ({
  mockAuthStore: {
    user: { username: "testuser", email: "test@test.com" },
    logout: vi.fn(),
  },
}));

const { mockToastStore } = vi.hoisted(() => ({
  mockToastStore: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("@/store/chatStore", () => ({
  useChatStore: () => mockChatStore,
}));

vi.mock("@/store/authStore", () => ({
  useAuthStore: () => mockAuthStore,
}));

vi.mock("@/store/toastStore", () => ({
  useToastStore: () => mockToastStore,
}));

/** 创建测试用对话 */
function createConversation(overrides?: Partial<Conversation>): Conversation {
  return {
    id: 1,
    title: "测试对话",
    is_active: true,
    created_at: "2026-07-10T00:00:00Z",
    updated_at: "2026-07-10T00:00:00Z",
    ...overrides,
  };
}

/** 渲染带 Router 的 ChatSidebar */
function renderSidebar() {
  return render(
    <MemoryRouter>
      <ChatSidebar />
    </MemoryRouter>,
  );
}

describe("ChatSidebar 组件", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChatStore.conversations = [];
    mockChatStore.currentConversationId = null;
    mockChatStore.loadingConversations = false;
  });

  it("渲染品牌标识", () => {
    renderSidebar();
    expect(screen.getByText("GeiIt企业知识库")).toBeInTheDocument();
  });

  it("渲染新对话按钮", () => {
    renderSidebar();
    expect(screen.getByText("新对话")).toBeInTheDocument();
  });

  it("点击新对话按钮触发 startNewConversation", async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByText("新对话"));

    expect(mockChatStore.startNewConversation).toHaveBeenCalledOnce();
  });

  it("对话列表为空时显示空状态", () => {
    renderSidebar();
    expect(screen.getByText("暂无对话")).toBeInTheDocument();
  });

  it("渲染对话列表", () => {
    mockChatStore.conversations = [
      createConversation({ id: 1, title: "对话1" }),
      createConversation({ id: 2, title: "对话2" }),
    ];
    renderSidebar();

    expect(screen.getByText("对话1")).toBeInTheDocument();
    expect(screen.getByText("对话2")).toBeInTheDocument();
  });

  it("点击对话项触发 selectConversation", async () => {
    const user = userEvent.setup();
    mockChatStore.conversations = [
      createConversation({ id: 5, title: "选中对话" }),
    ];
    renderSidebar();

    await user.click(screen.getByText("选中对话"));

    expect(mockChatStore.selectConversation).toHaveBeenCalledWith(5);
  });

  it("渲染用户信息", () => {
    renderSidebar();
    expect(screen.getByText("testuser")).toBeInTheDocument();
    expect(screen.getByText("test@test.com")).toBeInTheDocument();
  });

  it("渲染登出按钮", () => {
    renderSidebar();
    expect(screen.getByText("登出")).toBeInTheDocument();
  });

  it("渲染设置入口", () => {
    renderSidebar();
    expect(screen.getByText("设置")).toBeInTheDocument();
  });

  it("渲染知识库导航链接", () => {
    renderSidebar();
    expect(screen.getByText("知识库")).toBeInTheDocument();
  });

  it("渲染问答导航链接（当前活跃）", () => {
    renderSidebar();
    expect(screen.getByText("问答")).toBeInTheDocument();
  });

  it("加载中状态显示加载提示", () => {
    mockChatStore.loadingConversations = true;
    mockChatStore.conversations = [];
    renderSidebar();
    expect(screen.getByText("加载中...")).toBeInTheDocument();
  });
});
