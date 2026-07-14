/**
 * 文档对话页面
 *
 * 作用：
 *   单文档对话功能页面。用户上传一份文档后，可针对该文档内容进行提问，
 *   AI 基于文档内容流式返回回答（打字机效果）。
 *
 * 功能：
 *   - 文件上传（拖拽 + 点击），支持 .pdf/.docx/.md/.txt，限制 10MB
 *   - 上传进度显示
 *   - 文件信息卡片（文件名、大小、字符数、截断提示）
 *   - 流式问答（SSE 打字机效果）
 *   - 取消正在生成的回答（AbortController）
 *   - 清空对话 / 重新上传
 *
 * 使用方式：
 *   <DocumentChatPage />  // 由路由 /document-chat 渲染
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  FileText,
  UploadCloud,
  RotateCcw,
  Trash2,
  MessageSquare,
  AlertTriangle,
} from "lucide-react";
import { Button, EmptyState, Spinner } from "@/components/common";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { ChatInput } from "@/components/chat/ChatInput";
import { useToastStore } from "@/store/toastStore";
import { uploadDocument, askDocumentStream } from "@/api/documentChat";
import { getFileIcon } from "@/utils/fileType";
import { formatFileSize } from "@/utils/format";
import {
  DOCUMENT_CHAT_FILE_TYPES,
  DOCUMENT_CHAT_MAX_FILE_SIZE,
} from "@/utils/constants";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types/chat";
import type { DocumentChatUploadResponse } from "@/types/documentChat";

/** 消息 ID 自增计数器 */
let messageIdCounter = 1;

