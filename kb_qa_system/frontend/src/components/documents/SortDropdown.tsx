/**
 * 排序下拉菜单组件
 *
 * 作用：
 *   提供多维度排序功能，支持按创建时间、修改时间、文件名称、文件类型排序，
 *   每个字段支持升序/降序切换。
 *
 * 使用方式：
 *   <SortDropdown />
 */

import { useState, useRef, useEffect } from "react";
import { ArrowDownUp, ChevronDown, Check, ArrowUp, ArrowDown } from "lucide-react";
import { useDocumentStore } from "@/store/documentStore";
import { SORT_OPTIONS } from "@/utils/constants";
import { cn } from "@/lib/utils";
import type { SortField, SortOrder } from "@/types/document";

/** SortDropdown 组件 */
export function SortDropdown() {
  const { sortBy, sortOrder, setSort } = useDocumentStore();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭下拉
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  /** 当前排序字段的中文标签 */
  const currentLabel =
    SORT_OPTIONS.find((opt) => opt.field === sortBy)?.label ?? "排序";

  /** 选择排序字段（点击同字段时切换升降序） */
  function handleSelect(field: SortField) {
    if (field === sortBy) {
      // 同字段：切换升降序
      setSort(field, sortOrder === "asc" ? "desc" : "asc");
    } else {
      // 新字段：默认降序
      setSort(field, "desc");
    }
    setOpen(false);
  }

  /** 切换升降序 */
  function toggleOrder(e: React.MouseEvent) {
    e.stopPropagation();
    setSort(sortBy, sortOrder === "asc" ? "desc" : "asc");
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3",
          "text-sm text-ink-secondary transition-colors hover:bg-muted",
        )}
      >
        <ArrowDownUp className="h-3.5 w-3.5" />
        <span>{currentLabel}</span>
        {/* 升降序指示器 */}
        <button
          onClick={toggleOrder}
          className="ml-0.5 rounded p-0.5 hover:bg-line"
          aria-label={sortOrder === "asc" ? "切换为降序" : "切换为升序"}
          title={sortOrder === "asc" ? "升序" : "降序"}
        >
          {sortOrder === "asc" ? (
            <ArrowUp className="h-3.5 w-3.5" />
          ) : (
            <ArrowDown className="h-3.5 w-3.5" />
          )}
        </button>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {/* 下拉菜单 */}
      {open && (
        <div className="absolute right-0 top-10 z-30 w-40 rounded-md border border-line bg-surface py-1 shadow-lg animate-fade-in">
          {SORT_OPTIONS.map((option) => (
            <button
              key={option.field}
              onClick={() => handleSelect(option.field)}
              className={cn(
                "flex w-full items-center justify-between px-3 py-1.5 text-sm transition-colors",
                option.field === sortBy
                  ? "bg-brand-light text-brand"
                  : "text-ink-secondary hover:bg-muted hover:text-ink",
              )}
            >
              <span>{option.label}</span>
              {option.field === sortBy && (
                <Check className="h-3.5 w-3.5" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
