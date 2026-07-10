/**
 * 分支项组件
 *
 * 作用：
 *   渲染单个文档库分支，支持选中、重命名、删除操作。
 *   hover 时显示操作按钮，点击分支名进入编辑模式。
 */

import { useState, useRef, useEffect } from "react";
import { Folder as FolderIcon, MoreVertical, Pencil, Trash2, Check, X } from "lucide-react";
import { useDocumentStore } from "@/store/documentStore";
import { useToastStore } from "@/store/toastStore";
import type { DocumentFolder } from "@/types/document";
import { cn } from "@/lib/utils";

/** FolderItem 组件属性 */
interface FolderItemProps {
  /** 分支数据 */
  folder: DocumentFolder;
  /** 是否选中 */
  selected: boolean;
  /** 选中回调 */
  onSelect: () => void;
}

/** FolderItem 组件 */
export function FolderItem({ folder, selected, onSelect }: FolderItemProps) {
  const { renameFolder, deleteFolder } = useDocumentStore();
  const toast = useToastStore();

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(folder.name);
  const [menuOpen, setMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 编辑模式时自动聚焦
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  /** 保存重命名 */
  async function handleRename() {
    const trimmed = editName.trim();
    if (!trimmed) {
      toast.warning("分支名称不能为空");
      return;
    }
    if (trimmed === folder.name) {
      setEditing(false);
      return;
    }
    try {
      await renameFolder(folder.id, trimmed);
      toast.success("重命名成功");
      setEditing(false);
    } catch {
      setEditName(folder.name);
      setEditing(false);
    }
  }

  /** 删除分支 */
  async function handleDelete() {
    setMenuOpen(false);
    if (!confirm(`确定删除分支"${folder.name}"吗？`)) return;
    try {
      await deleteFolder(folder.id);
      toast.success("分支已删除");
    } catch (err) {
      toast.error("删除失败", err instanceof Error ? err.message : undefined);
    }
  }

  // 编辑模式
  if (editing) {
    return (
      <div className="mb-1 flex items-center gap-1 rounded-md px-2 py-1">
        <FolderIcon className="h-3.5 w-3.5 shrink-0 text-ink-tertiary" />
        <input
          ref={inputRef}
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRename();
            if (e.key === "Escape") {
              setEditName(folder.name);
              setEditing(false);
            }
          }}
          className="h-6 flex-1 rounded border border-brand bg-surface px-1 text-sm text-ink focus:outline-none"
        />
        <button
          onClick={handleRename}
          className="rounded p-0.5 text-success hover:bg-muted"
          aria-label="确认"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => {
            setEditName(folder.name);
            setEditing(false);
          }}
          className="rounded p-0.5 text-danger hover:bg-muted"
          aria-label="取消"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group mb-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
        selected
          ? "bg-brand-light text-brand"
          : "text-ink-secondary hover:bg-muted hover:text-ink",
      )}
    >
      <button
        onClick={onSelect}
        className="flex flex-1 items-center gap-2 truncate"
      >
        <FolderIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{folder.name}</span>
        {folder.document_count > 0 && (
          <span className="ml-auto rounded bg-muted px-1.5 text-xs text-ink-tertiary">
            {folder.document_count}
          </span>
        )}
      </button>

      {/* 操作菜单 */}
      <div className="relative opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen(!menuOpen);
          }}
          className="rounded p-0.5 hover:bg-muted"
          aria-label="更多操作"
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </button>

        {menuOpen && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setMenuOpen(false)}
            />
            <div className="absolute right-0 top-6 z-20 w-28 rounded-md border border-line bg-surface py-1 shadow-lg">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  setEditing(true);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-ink hover:bg-muted"
              >
                <Pencil className="h-3 w-3" />
                重命名
              </button>
              <button
                onClick={handleDelete}
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
  );
}
