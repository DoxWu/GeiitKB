/**
 * 弹窗组件
 *
 * 作用：
 *   提供居中模态对话框，支持遮罩层、标题、关闭按钮。
 *   点击遮罩或按 ESC 键关闭。
 *
 * 使用方式：
 *   <Modal open={isOpen} onClose={handleClose} title="新建分支">
 *     <p>弹窗内容</p>
 *   </Modal>
 */

import { useEffect, useId } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Modal 组件属性 */
interface ModalProps {
  /** 是否打开 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 标题 */
  title?: string;
  /** 内容区类名 */
  bodyClassName?: string;
  /** 子元素 */
  children: React.ReactNode;
  /** 底部操作区 */
  footer?: React.ReactNode;
  /** 是否禁止点击遮罩关闭 */
  disableBackdropClose?: boolean;
}

/** Modal 组件 */
export function Modal({
  open,
  onClose,
  title,
  bodyClassName,
  children,
  footer,
  disableBackdropClose = false,
}: ModalProps) {
  // ESC 键关闭
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // 禁止背景滚动
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [open]);

  // 生成唯一 ID 用于 aria-labelledby 关联标题
  // 作用：屏幕阅读器通过 aria-labelledby 找到弹窗标题并播报
  // 注意：useId 必须在所有早期返回之前调用，遵循 Rules of Hooks
  const titleId = useId();

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
      onClick={(e) => {
        if (!disableBackdropClose && e.target === e.currentTarget) onClose();
      }}
    >
      {/* 遮罩层 */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* 弹窗内容 */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-label={title ? undefined : "对话框"}
        className={cn(
          "relative z-10 w-full max-w-md animate-slide-up rounded-lg border border-line bg-surface shadow-xl",
        )}
      >
        {/* 标题栏 */}
        {title && (
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 id={titleId} className="text-base font-semibold text-ink">{title}</h2>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-ink-tertiary transition-colors hover:bg-muted hover:text-ink"
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* 内容区 */}
        <div className={cn("px-5 py-4", bodyClassName)}>{children}</div>

        {/* 底部操作区 */}
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
