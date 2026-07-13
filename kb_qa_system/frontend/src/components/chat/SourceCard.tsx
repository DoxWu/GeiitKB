/**
 * 引用来源卡片组件
 *
 * 作用：
 *   展示 AI 回答引用的文档片段，包括文档标题、相关度分数和内容摘要。
 *   支持折叠/展开查看完整引用内容。
 *
 * 使用方式：
 *   <SourceCard source={sourceItem} />
 */

import { useState } from "react";
import { ChevronDown, ChevronUp, FileText } from "lucide-react";
import { Badge } from "@/components/common";
import { cn } from "@/lib/utils";
import type { SourceItem } from "@/types/chat";

/** SourceCard 组件属性 */
interface SourceCardProps {
  /** 引用来源数据 */
  source: SourceItem;
}

/** 内容摘要最大字符数（超出时截断） */
const SUMMARY_MAX_LENGTH = 150;

/**
 * 根据相关度分数获取置信度级别
 *
 * 作用：
 *   将 0-1 的分数映射为语义化的置信度标签和 Badge variant，
 *   让用户直观理解分数含义，而非仅看到一个百分比数字。
 *
 * 分级标准（与后端 pre_generation_validator 对齐）：
 *   - score >= 0.7       → { label: "高置信", variant: "success" }  绿色，可靠
 *   - 0.5 <= score < 0.7 → { label: "较高",   variant: "brand" }    品牌色，可参考
 *   - score < 0.5        → { label: "参考",   variant: "warning" }  黄色，仅供参考
 *
 * 说明：
 *   后端 SIMILARITY_THRESHOLD=0.35 过滤掉低于 0.35 的结果，
 *   所以前端不会出现 < 0.35 的分数。0.35-0.5 区间为后端 "low" 置信度
 *   （回答前会附加"⚠️ 仅供参考"提示），前端标记为"参考"。
 */
function getConfidenceLevel(score: number): {
  label: string;
  variant: "success" | "brand" | "warning";
} {
  if (score >= 0.7) {
    return { label: "高置信", variant: "success" };
  }
  if (score >= 0.5) {
    return { label: "较高", variant: "brand" };
  }
  return { label: "参考", variant: "warning" };
}

/** SourceCard 组件 */
export function SourceCard({ source }: SourceCardProps) {
  const [expanded, setExpanded] = useState(false);

  /** 相关度百分比（0-100） */
  const scorePercent = Math.round(source.score * 100);

  /** 置信度级别（分段式标签，与后端 confidence 分级语义对齐） */
  const { label: confidenceLabel, variant: confidenceVariant } =
    getConfidenceLevel(source.score);

  /** 是否需要折叠（内容超过摘要长度） */
  const needCollapse = source.content.length > SUMMARY_MAX_LENGTH;

  /** 显示的内容（折叠时截断） */
  const displayContent = expanded
    ? source.content
    : needCollapse
      ? source.content.slice(0, SUMMARY_MAX_LENGTH) + "..."
      : source.content;

  return (
    <div
      className={cn(
        "rounded-lg border border-line bg-muted/50 p-3",
        "transition-colors hover:border-brand/30",
      )}
    >
      {/* 头部：标题 + 分数 */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <FileText className="h-3.5 w-3.5 shrink-0 text-ink-tertiary" />
          <span className="truncate text-xs font-medium text-ink">
            {source.title}
          </span>
        </div>
        <Badge variant={confidenceVariant} className="shrink-0">
          {confidenceLabel} · {scorePercent}%
        </Badge>
      </div>

      {/* 内容区 */}
      <p className="mt-2 text-xs leading-relaxed text-ink-secondary">
        {displayContent}
      </p>

      {/* 展开/折叠按钮 */}
      {needCollapse && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1.5 flex items-center gap-0.5 text-xs text-brand transition-colors hover:text-brand-hover"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3 w-3" />
              收起
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" />
              展开全部
            </>
          )}
        </button>
      )}
    </div>
  );
}
