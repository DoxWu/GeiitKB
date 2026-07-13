/**
 * SourceCard 组件单元测试
 *
 * 覆盖范围：
 *   - 渲染标题、分数、内容
 *   - 长内容折叠/展开
 *   - 短内容不显示展开按钮
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SourceCard } from "../SourceCard";
import type { SourceItem } from "@/types/chat";

/** 创建测试用 SourceItem */
function createSource(overrides?: Partial<SourceItem>): SourceItem {
  return {
    document_id: 1,
    title: "测试文档",
    content: "这是引用内容片段。",
    score: 0.85,
    ...overrides,
  };
}

describe("SourceCard 组件", () => {
  it("渲染标题", () => {
    render(<SourceCard source={createSource({ title: "Python 入门指南" })} />);
    expect(screen.getByText("Python 入门指南")).toBeInTheDocument();
  });

  it("显示相关度分数百分比和置信度标签", () => {
    // score=0.85 >= 0.7 → 高置信 · 85%
    render(<SourceCard source={createSource({ score: 0.85 })} />);
    expect(screen.getByText(/高置信 · 85%/)).toBeInTheDocument();
  });

  it("高置信度分数（>=0.7）显示绿色高置信标签", () => {
    render(<SourceCard source={createSource({ score: 0.92 })} />);
    expect(screen.getByText(/高置信 · 92%/)).toBeInTheDocument();
  });

  it("较高置信度分数（0.5-0.7）显示品牌色较高标签", () => {
    // 60% 落在 0.525-0.7 区间，后端判定 high，前端标记"较高"
    render(<SourceCard source={createSource({ score: 0.6 })} />);
    expect(screen.getByText(/较高 · 60%/)).toBeInTheDocument();
  });

  it("参考级分数（<0.5）显示黄色参考标签", () => {
    // 0.4 在 0.35-0.525 区间，后端标记 low，前端标记"参考"
    render(<SourceCard source={createSource({ score: 0.4 })} />);
    expect(screen.getByText(/参考 · 40%/)).toBeInTheDocument();
  });

  it("短内容直接显示，无展开按钮", () => {
    const shortContent = "短内容";
    render(<SourceCard source={createSource({ content: shortContent })} />);
    expect(screen.getByText(shortContent)).toBeInTheDocument();
    expect(screen.queryByText("展开全部")).not.toBeInTheDocument();
  });

  it("长内容显示截断和展开按钮", () => {
    const longContent = "a".repeat(200);
    render(<SourceCard source={createSource({ content: longContent })} />);
    expect(screen.getByText("展开全部")).toBeInTheDocument();
    // 截断后应包含 ...
    expect(screen.getByText(/a+\.\.\./)).toBeInTheDocument();
  });

  it("点击展开按钮显示完整内容", async () => {
    const user = userEvent.setup();
    const longContent = "a".repeat(200);
    render(<SourceCard source={createSource({ content: longContent })} />);

    await user.click(screen.getByText("展开全部"));

    expect(screen.getByText("收起")).toBeInTheDocument();
    // 展开后显示完整内容（不含 ...）
    expect(screen.queryByText(/a+\.\.\./)).not.toBeInTheDocument();
  });

  it("点击收起按钮折叠内容", async () => {
    const user = userEvent.setup();
    const longContent = "a".repeat(200);
    render(<SourceCard source={createSource({ content: longContent })} />);

    // 展开
    await user.click(screen.getByText("展开全部"));
    // 收起
    await user.click(screen.getByText("收起"));

    expect(screen.getByText("展开全部")).toBeInTheDocument();
  });
});
