/**
 * 文档库侧边栏组件
 *
 * 作用：
 *   展示文档库分支列表，支持分支选择、新建。
 *   底部显示当前用户信息和登出按钮。
 *
 * 布局：
 *   - 顶部：品牌标识
 *   - 中部：分支列表（含"全部文档"选项）
 *   - 底部：用户信息 + 登出
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BookOpen,
  Plus,
  LogOut,
  Folder as FolderIcon,
  Files,
  MessageSquare,
  Settings,
  ChevronLeft,
  HelpCircle,
} from "lucide-react";
import { Button, ThemeToggle } from "@/components/common";
import { FolderItem } from "./FolderItem";
import { CreateFolderModal } from "./CreateFolderModal";
import { useDocumentStore } from "@/store/documentStore";
import { useAuthStore } from "@/store/authStore";
import { useToastStore } from "@/store/toastStore";
import { cn } from "@/lib/utils";

/** Sidebar 组件属性 */
interface SidebarProps {
  /** 移动端折叠状态 */
  collapsed?: boolean;
  /** 折叠回调（移动端） */
  onCollapse?: () => void;
}

/** Sidebar 组件 */
export function Sidebar({ collapsed, onCollapse }: SidebarProps) {
  const navigate = useNavigate();
  const { folders, currentFolderId, selectFolder, foldersLoading } =
    useDocumentStore();
  const { user, logout } = useAuthStore();
  const toast = useToastStore();
  const [showCreateModal, setShowCreateModal] = useState(false);

  /** 处理登出 */
  async function handleLogout() {
    await logout();
    toast.info("已退出登录");
  }

  return (
    <>
      <aside
        className={cn(
          "flex h-full w-60 flex-col border-r border-line bg-surface",
          "transition-transform duration-200",
          collapsed && "w-0 -translate-x-full overflow-hidden",
        )}
      >
        {/* 顶部品牌区 */}
        <div className="flex items-center gap-2 border-b border-line px-4 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white">
            <BookOpen className="h-4 w-4" />
          </div>
          <span className="flex-1 truncate text-sm font-semibold text-ink">
            GeiIt企业知识库
          </span>
          {onCollapse && (
            <button
              onClick={onCollapse}
              className="rounded p-1 text-ink-tertiary hover:bg-muted hover:text-ink lg:hidden"
              aria-label="折叠侧边栏"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* 导航链接 */}
        <div className="flex gap-1 border-b border-line px-3 py-2">
          <button
            className={cn(
              "flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium",
              "bg-brand-light text-brand",
            )}
          >
            <Files className="h-3.5 w-3.5" />
            知识库
          </button>
          <button
            onClick={() => navigate("/chat")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium",
              "text-ink-secondary transition-colors hover:bg-muted hover:text-ink",
            )}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            问答
          </button>
          {/* D10-02 帮助文档链接 */}
          <button
            onClick={() => navigate("/help")}
            className={cn(
              "flex items-center justify-center rounded-md px-2 py-1.5 text-xs font-medium",
              "text-ink-secondary transition-colors hover:bg-muted hover:text-ink",
            )}
            aria-label="帮助"
            title="帮助中心"
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* 分支列表区 */}
        <div className="flex-1 overflow-y-auto px-2 py-3">
          <div className="mb-2 flex items-center justify-between px-2">
            <span className="text-xs font-medium text-ink-secondary">
              文档库
            </span>
            <button
              onClick={() => setShowCreateModal(true)}
              className="rounded p-1 text-ink-tertiary transition-colors hover:bg-muted hover:text-brand"
              aria-label="新建分支"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* 全部文档 */}
          <button
            onClick={() => selectFolder(null)}
            className={cn(
              "mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
              currentFolderId === null
                ? "bg-brand-light text-brand"
                : "text-ink-secondary hover:bg-muted hover:text-ink",
            )}
          >
            <Files className="h-3.5 w-3.5" />
            <span>全部文档</span>
          </button>

          {/* 分支列表 */}
          {foldersLoading ? (
            <div className="px-2 py-2 text-xs text-ink-tertiary">加载中...</div>
          ) : (
            folders.map((folder) => (
              <FolderItem
                key={folder.id}
                folder={folder}
                selected={currentFolderId === folder.id}
                onSelect={() => selectFolder(folder.id)}
              />
            ))
          )}

          {folders.length === 0 && !foldersLoading && (
            <div className="px-2 py-2 text-xs text-ink-tertiary">
              <FolderIcon className="mb-1 h-4 w-4" />
              暂无分支
            </div>
          )}
        </div>

        {/* 底部用户区 */}
        <div className="border-t border-line px-3 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-medium text-ink-secondary">
              {user?.username?.charAt(0).toUpperCase() || "U"}
            </div>
            <div className="flex-1 truncate">
              <p className="truncate text-sm font-medium text-ink">
                {user?.username || "用户"}
              </p>
              <p className="truncate text-xs text-ink-tertiary">
                {user?.email}
              </p>
            </div>
            {/* D5-04 暗色模式切换 */}
            <ThemeToggle />
            <button
              onClick={() => navigate("/settings")}
              className="rounded p-1.5 text-ink-tertiary transition-colors hover:bg-muted hover:text-ink"
              aria-label="设置"
              title="设置"
            >
              <Settings className="h-4 w-4" />
            </button>
            <button
              onClick={handleLogout}
              className="rounded p-1.5 text-ink-tertiary transition-colors hover:bg-muted hover:text-danger"
              aria-label="退出登录"
              title="退出登录"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* 新建分支弹窗 */}
      <CreateFolderModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
      />
    </>
  );
}
