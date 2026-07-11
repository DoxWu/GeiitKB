/**
 * 前端环境变量集中管理与校验（D9-03）
 *
 * 作用：
 *   集中管理所有 Vite 环境变量，在应用启动时校验必需变量是否已配置。
 *   避免运行时因环境变量缺失导致的隐晦错误。
 *
 * 实现方式：
 *   1. 从 import.meta.env 读取 Vite 环境变量
 *   2. 校验必需变量，缺失时抛出明确错误
 *   3. 导出类型安全的环境变量对象
 *
 * 使用方式：
 *   import { env } from '@/config/env';
 *   const apiUrl = env.VITE_API_BASE_URL;
 */

/**
 * 环境变量接口定义
 *
 * 定义所有前端使用的 Vite 环境变量及其类型。
 * Vite 环境变量必须以 VITE_ 前缀开头才能在客户端代码中访问。
 */
interface EnvConfig {
  /** 后端 API 基础 URL（必填） */
  VITE_API_BASE_URL: string;
  /** 应用环境（development / production） */
  VITE_ENV: "development" | "production";
  /** 是否开启调试模式 */
  VITE_DEBUG: boolean;
}

/**
 * 必需的环境变量列表
 *
 * 这些变量必须在构建时配置，缺失则应用无法正常运行。
 */
const REQUIRED_VARS: (keyof EnvConfig)[] = ["VITE_API_BASE_URL"];

/**
 * 读取并校验环境变量
 *
 * 作用：
 *   从 import.meta.env 读取环境变量，校验必需项，
 *   缺失时抛出包含变量名和修复建议的明确错误。
 *
 * @returns 校验通过的环境变量对象
 * @throws Error - 必需变量缺失时抛出
 */
function loadAndValidateEnv(): EnvConfig {
  const missing: string[] = [];

  // 检查必需变量
  for (const key of REQUIRED_VARS) {
    const value = import.meta.env[key];
    if (!value || typeof value !== "string" || value.trim() === "") {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `前端环境变量校验失败：以下必需变量未配置：\n` +
        missing.map((k) => `  - ${k}`).join("\n") +
        `\n请在项目根目录的 .env 文件中配置这些变量。\n` +
        `参考 .env.example 文件了解各变量的用途。`,
    );
  }

  // 构建并返回环境变量对象
  return {
    VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
    VITE_ENV: (import.meta.env.VITE_ENV as "development" | "production") ||
      (import.meta.env.PROD ? "production" : "development"),
    VITE_DEBUG: import.meta.env.VITE_DEBUG === "true",
  };
}

/** 校验通过的环境变量对象 */
export const env = loadAndValidateEnv();
