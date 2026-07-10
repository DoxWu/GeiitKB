/**
 * 消息气泡组件
 *
 * 作用：
 *   渲染单条聊天消息，区分用户消息和 AI 消息：
 *   - 用户消息：右对齐，brand 背景色，白色文字
 *   - AI 消息：左对齐，surface 背景色，带 AI 头像
 *   支持显示降级标记、引用来源、流式输出状态。
 *
 * 使用方式：
 *   <MessageBubble message={chatMessage} />
 *   <MessageBubble message={tempMessage} streaming={true} />
 */

import { Bot, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types/chat";
import { SourceCard } from "./SourceCard";
import { TypingIndicator } from "./TypingIndicator";

/** MessageBubble 组件属性 */
interface MessageBubbleProps {
  /** 消息数据 */
  message: ChatMessage;
  /** 是否为流式输出中的临时消息 */
  streaming?: boolean;
}

/** MessageBubble 组件 */
export function MessageBubble({
  message,
  streaming = false,
}: MessageBubbleProps) {
  const isUser = message.role === "user";
  const sources = message.sources || [];
  const showTypingIndicator = streaming && !message.content;

  return (
    <div
      className={cn(
        "flex gap-2",
        isUser ? "flex-row-reverse" : "flex-row",
      )}
    >
      {/* 头像（仅 AI 消息显示） */}
      {!isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-light text-brand">
          <Bot className="h-4 w-4" />
        </div>
      )}

      {/* 消息内容区 */}
      <div
        className={cn(
          "flex max-w-[80%] flex-col gap-1.5",
          isUser ? "items-end" : "items-start",
        )}
      >
        {/* 降级标记 */}
        {message.is_degraded && (
          <div className="flex items-center gap-1 text-xs text-warning">
            <AlertTriangle className="h-3 w-3" />
            <span>
              降级回复
              {message.degrade_reason ? ` · ${message.degrade_reason}` : ""}
            </span>
          </div>
        )}

        {/* 消息气泡 */}
        <div
          className={cn(
            "rounded-lg px-3 py-2 text-sm leading-relaxed",
            isUser
              ? "bg-brand text-white"
              : "border border-line bg-surface text-ink",
          )}
        >
          {showTypingIndicator ? (
            <TypingIndicator />
          ) : (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          )}
        </div>

        {/* 引用来源（仅 AI 消息有 sources 时显示） */}
        {!isUser && sources.length > 0 && (
          <div className="w-full space-y-1.5">
            <p className="text-xs font-medium text-ink-tertiary">
              引用来源（{sources.length}）
            </p>
            {sources.map((source, index) => (
              <SourceCard key={index} source={source} />
            ))}
          </div>
        )}

        {/* 时间戳 */}
        {!streaming && (
          <span className="text-xs text-ink-tertiary">
            {formatTime(message.created_at)}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * 格式化时间显示
 * @param isoString - ISO 8601 时间字符串
 * @returns HH:MM 格式的时间
 */
function formatTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}
