/**
 * 徽章组件
 *
 * 作用：
 *   用于显示状态标签、计数等小尺寸信息标记。
 *   支持自定义颜色样式。
 *
 * 使用方式：
 *   <Badge variant="success">已完成</Badge>
 *   <Badge className="bg-brand-light text-brand">自定义</Badge>
 */

import { cn } from "@/lib/utils";

/** 徽章变体 */
type BadgeVariant =
  | "default"
  | "success"
  | "warning"
  | "danger"
  | "brand"
  | "info";

/** Badge 组件属性 */
interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

/** 变体样式映射 */
const variantStyles: Record<BadgeVariant, string> = {
  default: "bg-muted text-ink-secondary",
  success: "bg-green-50 text-success",
  warning: "bg-amber-50 text-warning",
  danger: "bg-red-50 text-danger",
  brand: "bg-brand-light text-brand",
  info: "bg-blue-50 text-blue-600",
};

/** Badge 组件 */
export function Badge({
  variant = "default",
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
        variantStyles[variant],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
