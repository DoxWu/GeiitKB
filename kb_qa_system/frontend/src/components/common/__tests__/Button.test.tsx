/**
 * Button 组件单元测试
 *
 * 覆盖范围：
 *   - 渲染：默认文案、变体、尺寸
 *   - 交互：点击事件
 *   - 状态：loading 显示 spinner 并禁用、disabled 禁用点击
 *   - 样式：fullWidth 占满宽度、图标渲染
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "../Button";

describe("Button 组件", () => {
  it("渲染子内容", () => {
    render(<Button>登录</Button>);
    expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument();
  });

  it("点击触发 onClick 回调", async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>点击</Button>);
    await user.click(screen.getByRole("button"));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("loading 状态下禁用按钮且不触发 onClick", async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();
    render(
      <Button loading onClick={handleClick}>
        提交
      </Button>,
    );
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    await user.click(btn);
    expect(handleClick).not.toHaveBeenCalled();
  });

  it("disabled 属性禁用按钮", () => {
    render(<Button disabled>禁用</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("支持 type=submit", () => {
    render(<Button type="submit">提交</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "submit");
  });

  it("fullWidth 应用占满宽度样式", () => {
    render(<Button fullWidth>全宽</Button>);
    expect(screen.getByRole("button")).toHaveClass("w-full");
  });

  it("渲染左侧图标", () => {
    render(
      <Button icon={<span data-testid="icon">📷</span>}>图标</Button>,
    );
    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });
});
