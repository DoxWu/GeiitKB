/**
 * Markdown 渲染组件
 *
 * 作用：
 *   将 LLM 生成的 Markdown 内容渲染为带样式的 React 元素。
 *   支持 GFM（表格、任务列表、删除线、自动链接）和代码语法高亮。
 *
 * 实现方式：
 *   - react-markdown：核心 Markdown 解析渲染
 *   - remark-gfm：GFM 扩展（表格、任务列表、删除线、自动链接）
 *   - rehype-highlight：代码语法高亮（配合 highlight.js 主题样式）
 *   - 自定义 components：覆盖默认渲染元素，应用 Tailwind 样式
 *
 * 样式规范：
 *   - 与现有设计系统（brand、ink、surface、muted、line）协调
 *   - 代码块：暗色背景 + 横向滚动 + GitHub 主题高亮
 *   - 内联代码：muted 背景 + brand 文字
 *   - 表格：边框 + 滚动容器
 *   - 链接：新窗口打开 + noopener 防护
 *
 * 使用方式：
 *   <MarkdownRenderer content={message.content} />
 *   <MarkdownRenderer content="# 标题" className="custom-class" />
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { cn } from "@/lib/utils";

/** MarkdownRenderer 组件属性 */
interface MarkdownRendererProps {
  /** Markdown 格式的文本内容 */
  content: string;
  /** 自定义样式类名 */
  className?: string;
}

/**
 * 代码块组件
 *
 * 作用：
 *   区分内联代码和代码块，应用不同样式。
 *   react-markdown v9 移除了 `inline` prop，通过 className 判断：
 *   - 有 className（含 language- 或 hljs）→ 代码块内的 code
 *   - 无 className → 内联代码
 */
function CodeBlock({ className, children, ...props }: React.HTMLAttributes<HTMLElement>) {
  // 有 className 说明是代码块（rehype-highlight 添加 language-xxx 或 hljs 类名）
  if (className) {
    return (
      <code className={cn(className, "block")} {...props}>
        {children}
      </code>
    );
  }
  // 内联代码
  return (
    <code
      className="rounded bg-muted px-1 py-0.5 text-xs font-mono text-brand"
      {...props}
    >
      {children}
    </code>
  );
}

/** MarkdownRenderer 组件 */
export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={cn("markdown-body text-sm leading-relaxed", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          // 标题
          h1: ({ node, ...props }) => (
            <h1 className="mt-4 mb-2 text-base font-bold text-ink" {...props} />
          ),
          h2: ({ node, ...props }) => (
            <h2 className="mt-3 mb-2 text-sm font-bold text-ink" {...props} />
          ),
          h3: ({ node, ...props }) => (
            <h3 className="mt-3 mb-1 text-sm font-semibold text-ink" {...props} />
          ),
          h4: ({ node, ...props }) => (
            <h4 className="mt-2 mb-1 text-sm font-semibold text-ink" {...props} />
          ),
          // 段落
          p: ({ node, ...props }) => <p className="my-2 leading-relaxed" {...props} />,
          // 列表
          ul: ({ node, ...props }) => (
            <ul className="my-2 ml-5 list-disc space-y-1" {...props} />
          ),
          ol: ({ node, ...props }) => (
            <ol className="my-2 ml-5 list-decimal space-y-1" {...props} />
          ),
          li: ({ node, ...props }) => <li className="leading-relaxed" {...props} />,
          // 任务列表项（GFM）
          input: ({ node, ...props }) => (
            <input
              type="checkbox"
              disabled
              className="mr-1.5 align-middle"
              {...props}
            />
          ),
          // 链接
          a: ({ node, ...props }) => (
            <a
              className="text-brand underline hover:text-brand-hover"
              target="_blank"
              rel="noopener noreferrer"
              {...props}
            />
          ),
          // 引用块
          blockquote: ({ node, ...props }) => (
            <blockquote
              className="my-2 border-l-2 border-brand/40 pl-3 italic text-ink-secondary"
              {...props}
            />
          ),
          // 代码（区分内联/块级）
          code: CodeBlock as any,
          // 代码块容器
          pre: ({ node, ...props }) => (
            <pre
              className="my-2 overflow-x-auto rounded-md border border-line bg-muted p-3 text-xs"
              {...props}
            />
          ),
          // 表格
          table: ({ node, ...props }) => (
            <div className="my-2 overflow-x-auto">
              <table
                className="w-full border-collapse text-xs"
                {...props}
              />
            </div>
          ),
          thead: ({ node, ...props }) => (
            <thead className="bg-muted" {...props} />
          ),
          th: ({ node, ...props }) => (
            <th
              className="border border-line px-2 py-1 text-left font-medium text-ink"
              {...props}
            />
          ),
          td: ({ node, ...props }) => (
            <td
              className="border border-line px-2 py-1 text-ink-secondary"
              {...props}
            />
          ),
          // 分隔线
          hr: ({ node, ...props }) => (
            <hr className="my-3 border-line" {...props} />
          ),
          // 删除线（GFM）
          del: ({ node, ...props }) => (
            <del className="text-ink-tertiary line-through" {...props} />
          ),
          // 强调
          strong: ({ node, ...props }) => (
            <strong className="font-semibold text-ink" {...props} />
          ),
          em: ({ node, ...props }) => (
            <em className="italic" {...props} />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
