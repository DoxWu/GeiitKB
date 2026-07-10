/**
 * 文件类型工具函数
 *
 * 作用：
 *   提供文件类型与图标、可预览性的映射关系，
 *   供 DocumentItem 和 DocumentPreview 共享使用。
 */

import {
  FileText,
  FileCode,
  FileType,
  Sheet,
  Presentation,
  Globe,
  File as FileIcon,
} from "lucide-react";
import type { ComponentType } from "react";

/** 文件类型 → 图标组件映射 */
export const FILE_ICON_MAP: Record<string, ComponentType<{ className?: string }>> = {
  ".pdf": FileText,
  ".doc": FileType,
  ".docx": FileType,
  ".txt": FileText,
  ".md": FileCode,
  ".markdown": FileCode,
  ".csv": Sheet,
  ".xlsx": Sheet,
  ".xls": Sheet,
  ".ppt": Presentation,
  ".pptx": Presentation,
  ".html": Globe,
  ".htm": Globe,
};

/** 可直接渲染内容的文件类型（文本类） */
export const TEXT_PREVIEWABLE_TYPES = [
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".html",
  ".htm",
];

/** 可通过 iframe 嵌入预览的文件类型 */
export const IFRAME_PREVIEWABLE_TYPES = [".pdf"];

/**
 * 根据文件扩展名获取图标组件
 * @param fileType - 文件扩展名（如 ".pdf"）
 * @returns 对应的 lucide-react 图标组件
 */
export function getFileIcon(fileType: string): ComponentType<{ className?: string }> {
  return FILE_ICON_MAP[fileType.toLowerCase()] || FileIcon;
}

/**
 * 判断文件类型是否可直接渲染文本内容
 * @param fileType - 文件扩展名
 * @returns 是否可渲染
 */
export function isTextPreviewable(fileType: string): boolean {
  return TEXT_PREVIEWABLE_TYPES.includes(fileType.toLowerCase());
}

/**
 * 判断文件类型是否可通过 iframe 嵌入预览
 * @param fileType - 文件扩展名
 * @returns 是否可嵌入
 */
export function isIframePreviewable(fileType: string): boolean {
  return IFRAME_PREVIEWABLE_TYPES.includes(fileType.toLowerCase());
}

/**
 * 判断文件类型是否支持预览
 * @param fileType - 文件扩展名
 * @returns 是否支持预览
 */
export function isPreviewable(fileType: string): boolean {
  return (
    isTextPreviewable(fileType) ||
    isIframePreviewable(fileType)
  );
}
