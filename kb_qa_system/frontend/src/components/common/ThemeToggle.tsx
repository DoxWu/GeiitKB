/**
 * 主题切换按钮组件（D5-04 暗色模式）
 *
 * 作用：
 *   提供亮色/暗色主题切换按钮，点击后立即切换并持久化偏好。
 *   图标随当前主题变化：亮色显示月亮（点击切到暗色），暗色显示太阳（点击切到亮色）。
 *
 * 使用方式：
 *   <ThemeToggle />
 *   放置在导航栏或设置页面中。
 */

import { Sun, Moon } from "lucide-react";
import { useThemeStore } from "@/store/themeStore";
import { cn } from "@/lib/utils";

/** ThemeToggle 组件属性 */
interface ThemeToggleProps {
  /** 额外的 className */
  className?: string;
}

/** ThemeToggle 组件 */
export function ThemeToggle({ className }: ThemeToggleProps) {
  const { theme, toggleTheme } = useThemeStore();

  return (
    <button
      onClick={toggleTheme}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-md",
        "text-ink-secondary transition-colors",
        "hover:bg-muted hover:text-ink",
        "focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-1",
        className,
      )}
      aria-label={theme === "light" ? "切换到暗色模式" : "切换到亮色模式"}
      title={theme === "light" ? "切换到暗色模式" : "切换到亮色模式"}
    >
      {theme === "light" ? (
        <Moon className="h-4 w-4" />
      ) : (
        <Sun className="h-4 w-4" />
      )}
    </button>
  );
}
