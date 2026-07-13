/**
 * 格式化工具函数
 *
 * 作用：
 *   提供文件大小、日期、状态文案等格式化功能，
 *   供文档列表、预览等组件使用。
 */

/**
 * 格式化文件大小为人类可读字符串
 *
 * @param bytes - 文件字节数
 * @returns 格式化后的字符串，如 "1.5 MB"
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 0) return "—";

  const units = ["B", "KB", "MB", "GB", "TB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);

  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

/**
 * 格式化 ISO 日期字符串为本地显示格式
 *
 * @param isoString - ISO 8601 日期字符串
 * @param withTime - 是否包含时间，默认 true
 * @returns 格式化后的日期字符串，如 "2026-07-10 14:30"
 */
export function formatDate(isoString: string, withTime = true): string {
  if (!isoString) return "—";
  try {
    const date = new Date(isoString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    if (!withTime) return `${year}-${month}-${day}`;

    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  } catch {
    return isoString;
  }
}

/**
 * 相对时间格式化（如 "3 分钟前"、"2 小时前"）
 *
 * @param isoString - ISO 8601 日期字符串
 * @returns 相对时间字符串
 */
export function formatRelativeTime(isoString: string): string {
  if (!isoString) return "—";
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return "刚刚";
    if (minutes < 60) return `${minutes} 分钟前`;
    if (hours < 24) return `${hours} 小时前`;
    if (days < 7) return `${days} 天前`;
    return formatDate(isoString, false);
  } catch {
    return isoString;
  }
}

/**
 * 获取文档状态的中文显示文案
 *
 * @param status - 文档处理状态
 * @returns 中文状态文案
 */
export function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: "等待处理",
    processing: "处理中",
    completed: "已完成",
    failed: "处理失败",
    low_quality: "质量较低",
  };
  return labels[status] ?? status;
}

/**
 * 获取文档处理步骤的中文显示文案
 *
 * 作用：把后端的 processing_step（如 parsing/cleaning/chunking）转为中文显示，
 *   供进度条上方的步骤描述使用。
 *
 * @param step - 处理步骤标识
 * @returns 中文步骤文案
 */
export function getProcessingStepLabel(step: string | null | undefined): string {
  if (!step) return "处理中...";
  const labels: Record<string, string> = {
    uploaded: "已上传，等待处理",
    parsing: "正在解析文档",
    layout_analysis: "正在版面分析",
    cleaning: "正在清洗文本",
    table_extraction: "正在提取表格",
    ocr: "正在识别图片",
    chunking: "正在分块",
    embedding: "正在向量化",
    quality_scoring: "正在质量评分",
    completed: "处理完成",
    failed: "处理失败",
    queued: "排队中",
  };
  return labels[step] ?? step;
}
