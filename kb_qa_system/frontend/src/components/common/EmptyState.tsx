/**
 * 空状态组件
 *
 * 作用：
 *   当列表或内容为空时显示友好提示，引导用户操作。
 *
 * 使用方式：
 *   <EmptyState
 *     icon={<FileText />}
 *     title="暂无文档"
 *     description="上传您的第一份文档开始管理"
 *     action={<Button>上传文档</Button>}
 *   />
 */

import { cn } from "@/lib/utils";

/** EmptyState 组件属性 */
interface EmptyStateProps {
  /** 图标 */
  icon?: React.ReactNode;
  /** 标题 */
  title: string;
  /** 描述文字 */
  description?: string;
  /** 操作按钮 */
  action?: React.ReactNode;
  /** 自定义类名 */
  className?: string;
}

/** EmptyState 组件 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 py-16 text-center",
        className,
      )}
    >
      {icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-ink-tertiary">
          {icon}
        </div>
      )}
      <div className="space-y-1">
        <p className="text-sm font-medium text-ink">{title}</p>
        {description && (
          <p className="text-xs text-ink-secondary">{description}</p>
        )}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
