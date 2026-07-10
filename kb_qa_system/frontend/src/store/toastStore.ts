/**
 * Toast 通知状态管理 Store
 *
 * 作用：
 *   全局管理 Toast 通知的添加、移除和自动关闭。
 *   提供 success/error/warning/info 快捷方法。
 *
 * 使用方式：
 *   import { useToastStore } from '@/store/toastStore';
 *   const { success, error } = useToastStore();
 *   success('操作成功');
 */

import { create } from "zustand";
import type { ToastItem } from "@/types/api";

/** Toast Store 状态接口 */
interface ToastState {
  /** 当前显示的 Toast 列表 */
  toasts: ToastItem[];

  /** 添加 Toast 通知
   * @param toast - Toast 通知项
   */
  addToast: (toast: Omit<ToastItem, "id">) => void;

  /** 移除 Toast 通知
   * @param id - Toast ID
   */
  removeToast: (id: string) => void;

  /** 快捷方法：成功通知 */
  success: (title: string, description?: string) => void;

  /** 快捷方法：错误通知 */
  error: (title: string, description?: string) => void;

  /** 快捷方法：警告通知 */
  warning: (title: string, description?: string) => void;

  /** 快捷方法：信息通知 */
  info: (title: string, description?: string) => void;
}

/** 生成唯一 ID */
function generateId(): string {
  return `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 默认自动关闭时长（毫秒） */
const DEFAULT_DURATION = 4000;

/** Toast Store */
export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  addToast: (toast) => {
    const id = generateId();
    const item: ToastItem = {
      id,
      duration: DEFAULT_DURATION,
      ...toast,
    };

    set((state) => ({ toasts: [...state.toasts, item] }));

    // 自动关闭
    if (item.duration && item.duration > 0) {
      setTimeout(() => {
        get().removeToast(id);
      }, item.duration);
    }
  },

  removeToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },

  success: (title, description) => {
    get().addToast({ type: "success", title, description });
  },

  error: (title, description) => {
    get().addToast({
      type: "error",
      title,
      description,
      duration: 6000,
    });
  },

  warning: (title, description) => {
    get().addToast({ type: "warning", title, description });
  },

  info: (title, description) => {
    get().addToast({ type: "info", title, description });
  },
}));
