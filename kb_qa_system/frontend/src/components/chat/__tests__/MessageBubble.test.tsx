/**
 * MessageBubble 组件单元测试
 *
 * 覆盖范围：
 *   - 用户消息渲染（右对齐、brand 背景）
 *   - AI 消息渲染（左对齐、AI 头像）
 *   - 降级标记显示
 *   - 引用来源显示
 *   - 流式状态（TypingIndicator）
 */

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MessageBubble } from "../MessageBubble";
import type { ChatMessage } from "@/types/chat";

/** 创建测试用用户消息 */
function createUserMessage(overrides?: Partial<ChatMessage>): ChatMessage {
  return {
    id: 1,
    role: "user",
    content: "用户消息",
    created_at: "2026-07-10T10:00:00Z",
    ...overrides,
  };
}

/** 创建测试用 AI 消息 */
function createAssistantMessage(overrides?: Partial<ChatMessage>): ChatMessage {
  return {
    id: 2,
    role: "assistant",
    content: "AI 回答",
    created_at: "2026-07-10T10:00:01Z",
    ...overrides,
  };
}

describe("MessageBubble 组件", () => {
  it("渲染用户消息内容", () => {
    render(<MessageBubble message={createUserMessage({ content: "你好" })} />);
    expect(screen.getByText("你好")).toBeInTheDocument();
  });

  it("渲染 AI 消息内容", () => {
    render(<MessageBubble message={createAssistantMessage({ content: "你好！" })} />);
    expect(screen.getByText("你好！")).toBeInTheDocument();
  });

  it("AI 消息显示头像", () => {
    const { container } = render(<MessageBubble message={createAssistantMessage()} />);
    // Bot 图标在 SVG 中
    const svg = container.querySelector("svg.lucide-bot");
    expect(svg).toBeInTheDocument();
  });

  it("用户消息不显示头像", () => {
    const { container } = render(<MessageBubble message={createUserMessage()} />);
    const svg = container.querySelector("svg.lucide-bot");
    expect(svg).not.toBeInTheDocument();
  });

  it("降级消息显示降级标记", () => {
    render(
      <MessageBubble
        message={createAssistantMessage({
          is_degraded: true,
          degrade_reason: "circuit_open",
        })}
      />,
    );
    expect(screen.getByText(/降级回复/)).toBeInTheDocument();
    expect(screen.getByText(/circuit_open/)).toBeInTheDocument();
  });

  it("非降级消息不显示降级标记", () => {
    render(<MessageBubble message={createAssistantMessage({ is_degraded: false })} />);
    expect(screen.queryByText(/降级回复/)).not.toBeInTheDocument();
  });

  it("AI 消息有 sources 时默认折叠显示检索结果数量，点击展开后显示来源", () => {
    render(
      <MessageBubble
        message={createAssistantMessage({
          sources: [
            { title: "文档1", content: "内容1", score: 0.9 },
            { title: "文档2", content: "内容2", score: 0.8 },
          ],
        })}
      />,
    );
    // 默认折叠：显示"检索到 N 个检索结果"可点击面板
    expect(screen.getByText("检索到 2 个检索结果")).toBeInTheDocument();
    // 折叠状态下不显示来源标题
    expect(screen.queryByText("文档1")).not.toBeInTheDocument();
    expect(screen.queryByText("文档2")).not.toBeInTheDocument();
    // 点击展开
    fireEvent.click(screen.getByRole("button", { name: /检索到 2 个检索结果/ }));
    // 展开后显示来源标题
    expect(screen.getByText("文档1")).toBeInTheDocument();
    expect(screen.getByText("文档2")).toBeInTheDocument();
  });

  it("AI 消息无 sources 时不显示检索结果区域", () => {
    render(<MessageBubble message={createAssistantMessage({ sources: [] })} />);
    expect(screen.queryByText(/检索到.*检索结果/)).not.toBeInTheDocument();
  });

  it("流式状态且无内容时显示 TypingIndicator", () => {
    render(
      <MessageBubble
        message={createAssistantMessage({ content: "" })}
        streaming={true}
      />,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("流式状态但有内容时显示内容", () => {
    render(
      <MessageBubble
        message={createAssistantMessage({ content: "部分内容" })}
        streaming={true}
      />,
    );
    expect(screen.getByText("部分内容")).toBeInTheDocument();
  });

  it("非流式状态显示时间戳", () => {
    render(<MessageBubble message={createUserMessage()} />);
    // 时间戳应存在（格式为 HH:MM）
    expect(screen.getByText(/\d{2}:\d{2}/)).toBeInTheDocument();
  });

  it("流式状态不显示时间戳", () => {
    render(
      <MessageBubble
        message={createAssistantMessage()}
        streaming={true}
      />,
    );
    // 流式状态下不显示时间戳（但 TypingIndicator 中的 status 角色可能存在）
    // 验证没有时间格式的文本
    const allText = document.body.textContent || "";
    expect(allText).not.toMatch(/\d{2}:\d{2}/);
  });
});
