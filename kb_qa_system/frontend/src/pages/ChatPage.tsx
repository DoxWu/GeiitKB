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
 *   - 文档对话模式：上传文件后切换到文档对话，文档全文注入 LLM 上下文
 *
 * 使用方式：
 *   <ChatPage />  // 由路由 /chat 和 /chat/:conversationId 渲染
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Menu, MessageSquare, FileText } from "lucide-react";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { ChatInput } from "@/components/chat/ChatInput";
import { DocumentLibraryPicker } from "@/components/chat/DocumentLibraryPicker";
import { EmptyState, Spinner } from "@/components/common";
import { useChatStore } from "@/store/chatStore";
import { useToastStore } from "@/store/toastStore";
import { useAuthStore } from "@/store/authStore";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types/chat";
import type { DocumentChatUploadResponse } from "@/types/documentChat";
import * as documentChatApi from "@/api/documentChat";

/** 文档对话本地消息类型 */
interface DocChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

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

  const { apiError, success: toastSuccess, error: toastError } = useToastStore();
  const { user } = useAuthStore();

  // 从 URL 读取 conversationId 参数（支持 /chat/:conversationId 路由）
  const { conversationId } = useParams<{ conversationId: string }>();

  // 移动端侧边栏折叠状态
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // 消息列表容器引用（用于自动滚动）
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // 用户是否在滚动容器底部附近
  const [isAtBottom, setIsAtBottom] = useState(true);

  // ===== 文档对话状态 =====
  /** 文档对话会话 ID（null 表示知识库问答模式） */
  const [docSessionId, setDocSessionId] = useState<string | null>(null);
  /**
   * 文档对话对应的数据库 Conversation ID
   *
   * 作用：
   *   首次文档提问不传，后端创建 Conversation 后在 done 事件返回 conversation_id；
   *   后续追问传入该 ID，使多轮问答归属同一对话记录，侧边栏可正确显示。
   */
  const [docConversationId, setDocConversationId] = useState<number | null>(null);
  /** 已上传的文件信息 */
  const [uploadedFile, setUploadedFile] =
    useState<DocumentChatUploadResponse | null>(null);
  /** 文件上传中 */
  const [uploading, setUploading] = useState(false);
  /** 上传进度 */
  const [uploadProgress, setUploadProgress] = useState(0);
  /** 文档对话消息列表（本地管理，不走 chatStore） */
  const [docMessages, setDocMessages] = useState<DocChatMessage[]>([]);
  /** 文档对话流式输出中 */
  const [docStreaming, setDocStreaming] = useState(false);
  /** 文档对话流式内容 */
  const [docStreamingContent, setDocStreamingContent] = useState("");
  /** 文档对话 AbortController */
  const docAbortRef = useRef<AbortController | null>(null);
  /** 文档消息 ID 自增计数器 */
  const docMsgIdRef = useRef(0);
  /**
   * 文档对话流式内容 ref（同步跟踪最新值）
   *
   * 修复：handleDocSend 的 catch 块中直接读取 docStreamingContent state，
   * 但闭包捕获的是函数调用时的初始值（""），导致 abort 时已生成的内容丢失。
   * 通过 ref 同步更新，catch 块读取 ref 即可获取最新内容。
   */
  const docStreamingContentRef = useRef("");

  /** 文档库选择弹窗是否打开 */
  const [libraryPickerOpen, setLibraryPickerOpen] = useState(false);
  /** 从文档库选择中（加载文档内容到 Redis） */
  const [selectingFromLibrary, setSelectingFromLibrary] = useState(false);

  /** 当前是否在文档对话模式 */
  const inDocMode = !!docSessionId;

  /** 当前用户是否为游客（游客不能使用文档对话） */
  const isGuest = user?.user_type === "guest";

  /** 滚动事件处理 */
  const handleScroll = useCallback(() => {
    if (!messagesContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } =
      messagesContainerRef.current;
    const distanceToBottom = scrollHeight - scrollTop - clientHeight;
    setIsAtBottom(distanceToBottom < 120);
  }, []);

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
      startNewConversation();
      return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  /**
   * 修复问题1：切换对话或新建对话时清除文档对话历史
   *
   * 作用：
   *   当用户通过侧边栏切换到其他对话或点击"新对话"时，
   *   URL 中的 conversationId 会变化，此时清除上一轮的文档对话历史，
   *   避免残留的 docMessages 干扰新对话的显示。
   *   注意：首次挂载时不触发清除（prevRef 初始值与 conversationId 一致）。
   */
  const prevConversationIdRef = useRef(conversationId);
  useEffect(() => {
    if (prevConversationIdRef.current !== conversationId) {
      setDocMessages([]);
      setDocSessionId(null);
      setDocConversationId(null);
      setUploadedFile(null);
      setDocStreaming(false);
      setDocStreamingContent("");
      docStreamingContentRef.current = "";
      prevConversationIdRef.current = conversationId;
    }
  }, [conversationId]);

  // 切换对话时强制滚动到底部
  useEffect(() => {
    setIsAtBottom(true);
  }, [conversationId]);

  // 自动滚动到底部
  useEffect(() => {
    if (isAtBottom && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [
    messages,
    streamingContent,
    streaming,
    isAtBottom,
    docMessages,
    docStreamingContent,
    docStreaming,
  ]);

  // 错误自动清除
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => clearError(), 5000);
      return () => clearTimeout(timer);
    }
  }, [error, clearError]);

  // 组件卸载时取消文档对话流式请求
  useEffect(() => {
    return () => {
      docAbortRef.current?.abort();
    };
  }, []);

  /** 当前对话标题 */
  const currentTitle = inDocMode
    ? `📄 ${uploadedFile?.file_name || "文档对话"}`
    : conversations.find((c) => c.id === currentConversationId)?.title ||
      "新对话";

  /** 处理文件上传 */
  const handleFileSelect = useCallback(
    async (file: File) => {
      if (isGuest) {
        toastError("无法使用", "游客无法使用文档对话功能，请注册账号");
        return;
      }

      // 修复问题3：上传新文档前中断正在进行的文档对话流式请求，
      // 避免旧流式回调写入已清空的 docMessages 导致对话记录错乱
      docAbortRef.current?.abort();
      docAbortRef.current = null;
      setDocStreaming(false);
      setDocStreamingContent("");
      docStreamingContentRef.current = "";

      setUploading(true);
      setUploadProgress(0);

      try {
        const response = await documentChatApi.uploadDocument(
          file,
          (percent) => setUploadProgress(percent),
        );

        // 切换到文档对话模式
        setDocSessionId(response.session_id);
        setUploadedFile(response);
        setDocMessages([]);
        setDocConversationId(null);
        setDocStreamingContent("");

        // 提示用户
        toastSuccess(
          "文档已上传",
          `${response.char_count.toLocaleString()} 字符${
            response.truncated ? "（内容过长已截断）" : ""
          }，可以开始提问了`,
        );
      } catch (err) {
        apiError("文档上传失败", err);
      } finally {
        setUploading(false);
        setUploadProgress(0);
      }
    },
    [isGuest, toastError, toastSuccess, apiError],
  );

  /**
   * 清除文档，恢复知识库问答模式
   *
   * 修复问题1：此前清除文档时会清空 docMessages，导致文档对话历史完全消失。
   * 修复后：仅清除文档会话和文件信息，保留 docMessages 历史记录。
   *   - 用户仍可在当前界面查看之前的文档问答记录
   *   - 新提问将走知识库问答模式（chatStore）
   *   - 上传/选择新文档时才清空 docMessages（见 handleFileSelect / handleSelectFromLibrary）
   */
  const handleClearFile = useCallback(() => {
    docAbortRef.current?.abort();
    setDocSessionId(null);
    setDocConversationId(null);
    setUploadedFile(null);
    // 不清空 docMessages：保留文档对话历史，仅退出文档对话模式
    setDocStreaming(false);
    setDocStreamingContent("");
    docStreamingContentRef.current = "";
  }, []);

  /** 从文档库选择文档进行对话 */
  const handleSelectFromLibrary = useCallback(
    async (documentId: number) => {
      if (isGuest) {
        toastError("无法使用", "游客无法使用文档对话功能，请注册账号");
        return;
      }

      // 修复问题3：切换文档前中断正在进行的文档对话流式请求，
      // 避免旧流式回调写入已清空的 docMessages 导致对话记录错乱
      docAbortRef.current?.abort();
      docAbortRef.current = null;
      setDocStreaming(false);
      setDocStreamingContent("");
      docStreamingContentRef.current = "";

      setSelectingFromLibrary(true);

      try {
        const response = await documentChatApi.selectDocumentFromLibrary(
          documentId,
        );

        // 切换到文档对话模式
        setDocSessionId(response.session_id);
        setUploadedFile(response);
        setDocMessages([]);
        setDocConversationId(null);
        setDocStreamingContent("");

        // 提示用户
        toastSuccess(
          "文档已加载",
          `${response.file_name} · ${response.char_count.toLocaleString()} 字符${
            response.truncated ? "（内容过长已截断）" : ""
          }`,
        );
      } catch (err) {
        apiError("从文档库加载失败", err);
      } finally {
        setSelectingFromLibrary(false);
      }
    },
    [isGuest, toastError, toastSuccess, apiError],
  );

  /** 文档对话发送消息（流式） */
  const handleDocSend = useCallback(
    async (question: string) => {
      if (!docSessionId) return;

      // 添加用户消息
      const userMsg: DocChatMessage = {
        id: ++docMsgIdRef.current,
        role: "user",
        content: question,
        created_at: new Date().toISOString(),
      };
      setDocMessages((prev) => [...prev, userMsg]);

      // 启动流式请求
      setDocStreaming(true);
      setDocStreamingContent("");
      docStreamingContentRef.current = "";

      const controller = new AbortController();
      docAbortRef.current = controller;

      try {
        await documentChatApi.askDocumentStream(
          {
            session_id: docSessionId,
            question,
            // 传递 conversation_id 使多轮问答归属同一对话记录
            // 首次提问为 null（不传），后端创建后通过 done 事件返回
            conversation_id: docConversationId ?? undefined,
          },
          {
            onChunk: (text) => {
              docStreamingContentRef.current += text;
              setDocStreamingContent((prev) => prev + text);
            },
            onDone: (data) => {
              // 添加完整 AI 消息
              const aiMsg: DocChatMessage = {
                id: ++docMsgIdRef.current,
                role: "assistant",
                content: data.content || "",
                created_at: new Date().toISOString(),
              };
              setDocMessages((prev) => [...prev, aiMsg]);
              setDocStreamingContent("");
              docStreamingContentRef.current = "";

              // 保存 conversation_id 以便后续追问归属同一对话
              if (data.conversation_id) {
                setDocConversationId(data.conversation_id);
              }
              // 修复：总是刷新侧边栏对话列表
              // 后端在请求处理阶段（非生成器内）已创建 Conversation 并 commit，
              // 无论 done 事件是否携带 conversation_id，数据库中都已存在会话记录，
              // 必须刷新侧边栏使其立即显示。
              loadConversations();
            },
            onError: (msg) => {
              toastError("文档对话失败", msg);
              // 修复问题3：后端发送 error 事件后不会发送 done 事件，
              // 已生成的流式内容会随 docStreaming=false 丢失。
              // 保存部分内容到 docMessages，与用户取消（abort）的处理一致。
              const partialContent = docStreamingContentRef.current;
              if (partialContent) {
                const aiMsg: DocChatMessage = {
                  id: ++docMsgIdRef.current,
                  role: "assistant",
                  content: partialContent + "\n\n_(生成中断，请重试)_",
                  created_at: new Date().toISOString(),
                };
                setDocMessages((prev) => [...prev, aiMsg]);
                setDocStreamingContent("");
                docStreamingContentRef.current = "";
              }
              // 修复：错误时也总是刷新侧边栏
              // 后端在请求处理阶段已创建 Conversation + 保存用户消息并 commit，
              // 即使 LLM 调用失败（发送 error 事件），数据库中也有会话记录，
              // 必须刷新侧边栏使其显示。
              loadConversations();
            },
          },
          controller.signal,
        );
      } catch (err) {
        // 用户取消时不报错
        if (err instanceof DOMException && err.name === "AbortError") {
          // 修复：使用 ref 读取最新流式内容，而非闭包中的 stale state
          const partialContent = docStreamingContentRef.current;
          if (partialContent) {
            const aiMsg: DocChatMessage = {
              id: ++docMsgIdRef.current,
              role: "assistant",
              content: partialContent + "\n\n_(已中断)_",
              created_at: new Date().toISOString(),
            };
            setDocMessages((prev) => [...prev, aiMsg]);
            setDocStreamingContent("");
            docStreamingContentRef.current = "";
          }
        } else {
          apiError("文档对话失败", err);
        }
      } finally {
        setDocStreaming(false);
        docAbortRef.current = null;
      }
    },
    [docSessionId, docConversationId, apiError, toastError, loadConversations],
  );

  /** 文档对话停止生成 */
  const handleDocStop = useCallback(() => {
    docAbortRef.current?.abort();
  }, []);

  /** 统一发送处理 */
  function handleSend(message: string) {
    setIsAtBottom(true);
    if (inDocMode) {
      handleDocSend(message);
    } else {
      sendMessage(message);
    }
  }

  /** 统一停止处理 */
  function handleStop() {
    if (inDocMode) {
      handleDocStop();
    } else {
      stopStreaming();
    }
  }

  /** 文档对话流式输出中的临时 AI 消息
   *
   * 修复问题2：此前条件为 `docStreaming && docStreamingContent`，
   * 导致流式开始但首个文本块到达前（content 为空）不显示消息气泡，
   * 用户看不到大模型头像和思考状态指示。
   * 修复后：只要 docStreaming 为 true 即创建消息气泡，
   * MessageBubble 组件通过 `streaming && !content` 判断显示 TypingIndicator。
   */
  const docStreamingMessage: ChatMessage | null = docStreaming
    ? {
        id: -1,
        role: "assistant",
        content: docStreamingContent,
        created_at: new Date().toISOString(),
      }
    : null;

  /** 知识库问答流式输出中的临时 AI 消息 */
  const kbStreamingMessage: ChatMessage | null =
    !inDocMode && streaming
      ? {
          id: -1,
          role: "assistant",
          content: streamingContent,
          sources: streamingSources,
          created_at: new Date().toISOString(),
        }
      : null;

  /**
   * 是否有文档对话历史（文档已清除但历史消息仍保留）
   *
   * 修复问题1：清除文档后 docMessages 仍保留，
   * 需在非文档模式下继续展示这些历史消息。
   */
  const hasDocHistory = !inDocMode && docMessages.length > 0;

  /** 是否显示空状态 */
  const showEmptyState = inDocMode
    ? docMessages.length === 0 && !docStreaming
    : docMessages.length === 0 &&
      messages.length === 0 &&
      !streaming &&
      !loadingMessages;

  /** 当前是否在流式输出 */
  const isStreaming = inDocMode ? docStreaming : streaming;

  /**
   * 当前要显示的消息列表
   *
   * 修复问题1：文档对话模式下显示 docMessages；
   * 非文档模式但有文档历史时，先展示文档对话历史，再展示知识库问答消息，
   * 用分隔符标记两段对话的边界，让用户清晰区分。
   */
  const displayMessages: ChatMessage[] = inDocMode
    ? docMessages.map((m) => ({
        ...m,
        sources: undefined,
      }))
    : hasDocHistory
      ? [
          ...docMessages.map((m) => ({
            ...m,
            sources: undefined,
          })),
          // 分隔标记消息：在文档历史和知识库问答之间插入视觉分隔
          {
            id: -2,
            role: "assistant" as const,
            content: "__DOC_HISTORY_DIVIDER__",
            created_at: new Date().toISOString(),
          },
          ...messages,
        ]
      : messages;

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      {/* 侧边栏 - 桌面端固定，移动端抽屉 */}
      <div
        className={cn(
          "fixed inset-0 z-50 lg:static lg:z-auto",
          sidebarOpen ? "block" : "hidden lg:block",
        )}
      >
        {sidebarOpen && (
          <div
            // 修复：bg-black/50 在高缩放比例下仍与背景过度融合，提升至 bg-black/70
            className="absolute inset-0 bg-black/70 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        {/* 修复：wrapper 添加 bg-surface 确保侧边栏区域完全不透明 */}
        {/* 移动端优化：添加 mobile-solid-bg，在 <768px 时强制纯白/纯黑背景 */}
        <div className="relative h-full w-60 bg-surface mobile-solid-bg">
          <ChatSidebar onCollapse={() => setSidebarOpen(false)} />
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

            {/* 文档对话模式标识 */}
            {inDocMode && (
              <FileText className="h-4 w-4 shrink-0 text-brand" />
            )}

            {/* 页面标题 */}
            <h1 className="truncate text-base font-semibold text-ink">
              {currentTitle}
            </h1>

            {/* 文档对话模式标签 */}
            {inDocMode && (
              <span className="shrink-0 rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand">
                文档对话
              </span>
            )}
          </div>
        </header>

        {/* 错误提示条 */}
        {error && !inDocMode && (
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
          {inDocMode ? (
            // 文档对话模式
            showEmptyState ? (
              <div className="flex h-full items-center justify-center">
                <EmptyState
                  icon={<FileText className="h-6 w-6" />}
                  title="文档已就绪"
                  description={`已加载 ${uploadedFile?.char_count.toLocaleString()} 字符，在下方输入框提问（翻译、总结、解释等）`}
                  className="py-0"
                />
              </div>
            ) : (
              <div className="mx-auto max-w-3xl space-y-4">
                {displayMessages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))}
                {docStreamingMessage && (
                  <MessageBubble message={docStreamingMessage} streaming={true} />
                )}
                <div ref={messagesEndRef} />
              </div>
            )
          ) : // 知识库问答模式
          loadingMessages ? (
            <div className="flex h-full items-center justify-center">
              <Spinner className="h-6 w-6 text-brand" />
            </div>
          ) : showEmptyState ? (
            <div className="flex h-full items-center justify-center">
              <EmptyState
                icon={<MessageSquare className="h-6 w-6" />}
                title="开始新对话"
                description="在下方输入框中提问，AI 将基于您的知识库回答。点击📎上传文档或📚从文档库选择文档进行对话"
                className="py-0"
              />
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-4">
              {displayMessages.map((message) =>
                // 修复问题1：分隔标记消息渲染为视觉分隔线，不作为普通消息气泡
                message.content === "__DOC_HISTORY_DIVIDER__" ? (
                  <div
                    key={message.id}
                    className="flex items-center gap-3 py-2"
                  >
                    <div className="h-px flex-1 bg-line" />
                    <span className="text-xs text-ink-tertiary">
                      文档已清除 · 以下为知识库问答
                    </span>
                    <div className="h-px flex-1 bg-line" />
                  </div>
                ) : (
                  <MessageBubble key={message.id} message={message} />
                ),
              )}
              {kbStreamingMessage && (
                <MessageBubble message={kbStreamingMessage} streaming={true} />
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* 输入区 */}
        <ChatInput
          streaming={isStreaming}
          onSend={handleSend}
          onStop={handleStop}
          onFileSelect={isGuest ? undefined : handleFileSelect}
          onOpenLibrary={isGuest ? undefined : () => setLibraryPickerOpen(true)}
          uploadedFile={uploadedFile}
          onClearFile={inDocMode ? handleClearFile : undefined}
          uploading={uploading || selectingFromLibrary}
          uploadProgress={uploadProgress}
        />
      </main>

      {/* 文档库选择弹窗 */}
      <DocumentLibraryPicker
        open={libraryPickerOpen}
        onClose={() => setLibraryPickerOpen(false)}
        onSelect={handleSelectFromLibrary}
      />
    </div>
  );
}
