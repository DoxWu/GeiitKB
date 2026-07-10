/**
 * 错误状态组件
 *
 * 作用：
 *   当请求失败或发生错误时显示错误提示，提供重试按钮。
 *
 * 使用方式：
 *   <ErrorState message="加载文档失败" onRetry={handleRetry} />
 */

import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "./Button";
import { cn } from "@/lib/utils";

/** ErrorState 组件属性 */
interface ErrorStateProps {
  /** 错误信息 */
  message?: string;
  /** 重试回调 */
  onRetry?: () => void;
  /** 自定义类名 */
  className?: string;
}

/** ErrorState 组件 */
export function ErrorState({
  message = "发生错误，请重试",
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 py-16 text-center",
        className,
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-danger">
        <AlertCircle className="h-6 w-6" />
      </div>
      <p className="text-sm text-ink-secondary">{message}</p>
      {onRetry && (
        <Button
          variant="secondary"
          size="sm"
          icon={<RefreshCw className="h-3.5 w-3.5" />}
          onClick={onRetry}
        >
          重试
        </Button>
      )}
    </div>
  );
}
