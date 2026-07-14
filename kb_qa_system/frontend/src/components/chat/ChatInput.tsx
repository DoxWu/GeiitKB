/**
 * 聊天输入框组件
 *
 * 作用：
 *   提供消息输入区域，支持：
 *   - 自适应高度的 textarea
 *   - Enter 发送 / Shift+Enter 换行
 *   - 流式输出时显示"停止"按钮
 *   - 字符计数（最大 2000）
 *   - 空输入禁用发送
 *   - 文档上传按钮（点击选择 + 拖拽上传）
 *   - 上传进度显示
 *   - 已上传文件信息展示与移除
 *
 * 使用方式：
 *   <ChatInput streaming={false} onSend={handleSend} onStop={handleStop}
 *     onFileSelect={handleFileSelect} uploadedFile={fileInfo}
 *     onClearFile={handleClearFile} uploading={false} uploadProgress={0} />
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Square, Paperclip, X, FileText, Loader2, Library } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DocumentChatUploadResponse } from "@/types/documentChat";

/** ChatInput 组件属性 */
interface ChatInputProps {
  /** 是否正在流式输出 */
  streaming: boolean;
  /** 发送消息回调 */
  onSend: (message: string) => void;
  /** 停止流式输出回调 */
  onStop: () => void;
  /** 文件选择回调（用户选择文件后触发） */
  onFileSelect?: (file: File) => void;
  /** 从文档库选择文档回调（点击后打开文档库选择弹窗） */
  onOpenLibrary?: () => void;
  /** 已上传的文件信息（null 表示未上传） */
  uploadedFile?: DocumentChatUploadResponse | null;
  /** 清除已上传文件回调 */
  onClearFile?: () => void;
  /** 是否正在上传文件 */
  uploading?: boolean;
  /** 上传进度（0-100） */
  uploadProgress?: number;
}

/** 最大输入字符数（对齐后端 question max_length=2000） */
const MAX_LENGTH = 2000;

/** textarea 最小/最大高度（行） */
const MIN_ROWS = 1;
const MAX_ROWS = 6;

/** 支持的文件类型 */
const ACCEPTED_TYPES = ".pdf,.docx,.md,.txt";

