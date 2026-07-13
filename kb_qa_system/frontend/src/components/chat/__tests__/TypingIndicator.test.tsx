/**
 * TypingIndicator 组件单元测试
 *
 * 覆盖范围：
 *   - 渲染三个圆点
 *   - 无障碍属性
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TypingIndicator } from "../TypingIndicator";

describe("TypingIndicator 组件", () => {
  it("渲染三个圆点", () => {
    const { container } = render(<TypingIndicator />);
    const dots = container.querySelectorAll("span.animate-bounce");
    expect(dots).toHaveLength(3);
  });

  it("包含无障碍 status 角色", () => {
    render(<TypingIndicator />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("包含 aria-label", () => {
    render(<TypingIndicator />);
    expect(screen.getByLabelText("AI 正在思考")).toBeInTheDocument();
  });
});
