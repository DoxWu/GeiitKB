/**
 * 批量操作工具栏组件
 *
 * 作用：
 *   多选模式下显示的浮动操作栏，提供：
 *   - 选中数量显示
 *   - 全选/取消全选
 *   - 批量移动到分支
 *   - 批量删除
 *   - 退出多选模式
 *
 * 使用方式：
 *   <BatchActionBar />  // 由 DocumentsPage 在多选模式下渲染
 */

import { useState } from "react";
import { Trash2, FolderInput, X, CheckSquare } from "lucide-react";
import { Button } from "@/components/common";
import { useDocumentStore } from "@/store/documentStore";
import { useToastStore } from "@/store/toastStore";
import { BatchMoveModal } from "./BatchMoveModal";

/** BatchActionBar 组件 */
export function BatchActionBar() {
  const {
    selectedDocIds,
    documents,
    selectAll,
    clearSelection,
    exitSelectionMode,
    batchDelete,
  } = useDocumentStore();
  const toast = useToastStore();
  const [batchMoveOpen, setBatchMoveOpen] = useState(false);

  const selectedCount = selectedDocIds.size;
  const allSelected = documents.length > 0 && selectedCount === documents.length;

  /** 处理批量删除 */
  async function handleBatchDelete() {
    if (!confirm(`确定删除选中的 ${selectedCount} 个文档吗？此操作可恢复（软删除）。`)) {
      return;
    }
    try {
      const result = await batchDelete();
      if (result.failed.length > 0) {
        toast.warning(
          `删除完成：成功 ${result.success_count} 个，失败 ${result.failed.length} 个`,
        );
      } else {
        toast.success(`已删除 ${result.success_count} 个文档`);
      }
    } catch (err) {
      toast.apiError("批量删除失败", err);
    }
  }

  /** 全选/取消全选 */
  function handleSelectAll() {
    if (allSelected) {
      clearSelection();
    } else {
      selectAll();
    }
  }

  return (
    <>
      <div className="sticky top-0 z-20 flex items-center gap-3 rounded-lg border border-brand bg-brand-light px-4 py-2.5 shadow-md">
        {/* 选中数量 */}
        <span className="text-sm font-medium text-brand">
          已选中 {selectedCount} 项
        </span>

        {/* 全选/取消全选 */}
        <button
          onClick={handleSelectAll}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-secondary transition-colors hover:bg-muted hover:text-ink"
        >
          <CheckSquare className="h-3.5 w-3.5" />
          {allSelected ? "取消全选" : "全选"}
        </button>

        <div className="ml-auto flex items-center gap-2">
          {/* 批量移动 */}
          <Button
            variant="secondary"
            size="sm"
            icon={<FolderInput className="h-4 w-4" />}
            onClick={() => setBatchMoveOpen(true)}
            disabled={selectedCount === 0}
          >
            移动到分支
          </Button>

          {/* 批量删除 */}
          <Button
            variant="danger"
            size="sm"
            icon={<Trash2 className="h-4 w-4" />}
            onClick={handleBatchDelete}
            disabled={selectedCount === 0}
          >
            删除
          </Button>

          {/* 退出多选 */}
          <button
            onClick={exitSelectionMode}
            className="rounded-md p-1.5 text-ink-tertiary transition-colors hover:bg-muted hover:text-ink"
            aria-label="退出多选模式"
            title="退出多选"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 批量移动弹窗 */}
      <BatchMoveModal
        open={batchMoveOpen}
        onClose={() => setBatchMoveOpen(false)}
      />
    </>
  );
}
