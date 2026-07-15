/**
 * 错误消息友好化工具
 *
 * 作用：
 *   将后端 API 错误（HttpClientError）、网络错误、用户取消等异常
 *   转换为用户可理解、可定位问题的中文提示。
 *
 * 设计原则：
 *   1. 标题（title）：简短的错误分类，让用户一眼定位问题类型
 *      例如 "网络连接失败"、"权限不足"、"服务器暂时不可用"
 *   2. 描述（description）：可操作的建议或具体原因
 *      例如 "请检查网络后重试"、"您没有执行此操作的权限"
 *
 * 使用方式：
 *   import { formatApiError } from "@/utils/errorMessage";
 *   const { title, description } = formatApiError(err, "删除失败");
 *   toast.error(title, description);
 *
 *   或通过 toastStore.apiError(fallbackTitle, err) 快捷调用
 */

import { HttpClientError } from "@/api/client";
import type { ApiError } from "@/types/api";

/** 友好错误提示结构 */
export interface FriendlyError {
  /** 错误标题（分类化，简短） */
  title: string;
  /** 错误描述（可操作的建议或具体原因，可选） */
  description?: string;
}

/**
 * 将任意错误对象转换为用户友好的中文提示
 *
 * @param err - 捕获的错误对象（通常是 HttpClientError、TypeError、DOMException 等）
 * @param fallbackTitle - 兜底标题（当错误无法识别时使用，如 "删除失败"）
 * @returns { title, description? } 友好的错误提示
 */
export function formatApiError(
  err: unknown,
  fallbackTitle = "操作失败",
): FriendlyError {
  // 1. 用户主动取消（AbortError）
  if (err instanceof DOMException && err.name === "AbortError") {
    return { title: "操作已取消", description: "您已主动取消本次操作" };
  }

  // 2. 非 HttpClientError：可能是网络错误或原生 JS 错误
  if (!(err instanceof HttpClientError)) {
    // TypeError 通常是 fetch 网络层失败（DNS 解析失败、连接拒绝等）
    if (err instanceof TypeError) {
      return {
        title: "网络连接失败",
        description: "无法连接到服务器，请检查网络后重试",
      };
    }
    // 普通错误：保留原始消息作为描述
    if (err instanceof Error && err.message) {
      return { title: fallbackTitle, description: err.message };
    }
    return { title: fallbackTitle };
  }

  // 3. status === 0：网络层失败（请求未到达服务器）
  if (err.status === 0) {
    return {
      title: "网络连接失败",
      description: "无法连接到服务器，请检查网络后重试",
    };
  }

  // 4. 提取后端返回的 detail 文本（可能是字符串或 Pydantic 校验错误数组）
  const rawDetail = extractDetail(err.detail);

  // 5. 按 HTTP 状态码分类映射
  switch (err.status) {
    case 400:
      return {
        title: "请求参数有误",
        description: rawDetail || "请检查输入内容后重试",
      };
    case 401:
      return {
        title: "登录已过期",
        description: "请重新登录后再操作",
      };
    case 403:
      return {
        title: "权限不足",
        description: rawDetail || "您没有执行此操作的权限",
      };
    case 404:
      return {
        title: "资源不存在",
        description: rawDetail || "请求的内容已被删除或不存在",
      };
    case 409:
      return {
        title: "操作冲突",
        description: rawDetail || "资源已存在或状态冲突",
      };
    case 413:
      return {
        title: "文件过大",
        description: "请上传更小的文件后重试",
      };
    case 422:
      return {
        title: "参数校验失败",
        description: rawDetail || "请检查输入内容是否符合要求",
      };
    case 429:
      return {
        title: "操作过于频繁",
        description: "请稍等片刻后再试",
      };
    default:
      // 5xx 服务器错误
      if (err.status >= 500) {
        return {
          title: "服务器暂时不可用",
          description:
            rawDetail || "服务异常，请稍后重试。如持续出现，请联系管理员",
        };
      }
      // 其他 4xx 客户端错误
      if (err.status >= 400) {
        return {
          title: fallbackTitle,
          description: rawDetail || `请求失败（HTTP ${err.status}）`,
        };
      }
      return { title: fallbackTitle, description: rawDetail };
  }
}

/**
 * 从 ApiError.detail 中提取人类可读的错误描述
 *
 * 后端 detail 可能是：
 *   - 字符串：直接返回（如 "Document not found"）
 *   - 数组：Pydantic 校验错误，格式为 [{msg, type, loc}]
 *   - 对象：业务错误，格式为 {"error": {"code", "message", ...}}
 *
 * @param detail - ApiError.detail 字段
 * @returns 可读的错误描述字符串，无内容时返回 undefined
 */
function extractDetail(detail: ApiError["detail"]): string | undefined {
  if (!detail) return undefined;

  // 字符串类型：直接返回
  if (typeof detail === "string") {
    return detail || undefined;
  }

  // 数组类型：Pydantic 校验错误，拼接字段名 + 错误信息
  if (Array.isArray(detail) && detail.length > 0) {
    const parts = detail.slice(0, 3).map((e) => {
      // loc 形如 ["body", "field_name"]，过滤掉 "body" 前缀
      const field = e.loc
        ? e.loc.filter((l) => l !== "body" && l !== "query").join(".")
        : "";
      const msg = e.msg || "";
      return field ? `${field}: ${msg}` : msg;
    });
    return parts.join("；") || undefined;
  }

  // 对象类型：业务错误 {"error": {"code", "message", ...}}
  // 作用：后端统一错误格式，提取 message 字段作为可读描述
  if (typeof detail === "object" && detail !== null && !Array.isArray(detail)) {
    const errObj = (detail as { error?: { message?: string; code?: string } }).error;
    if (errObj?.message) {
      return errObj.message;
    }
  }

  return undefined;
}
