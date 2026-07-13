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
import { useNavigate, useLocation } from "react-router-dom";
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
  Globe,
  User as UserIcon,
  Layers,
  Inbox,
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
  /** 移动端折叠状态（已废弃：可见性由父容器 hidden/block 控制，保留兼容父组件传参） */
  collapsed?: boolean;
  /** 折叠回调（移动端关闭抽屉） */
  onCollapse?: () => void;
}

/** Sidebar 组件 */
export function Sidebar({ onCollapse }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { folders, currentFolderId, currentScope, selectFolder, selectScope, foldersLoading } =
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
          // 固定 w-60 宽度，始终非透明（bg-surface 为纯白/纯灰，不使用透明度）
          // 可见性由父容器 DocumentsPage 的 hidden/block 控制，此处不再用 collapsed 操纵宽度
          // （此前 collapsed={!sidebarOpen} 在桌面端恒为 true，导致 w-0 侧边栏在正常缩放下不可见，
          //   仅在 300% 缩放触发移动端布局后才可见）
          "flex h-full w-60 flex-shrink-0 flex-col border-r border-line bg-surface shadow-xl",
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

        {/* 导航链接 - 垂直布局，显眼入口 */}
        {/* 作用：提供知识库、问答对话、帮助中心三个主要入口，
             使用垂直全宽按钮，活跃态高亮，非活跃态清晰可见 */}
        <nav className="space-y-1 border-b border-line px-2 py-2">
          <button
            onClick={() => navigate("/documents")}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              location.pathname.startsWith("/documents")
                ? "bg-brand-light text-brand"
                : "text-ink-secondary hover:bg-muted hover:text-ink",
            )}
          >
            <Files className="h-4 w-4" />
            知识库
          </button>
          <button
            onClick={() => navigate("/chat")}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              location.pathname.startsWith("/chat")
                ? "bg-brand-light text-brand"
                : "text-ink-secondary hover:bg-muted hover:text-ink",
            )}
          >
            <MessageSquare className="h-4 w-4" />
            问答对话
          </button>
          {/* D10-02 帮助文档链接 */}
          <button
            onClick={() => navigate("/help")}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              location.pathname === "/help"
                ? "bg-brand-light text-brand"
                : "text-ink-secondary hover:bg-muted hover:text-ink",
            )}
            aria-label="帮助中心"
            title="帮助中心"
          >
            <HelpCircle className="h-4 w-4" />
            帮助中心
          </button>
        </nav>

        {/* 分支列表区 */}
        <div className="flex-1 overflow-y-auto px-2 py-3">
          {/* 修复 Issue 8：文档库范围切换 - 公用/个人/全部 */}
          <div className="mb-3">
            <span className="mb-1 block px-2 text-xs font-medium text-ink-secondary">
              文档库范围
            </span>
            {/* 全部文档（accessible：自己的+公共库） */}
            <button
              onClick={() => selectScope("accessible")}
              className={cn(
                "mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                currentScope === "accessible" && currentFolderId === null
                  ? "bg-brand-light text-brand"
                  : "text-ink-secondary hover:bg-muted hover:text-ink",
              )}
            >
              <Layers className="h-3.5 w-3.5" />
              <span>全部文档</span>
            </button>
            {/* 公共文档库（public）- 蓝色标识 */}
            <button
              onClick={() => selectScope("public")}
              className={cn(
                "mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                currentScope === "public"
                  ? "bg-blue-50 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400"
                  : "text-ink-secondary hover:bg-muted hover:text-ink",
              )}
            >
              <Globe className="h-3.5 w-3.5" />
              <span>公共文档库</span>
            </button>
            {/* 个人文档库（mine）- 品牌色标识 */}
            <button
              onClick={() => selectScope("mine")}
              className={cn(
                "mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                currentScope === "mine"
                  ? "bg-brand-light text-brand"
                  : "text-ink-secondary hover:bg-muted hover:text-ink",
              )}
            >
              <UserIcon className="h-3.5 w-3.5" />
              <span>个人文档库</span>
            </button>
          </div>

          {/* 分隔线 */}
          <div className="mb-2 border-t border-line" />

          {/* 个人分支列表 */}
          <div className="mb-2 flex items-center justify-between px-2">
            <span className="text-xs font-medium text-ink-secondary">
              我的分支
            </span>
            <button
              onClick={() => setShowCreateModal(true)}
              className="rounded p-1 text-ink-tertiary transition-colors hover:bg-muted hover:text-brand"
              aria-label="新建分支"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* 未分类（默认分支）：显示 folder_id 为 NULL 的文档 */}
          {/* 作用：未指定分支的文档归入此虚拟分支，方便用户分类管理 */}
          <button
            onClick={() => selectFolder(0)}
            className={cn(
              "mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
              currentFolderId === 0
                ? "bg-brand-light text-brand"
                : "text-ink-secondary hover:bg-muted hover:text-ink",
            )}
          >
            <Inbox className="h-3.5 w-3.5" />
            <span>未分类</span>
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
