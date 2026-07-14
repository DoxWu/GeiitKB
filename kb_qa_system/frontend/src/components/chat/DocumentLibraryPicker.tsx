/**
 * 文档库选择器弹窗
 *
 * 作用：
 *   在聊天页面中，让用户从个人文档库/公共文档库中选择已处理完成的文档，
 *   复用其已清洗的全文内容进行文档对话，无需重新上传。
 *
 * 功能：
 *   - 弹窗形式展示文档列表（仅 status=completed）
 *   - 支持按标题搜索
 *   - 显示文件图标、名称、大小、质量分
 *   - 分页加载更多
 *   - 点击文档即触发选择回调
 *
 * 使用方式：
 *   <DocumentLibraryPicker
 *     open={isOpen}
 *     onClose={() => setOpen(false)}
 *     onSelect={(docId) => handleSelect(docId)}
 *   />
 */

import { useState, useEffect, useCallback } from "react";
import { Search, Loader2, FileText } from "lucide-react";
import { Modal, Spinner, EmptyState } from "@/components/common";
import { cn } from "@/lib/utils";
import { getFileIcon } from "@/utils/fileType";
import { getDocuments } from "@/api/document";
import type { DocumentResponse } from "@/types/document";

/** DocumentLibraryPicker 组件属性 */
interface DocumentLibraryPickerProps {
  /** 是否打开 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 选择文档回调（传入 document_id） */
  onSelect: (documentId: number) => void;
}

/** 每页加载文档数量 */
const PAGE_SIZE = 20;

/** DocumentLibraryPicker 组件 */
export function DocumentLibraryPicker({
  open,
  onClose,
  onSelect,
}: DocumentLibraryPickerProps) {
  /** 文档列表 */
  const [documents, setDocuments] = useState<DocumentResponse[]>([]);
  /** 加载中 */
  const [loading, setLoading] = useState(false);
  /** 加载更多中 */
  const [loadingMore, setLoadingMore] = useState(false);
  /** 搜索关键词 */
  const [searchTerm, setSearchTerm] = useState("");
  /** 当前页码 */
  const [page, setPage] = useState(1);
  /** 总数 */
  const [total, setTotal] = useState(0);
  /** 错误信息 */
  const [error, setError] = useState<string | null>(null);

  /** 是否还有更多 */
  const hasMore = documents.length < total;

  /** 格式化文件大小 */
  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /** 加载文档列表（首页） */
  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getDocuments({
        status: "completed",
        scope: "accessible",
        search: searchTerm.trim() || undefined,
        page: 1,
        page_size: PAGE_SIZE,
        sort_by: "updated_at",
        sort_order: "desc",
      });
      setDocuments(response.items);
      setTotal(response.total);
      setPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载文档列表失败");
    } finally {
      setLoading(false);
    }
  }, [searchTerm]);

  /** 加载更多 */
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const response = await getDocuments({
        status: "completed",
        scope: "accessible",
        search: searchTerm.trim() || undefined,
        page: nextPage,
        page_size: PAGE_SIZE,
        sort_by: "updated_at",
        sort_order: "desc",
      });
      setDocuments((prev) => [...prev, ...response.items]);
      setPage(nextPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载更多失败");
    } finally {
      setLoadingMore(false);
    }
  }, [page, hasMore, loadingMore, searchTerm]);

  // 弹窗打开时加载文档列表
  useEffect(() => {
    if (open) {
      loadDocuments();
    }
  }, [open, loadDocuments]);

  /** 处理文档选择 */
  function handleSelect(doc: DocumentResponse) {
    onSelect(doc.id);
    onClose();
  }

  /** 处理搜索输入 */
  function handleSearchChange(value: string) {
    setSearchTerm(value);
  }

  /** 搜索防抖：输入停止 500ms 后自动搜索 */
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      loadDocuments();
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="从文档库选择文档"
      bodyClassName="p-0"
    >
      {/* 搜索栏 */}
      <div className="border-b border-line px-4 py-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-tertiary" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="搜索文档标题..."
            className={cn(
              "w-full rounded-md border border-line bg-surface py-2 pl-9 pr-3",
              "text-sm text-ink placeholder:text-ink-tertiary",
              "focus:border-brand focus:outline-none",
            )}
            autoFocus
          />
        </div>
      </div>

      {/* 文档列表 */}
      <div className="max-h-[400px] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner className="h-6 w-6 text-brand" />
          </div>
        ) : error ? (
          <div className="px-4 py-8 text-center text-sm text-danger">
            {error}
            <button
              onClick={loadDocuments}
              className="mt-2 block w-full text-brand hover:underline"
            >
              点击重试
            </button>
          </div>
        ) : documents.length === 0 ? (
          <EmptyState
            icon={<FileText className="h-6 w-6" />}
            title={searchTerm ? "未找到匹配的文档" : "暂无可用文档"}
            description={
              searchTerm
                ? "尝试更换搜索关键词"
                : "文档库中暂无已处理完成的文档，请先上传并等待处理完成"
            }
            className="py-8"
          />
        ) : (
          <>
            {documents.map((doc) => {
              const IconComp = getFileIcon(doc.file_type);
              return (
                <button
                  key={doc.id}
                  onClick={() => handleSelect(doc)}
                  className={cn(
                    "flex w-full items-center gap-3 border-b border-line px-4 py-3",
                    "text-left transition-colors hover:bg-muted/50",
                  )}
                >
                  {/* 文件类型图标 */}
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                    <IconComp className="h-4 w-4 text-brand" />
                  </div>

                  {/* 文档信息 */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">
                      {doc.title || doc.file_name}
                    </p>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-tertiary">
                      <span>{doc.file_type}</span>
                      <span>·</span>
                      <span>{formatFileSize(doc.file_size)}</span>
                      {doc.chunk_count > 0 && (
                        <>
                          <span>·</span>
                          <span>{doc.chunk_count} 块</span>
                        </>
                      )}
                      {doc.visibility === "public" && (
                        <>
                          <span>·</span>
                          <span className="text-brand">公共库</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* 质量分 */}
                  {doc.quality_score !== null && doc.quality_score > 0 && (
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-xs",
                        doc.quality_score >= 70
                          ? "bg-green-50 text-success"
                          : doc.quality_score >= 40
                            ? "bg-amber-50 text-warning"
                            : "bg-red-50 text-danger",
                      )}
                    >
                      {Math.round(doc.quality_score)}分
                    </span>
                  )}
                </button>
              );
            })}

            {/* 加载更多 */}
            {hasMore && (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className={cn(
                  "flex w-full items-center justify-center gap-2 py-3",
                  "text-sm text-brand hover:bg-muted/50",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                )}
              >
                {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
                {loadingMore ? "加载中..." : "加载更多"}
              </button>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
