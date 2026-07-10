/// <reference types="vite/client" />
/// <reference types="vitest/globals" />

/**
 * Vite 环境变量类型声明
 *
 * 作用：
 *   为 .env 文件中自定义的环境变量提供 TypeScript 类型提示，
 *   确保 import.meta.env 访问时有类型安全。
 */

interface ImportMetaEnv {
  /** API 基础地址（含 /api/v1 前缀） */
  readonly VITE_API_BASE_URL: string;
  /** 应用标题 */
  readonly VITE_APP_TITLE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
