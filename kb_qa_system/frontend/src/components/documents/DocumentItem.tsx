/**
 * 文档项组件
 *
 * 作用：
 *   渲染单个文档信息，包括文件类型图标、文件名、大小、状态、时间。
 *   支持点击预览、删除、重新处理（失败时）操作。
 *
 * 使用方式：
 *   <DocumentItem document={doc} />
 */

import {
  Trash2,
  RefreshCw,
  Eye,
  MoreVertical,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/common";
import { useDocumentStore } from "@/store/documentStore";
import { useToastStore } from "@/store/toastStore";
import { formatFileSize, formatRelativeTime, getStatusLabel } from "@/utils/format";
import { getFileIcon } from "@/utils/fileType";
import { cn } from "@/lib/utils";
import type { DocumentResponse } from "@/types/document";

/** 状态徽章变体映射 */
const STATUS_VARIANT_MAP: Record<
  string,
  "default" | "success" | "warning" | "danger" | "brand"
> = {
  pending: "default",
  processing: "brand",
  completed: "success",
  failed: "danger",
  low_quality: "warning",
};

/** DocumentItem 组件属性 */
interface DocumentItemProps {
  /** 文档数据 */
  document: DocumentResponse;
}

/** DocumentItem 组件 */
export function DocumentItem({ document }: DocumentItemProps) {
  const { openPreview, removeDocument, reprocessDocument } = useDocumentStore();
  const toast = useToastStore();
  const [menuOpen, setMenuOpen] = useState(false);

  /** 获取文件图标（使用共享 fileType 工具） */
  const IconComp = getFileIcon(document.file_type);

  /** 是否处理中（显示进度条） */
  const isProcessing = document.status === "processing";

  /** 是否处理失败（可重新处理） */
  const isFailed = document.status === "failed";

  /** 处理删除 */
  async function handleDelete() {
    setMenuOpen(false);
    if (!confirm(`确定删除文档"${document.file_name}"吗？`)) return;
    try {
      await removeDocument(document.id);
      toast.success("文档已删除");
    } catch (err) {
      toast.error("删除失败", err instanceof Error ? err.message : undefined);
    }
  }

  /** 处理重新处理 */
  async function handleReprocess() {
    setMenuOpen(false);
    try {
      await reprocessDocument(document.id);
      toast.success("已重新提交处理");
    } catch (err) {
      toast.error("操作失败", err instanceof Error ? err.message : undefined);
    }
  }

  return (
    <div
      className={cn(
        "group relative flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3",
        "transition-all hover:border-brand hover:shadow-sm",
        "cursor-pointer animate-slide-in-right",
      )}
      onClick={() => openPreview(document)}
    >
      {/* 文件类型图标 */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
        <IconComp className="h-5 w-5 text-ink-secondary" />
      </div>

      {/* 文档信息 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-ink">
            {document.file_name}
          </span>
          <Badge variant={STATUS_VARIANT_MAP[document.status] || "default"}>
            {getStatusLabel(document.status)}
          </Badge>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-tertiary">
          <span>{formatFileSize(document.file_size)}</span>
          <span>·</span>
          <span>{formatRelativeTime(document.updated_at)}</span>
          {document.chunk_count > 0 && (
            <>
              <span>·</span>
              <span>{document.chunk_count} 个分块</span>
            </>
          )}
        </div>

        {/* 处理进度条 */}
        {isProcessing && (
          <div className="mt-2">
            <div className="flex items-center justify-between text-xs text-brand">
              <span>{document.processing_step || "处理中..."}</span>
              <span>{document.processing_progress}%</span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-brand transition-all duration-300"
                style={{ width: `${document.processing_progress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* 操作按钮区 */}
      <div className="flex items-center gap-1">
        {/* 预览按钮 */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            openPreview(document);
          }}
          className="rounded p-1.5 text-ink-tertiary opacity-0 transition-opacity hover:bg-muted hover:text-ink group-hover:opacity-100"
          aria-label="预览"
          title="预览"
        >
          <Eye className="h-4 w-4" />
        </button>

        {/* 更多操作菜单 */}
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(!menuOpen);
            }}
            className="rounded p-1.5 text-ink-tertiary opacity-0 transition-opacity hover:bg-muted hover:text-ink group-hover:opacity-100"
            aria-label="更多操作"
          >
            <MoreVertical className="h-4 w-4" />
          </button>

          {menuOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                }}
              />
              <div className="absolute right-0 top-8 z-20 w-28 rounded-md border border-line bg-surface py-1 shadow-lg">
                {isFailed && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleReprocess();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-ink hover:bg-muted"
                  >
                    <RefreshCw className="h-3 w-3" />
                    重新处理
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-danger hover:bg-muted"
                >
                  <Trash2 className="h-3 w-3" />
                  删除
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
