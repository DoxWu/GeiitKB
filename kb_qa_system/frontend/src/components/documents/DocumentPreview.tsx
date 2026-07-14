/**
 * 文档预览面板组件
 *
 * 作用：
 *   在右侧滑出面板中展示文档详细信息和内容预览，包括：
 *   - 文件基本信息（名称、类型、大小、状态）
 *   - 处理信息（分块数、Token 数、质量分）
 *   - 内容预览（Markdown/TXT/CSV 渲染、PDF iframe、其他格式提示）
 *   - 操作按钮（删除、重新处理）
 *
 * 使用方式：
 *   <DocumentPreview />  // 从 documentStore 读取 previewDocument 和 previewOpen
 */

import {
  X,
  Trash2,
  RefreshCw,
  Calendar,
  HardDrive,
  Layers,
  Hash,
  ShieldCheck,
  AlertTriangle,
  FileWarning,
  Loader2,
  Globe,
  Lock,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { Badge, Button } from "@/components/common";
import { useDocumentStore } from "@/store/documentStore";
import { useToastStore } from "@/store/toastStore";
import { formatFileSize, formatDate, getStatusLabel, getProcessingStepLabel } from "@/utils/format";
import {
  getFileIcon,
  isTextPreviewable,
  isIframePreviewable,
  isPreviewable,
} from "@/utils/fileType";
import { API_BASE_URL } from "@/utils/constants";
import { cn } from "@/lib/utils";
import type { DocumentResponse } from "@/types/document";

/** 信息行属性 */
interface InfoRowProps {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}

/** 信息行组件 */
function InfoRow({ icon, label, value }: InfoRowProps) {
  return (
    <div className="flex items-center gap-2 py-2">
      <span className="text-ink-tertiary">{icon}</span>
      <span className="text-xs text-ink-secondary">{label}</span>
      <span className="ml-auto text-xs font-medium text-ink">{value}</span>
    </div>
  );
}

/** 预览内容加载状态 */
type PreviewLoadState = "idle" | "loading" | "success" | "error";

/** DocumentPreview 组件 */
export function DocumentPreview() {
  const {
    previewDocument,
    previewOpen,
    closePreview,
    removeDocument,
    reprocessDocument,
  } = useDocumentStore();
  const toast = useToastStore();

  const [previewContent, setPreviewContent] = useState<string>("");
  const [previewState, setPreviewState] = useState<PreviewLoadState>("idle");

  /** 加载文档内容预览
   * 作用：对文本类文件请求原始内容，对 PDF 使用 iframe，其他格式显示提示
   */
  const loadPreviewContent = useCallback(async (doc: DocumentResponse) => {
    // 非文本/iframe 类文件不加载内容
    if (!isPreviewable(doc.file_type)) {
      setPreviewState("idle");
      setPreviewContent("");
      return;
    }

    // PDF 使用 iframe，不需要加载文本
    if (isIframePreviewable(doc.file_type)) {
      setPreviewState("success");
      return;
    }

    // 文本类文件：请求原始内容
    setPreviewState("loading");
    try {
      const response = await fetch(
        `${API_BASE_URL}/documents/${doc.id}/content`,
        {
          headers: {
            Authorization: `Bearer ${JSON.parse(localStorage.getItem("kb_auth_tokens") || "{}").access_token || ""}`,
          },
        },
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const text = await response.text();
      setPreviewContent(text);
      setPreviewState("success");
    } catch {
      setPreviewState("error");
      setPreviewContent("");
    }
  }, []);

  // 文档变化时加载预览内容
  useEffect(() => {
    if (previewOpen && previewDocument) {
      loadPreviewContent(previewDocument);
    } else {
      setPreviewContent("");
      setPreviewState("idle");
    }
  }, [previewOpen, previewDocument, loadPreviewContent]);

  /** 处理删除 */
  async function handleDelete(doc: DocumentResponse) {
    if (!confirm(`确定删除文档"${doc.file_name}"吗？`)) return;
    try {
      await removeDocument(doc.id);
      toast.success("文档已删除");
    } catch (err) {
      toast.apiError("删除失败", err);
    }
  }

  /** 处理重新处理 */
  async function handleReprocess(doc: DocumentResponse) {
    try {
      await reprocessDocument(doc.id);
      toast.success("已重新提交处理");
    } catch (err) {
      toast.apiError("操作失败", err);
    }
  }

  // 未打开时不渲染
  if (!previewOpen || !previewDocument) {
    return null;
  }

  const doc = previewDocument;
  const IconComp = getFileIcon(doc.file_type);
  const isProcessing = doc.status === "processing";
  const isFailed = doc.status === "failed";
  const canPreview = isPreviewable(doc.file_type);

  return (
    <>
      {/* 遮罩层（移动端） */}
      {/* 修复问题1：原 bg-black/20 透明度过低，高缩放比例下文档详情与背景内容融合。
          提升至 bg-black/50 确保预览面板与背景清晰分离。 */}
      <div
        className="fixed inset-0 z-40 bg-black/50 lg:hidden"
        onClick={closePreview}
      />

      {/* 预览面板 */}
      <aside
        className={cn(
          "fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col",
          "border-l border-line bg-surface shadow-xl",
          "animate-slide-in-right lg:static lg:z-auto lg:w-96 lg:shadow-none",
        )}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h3 className="text-sm font-semibold text-ink">文档详情</h3>
          <button
            onClick={closePreview}
            className="rounded p-1 text-ink-tertiary transition-colors hover:bg-muted hover:text-ink"
            aria-label="关闭预览"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* 文件图标与名称 */}
          {/* 修复问题1：原 bg-muted/50 半透明，高缩放下与背景融合。改为不透明 bg-muted。 */}
          <div className="flex flex-col items-center gap-3 rounded-lg bg-muted py-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-surface shadow-sm">
              <IconComp className="h-8 w-8 text-brand" />
            </div>
            <div className="max-w-full text-center">
              <p className="break-all text-sm font-medium text-ink">
                {doc.file_name}
              </p>
              {doc.title !== doc.file_name && (
                <p className="mt-0.5 text-xs text-ink-tertiary">{doc.title}</p>
              )}
            </div>
            <Badge
              variant={
                doc.status === "completed"
                  ? "success"
                  : doc.status === "failed"
                    ? "danger"
                    : doc.status === "processing"
                      ? "brand"
                      : doc.status === "low_quality"
                        ? "warning"
                        : "default"
              }
            >
              {getStatusLabel(doc.status)}
            </Badge>
          </div>

          {/* 处理进度 */}
          {/* 修复问题1：原 bg-brand-light/50 半透明，改为不透明 bg-brand-light 增强可读性 */}
          {isProcessing && (
            <div className="mt-4 rounded-lg border border-brand-light bg-brand-light p-3">
              <div className="flex items-center justify-between text-xs text-brand">
                <span>{getProcessingStepLabel(doc.processing_step)}</span>
                <span>{doc.processing_progress}%</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface">
                <div
                  className="h-full rounded-full bg-brand transition-all duration-300"
                  style={{ width: `${doc.processing_progress}%` }}
                />
              </div>
            </div>
          )}

          {/* 错误信息 */}
          {isFailed && doc.error_message && (
            <div className="mt-4 flex gap-2 rounded-lg border border-danger/30 bg-danger/10 p-3 dark:border-danger/40 dark:bg-danger/20">
              <AlertTriangle className="h-4 w-4 shrink-0 text-danger" />
              <div>
                <p className="text-xs font-medium text-danger">处理失败</p>
                <p className="mt-0.5 text-xs text-danger/90 dark:text-danger/80">
                  {doc.error_message}
                </p>
              </div>
            </div>
          )}

          {/* 质量信息 */}
          {doc.quality_score !== null && (
            <div className="mt-4 flex gap-2 rounded-lg border border-line bg-surface p-3">
              <ShieldCheck
                className={cn(
                  "h-4 w-4 shrink-0",
                  doc.quality_score >= 60 ? "text-success" : "text-warning",
                )}
              />
              <div>
                <p className="text-xs font-medium text-ink">质量评分</p>
                <p className="mt-0.5 text-xs text-ink-secondary">
                  {doc.quality_score} / 100
                  {doc.quality_issues && doc.quality_issues.length > 0 && (
                    <span> · {doc.quality_issues.join("、")}</span>
                  )}
                </p>
              </div>
            </div>
          )}

          {/* 内容预览区 */}
          {doc.status === "completed" && canPreview && (
            <div className="mt-4">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
                内容预览
              </h4>
              {/* 修复问题1：原 bg-muted/30 过于透明，提升至 bg-muted/60 增强内容可读性 */}
              <div className="rounded-lg border border-line bg-muted/60 overflow-hidden">
                {/* 加载中 */}
                {previewState === "loading" && (
                  <div className="flex items-center justify-center gap-2 py-12 text-sm text-ink-secondary">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    加载预览内容...
                  </div>
                )}

                {/* 加载失败 */}
                {previewState === "error" && (
                  <div className="flex flex-col items-center gap-2 py-12 text-sm text-ink-tertiary">
                    <FileWarning className="h-6 w-6" />
                    <span>预览内容加载失败</span>
                  </div>
                )}

                {/* PDF iframe 预览 */}
                {previewState === "success" && isIframePreviewable(doc.file_type) && (
                  <iframe
                    src={`${API_BASE_URL}/documents/${doc.id}/content`}
                    className="h-96 w-full border-0"
                    title={doc.file_name}
                  />
                )}

                {/* 文本类内容预览 */}
                {previewState === "success" &&
                  isTextPreviewable(doc.file_type) && (
                    <pre className="max-h-96 overflow-auto p-3 text-xs leading-relaxed text-ink whitespace-pre-wrap break-words">
                      {previewContent || "(空文件)"}
                    </pre>
                  )}
              </div>
            </div>
          )}

          {/* 不支持预览的文件类型提示 */}
          {doc.status === "completed" && !canPreview && (
            <div className="mt-4">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
                内容预览
              </h4>
              {/* 修复问题1：原 bg-muted/30 过于透明，提升至 bg-muted/60 */}
            <div className="flex flex-col items-center gap-2 rounded-lg border border-line bg-muted/60 py-12 text-sm text-ink-tertiary">
                <FileWarning className="h-6 w-6" />
                <span>该文件类型暂不支持在线预览</span>
                <span className="text-xs">({doc.file_type})</span>
              </div>
            </div>
          )}

          {/* 详细信息 */}
          <div className="mt-4">
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
              基本信息
            </h4>
            <div className="divide-y divide-line">
              <InfoRow
                icon={<IconComp className="h-3.5 w-3.5" />}
                label="文件类型"
                value={doc.file_type.toUpperCase()}
              />
              <InfoRow
                icon={<HardDrive className="h-3.5 w-3.5" />}
                label="文件大小"
                value={formatFileSize(doc.file_size)}
              />
              {/* 修复 Issue 8：显示文档库归属 */}
              <InfoRow
                icon={
                  doc.visibility === "public" ? (
                    <Globe className="h-3.5 w-3.5" />
                  ) : (
                    <Lock className="h-3.5 w-3.5" />
                  )
                }
                label="文档库"
                value={doc.visibility === "public" ? "公共文档库" : "个人文档库"}
              />
              <InfoRow
                icon={<Calendar className="h-3.5 w-3.5" />}
                label="创建时间"
                value={formatDate(doc.created_at)}
              />
              <InfoRow
                icon={<Calendar className="h-3.5 w-3.5" />}
                label="更新时间"
                value={formatDate(doc.updated_at)}
              />
            </div>
          </div>

          {/* 处理信息 */}
          <div className="mt-4">
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
              处理信息
            </h4>
            <div className="divide-y divide-line">
              <InfoRow
                icon={<Layers className="h-3.5 w-3.5" />}
                label="分块数量"
                value={doc.chunk_count || "—"}
              />
              <InfoRow
                icon={<Hash className="h-3.5 w-3.5" />}
                label="Token 总数"
                value={
                  doc.total_tokens > 0
                    ? doc.total_tokens.toLocaleString()
                    : "—"
                }
              />
            </div>
          </div>
        </div>

        {/* 底部操作区 */}
        <div className="flex gap-2 border-t border-line px-4 py-3">
          {isFailed && (
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={() => handleReprocess(doc)}
            >
              重新处理
            </Button>
          )}
          <Button
            variant="danger"
            size="sm"
            className="ml-auto"
            icon={<Trash2 className="h-3.5 w-3.5" />}
            onClick={() => handleDelete(doc)}
          >
            删除文档
          </Button>
        </div>
      </aside>
    </>
  );
}