/** 最大文件大小：10MB */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** ChatInput 组件 */
export function ChatInput({
  streaming,
  onSend,
  onStop,
  onFileSelect,
  onOpenLibrary,
  uploadedFile,
  onClearFile,
  uploading = false,
  uploadProgress = 0,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const [isComposing, setIsComposing] = useState(false); // D5-01 IME 输入法组合状态
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** 自适应高度：根据内容调整 textarea 行数 */
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // 重置高度以重新计算
    textarea.style.height = "auto";

    // 计算行数并限制在 MIN_ROWS ~ MAX_ROWS 之间
    const lineHeight = 24; // h-10 对应约 24px 行高
    const rows = Math.min(
      Math.max(textarea.scrollHeight / lineHeight, MIN_ROWS),
      MAX_ROWS,
    );
    textarea.style.height = `${rows * lineHeight}px`;
  }, [value]);

  /** 发送消息 */
  function handleSend() {
    const trimmed = value.trim();
    if (!trimmed || streaming) return;

    onSend(trimmed);
    setValue("");
  }

  /** 键盘事件：Enter 发送，Shift+Enter 换行 */
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // D5-01 IME 输入法组合期间（如中文拼音输入），Enter 用于选词，不触发发送
    if (e.key === "Enter" && !e.shiftKey && !isComposing) {
      e.preventDefault();
      handleSend();
    }
  }

  /** 格式化文件大小 */
  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /** 处理文件选择 */
  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // 校验文件大小
      if (file.size > MAX_FILE_SIZE) {
        alert("文件大小不能超过 10MB");
        e.target.value = "";
        return;
      }

      onFileSelect?.(file);
      e.target.value = ""; // 重置 input，允许重复选择同一文件
    },
    [onFileSelect],
  );

  /** 处理拖拽进入 */
  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (uploading || streaming) return;
      setIsDragging(true);
    },
    [uploading, streaming],
  );

  /** 处理拖拽离开 */
  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // 仅当离开容器本身时才取消高亮（子元素切换不触发）
      if (e.currentTarget === e.target) {
        setIsDragging(false);
      }
    },
    [],
  );

  /** 处理拖拽放置 */
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      if (uploading || streaming) return;

      const file = e.dataTransfer.files?.[0];
      if (!file) return;

      // 校验文件大小
      if (file.size > MAX_FILE_SIZE) {
        alert("文件大小不能超过 10MB");
        return;
      }

      onFileSelect?.(file);
    },
    [onFileSelect, uploading, streaming],
  );

  /** 当前字符数 */
  const charCount = value.length;
  /** 是否达到上限 */
  const isOverLimit = charCount >= MAX_LENGTH;
  /** 是否可以发送 */
  const canSend = value.trim().length > 0 && !streaming && !isOverLimit;
  /** 是否在文档对话模式 */
  const inDocMode = !!uploadedFile;

  return (
    <div className="border-t border-line bg-surface px-4 py-3">
      <div className="mx-auto max-w-3xl">
        {/* 已上传文件信息 / 上传进度 */}
        {(uploadedFile || uploading) && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-line bg-muted/30 px-3 py-2">
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand" />
                <span className="flex-1 text-xs text-ink-secondary">
                  正在上传解析... {uploadProgress > 0 && `${uploadProgress}%`}
                </span>
              </>
            ) : (
              <>
                <FileText className="h-4 w-4 shrink-0 text-brand" />
                <span className="flex-1 truncate text-xs text-ink-secondary">
                  {uploadedFile!.file_name}
                  <span className="ml-2 text-ink-tertiary">
                    {formatFileSize(uploadedFile!.file_size)} ·{" "}
                    {uploadedFile!.char_count.toLocaleString()} 字符
                  </span>
                  {uploadedFile!.truncated && (
                    <span className="ml-2 text-warning">（已截断）</span>
                  )}
                </span>
              </>
            )}
            {!uploading && onClearFile && (
              <button
                onClick={onClearFile}
                className="shrink-0 rounded p-0.5 text-ink-tertiary hover:bg-muted hover:text-danger"
                aria-label="移除文档"
                title="移除文档，恢复知识库问答模式"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}

        <div
          className={cn(
            "relative flex items-end gap-2 rounded-lg border bg-surface px-3 py-2",
            "transition-colors",
            isDragging
              ? "border-brand bg-brand/5 ring-2 ring-brand/20"
              : isOverLimit
                ? "border-danger"
                : "border-line focus-within:border-brand",
          )}
          onDragEnter={handleDragEnter}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* 文档上传按钮 + 文档库选择按钮 */}
          {!inDocMode && !uploading && (
            <>
              {/* 上传新文件 */}
              {onFileSelect && (
                <>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={streaming || uploading}
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                      "transition-colors",
                      "text-ink-tertiary hover:bg-muted hover:text-brand",
                      "disabled:cursor-not-allowed disabled:opacity-40",
                    )}
                    aria-label="上传文档"
                    title="上传新文档进行对话（PDF/DOCX/MD/TXT，最大 10MB）"
                  >
                    <Paperclip className="h-4 w-4" />
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPTED_TYPES}
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </>
              )}

              {/* 从文档库选择已处理文档 */}
              {onOpenLibrary && (
                <button
                  onClick={onOpenLibrary}
                  disabled={streaming || uploading}
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                    "transition-colors",
                    "text-ink-tertiary hover:bg-muted hover:text-brand",
                    "disabled:cursor-not-allowed disabled:opacity-40",
                  )}
                  aria-label="从文档库选择"
                  title="从文档库选择已处理完成的文档进行对话"
                >
                  <Library className="h-4 w-4" />
                </button>
              )}
            </>
          )}

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              // 限制最大字符数
              if (e.target.value.length <= MAX_LENGTH) {
                setValue(e.target.value);
              }
            }}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            onKeyDown={handleKeyDown}
            placeholder={
              inDocMode
                ? "针对文档内容提问（翻译、总结、解释等）..."
                : isDragging
                  ? "松开以上传文件..."
                  : "输入您的问题..."
            }
            disabled={streaming}
            rows={MIN_ROWS}
            className={cn(
              "flex-1 resize-none bg-transparent text-sm text-ink",
              "placeholder:text-ink-tertiary",
              "focus:outline-none",
              "disabled:cursor-not-allowed disabled:opacity-60",
            )}
          />

          {/* 发送/停止按钮 */}
          {streaming ? (
            <button
              onClick={onStop}
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                "bg-danger text-white transition-colors hover:bg-red-700",
              )}
              aria-label="停止生成"
              title="停止生成"
            >
              <Square className="h-3.5 w-3.5" fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!canSend}
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                "transition-colors",
                canSend
                  ? "bg-brand text-white hover:bg-brand-hover"
                  : "cursor-not-allowed bg-muted text-ink-tertiary",
              )}
              aria-label="发送消息"
              title="发送消息 (Enter)"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* 底部提示行 */}
        <div className="mt-1.5 flex items-center justify-between px-1">
          <p className="text-xs text-ink-tertiary">
            {inDocMode
              ? "文档对话模式 · Enter 发送"
              : "Enter 发送 · Shift+Enter 换行 · 📎上传文件 / 📚从文档库选择"}
          </p>
          <p
            className={cn(
              "text-xs",
              isOverLimit ? "text-danger" : "text-ink-tertiary",
            )}
          >
            {charCount} / {MAX_LENGTH}
          </p>
        </div>
      </div>
    </div>
  );
}
