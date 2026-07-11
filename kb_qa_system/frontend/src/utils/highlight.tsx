/**
 * 搜索关键词高亮工具（D2-02）
 *
 * 作用：
 *   将文本中匹配关键词的部分用 <mark> 标签包裹，实现搜索结果高亮。
 *   支持大小写不敏感匹配，正则特殊字符自动转义。
 *
 * 使用方式：
 *   import { highlightKeyword } from '@/utils/highlight';
 *   <span>{highlightKeyword(document.title, searchKeyword)}</span>
 */

import type { ReactNode } from "react";

/**
 * 转义正则表达式特殊字符
 *
 * 作用：
 *   防止用户输入的关键词中包含正则元字符（如 . * + ? 等）导致匹配异常。
 *
 * @param str - 原始字符串
 * @returns 转义后的安全正则字符串
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 高亮搜索关键词
 *
 * 作用：
 *   将文本中所有匹配关键词的部分用 <mark> 标签包裹，
 *   返回 React 节点数组供 JSX 渲染。
 *
 * 实现方式：
 *   1. 关键词为空时直接返回原文本
 *   2. 构建全局不区分大小写的正则表达式
 *   3. 按 regex split 文本，匹配部分用 <mark> 包裹
 *
 * @param text - 原始文本
 * @param keyword - 要高亮的关键词
 * @returns React 节点数组（匹配部分用 <mark> 包裹）
 */
export function highlightKeyword(text: string, keyword: string): ReactNode[] {
  const trimmed = keyword.trim();
  if (!trimmed) return [text];

  try {
    const regex = new RegExp(`(${escapeRegExp(trimmed)})`, "gi");
    const parts = text.split(regex);

    return parts.map((part, index) => {
      // 匹配部分（与关键词不区分大小写相等）
      if (part.toLowerCase() === trimmed.toLowerCase()) {
        return (
          <mark
            key={index}
            className="rounded bg-yellow-200 px-0.5 text-inherit dark:bg-yellow-700 dark:text-yellow-100"
          >
            {part}
          </mark>
        );
      }
      return part;
    });
  } catch {
    // 正则构建失败（极端情况），返回原文本
    return [text];
  }
}
