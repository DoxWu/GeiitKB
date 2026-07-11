/**
 * 主题状态管理 Store（D5-04 暗色模式）
 *
 * 作用：
 *   使用 Zustand 管理应用主题（亮色/暗色），持久化到 localStorage。
 *   切换主题时同步修改 <html> 标签的 class，触发 Tailwind dark: 样式。
 *
 * 实现方式：
 *   1. 首次加载时从 localStorage 读取用户偏好
 *   2. 无偏好时读取系统偏好（prefers-color-scheme）
 *   3. 通过 toggleTheme 切换并持久化
 *   4. 应用 <html> 的 dark class 控制 Tailwind dark: 变体
 *
 * 使用方式：
 *   import { useThemeStore } from '@/store/themeStore';
 *   const { theme, toggleTheme } = useThemeStore();
 */

import { create } from "zustand";

/** 主题类型 */
type Theme = "light" | "dark";

/** localStorage 存储键名 */
const THEME_STORAGE_KEY = "geiit-theme";

/** 主题 Store 状态接口 */
interface ThemeState {
  /** 当前主题 */
  theme: Theme;
  /** 切换主题（亮↔暗） */
  toggleTheme: () => void;
  /** 设置指定主题 */
  setTheme: (theme: Theme) => void;
}

/**
 * 从 localStorage 读取已保存的主题
 *
 * 作用：
 *   优先返回用户显式选择的主题；无记录时回退到系统偏好。
 *
 * @returns 主题值 'light' 或 'dark'
 */
function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";

  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === "light" || saved === "dark") {
    return saved;
  }

  // 无显式偏好时，读取系统偏好
  const prefersDark = window.matchMedia(
    "(prefers-color-scheme: dark)",
  ).matches;
  return prefersDark ? "dark" : "light";
}

/**
 * 将主题应用到 <html> 标签
 *
 * 作用：
 *   添加/移除 'dark' class，触发 Tailwind dark: 变体和 CSS 变量切换。
 *
 * @param theme - 目标主题
 */
function applyThemeToDOM(theme: Theme): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

/** 主题 Store */
export const useThemeStore = create<ThemeState>((set, get) => ({
  // 初始化时从 localStorage 读取
  theme: getInitialTheme(),

  toggleTheme: () => {
    const next: Theme = get().theme === "light" ? "dark" : "light";
    localStorage.setItem(THEME_STORAGE_KEY, next);
    applyThemeToDOM(next);
    set({ theme: next });
  },

  setTheme: (theme: Theme) => {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    applyThemeToDOM(theme);
    set({ theme });
  },
}));

/**
 * 初始化主题（在应用启动时调用一次）
 *
 * 作用：
 *   确保 <html> 标签的 dark class 与 store 状态同步。
 *   需在 main.tsx 中渲染前调用，避免闪屏（FOUC）。
 */
export function initTheme(): void {
  const theme = getInitialTheme();
  applyThemeToDOM(theme);
}
