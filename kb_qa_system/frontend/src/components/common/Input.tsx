/**
 * 输入框组件
 *
 * 作用：
 *   提供统一风格的文本输入框，支持标签、错误提示、图标。
 *   遵循设计风格：圆角边框、聚焦强调色。
 *
 * 使用方式：
 *   <Input
 *     label="邮箱"
 *     type="email"
 *     error={errors.email}
 *     icon={<Mail className="h-4 w-4" />}
 *   />
 */

import { forwardRef } from "react";
import { cn } from "@/lib/utils";

/** Input 组件属性 */
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** 标签文本 */
  label?: string;
  /** 错误信息（有值时显示红色错误样式） */
  error?: string;
  /** 左侧图标 */
  icon?: React.ReactNode;
  /** 右侧图标（如密码可见切换） */
  rightIcon?: React.ReactNode;
  /** 辅助说明 */
  hint?: string;
}

/** Input 组件 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, icon, rightIcon, hint, className, id, ...props }, ref) => {
    const inputId = id || props.name;

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="mb-1.5 block text-sm font-medium text-ink"
          >
            {label}
          </label>
        )}
        <div className="relative">
          {icon && (
            <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-tertiary">
              {icon}
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            className={cn(
              "h-10 w-full rounded-lg border bg-surface px-3 text-sm text-ink",
              "placeholder:text-ink-tertiary",
              "transition-colors duration-150",
              "focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-0",
              icon && "pl-10",
              rightIcon && "pr-10",
              error
                ? "border-danger focus:ring-danger"
                : "border-line focus:border-brand",
              "disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60",
              className,
            )}
            {...props}
          />
          {rightIcon && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-tertiary">
              {rightIcon}
            </div>
          )}
        </div>
        {error ? (
          <p className="mt-1.5 text-xs text-danger">{error}</p>
        ) : hint ? (
          <p className="mt-1.5 text-xs text-ink-tertiary">{hint}</p>
        ) : null}
      </div>
    );
  },
);

Input.displayName = "Input";
