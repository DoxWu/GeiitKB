/**
 * 按钮组件
 *
 * 作用：
 *   提供统一风格的按钮，支持多种变体、尺寸和加载状态。
 *   遵循设计风格：圆角、微妙过渡、橙色强调。
 *
 * 使用方式：
 *   <Button variant="primary" size="md" onClick={handleClick}>
 *     点击我
 *   </Button>
 */

import { forwardRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** 按钮变体 */
type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

/** 按钮尺寸 */
type ButtonSize = "sm" | "md" | "lg";

/** Button 组件属性 */
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** 变体样式 */
  variant?: ButtonVariant;
  /** 尺寸 */
  size?: ButtonSize;
  /** 是否加载中（显示 spinner 并禁用） */
  loading?: boolean;
  /** 左侧图标 */
  icon?: React.ReactNode;
  /** 是否占满宽度 */
  fullWidth?: boolean;
}

/** 变体样式映射 */
const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-brand text-white hover:bg-brand-hover active:bg-brand-hover shadow-sm",
  secondary:
    "border border-line bg-surface text-ink hover:bg-muted active:bg-muted",
  ghost: "text-ink-secondary hover:bg-muted hover:text-ink",
  danger: "bg-danger text-white hover:bg-red-700 active:bg-red-700 shadow-sm",
};

/** 尺寸样式映射 */
const sizeStyles: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-base gap-2",
};

/** Button 组件 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      loading = false,
      icon,
      fullWidth = false,
      className,
      children,
      disabled,
      ...props
    },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          "inline-flex items-center justify-center rounded-lg font-medium transition-colors duration-150",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1",
          "disabled:cursor-not-allowed disabled:opacity-50",
          variantStyles[variant],
          sizeStyles[size],
          fullWidth && "w-full",
          className,
        )}
        {...props}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          icon
        )}
        {children}
      </button>
    );
  },
);

Button.displayName = "Button";
