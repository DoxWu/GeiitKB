/**
 * fileType.ts 单元测试
 *
 * 覆盖范围：
 *   - getFileIcon：文件类型 → 图标映射
 *   - isTextPreviewable：文本类可预览判断
 *   - isIframePreviewable：iframe 可预览判断
 *   - isPreviewable：综合可预览判断
 */

import { describe, it, expect } from "vitest";
import {
  getFileIcon,
  isTextPreviewable,
  isIframePreviewable,
  isPreviewable,
  FILE_ICON_MAP,
} from "@/utils/fileType";
import { File as FileIcon } from "lucide-react";

describe("getFileIcon", () => {
  it("已知文件类型返回对应图标组件", () => {
    expect(getFileIcon(".pdf")).toBe(FILE_ICON_MAP[".pdf"]);
    expect(getFileIcon(".txt")).toBe(FILE_ICON_MAP[".txt"]);
    expect(getFileIcon(".md")).toBe(FILE_ICON_MAP[".md"]);
    expect(getFileIcon(".csv")).toBe(FILE_ICON_MAP[".csv"]);
    expect(getFileIcon(".xlsx")).toBe(FILE_ICON_MAP[".xlsx"]);
    expect(getFileIcon(".docx")).toBe(FILE_ICON_MAP[".docx"]);
    expect(getFileIcon(".html")).toBe(FILE_ICON_MAP[".html"]);
  });

  it("大小写不敏感", () => {
    expect(getFileIcon(".PDF")).toBe(FILE_ICON_MAP[".pdf"]);
    expect(getFileIcon(".MD")).toBe(FILE_ICON_MAP[".md"]);
  });

  it("未知文件类型返回默认 FileIcon", () => {
    expect(getFileIcon(".unknown")).toBe(FileIcon);
    expect(getFileIcon(".xyz")).toBe(FileIcon);
  });
});

describe("isTextPreviewable", () => {
  it("文本类文件返回 true", () => {
    expect(isTextPreviewable(".txt")).toBe(true);
    expect(isTextPreviewable(".md")).toBe(true);
    expect(isTextPreviewable(".markdown")).toBe(true);
    expect(isTextPreviewable(".csv")).toBe(true);
    expect(isTextPreviewable(".html")).toBe(true);
    expect(isTextPreviewable(".htm")).toBe(true);
  });

  it("非文本类文件返回 false", () => {
    expect(isTextPreviewable(".pdf")).toBe(false);
    expect(isTextPreviewable(".docx")).toBe(false);
    expect(isTextPreviewable(".xlsx")).toBe(false);
    expect(isTextPreviewable(".pptx")).toBe(false);
    expect(isTextPreviewable(".unknown")).toBe(false);
  });

  it("大小写不敏感", () => {
    expect(isTextPreviewable(".TXT")).toBe(true);
    expect(isTextPreviewable(".MD")).toBe(true);
  });
});

describe("isIframePreviewable", () => {
  it("PDF 返回 true", () => {
    expect(isIframePreviewable(".pdf")).toBe(true);
  });

  it("非 PDF 返回 false", () => {
    expect(isIframePreviewable(".txt")).toBe(false);
    expect(isIframePreviewable(".docx")).toBe(false);
    expect(isIframePreviewable(".html")).toBe(false);
  });

  it("大小写不敏感", () => {
    expect(isIframePreviewable(".PDF")).toBe(true);
  });
});

describe("isPreviewable", () => {
  it("文本类返回 true", () => {
    expect(isPreviewable(".txt")).toBe(true);
    expect(isPreviewable(".md")).toBe(true);
    expect(isPreviewable(".csv")).toBe(true);
  });

  it("PDF 返回 true", () => {
    expect(isPreviewable(".pdf")).toBe(true);
  });

  it("不可预览的格式返回 false", () => {
    expect(isPreviewable(".docx")).toBe(false);
    expect(isPreviewable(".xlsx")).toBe(false);
    expect(isPreviewable(".pptx")).toBe(false);
    expect(isPreviewable(".unknown")).toBe(false);
  });
});
