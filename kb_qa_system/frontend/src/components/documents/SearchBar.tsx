/**
 * 搜索框组件
 *
 * 作用：
 *   提供文件名实时搜索功能，支持模糊匹配。
 *   输入时防抖触发搜索（300ms），避免频繁请求。
 *
 * 使用方式：
 *   <SearchBar />
 */

import { useState, useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import { useDocumentStore } from "@/store/documentStore";
import { cn } from "@/lib/utils";

/** 防抖延迟（毫秒） */
const DEBOUNCE_DELAY = 300;

/** SearchBar 组件 */
export function SearchBar() {
  const { searchKeyword, setSearchKeyword, loadDocuments } = useDocumentStore();
  const [value, setValue] = useState(searchKeyword);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 输入变化时防抖触发搜索
  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    // 同步关键词到 store
    setSearchKeyword(value);
    // 防抖加载文档列表
    timerRef.current = setTimeout(() => {
      loadDocuments();
    }, DEBOUNCE_DELAY);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  /** 清空搜索 */
  function handleClear() {
    setValue("");
  }

  return (
    <div className="relative flex-1 max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-tertiary" />
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="搜索文件名..."
        className={cn(
          "h-9 w-full rounded-md border border-line bg-surface pl-9 pr-9",
          "text-sm text-ink placeholder:text-ink-tertiary",
          "focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand",
          "transition-colors",
        )}
      />
      {value && (
        <button
          onClick={handleClear}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-tertiary transition-colors hover:bg-muted hover:text-ink"
          aria-label="清空搜索"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
