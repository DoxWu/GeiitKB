/**
 * ErrorState 组件单元测试
 *
 * 覆盖范围：
 *   - 渲染：默认错误信息、自定义错误信息
 *   - 重试：显示重试按钮、点击触发 onRetry
 *   - 无 onRetry 时不渲染重试按钮
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorState } from "../ErrorState";

describe("ErrorState 组件", () => {
  it("显示默认错误信息", () => {
    render(<ErrorState />);
    expect(screen.getByText("发生错误，请重试")).toBeInTheDocument();
  });

  it("显示自定义错误信息", () => {
    render(<ErrorState message="加载文档失败" />);
    expect(screen.getByText("加载文档失败")).toBeInTheDocument();
  });

  it("显示重试按钮并点击触发 onRetry", async () => {
    const user = userEvent.setup();
    const handleRetry = vi.fn();
    render(<ErrorState message="错误" onRetry={handleRetry} />);
    const retryBtn = screen.getByText("重试");
    await user.click(retryBtn);
    expect(handleRetry).toHaveBeenCalledTimes(1);
  });

  it("无 onRetry 时不渲染重试按钮", () => {
    render(<ErrorState message="错误" />);
    expect(screen.queryByText("重试")).not.toBeInTheDocument();
  });
});
