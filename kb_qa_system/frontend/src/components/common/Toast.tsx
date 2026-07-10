/**
 * Toast 通知容器组件
 *
 * 作用：
 *   全局渲染 Toast 通知列表，固定在右上角。
 *   消费 toastStore 中的状态，自动渲染和移除。
 *
 * 使用方式：
 *   在 App 根组件中渲染一次：<ToastContainer />
 *   在任意位置触发：useToastStore.getState().success('操作成功')
 */

import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  X,
} from "lucide-react";
import { useToastStore } from "@/store/toastStore";
import type { ToastType } from "@/types/api";
import { cn } from "@/lib/utils";

/** Toast 类型配置（图标和颜色） */
const toastConfig: Record<
  ToastType,
  { icon: React.ReactNode; className: string }
> = {
  success: {
    icon: <CheckCircle2 className="h-5 w-5 text-success" />,
    className: "border-l-success",
  },
  error: {
    icon: <XCircle className="h-5 w-5 text-danger" />,
    className: "border-l-danger",
  },
  warning: {
    icon: <AlertTriangle className="h-5 w-5 text-warning" />,
    className: "border-l-warning",
  },
  info: {
    icon: <Info className="h-5 w-5 text-blue-500" />,
    className: "border-l-blue-500",
  },
};

/** Toast 容器组件 */
export function ToastContainer() {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed right-4 top-4 z-[100] flex flex-col gap-2"
      role="region"
      aria-label="通知区域"
    >
      {toasts.map((toast) => {
        const config = toastConfig[toast.type];
        // 错误类通知使用 alert role，其余使用 status role
        // 作用：屏幕阅读器对 alert 会立即播报，对 status 会礼貌播报
        const ariaRole = toast.type === "error" ? "alert" : "status";
        return (
          <div
            key={toast.id}
            role={ariaRole}
            aria-live={toast.type === "error" ? "assertive" : "polite"}
            className={cn(
              "flex items-start gap-3 rounded-lg border border-line border-l-4 bg-surface p-4 shadow-lg",
              "min-w-[320px] max-w-md animate-slide-in-right",
              config.className,
            )}
          >
            <div className="shrink-0">{config.icon}</div>
            <div className="flex-1">
              <p className="text-sm font-medium text-ink">{toast.title}</p>
              {toast.description && (
                <p className="mt-0.5 text-xs text-ink-secondary">
                  {toast.description}
                </p>
              )}
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="shrink-0 rounded p-0.5 text-ink-tertiary transition-colors hover:bg-muted hover:text-ink"
              aria-label="关闭通知"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