/** DocumentChatPage 组件 */
export default function DocumentChatPage() {
  const navigate = useNavigate();
  const toast = useToastStore();

  // 文件信息（上传成功后设置）
  const [fileInfo, setFileInfo] = useState<DocumentChatUploadResponse | null>(
    null,
  );
  // 上传中状态
  const [uploading, setUploading] = useState(false);
  // 上传进度（0-100）
  const [uploadProgress, setUploadProgress] = useState(0);

  // 聊天消息列表
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // 流式输出状态
  const [streaming, setStreaming] = useState(false);
  // 流式输出累积的内容
  const [streamingContent, setStreamingContent] = useState("");

  // 拖拽状态
  const [dragOver, setDragOver] = useState(false);

  // 文件输入引用
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 流式请求的 AbortController（用于取消生成）
  const abortControllerRef = useRef<AbortController | null>(null);
  // 消息列表滚动锚点
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // 消息容器引用（用于智能滚动）
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  // 用户是否在底部（用于智能滚动跟随）
  const [isAtBottom, setIsAtBottom] = useState(true);

  /** 校验文件是否合法
   * @param file - 文件对象
   * @returns 错误信息，合法则返回 null
   */
  function validateFile(file: File): string | null {
    const ext = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
    if (!DOCUMENT_CHAT_FILE_TYPES.includes(ext)) {
      return `不支持的文件类型: ${ext}，仅支持 ${DOCUMENT_CHAT_FILE_TYPES.join("、")}`;
    }
    if (file.size > DOCUMENT_CHAT_MAX_FILE_SIZE) {
      return `文件过大: ${formatFileSize(file.size)}，最大支持 ${formatFileSize(DOCUMENT_CHAT_MAX_FILE_SIZE)}`;
    }
    return null;
  }

  /** 处理上传文件 */
  const handleUploadFile = useCallback(
    async (file: File) => {
      const validationError = validateFile(file);
      if (validationError) {
        toast.error("文件校验失败", validationError);
        return;
      }

      setUploading(true);
      setUploadProgress(0);

      try {
        const response = await uploadDocument(file, (percent) => {
          setUploadProgress(percent);
        });
        setFileInfo(response);
        setMessages([]);
        setStreamingContent("");
        toast.success(
          "上传成功",
          response.truncated
            ? `已解析 ${response.char_count} 字符（内容过长已截断）`
            : `已解析 ${response.char_count} 字符`,
        );
      } catch (err) {
        // 取消上传不显示错误 toast
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }
        toast.apiError("上传失败", err);
      } finally {
        setUploading(false);
        setUploadProgress(0);
      }
    },
    [toast],
  );

  /** 文件选择 */
  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      handleUploadFile(file);
    }
    // 重置 input 以支持重复选择同一文件
    e.target.value = "";
  }

  /** 拖拽放置 */
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleUploadFile(file);
    }
  }

  /** 发送消息（流式问答） */
  async function handleSend(question: string) {
    if (!fileInfo || streaming) return;

    // 追加用户消息
    const userMessage: ChatMessage = {
      id: messageIdCounter++,
      role: "user",
      content: question,
      sources: null,
      created_at: new Date().toISOString(),
    };

    // 追加占位的 AI 消息（流式输出会填充内容）
    const aiMessageId = messageIdCounter++;
    const aiMessage: ChatMessage = {
      id: aiMessageId,
      role: "assistant",
      content: "",
      sources: null,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage, aiMessage]);
    setStreaming(true);
    setStreamingContent("");
    setIsAtBottom(true);

    // 创建 AbortController 用于取消
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // 累积的流式内容
    let accumulated = "";

    try {
      await askDocumentStream(
        { session_id: fileInfo.session_id, question },
        {
          onChunk: (text) => {
            accumulated += text;
            setStreamingContent(accumulated);
            // 实时更新占位 AI 消息的内容
            setMessages((prev) =>
              prev.map((m) =>
                m.id === aiMessageId ? { ...m, content: accumulated } : m,
              ),
            );
          },
          onDone: (data) => {
            // 流结束：用最终内容更新（防止 chunk 累积偏差）
            const finalContent = data.content || accumulated;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === aiMessageId
                  ? { ...m, content: finalContent }
                  : m,
              ),
            );
            setStreamingContent("");
          },
          onError: (message) => {
            // 后端返回 error 事件：更新 AI 消息为错误提示
            setMessages((prev) =>
              prev.map((m) =>
                m.id === aiMessageId
                  ? {
                      ...m,
                      content: accumulated || `抱歉，生成回答时出错：${message}`,
                      is_degraded: true,
                      degrade_reason: message,
                    }
                  : m,
              ),
            );
            toast.error("生成失败", message);
          },
        },
        abortController.signal,
      );
    } catch (err) {
      // 取消时（用户主动停止）：保留已生成的内容
      if (err instanceof Error && err.name === "AbortError") {
        if (accumulated) {
          // 保留已生成内容，添加中断标记
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMessageId
                ? { ...m, content: accumulated + "\n\n_（已停止生成）_" }
                : m,
            ),
          );
        } else {
          // 没有任何内容时移除占位消息
          setMessages((prev) => prev.filter((m) => m.id !== aiMessageId));
        }
      } else {
        // 其他错误：更新为错误提示
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMessageId
              ? {
                  ...m,
                  content: accumulated || "抱歉，生成回答时发生错误，请重试。",
                  is_degraded: true,
                }
              : m,
          ),
        );
        toast.apiError("生成失败", err);
      }
    } finally {
      setStreaming(false);
      setStreamingContent("");
      abortControllerRef.current = null;
    }
  }

  /** 停止生成 */
  function handleStop() {
    abortControllerRef.current?.abort();
  }

  /** 清空对话（保留文件） */
  function handleClearMessages() {
    setMessages([]);
    setStreamingContent("");
    toast.info("已清空对话");
  }

  /** 重新上传（清空一切） */
  function handleReset() {
    if (streaming) {
      handleStop();
    }
    setFileInfo(null);
    setMessages([]);
    setStreamingContent("");
    setUploadProgress(0);
  }

  /** 滚动事件：判断用户是否在底部 */
  const handleScroll = useCallback(() => {
    if (!messagesContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } =
      messagesContainerRef.current;
    const distanceToBottom = scrollHeight - scrollTop - clientHeight;
    setIsAtBottom(distanceToBottom < 120);
  }, []);

  // 自动滚动到底部（仅在用户已在底部时跟随）
  useEffect(() => {
    if (isAtBottom && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, streamingContent, streaming, isAtBottom]);

  // 组件卸载时取消进行中的流式请求
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  /** 当前文件类型对应的图标 */
  const FileIcon = fileInfo ? getFileIcon(fileInfo.file_type) : FileText;

  /** 是否显示空状态 */
  const showEmptyState =
    fileInfo && messages.length === 0 && !streaming;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas">
      {/* 顶部工具栏 */}
      <header className="border-b border-line bg-surface px-4 py-3 lg:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {/* 返回按钮 */}
            <button
              onClick={() => navigate("/chat")}
              className="rounded p-1.5 text-ink-secondary hover:bg-muted"
              aria-label="返回问答"
              title="返回问答"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <h1 className="truncate text-base font-semibold text-ink">
              文档对话
            </h1>
          </div>

          {/* 右侧操作按钮 */}
          {fileInfo && (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                icon={<Trash2 className="h-3.5 w-3.5" />}
                onClick={handleClearMessages}
                disabled={streaming || messages.length === 0}
              >
                清空对话
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<RotateCcw className="h-3.5 w-3.5" />}
                onClick={handleReset}
                disabled={streaming}
              >
                重新上传
              </Button>
            </div>
          )}
        </div>
      </header>

      {/* 主内容区 */}
      {!fileInfo ? (
        /* 未上传文件：显示上传区域 */
        <div className="flex flex-1 items-center justify-center overflow-y-auto px-4 py-6">
          <div className="w-full max-w-xl">
            {uploading ? (
              /* 上传中：显示进度 */
              <div className="flex flex-col items-center gap-4 py-12">
                <Spinner size="lg" className="text-brand" />
                <div className="text-center">
                  <p className="text-sm font-medium text-ink">正在上传并解析文档...</p>
                  <p className="mt-1 text-xs text-ink-tertiary">
                    {uploadProgress > 0 ? `上传进度: ${uploadProgress}%` : "请稍候"}
                  </p>
                </div>
                {/* 进度条 */}
                <div className="h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-brand transition-all duration-200"
                    style={{ width: `${Math.max(uploadProgress, 5)}%` }}
                  />
                </div>
              </div>
            ) : (
              /* 上传区域 */
              <div className="space-y-4">
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  className={cn(
                    "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed py-12 transition-colors",
                    dragOver
                      ? "border-brand bg-brand-light"
                      : "border-line bg-surface hover:border-brand hover:bg-muted/50",
                  )}
                >
                  <UploadCloud
                    className={cn(
                      "h-10 w-10",
                      dragOver ? "text-brand" : "text-ink-tertiary",
                    )}
                  />
                  <div className="text-center">
                    <p className="text-sm font-medium text-ink">
                      点击上传或拖拽文件到此处
                    </p>
                    <p className="mt-1 text-xs text-ink-tertiary">
                      支持 {DOCUMENT_CHAT_FILE_TYPES.join("、")}，单个文件最大{" "}
                      {formatFileSize(DOCUMENT_CHAT_MAX_FILE_SIZE)}
                    </p>
                  </div>
                </div>

                {/* 功能说明 */}
                <div className="rounded-lg border border-line bg-muted/30 p-4 text-xs text-ink-secondary">
                  <p className="font-medium text-ink">使用说明</p>
                  <ul className="mt-2 space-y-1 list-disc list-inside">
                    <li>上传文档后，可针对文档内容自由提问</li>
                    <li>AI 将基于文档内容流式返回回答</li>
                    <li>支持随时停止生成、清空对话或重新上传</li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* 已上传文件：显示文件信息 + 聊天区域 */
        <>
          {/* 文件信息卡片 */}
          <div className="border-b border-line bg-muted/30 px-4 py-3 lg:px-6">
            <div className="mx-auto flex max-w-3xl items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-light text-brand">
                <FileIcon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-ink">
                    {fileInfo.file_name}
                  </p>
                  {fileInfo.truncated && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-warning/10 px-1.5 py-0.5 text-xs text-warning">
                      <AlertTriangle className="h-3 w-3" />
                      内容已截断
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-ink-tertiary">
                  {formatFileSize(fileInfo.file_size)} · {fileInfo.char_count.toLocaleString()} 字符 · {fileInfo.file_type}
                </p>
              </div>
            </div>
          </div>

          {/* 消息列表区 */}
          <div
            ref={messagesContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto px-4 py-6"
          >
            {showEmptyState ? (
              <div className="flex h-full items-center justify-center">
                <EmptyState
                  icon={<MessageSquare className="h-6 w-6" />}
                  title="开始文档对话"
                  description="在下方输入框中针对文档内容提问"
                  className="py-0"
                />
              </div>
            ) : (
              <div className="mx-auto max-w-3xl space-y-4">
                {/* 历史消息列表 */}
                {messages.map((message, index) => {
                  const isLastMessage = index === messages.length - 1;
                  const isStreamingMessage =
                    streaming &&
                    isLastMessage &&
                    message.role === "assistant";
                  return (
                    <MessageBubble
                      key={message.id}
                      message={message}
                      streaming={isStreamingMessage}
                    />
                  );
                })}

                {/* 滚动锚点 */}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* 输入区 */}
          <ChatInput
            streaming={streaming}
            onSend={handleSend}
            onStop={handleStop}
          />
        </>
      )}

      {/* 隐藏的文件输入（始终挂载，以便点击触发） */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileSelect}
        accept={DOCUMENT_CHAT_FILE_TYPES.join(",")}
      />
    </div>
  );
}
