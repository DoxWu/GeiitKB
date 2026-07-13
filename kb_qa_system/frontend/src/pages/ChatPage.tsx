/**
 * 聊天主页面
 *
 * 作用：
 *   知识库问答系统的核心交互页面，采用双栏布局：
 *   - 左侧：对话列表侧边栏（ChatSidebar）
 *   - 右侧：消息区域（消息列表 + 输入框）
 *
 * 功能：
 *   - 流式问答（SSE 打字机效果）
 *   - 对话历史切换
 *   - 新建对话
 *   - 自动滚动到底部
 *   - 移动端侧边栏折叠
 *
 * 使用方式：
 *   <ChatPage />  // 由路由 /chat 和 /chat/:conversationId 渲染
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Menu, MessageSquare } from "lucide-react";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { ChatInput } from "@/components/chat/ChatInput";
import { EmptyState, Spinner } from "@/components/common";
import { useChatStore } from "@/store/chatStore";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types/chat";

/** ChatPage 组件 */
export default function ChatPage() {
  const {
    conversations,
    messages,
    streaming,
    streamingContent,
    streamingSources,
    loadingMessages,
    currentConversationId,
    error,
    loadConversations,
    selectConversation,
    startNewConversation,
    sendMessage,
    stopStreaming,
    clearError,
  } = useChatStore();

  // 从 URL 读取 conversationId 参数（支持 /chat/:conversationId 路由）
  const { conversationId } = useParams<{ conversationId: string }>();

  // 移动端侧边栏折叠状态
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // 消息列表容器引用（用于自动滚动）
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // 用户是否在滚动容器底部附近
  // 作用：智能滚动策略——仅在用户已在底部时自动跟随滚动，
  //       用户向上浏览历史内容时不强制拉回底部
  const [isAtBottom, setIsAtBottom] = useState(true);

  // 滚动事件处理：判断用户是否在底部
  // 作用：监听滚动容器的 scroll 事件，根据滚动位置更新 isAtBottom
  //       阈值 120px：允许小幅偏差，避免因亚像素精度导致误判
  const handleScroll = useCallback(() => {
    if (!messagesContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } =
      messagesContainerRef.current;
    const distanceToBottom = scrollHeight - scrollTop - clientHeight;
    setIsAtBottom(distanceToBottom < 120);
  }, []);

  // 页面加载时获取对话列表
  // E3-03: 仅在挂载时执行一次。loadConversations 来自 zustand store，
  // 引用稳定但 lint 无法识别；若加入依赖会导致重复请求。
  useEffect(() => {
    loadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // URL conversationId 变化时，同步选中对话
  // E3-03: 仅依赖 URL 参数 conversationId 变化触发。
  // currentConversationId/selectConversation/startNewConversation 来自 store，
  // 引用稳定但 lint 无法识别；加入依赖会导致 URL 变化时重复触发。
  useEffect(() => {
    if (conversationId !== undefined) {
      const id = Number(conversationId);
      if (!Number.isNaN(id) && id !== currentConversationId) {
        selectConversation(id);
        return;
      }
    } else if (currentConversationId !== null && conversationId === undefined) {
      // 从 /chat/:conversationId 回到 /chat 时，开始新对话
      startNewConversation();
      return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // 切换对话时强制滚动到底部
  // 作用：加载新对话的消息后，应显示最新消息而非保持旧滚动位置
  useEffect(() => {
    setIsAtBottom(true);
  }, [conversationId]);

  // 自动滚动到底部（仅在用户已在底部时跟随）
  // 作用：流式输出和消息更新时，如果用户在底部则自动滚动跟随；
  //       用户向上浏览历史内容时不强制拉回，保障浏览体验
  useEffect(() => {
    if (isAtBottom && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, streamingContent, streaming, isAtBottom]);

  // 错误自动清除
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => clearError(), 5000);
      return () => clearTimeout(timer);
    }
  }, [error, clearError]);

  /** 当前对话标题 */
  const currentTitle =
    conversations.find((c) => c.id === currentConversationId)?.title ||
    "新对话";

  /** 流式输出中的临时 AI 消息 */
  const streamingMessage: ChatMessage | null = streaming
    ? {
        id: -1,
        role: "assistant",
        content: streamingContent,
        sources: streamingSources,
        created_at: new Date().toISOString(),
      }
    : null;

  /** 是否显示空状态（无消息且不在加载/流式状态） */
  const showEmptyState =
    messages.length === 0 && !streaming && !loadingMessages;

  /** 处理发送消息 */
  function handleSend(message: string) {
    // 用户发送新消息时强制滚动到底部
    // 作用：确保用户能看到自己发送的消息和后续的 AI 回复
    setIsAtBottom(true);
    sendMessage(message);
  }

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      {/* 侧边栏 - 桌面端固定，移动端抽屉 */}
      <div
        className={cn(
          "fixed inset-0 z-50 lg:static lg:z-auto",
          sidebarOpen ? "block" : "hidden lg:block",
        )}
      >
        {/* 移动端遮罩 */}
        {sidebarOpen && (
          <div
            className="absolute inset-0 bg-black/20 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <div className="relative h-full">
          <ChatSidebar
            onCollapse={() => setSidebarOpen(false)}
          />
        </div>
      </div>

      {/* 主内容区 */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* 顶部工具栏 */}
        <header className="border-b border-line bg-surface px-4 py-3 lg:px-6">
          <div className="flex items-center gap-3">
            {/* 移动端菜单按钮 */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="rounded p-1.5 text-ink-secondary hover:bg-muted lg:hidden"
              aria-label="打开侧边栏"
            >
              <Menu className="h-5 w-5" />
            </button>

            {/* 页面标题 */}
            <h1 className="truncate text-base font-semibold text-ink">
              {currentTitle}
            </h1>
          </div>
        </header>

        {/* 错误提示条 */}
        {error && (
          <div className="border-b border-danger/30 bg-danger/10 px-4 py-2 text-sm text-danger dark:bg-danger/20">
            {error}
          </div>
        )}

        {/* 消息列表区 */}
        <div
          ref={messagesContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-4 py-6"
        >
          {loadingMessages ? (
            <div className="flex h-full items-center justify-center">
              <Spinner className="h-6 w-6 text-brand" />
            </div>
          ) : showEmptyState ? (
            <div className="flex h-full items-center justify-center">
              <EmptyState
                icon={<MessageSquare className="h-6 w-6" />}
                title="开始新对话"
                description="在下方输入框中提问，AI 将基于您的知识库回答"
                className="py-0"
              />
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-4">
              {/* 历史消息列表 */}
              {messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}

              {/* 流式输出中的临时 AI 消息 */}
              {streamingMessage && (
                <MessageBubble
                  message={streamingMessage}
                  streaming={true}
                />
              )}

              {/* 滚动锚点 */}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* 输入区 */}
        <ChatInput
          streaming={streaming}
          onSend={handleSend}
          onStop={stopStreaming}
        />
      </main>
    </div>
  );
}
