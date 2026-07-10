/**
 * 分页控件组件
 *
 * 作用：
 *   提供文档列表的分页导航，支持上一页/下一页和页码跳转。
 *   当文档总数超过每页数量时显示，否则不渲染。
 *
 * 使用方式：
 *   <Pagination
 *     current={1}
 *     pageSize={20}
 *     total={85}
 *     onChange={(page) => setPage(page)}
 *   />
 *
 * 设计说明：
 *   - 最多显示 7 个页码按钮（首尾 + 当前页 ± 2 + 省略号）
 *   - 首页/末页始终可见
 *   - 当前页高亮显示
 *   - 在首页时禁用"上一页"，在末页时禁用"下一页"
 */

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Pagination 组件属性 */
interface PaginationProps {
  /** 当前页码（从 1 开始） */
  current: number;
  /** 每页数量 */
  pageSize: number;
  /** 总记录数 */
  total: number;
  /** 页码变化回调 */
  onChange: (page: number) => void;
}

/**
 * 计算需要显示的页码列表
 *
 * 策略：始终显示首页和末页，当前页前后各显示 2 页，
 * 中间用省略号（-1 表示）连接。
 *
 * @param current - 当前页码
 * @param totalPages - 总页数
 * @returns 页码数组（-1 表示省略号）
 */
function getPageNumbers(current: number, totalPages: number): number[] {
  // 总页数 ≤ 7：显示全部页码
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const pages: number[] = [1]; // 首页

  // 当前页附近的页码范围
  const left = Math.max(2, current - 1);
  const right = Math.min(totalPages - 1, current + 1);

  // 左侧省略号
  if (left > 2) {
    pages.push(-1);
  }

  // 中间页码
  for (let i = left; i <= right; i++) {
    pages.push(i);
  }

  // 右侧省略号
  if (right < totalPages - 1) {
    pages.push(-1);
  }

  pages.push(totalPages); // 末页
  return pages;
}

/** Pagination 组件 */
export function Pagination({
  current,
  pageSize,
  total,
  onChange,
}: PaginationProps) {
  // 计算总页数
  const totalPages = Math.ceil(total / pageSize);

  // 总页数 ≤ 1 时不渲染
  if (totalPages <= 1) {
    return null;
  }

  const pages = getPageNumbers(current, totalPages);
  const isFirst = current === 1;
  const isLast = current === totalPages;

  /** 跳转到指定页 */
  function goTo(page: number): void {
    if (page < 1 || page > totalPages || page === current) return;
    onChange(page);
  }

  return (
    <nav
      className="mt-6 flex items-center justify-center gap-1"
      aria-label="文档分页"
    >
      {/* 上一页按钮 */}
      <button
        onClick={() => goTo(current - 1)}
        disabled={isFirst}
        aria-label="上一页"
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-surface transition-colors",
          isFirst
            ? "cursor-not-allowed text-ink-tertiary opacity-50"
            : "text-ink-secondary hover:bg-muted hover:text-ink",
        )}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      {/* 页码按钮 */}
      {pages.map((page, index) => {
        // 省略号
        if (page === -1) {
          return (
            <span
              key={`ellipsis-${index}`}
              className="inline-flex h-8 w-8 items-center justify-center text-sm text-ink-tertiary"
            >
              …
            </span>
          );
        }

        // 页码
        const isActive = page === current;
        return (
          <button
            key={page}
            onClick={() => goTo(page)}
            aria-label={`第 ${page} 页`}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-sm font-medium transition-colors",
              isActive
                ? "border-brand bg-brand text-white"
                : "border-line bg-surface text-ink-secondary hover:bg-muted hover:text-ink",
            )}
          >
            {page}
          </button>
        );
      })}

      {/* 下一页按钮 */}
      <button
        onClick={() => goTo(current + 1)}
        disabled={isLast}
        aria-label="下一页"
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-surface transition-colors",
          isLast
            ? "cursor-not-allowed text-ink-tertiary opacity-50"
            : "text-ink-secondary hover:bg-muted hover:text-ink",
        )}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </nav>
  );
}
