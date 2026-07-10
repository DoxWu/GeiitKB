/**
 * 加载指示器组件
 *
 * 作用：
 *   显示旋转加载动画，用于按钮加载、数据请求等场景。
 *
 * 使用方式：
 *   <Spinner size="md" />
 *   <Spinner className="text-brand" />
 */

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Spinner 尺寸 */
type SpinnerSize = "sm" | "md" | "lg";

/** Spinner 组件属性 */
interface SpinnerProps {
  /** 尺寸 */
  size?: SpinnerSize;
  /** 自定义类名 */
  className?: string;
}

/** 尺寸映射 */
const sizeStyles: Record<SpinnerSize, string> = {
  sm: "h-4 w-4",
  md: "h-6 w-6",
  lg: "h-8 w-8",
};

/** Spinner 组件 */
export function Spinner({ size = "md", className }: SpinnerProps) {
  return (
    <Loader2
      role="status"
      aria-label="加载中"
      className={cn(
        "animate-spin text-ink-tertiary",
        sizeStyles[size],
        className,
      )}
    />
  );
}

/**
 * 全屏加载遮罩
 *
 * 作用：页面级加载状态，居中显示 Spinner。
 */
export function FullScreenSpinner({ text }: { text?: string }) {
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-3"
      role="status"
      aria-live="polite"
      aria-label={text || "页面加载中"}
    >
      <Spinner size="lg" className="text-brand" />
      {text && <p className="text-sm text-ink-secondary">{text}</p>}
    </div>
  );
}
