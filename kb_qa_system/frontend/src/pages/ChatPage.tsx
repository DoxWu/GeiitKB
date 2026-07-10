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

import { useEffect, useRef, useState } from "react";
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

  // 页面加载时获取对话列表
  useEffect(() => {
    loadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // URL conversationId 变化时，同步选中对话
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

  // 自动滚动到底部（消息或流式内容变化时）
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, streamingContent, streaming]);

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
            collapsed={!sidebarOpen}
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
          <div className="border-b border-danger/30 bg-red-50 px-4 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        {/* 消息列表区 */}
        <div
          ref={messagesContainerRef}
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
