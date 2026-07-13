/**
 * 批量移动文档到分支弹窗组件
 *
 * 作用：
 *   提供分支选择列表，将选中的多个文档移动到目标分支。
 *   支持移动到已有分支或移出分支（归入未分类）。
 *
 * 使用方式：
 *   <BatchMoveModal open={open} onClose={() => setOpen(false)} />
 */

import { useState, useEffect } from "react";
import { Folder as FolderIcon, FileText } from "lucide-react";
import { Modal, Button } from "@/components/common";
import { useDocumentStore } from "@/store/documentStore";
import { useToastStore } from "@/store/toastStore";
import { cn } from "@/lib/utils";

/** BatchMoveModal 组件属性 */
interface BatchMoveModalProps {
  /** 是否打开 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
}

/** BatchMoveModal 组件 */
export function BatchMoveModal({ open, onClose }: BatchMoveModalProps) {
  const { folders, selectedDocIds, batchMove } = useDocumentStore();
  const toast = useToastStore();
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  // 弹窗打开时，默认选中"未分类"
  useEffect(() => {
    if (open) {
      setSelectedFolderId(null);
    }
  }, [open]);

  /** 提交批量移动 */
  async function handleSubmit() {
    setLoading(true);
    try {
      const result = await batchMove(selectedFolderId);
      if (result.failed.length > 0) {
        toast.warning(
          `移动完成：成功 ${result.success_count} 个，失败 ${result.failed.length} 个`,
        );
      } else {
        toast.success(
          `已移动 ${result.success_count} 个文档到${
            selectedFolderId === null ? "未分类" : "目标分支"
          }`,
        );
      }
      onClose();
    } catch (err) {
      toast.apiError("批量移动失败", err);
    } finally {
      setLoading(false);
    }
  }

  /** 关闭时重置状态 */
  function handleClose() {
    setSelectedFolderId(null);
    onClose();
  }

  const selectedCount = selectedDocIds.size;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={`批量移动 ${selectedCount} 个文档到分支`}
      footer={
        <>
          <Button variant="ghost" onClick={handleClose}>
            取消
          </Button>
          <Button onClick={handleSubmit} loading={loading}>
            移动
          </Button>
        </>
      }
    >
      <div className="space-y-1">
        <p className="mb-3 text-xs text-ink-tertiary">
          选择目标分支，将选中的 {selectedCount} 个文档移动到该分支。选择"未分类"可将文档移出所有分支。
        </p>

        {/* 未分类选项 */}
        <button
          type="button"
          onClick={() => setSelectedFolderId(null)}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
            selectedFolderId === null
              ? "bg-brand-light text-brand"
              : "text-ink-secondary hover:bg-muted hover:text-ink",
          )}
        >
          <FileText className="h-4 w-4" />
          <span>未分类</span>
        </button>

        {/* 分支列表 */}
        {folders.length === 0 ? (
          <div className="rounded-md border border-line bg-muted/30 px-3 py-4 text-center text-xs text-ink-tertiary">
            暂无分支，请先在左侧侧边栏创建分支
          </div>
        ) : (
          folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              onClick={() => setSelectedFolderId(folder.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                selectedFolderId === folder.id
                  ? "bg-brand-light text-brand"
                  : "text-ink-secondary hover:bg-muted hover:text-ink",
              )}
            >
              <FolderIcon className="h-4 w-4" />
              <span className="truncate">{folder.name}</span>
              <span className="ml-auto text-xs text-ink-tertiary">
                {folder.document_count} 篇
              </span>
            </button>
          ))
        )}
      </div>
    </Modal>
  );
}
