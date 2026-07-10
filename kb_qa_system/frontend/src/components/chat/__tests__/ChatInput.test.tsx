/**
 * ChatInput 组件单元测试
 *
 * 覆盖范围：
 *   - 渲染 textarea 和发送按钮
 *   - 输入文本后启用发送按钮
 *   - Enter 发送消息
 *   - Shift+Enter 换行
 *   - 流式输出时显示停止按钮
 *   - 空输入禁用发送
 *   - 字符计数
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatInput } from "../ChatInput";

describe("ChatInput 组件", () => {
  it("渲染 textarea 和发送按钮", () => {
    render(
      <ChatInput streaming={false} onSend={vi.fn()} onStop={vi.fn()} />,
    );
    expect(screen.getByPlaceholderText("输入您的问题...")).toBeInTheDocument();
    expect(screen.getByLabelText("发送消息")).toBeInTheDocument();
  });

  it("空输入时发送按钮禁用", () => {
    render(
      <ChatInput streaming={false} onSend={vi.fn()} onStop={vi.fn()} />,
    );
    expect(screen.getByLabelText("发送消息")).toBeDisabled();
  });

  it("输入文本后启用发送按钮", async () => {
    const user = userEvent.setup();
    render(
      <ChatInput streaming={false} onSend={vi.fn()} onStop={vi.fn()} />,
    );

    await user.type(screen.getByPlaceholderText("输入您的问题..."), "测试");

    expect(screen.getByLabelText("发送消息")).not.toBeDisabled();
  });

  it("Enter 键发送消息并清空输入", async () => {
    const user = userEvent.setup();
    const handleSend = vi.fn();
    render(
      <ChatInput streaming={false} onSend={handleSend} onStop={vi.fn()} />,
    );

    const textarea = screen.getByPlaceholderText("输入您的问题...");
    await user.type(textarea, "你好");
    await user.keyboard("{Enter}");

    expect(handleSend).toHaveBeenCalledWith("你好");
    expect(textarea).toHaveValue("");
  });

  it("Shift+Enter 换行不发送", async () => {
    const user = userEvent.setup();
    const handleSend = vi.fn();
    render(
      <ChatInput streaming={false} onSend={handleSend} onStop={vi.fn()} />,
    );

    const textarea = screen.getByPlaceholderText("输入您的问题...");
    await user.type(textarea, "你好");
    await user.keyboard("{Shift>}{Enter}{/Shift}");

    expect(handleSend).not.toHaveBeenCalled();
    expect(textarea).toHaveValue("你好\n");
  });

  it("流式输出时显示停止按钮", () => {
    render(
      <ChatInput streaming={true} onSend={vi.fn()} onStop={vi.fn()} />,
    );
    expect(screen.getByLabelText("停止生成")).toBeInTheDocument();
    expect(screen.queryByLabelText("发送消息")).not.toBeInTheDocument();
  });

  it("点击停止按钮触发 onStop", async () => {
    const user = userEvent.setup();
    const handleStop = vi.fn();
    render(
      <ChatInput streaming={true} onSend={vi.fn()} onStop={handleStop} />,
    );

    await user.click(screen.getByLabelText("停止生成"));

    expect(handleStop).toHaveBeenCalledOnce();
  });

  it("显示字符计数", async () => {
    const user = userEvent.setup();
    render(
      <ChatInput streaming={false} onSend={vi.fn()} onStop={vi.fn()} />,
    );

    await user.type(screen.getByPlaceholderText("输入您的问题..."), "测试");

    expect(screen.getByText("2 / 2000")).toBeInTheDocument();
  });

  it("流式输出时 textarea 禁用", () => {
    render(
      <ChatInput streaming={true} onSend={vi.fn()} onStop={vi.fn()} />,
    );
    expect(screen.getByPlaceholderText("输入您的问题...")).toBeDisabled();
  });
});
