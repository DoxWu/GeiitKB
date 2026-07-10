/**
 * 聊天侧边栏组件
 *
 * 作用：
 *   展示对话列表，支持选择对话、新建对话、删除对话。
 *   底部显示当前用户信息、登出和设置入口。
 *   顶部提供到文档管理页的导航链接。
 *
 * 布局：
 *   - 顶部：品牌标识 + 导航链接 + 新对话按钮
 *   - 中部：对话列表（含空状态）
 *   - 底部：用户信息 + 登出 + 设置
 *
 * 使用方式：
 *   <ChatSidebar collapsed={sidebarOpen} onCollapse={handleCollapse} />
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BookOpen,
  Plus,
  LogOut,
  MessageSquare,
  Files,
  Trash2,
  Settings,
  ChevronLeft,
} from "lucide-react";
import { Button, EmptyState } from "@/components/common";
import { useChatStore } from "@/store/chatStore";
import { useAuthStore } from "@/store/authStore";
import { useToastStore } from "@/store/toastStore";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/types/chat";

/** ChatSidebar 组件属性 */
interface ChatSidebarProps {
  /** 移动端折叠状态 */
  collapsed?: boolean;
  /** 折叠回调（移动端） */
  onCollapse?: () => void;
}

/** ChatSidebar 组件 */
export function ChatSidebar({ collapsed, onCollapse }: ChatSidebarProps) {
  const navigate = useNavigate();
  const {
    conversations,
    currentConversationId,
    loadingConversations,
    selectConversation,
    startNewConversation,
    removeConversation,
  } = useChatStore();
  const { user, logout } = useAuthStore();
  const toast = useToastStore();
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  /** 处理新对话 */
  function handleNewConversation() {
    startNewConversation();
    navigate("/chat");
  }

  /** 处理选择对话 */
  function handleSelectConversation(id: number) {
    selectConversation(id);
    navigate(`/chat/${id}`);
    onCollapse?.();
  }

  /** 处理删除对话 */
  async function handleDeleteConversation(id: number) {
    try {
      await removeConversation(id);
      toast.success("对话已删除");
      // 如果删除的是当前对话，导航到 /chat
      if (id === currentConversationId) {
        navigate("/chat");
      }
    } catch {
      toast.error("删除失败");
    }
    setConfirmDeleteId(null);
  }

  /** 处理登出 */
  async function handleLogout() {
    await logout();
    toast.info("已退出登录");
  }

  return (
    <aside
      className={cn(
        "flex h-full w-60 flex-col border-r border-line bg-surface",
        "transition-transform duration-200",
        collapsed && "w-0 -translate-x-full overflow-hidden",
      )}
    >
      {/* 顶部：品牌标识 */}
      <div className="border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-brand" />
          <span className="text-sm font-semibold text-ink">GeiIt企业知识库</span>
        </div>

        {/* 导航链接 */}
        <div className="mt-3 flex gap-1">
          <button
            onClick={() => navigate("/documents")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium",
              "text-ink-secondary transition-colors hover:bg-muted hover:text-ink",
            )}
          >
            <Files className="h-3.5 w-3.5" />
            知识库
          </button>
          <button
            className={cn(
              "flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium",
              "bg-brand-light text-brand",
            )}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            问答
          </button>
        </div>
      </div>

      {/* 新对话按钮 */}
      <div className="px-3 py-2">
        <Button
          variant="primary"
          size="sm"
          fullWidth
          icon={<Plus className="h-3.5 w-3.5" />}
          onClick={handleNewConversation}
        >
          新对话
        </Button>
      </div>

      {/* 对话列表 */}
      <div className="flex-1 overflow-y-auto px-2">
        {loadingConversations && conversations.length === 0 ? (
          <div className="px-2 py-4 text-center text-xs text-ink-tertiary">
            加载中...
          </div>
        ) : conversations.length === 0 ? (
          <EmptyState
            icon={<MessageSquare className="h-5 w-5" />}
            title="暂无对话"
            description="点击上方按钮开始新对话"
            className="py-8"
          />
        ) : (
          <div className="space-y-0.5">
            {conversations.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                active={conv.id === currentConversationId}
                confirmDelete={conv.id === confirmDeleteId}
                onSelect={() => handleSelectConversation(conv.id)}
                onDelete={() => setConfirmDeleteId(conv.id)}
                onConfirmDelete={() => handleDeleteConversation(conv.id)}
                onCancelDelete={() => setConfirmDeleteId(null)}
              />
            ))}
          </div>
        )}
      </div>

      {/* 底部：用户信息 + 操作 */}
      <div className="border-t border-line px-3 py-2">
        <div className="flex items-center gap-2 px-1 py-1">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-light text-xs font-medium text-brand">
            {user?.username?.[0]?.toUpperCase() || "U"}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-ink">
              {user?.username || "用户"}
            </p>
            <p className="truncate text-xs text-ink-tertiary">
              {user?.email}
            </p>
          </div>
        </div>

        <div className="mt-2 flex gap-1">
          <button
            onClick={() => navigate("/settings")}
            className="flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs text-ink-secondary transition-colors hover:bg-muted"
          >
            <Settings className="h-3.5 w-3.5" />
            设置
          </button>
          <button
            onClick={handleLogout}
            className="flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs text-ink-secondary transition-colors hover:bg-muted hover:text-danger"
          >
            <LogOut className="h-3.5 w-3.5" />
            登出
          </button>
        </div>
      </div>

      {/* 移动端折叠按钮 */}
      {collapsed !== undefined && onCollapse && (
        <button
          onClick={onCollapse}
          className="absolute -right-3 top-4 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-line bg-surface shadow-sm"
          aria-label="折叠侧边栏"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      )}
    </aside>
  );
}

