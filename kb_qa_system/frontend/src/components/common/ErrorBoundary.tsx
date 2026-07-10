/**
 * 错误边界组件
 *
 * 作用：
 *   捕获子组件树渲染过程中的 JavaScript 错误，防止整个应用白屏。
 *   显示友好的错误降级 UI，支持用户手动重试（恢复组件状态）。
 *
 * 使用方式：
 *   <ErrorBoundary>
 *     <App />
 *   </ErrorBoundary>
 *
 * 注意：
 *   Error Boundary 仅捕获组件渲染、生命周期和构造函数中的错误，
 *   不捕获事件处理函数、异步代码和 setTimeout 中的错误。
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

/** ErrorBoundary 组件属性 */
interface ErrorBoundaryProps {
  /** 子组件 */
  children: ReactNode;
  /** 自定义降级 UI（可选） */
  fallback?: ReactNode;
  /** 错误回调（可用于上报错误日志） */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

/** ErrorBoundary 组件状态 */
interface ErrorBoundaryState {
  /** 是否发生错误 */
  hasError: boolean;
  /** 错误对象 */
  error: Error | null;
}

/** ErrorBoundary 组件 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  /**
   * 静态方法：捕获错误并更新状态
   * 在派生类渲染期间调用，返回值将作为新的 state
   *
   * @param error - 捕获的错误对象
   * @returns 新的状态
   */
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  /**
   * 错误捕获后的回调
   * 用于记录错误信息或上报错误日志
   *
   * @param error - 错误对象
   * @param errorInfo - 错误信息（组件堆栈）
   */
  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // 调用外部错误回调（可用于 Sentry 等错误上报）
    this.props.onError?.(error, errorInfo);

    // 控制台输出错误信息（开发环境调试）
    if (import.meta.env.DEV) {
      console.error("[ErrorBoundary] 捕获到渲染错误:", error, errorInfo);
    }
  }

  /** 重置错误状态，尝试重新渲染 */
  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  /** 刷新整个页面 */
  handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    // 未发生错误：正常渲染子组件
    if (!this.state.hasError) {
      return this.props.children;
    }

    // 使用自定义降级 UI
    if (this.props.fallback) {
      return this.props.fallback;
    }

    // 默认降级 UI
    const error = this.state.error;
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4 p-8">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-50">
          <AlertTriangle className="h-8 w-8 text-danger" />
        </div>
        <div className="text-center">
          <h2 className="text-lg font-semibold text-ink">
            页面渲染出现错误
          </h2>
          <p className="mt-1 text-sm text-ink-secondary">
            应用遇到了意外错误，请尝试重试或刷新页面
          </p>
        </div>

        {/* 开发环境下显示错误详情 */}
        {import.meta.env.DEV && error && (
          <details className="w-full max-w-2xl rounded-lg border border-line bg-surface p-4">
            <summary className="cursor-pointer text-sm font-medium text-ink-secondary">
              查看错误详情（仅开发环境）
            </summary>
            <pre className="mt-2 overflow-auto rounded bg-muted p-3 text-xs text-danger">
              {error.message}
              {"\n\n"}
              {error.stack}
            </pre>
          </details>
        )}

        {/* 操作按钮 */}
        <div className="flex gap-3">
          <button
            onClick={this.handleReset}
            className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-muted"
          >
            <RefreshCw className="h-4 w-4" />
            重试
          </button>
          <button
            onClick={this.handleReload}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
          >
            刷新页面
          </button>
        </div>
      </div>
    );
  }
}
