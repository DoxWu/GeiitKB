/** @type {import('tailwindcss').Config} */

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
    },
    extend: {
      colors: {
        // D5-04 暗色模式：使用 CSS 变量，在 index.css 中定义 :root 和 .dark 的值
        // 格式 rgb(var(--x) / <alpha-value>) 支持 bg-surface/95 等透明度修饰符
        canvas: "rgb(var(--color-canvas-rgb) / <alpha-value>)",
        surface: "rgb(var(--color-surface-rgb) / <alpha-value>)",
        muted: "rgb(var(--color-muted-rgb) / <alpha-value>)",
        line: "rgb(var(--color-line-rgb) / <alpha-value>)",
        ink: {
          DEFAULT: "rgb(var(--color-ink-rgb) / <alpha-value>)",
          secondary: "rgb(var(--color-ink-secondary-rgb) / <alpha-value>)",
          tertiary: "rgb(var(--color-ink-tertiary-rgb) / <alpha-value>)",
        },
        brand: {
          DEFAULT: "#D97757",
          hover: "#C26547",
          light: "rgb(var(--color-brand-light-rgb) / <alpha-value>)",
        },
        success: "#16A34A",
        warning: "#D97706",
        danger: "#DC2626",
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Noto Sans SC",
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
      animation: {
        "fade-in": "fadeIn 200ms ease-out",
        "slide-up": "slideUp 250ms ease-out",
        "slide-in-right": "slideInRight 250ms ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        slideInRight: {
          "0%": { opacity: "0", transform: "translateX(16px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
      },
    },
  },
  plugins: [],
};
