/**
 * highlight.tsx 单元测试（D2-02 搜索结果高亮）
 *
 * 覆盖范围：
 *   - 空关键词返回原文
 *   - 匹配关键词高亮（mark 元素）
 *   - 大小写不敏感匹配
 *   - 正则特殊字符转义
 *   - 多处匹配全部高亮
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { highlightKeyword } from "@/utils/highlight";

/**
 * 辅助组件：将 highlightKeyword 返回的 ReactNode 数组渲染为 DOM
 *
 * 作用：
 *   highlightKeyword 返回 ReactNode[]，需要包裹在 JSX 元素中才能渲染。
 *   此组件简化测试中的渲染调用。
 */
function HighlightedText({ text, keyword }: { text: string; keyword: string }) {
  return <span data-testid="container">{highlightKeyword(text, keyword)}</span>;
}

describe("highlightKeyword", () => {
  it("空关键词返回原文（不高亮）", () => {
    render(<HighlightedText text="Hello World" keyword="" />);
    const container = screen.getByTestId("container");
    // 不应有 mark 元素
    expect(container.querySelector("mark")).toBeNull();
    expect(container.textContent).toBe("Hello World");
  });

  it("纯空白关键词返回原文（不高亮）", () => {
    render(<HighlightedText text="Hello World" keyword="   " />);
    const container = screen.getByTestId("container");
    expect(container.querySelector("mark")).toBeNull();
    expect(container.textContent).toBe("Hello World");
  });

  it("匹配关键词用 mark 元素高亮", () => {
    render(<HighlightedText text="企业知识库" keyword="知识" />);
    const marks = screen.getAllByRole("mark");
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe("知识");
  });

  it("大小写不敏感匹配", () => {
    render(<HighlightedText text="Hello World" keyword="WORLD" />);
    const marks = screen.getAllByRole("mark");
    expect(marks).toHaveLength(1);
    // 匹配部分保留原文大小写
    expect(marks[0].textContent).toBe("World");
  });

  it("大小写不敏感匹配（反向：文本大写，关键词小写）", () => {
    render(<HighlightedText text="HELLO WORLD" keyword="hello" />);
    const marks = screen.getAllByRole("mark");
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe("HELLO");
  });

  it("正则特殊字符正确转义不报错", () => {
    // 关键词含正则元字符，应被转义为字面量而非报错
    expect(() => {
      render(<HighlightedText text="price (test) value" keyword="(test)" />);
    }).not.toThrow();

    const marks = screen.getAllByRole("mark");
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe("(test)");
  });

  it("正则特殊字符星号正确转义", () => {
    expect(() => {
      render(<HighlightedText text="a*b+c" keyword="*" />);
    }).not.toThrow();

    const marks = screen.getAllByRole("mark");
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe("*");
  });

  it("多处匹配全部高亮", () => {
    render(<HighlightedText text="test and test and test" keyword="test" />);
    const marks = screen.getAllByRole("mark");
    expect(marks).toHaveLength(3);
    marks.forEach((mark) => {
      expect(mark.textContent).toBe("test");
    });
  });

  it("无匹配时返回原文（不高亮）", () => {
    render(<HighlightedText text="Hello World" keyword="xyz" />);
    const container = screen.getByTestId("container");
    expect(container.querySelector("mark")).toBeNull();
    expect(container.textContent).toBe("Hello World");
  });

  it("完整文本匹配时整体高亮", () => {
    render(<HighlightedText text="keyword" keyword="keyword" />);
    const marks = screen.getAllByRole("mark");
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe("keyword");
  });
});
