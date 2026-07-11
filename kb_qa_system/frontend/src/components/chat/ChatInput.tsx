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
 *
 * 使用方式：
 *   <ChatInput streaming={false} onSend={handleSend} onStop={handleStop} />
 */

import { useState, useRef, useEffect } from "react";
import { Send, Square } from "lucide-react";
import { cn } from "@/lib/utils";

/** ChatInput 组件属性 */
interface ChatInputProps {
  /** 是否正在流式输出 */
  streaming: boolean;
  /** 发送消息回调 */
  onSend: (message: string) => void;
  /** 停止流式输出回调 */
  onStop: () => void;
}

/** 最大输入字符数（对齐后端 question max_length=2000） */
const MAX_LENGTH = 2000;

/** textarea 最小/最大高度（行） */
const MIN_ROWS = 1;
const MAX_ROWS = 6;

/** ChatInput 组件 */
export function ChatInput({ streaming, onSend, onStop }: ChatInputProps) {
  const [value, setValue] = useState("");
  const [isComposing, setIsComposing] = useState(false); // D5-01 IME 输入法组合状态
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  /** 当前字符数 */
  const charCount = value.length;
  /** 是否达到上限 */
  const isOverLimit = charCount >= MAX_LENGTH;
  /** 是否可以发送 */
  const canSend = value.trim().length > 0 && !streaming && !isOverLimit;

  return (
    <div className="border-t border-line bg-surface px-4 py-3">
      <div className="mx-auto max-w-3xl">
        <div
          className={cn(
            "flex items-end gap-2 rounded-lg border bg-surface px-3 py-2",
            "transition-colors",
            isOverLimit
              ? "border-danger"
              : "border-line focus-within:border-brand",
          )}
        >
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
            placeholder="输入您的问题..."
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
            Enter 发送 · Shift+Enter 换行
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
