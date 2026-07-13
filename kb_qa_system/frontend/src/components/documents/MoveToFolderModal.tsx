/**
 * 移动文档到其他分支弹窗组件
 *
 * 作用：
 *   提供分支选择列表，将指定文档移动到目标分支。
 *   支持移动到已有分支或移出分支（归入未分类）。
 *
 * 修复 Issue 6：前端缺少移动文档到其他分支的功能
 *
 * 使用方式：
 *   <MoveToFolderModal
 *     open={open}
 *     documentId={doc.id}
 *     currentFolderId={doc.folder_id}
 *     onClose={() => setOpen(false)}
 *   />
 */

import { useState, useEffect } from "react";
import { Folder as FolderIcon, FileText } from "lucide-react";
import { Modal, Button } from "@/components/common";
import { useDocumentStore } from "@/store/documentStore";
import { useToastStore } from "@/store/toastStore";
import { cn } from "@/lib/utils";

/** MoveToFolderModal 组件属性 */
interface MoveToFolderModalProps {
  /** 是否打开 */
  open: boolean;
  /** 文档ID */
  documentId: number;
  /** 当前所属分支ID（用于高亮当前分支） */
  currentFolderId: number | null;
  /** 关闭回调 */
  onClose: () => void;
}

/** MoveToFolderModal 组件 */
export function MoveToFolderModal({
  open,
  documentId,
  currentFolderId,
  onClose,
}: MoveToFolderModalProps) {
  const { folders, moveDocument } = useDocumentStore();
  const toast = useToastStore();
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  // 弹窗打开时，默认选中当前分支
  useEffect(() => {
    if (open) {
      setSelectedFolderId(currentFolderId);
    }
  }, [open, currentFolderId]);

  /** 提交移动 */
  async function handleSubmit() {
    // 如果选中的就是当前分支，无需移动
    if (selectedFolderId === currentFolderId) {
      toast.info("文档已在该分支中");
      onClose();
      return;
    }

    setLoading(true);
    try {
      await moveDocument(documentId, selectedFolderId);
      toast.success(
        selectedFolderId === null
          ? "文档已移出分支"
          : "文档已移动到目标分支",
      );
      onClose();
    } catch (err) {
      toast.error("移动失败", err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }

  /** 关闭时重置状态 */
  function handleClose() {
    setSelectedFolderId(null);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="移动文档到分支"
      footer={
        <>
          <Button variant="ghost" onClick={handleClose}>
            取消
          </Button>
          <Button
            onClick={handleSubmit}
            loading={loading}
          >
            移动
          </Button>
        </>
      }
    >
      <div className="space-y-1">
        <p className="mb-3 text-xs text-ink-tertiary">
          选择目标分支，将文档移动到该分支。选择"未分类"可将文档移出所有分支。
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
          {currentFolderId === null && (
            <span className="ml-auto text-xs text-ink-tertiary">当前</span>
          )}
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
              {currentFolderId === folder.id && (
                <span className="ml-2 text-xs text-brand">当前</span>
              )}
            </button>
          ))
        )}
      </div>
    </Modal>
  );
}
