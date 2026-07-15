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

import { useState } from "react";
import { Bot, AlertTriangle, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types/chat";
import { SourceCard } from "./SourceCard";
import { TypingIndicator } from "./TypingIndicator";
import { MarkdownRenderer } from "./MarkdownRenderer";

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
  // 检索结果默认折叠：确保用户优先查看 LLM 生成的回答内容，
  // 仅在用户主动点击展开时才显示完整的检索结果列表。
  const [sourcesExpanded, setSourcesExpanded] = useState(false);

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
          ) : message.content ? (
            isUser ? (
              <p className="whitespace-pre-wrap break-words">{message.content}</p>
            ) : (
              <MarkdownRenderer content={message.content} />
            )
          ) : (
            // 修复：内容为空时（如 LLM 失败的 fallback 消息）显示占位提示，
            // 避免出现空白气泡让用户困惑
            <p className="whitespace-pre-wrap break-words text-ink-tertiary italic">
              {message.is_degraded
                ? "智能体未能生成回复，请参考上方提示或重试。"
                : "（空回复）"}
            </p>
          )}
        </div>

        {/* 检索结果（仅 AI 消息有 sources 时显示）
            默认折叠为"检索到 N 个检索结果"的可点击面板，
            仅在用户主动点击展开时才显示完整的检索结果列表，
            确保用户优先查看 LLM 生成的回答内容。 */}
        {!isUser && sources.length > 0 && (
          <div className="w-full">
            <button
              type="button"
              onClick={() => setSourcesExpanded((prev) => !prev)}
              aria-expanded={sourcesExpanded}
              className="flex w-full items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-secondary transition-colors hover:border-brand/30 hover:text-ink"
            >
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 shrink-0 text-ink-tertiary transition-transform duration-200",
                  sourcesExpanded && "rotate-180",
                )}
              />
              <span>检索到 {sources.length} 个检索结果</span>
            </button>
            {sourcesExpanded && (
              <div className="mt-1.5 space-y-1.5">
                {sources.map((source, index) => (
                  <SourceCard key={index} source={source} />
                ))}
              </div>
            )}
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
