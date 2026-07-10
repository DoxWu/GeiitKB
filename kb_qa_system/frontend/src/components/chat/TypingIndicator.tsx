/**
 * 打字指示器组件
 *
 * 作用：
 *   在流式输出等待首个文本块时显示三个跳动的圆点动画，
 *   向用户传达"AI 正在思考"的视觉反馈。
 *
 * 使用方式：
 *   <TypingIndicator />
 */

import { cn } from "@/lib/utils";

/** TypingIndicator 组件属性 */
interface TypingIndicatorProps {
  /** 自定义类名 */
  className?: string;
}

/** TypingIndicator 组件 */
export function TypingIndicator({ className }: TypingIndicatorProps) {
  return (
    <div
      className={cn("flex items-center gap-1", className)}
      aria-label="AI 正在输入"
      role="status"
    >
      <span className="h-2 w-2 animate-bounce rounded-full bg-ink-tertiary [animation-delay:-0.3s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-ink-tertiary [animation-delay:-0.15s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-ink-tertiary [animation-delay:0s]" />
    </div>
  );
}
