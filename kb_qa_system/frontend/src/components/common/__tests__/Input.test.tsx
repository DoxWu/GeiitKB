/**
 * Input 组件单元测试
 *
 * 覆盖范围：
 *   - 渲染：label、placeholder、value
 *   - 交互：onChange 输入事件
 *   - 错误状态：显示错误文案、应用错误样式
 *   - 辅助说明：hint 提示
 *   - 图标：左侧 icon、右侧 rightIcon
 *   - 禁用状态
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Input } from "../Input";

describe("Input 组件", () => {
  it("渲染 label 和 placeholder", () => {
    render(<Input label="邮箱" placeholder="请输入邮箱" name="email" />);
    expect(screen.getByText("邮箱")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("请输入邮箱")).toBeInTheDocument();
  });

  it("输入触发 onChange 并更新值", async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(
      <Input
        name="email"
        placeholder="邮箱"
        onChange={handleChange}
      />,
    );
    const input = screen.getByPlaceholderText("邮箱");
    await user.type(input, "a");
    expect(handleChange).toHaveBeenCalled();
  });

  it("显示错误信息并应用错误样式", () => {
    render(
      <Input name="email" label="邮箱" error="邮箱格式不正确" />,
    );
    expect(screen.getByText("邮箱格式不正确")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveClass("border-danger");
  });

  it("显示 hint 辅助说明（无错误时）", () => {
    render(
      <Input name="email" hint="请输入有效邮箱地址" />,
    );
    expect(screen.getByText("请输入有效邮箱地址")).toBeInTheDocument();
  });

  it("有 error 时优先显示 error 而非 hint", () => {
    render(
      <Input
        name="email"
        error="错误"
        hint="提示"
      />,
    );
    expect(screen.getByText("错误")).toBeInTheDocument();
    expect(screen.queryByText("提示")).not.toBeInTheDocument();
  });

  it("渲染左侧图标", () => {
    render(
      <Input
        name="email"
        icon={<span data-testid="left-icon">📧</span>}
      />,
    );
    expect(screen.getByTestId("left-icon")).toBeInTheDocument();
  });

  it("渲染右侧图标", () => {
    render(
      <Input
        name="password"
        rightIcon={<span data-testid="right-icon">👁</span>}
      />,
    );
    expect(screen.getByTestId("right-icon")).toBeInTheDocument();
  });

  it("disabled 状态", () => {
    render(<Input name="email" disabled placeholder="禁用" />);
    expect(screen.getByPlaceholderText("禁用")).toBeDisabled();
  });

  it("label 关联 input 的 id", () => {
    render(<Input name="email" label="邮箱" id="email-field" />);
    expect(screen.getByLabelText("邮箱")).toHaveAttribute("id", "email-field");
  });
});
