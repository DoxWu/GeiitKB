/**
 * 骨架屏组件
 *
 * 作用：
 *   数据加载时显示灰色占位块，避免布局抖动。
 *   支持自定义尺寸和圆角。
 *
 * 使用方式：
 *   <Skeleton className="h-4 w-full" />
 *   <Skeleton className="h-12 w-12 rounded-full" />
 */

import { cn } from "@/lib/utils";

/** Skeleton 组件属性 */
interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 是否为圆形 */
  circle?: boolean;
}

/** Skeleton 组件 */
export function Skeleton({ className, circle, ...props }: SkeletonProps) {
  return (
    <div
      className={cn(
        "animate-pulse bg-muted",
        circle ? "rounded-full" : "rounded-md",
        className,
      )}
      {...props}
    />
  );
}

/**
 * 文档列表骨架屏
 *
 * 作用：文档列表加载时显示的骨架占位。
 */
export function DocumentListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-lg border border-line bg-surface p-4"
        >
          <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-6 w-16 rounded-md" />
        </div>
      ))}
    </div>
  );
}

/**
 * 聊天消息骨架屏（E5-01）
 *
 * 作用：聊天消息加载时显示的骨架占位。
 */
export function ChatMessageSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={`flex gap-3 ${i % 2 === 0 ? "justify-start" : "justify-end"}`}
        >
          {i % 2 === 0 && <Skeleton circle className="h-8 w-8 shrink-0" />}
          <div className="max-w-[70%] space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
          {i % 2 !== 0 && <Skeleton circle className="h-8 w-8 shrink-0" />}
        </div>
      ))}
    </div>
  );
}

/**
 * 设置页骨架屏（E5-01）
 *
 * 作用：设置页加载时显示的骨架占位。
 */
export function SettingsSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      {/* 快捷功能区 */}
      <div className="rounded-lg border border-line bg-surface p-5">
        <Skeleton className="mb-4 h-4 w-24" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-16 w-full rounded-md" />
          <Skeleton className="h-16 w-full rounded-md" />
        </div>
      </div>
      {/* 账号信息区 */}
      <div className="rounded-lg border border-line bg-surface p-5">
        <Skeleton className="mb-4 h-4 w-20" />
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton circle className="h-9 w-9" />
              <div className="flex-1 space-y-1">
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-4 w-32" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
