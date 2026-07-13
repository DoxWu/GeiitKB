/**
 * 打字指示器组件
 *
 * 作用：
 *   在流式输出等待首个文本块时显示"思考中......"加载状态，
 *   向用户传达"AI 正在处理请求"的明确视觉反馈。
 *
 *   任务1优化：原实现仅显示 3 个跳动圆点，无文字提示，用户感知不明确
 *              （推理模型首字延迟可达 10-30 秒）。现新增"思考中......"
 *              脉动文字，让用户明确感知系统正在处理。
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
      className={cn("flex items-center gap-2", className)}
      aria-label="AI 正在思考"
      role="status"
    >
      {/* 跳动圆点动画组 */}
      <div className="flex items-center gap-1">
        <span className="h-2 w-2 animate-bounce rounded-full bg-ink-tertiary [animation-delay:-0.3s]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-ink-tertiary [animation-delay:-0.15s]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-ink-tertiary [animation-delay:0s]" />
      </div>
      {/* 任务1：新增"思考中......"脉动文字提示 */}
      {/* 作用：让用户明确感知 AI 正在处理，而非界面卡死 */}
      <span className="text-xs text-ink-tertiary animate-pulse">思考中......</span>
    </div>
  );
}