/** 单个对话项组件属性 */
interface ConversationItemProps {
  conversation: Conversation;
  active: boolean;
  confirmDelete: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}

/** 单个对话项 */
function ConversationItem({
  conversation,
  active,
  confirmDelete,
  onSelect,
  onDelete,
  onConfirmDelete,
  onCancelDelete,
}: ConversationItemProps) {
  return (
    <div
      className={cn(
        "group relative rounded-md transition-colors",
        active ? "bg-brand-light" : "hover:bg-muted",
      )}
    >
      <button
        onClick={onSelect}
        className="w-full px-2.5 py-2 text-left"
      >
        <p
          className={cn(
            "truncate text-xs font-medium",
            active ? "text-brand" : "text-ink",
          )}
        >
          {conversation.title}
        </p>
        <p className="mt-0.5 text-xs text-ink-tertiary">
          {formatRelativeTime(conversation.updated_at)}
        </p>
      </button>

      {/* 删除按钮（hover 显示） */}
      {!confirmDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="absolute right-1.5 top-1.5 hidden rounded p-1 text-ink-tertiary transition-colors hover:bg-danger/10 hover:text-danger group-hover:block"
          aria-label="删除对话"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}

      {/* 删除确认 */}
      {confirmDelete && (
        <div className="absolute inset-0 flex items-center justify-center gap-1 rounded-md bg-surface">
          <button
            onClick={onConfirmDelete}
            className="rounded bg-danger px-2 py-0.5 text-xs text-white hover:bg-red-700"
          >
            删除
          </button>
          <button
            onClick={onCancelDelete}
            className="rounded bg-muted px-2 py-0.5 text-xs text-ink-secondary hover:bg-line"
          >
            取消
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * 格式化相对时间
 * @param isoString - ISO 8601 时间字符串
 * @returns 相对时间描述（如"刚刚"、"3分钟前"）
 */
function formatRelativeTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffMin < 1) return "刚刚";
    if (diffMin < 60) return `${diffMin}分钟前`;
    if (diffHour < 24) return `${diffHour}小时前`;
    if (diffDay < 7) return `${diffDay}天前`;
    return date.toLocaleDateString("zh-CN");
  } catch {
    return "";
  }
}
