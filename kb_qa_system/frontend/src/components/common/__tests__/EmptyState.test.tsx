/**
 * EmptyState 组件单元测试
 *
 * 覆盖范围：
 *   - 渲染：title、description、icon、action
 *   - 无 icon 时不渲染图标容器
 *   - 无 description 时不渲染描述
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "../EmptyState";

describe("EmptyState 组件", () => {
  it("渲染标题和描述", () => {
    render(
      <EmptyState title="暂无文档" description="点击上传添加文档" />,
    );
    expect(screen.getByText("暂无文档")).toBeInTheDocument();
    expect(screen.getByText("点击上传添加文档")).toBeInTheDocument();
  });

  it("渲染图标", () => {
    render(
      <EmptyState
        title="空"
        icon={<span data-testid="icon">📄</span>}
      />,
    );
    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });

  it("渲染 action 操作按钮", () => {
    render(
      <EmptyState
        title="空"
        action={<button>上传</button>}
      />,
    );
    expect(screen.getByText("上传")).toBeInTheDocument();
  });

  it("无 description 时不渲染描述段落", () => {
    const { container } = render(<EmptyState title="只有标题" />);
    expect(screen.getByText("只有标题")).toBeInTheDocument();
    // EmptyState 内 description 存在时才有 text-ink-secondary 段落
    expect(container.querySelector(".text-ink-secondary")).not.toBeInTheDocument();
  });

  it("仅渲染 title（最小 props）", () => {
    render(<EmptyState title="最小" />);
    expect(screen.getByText("最小")).toBeInTheDocument();
  });
});
