/**
 * ErrorBoundary 组件测试
 *
 * 覆盖范围：
 *   - 正常渲染子组件（无错误时）
 *   - 捕获渲染错误并显示降级 UI
 *   - 重试按钮重置错误状态
 *   - 自定义 fallback 渲染
 *   - onError 回调调用
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorBoundary } from "../ErrorBoundary";

/** 制造渲染错误的组件 */
function ThrowComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("测试渲染错误");
  }
  return <div>正常内容</div>;
}

describe("ErrorBoundary 组件", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 抑制 console.error 输出（React 会打印错误日志）
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("无错误时正常渲染子组件", () => {
    render(
      <ErrorBoundary>
        <ThrowComponent shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("正常内容")).toBeInTheDocument();
  });

  it("捕获渲染错误并显示降级 UI", () => {
    render(
      <ErrorBoundary>
        <ThrowComponent shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("页面渲染出现错误")).toBeInTheDocument();
    expect(screen.getByText("重试")).toBeInTheDocument();
    expect(screen.getByText("刷新页面")).toBeInTheDocument();
  });

  it("点击重试按钮重置错误状态", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ErrorBoundary>
        <ThrowComponent shouldThrow={true} />
      </ErrorBoundary>,
    );

    // 初始渲染抛错，显示降级 UI
    expect(screen.getByText("页面渲染出现错误")).toBeInTheDocument();

    // 先 rerender 传递 shouldThrow=false
    // 注意：此时 ErrorBoundary 仍处于 hasError=true 状态，会继续显示降级 UI，
    // 不会重新渲染子组件，因此不会再次抛错。
    // 新的 children prop 被存储但尚未渲染。
    rerender(
      <ErrorBoundary>
        <ThrowComponent shouldThrow={false} />
      </ErrorBoundary>,
    );

    // 降级 UI 仍然显示（证明 rerender 未触发子组件渲染）
    expect(screen.getByText("重试")).toBeInTheDocument();

    // 点击重试：ErrorBoundary 重置 hasError=false，
    // 重新渲染时使用更新后的 children prop（shouldThrow=false），不再抛错
    await user.click(screen.getByText("重试"));

    expect(screen.getByText("正常内容")).toBeInTheDocument();
  });

  it("使用自定义 fallback", () => {
    render(
      <ErrorBoundary fallback={<div>自定义错误页面</div>}>
        <ThrowComponent shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("自定义错误页面")).toBeInTheDocument();
    expect(screen.queryByText("页面渲染出现错误")).not.toBeInTheDocument();
  });

  it("onError 回调被调用", () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary onError={onError}>
        <ThrowComponent shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0][0].message).toBe("测试渲染错误");
  });
});
