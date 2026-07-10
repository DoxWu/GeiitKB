/**
 * Spinner 组件单元测试
 *
 * 覆盖范围：
 *   - Spinner：默认尺寸 md、自定义尺寸（sm/md/lg）、自定义类名
 *   - FullScreenSpinner：渲染 Spinner + 可选文字
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Spinner, FullScreenSpinner } from "../Spinner";

describe("Spinner 组件", () => {
  it("默认尺寸 md 渲染", () => {
    const { container } = render(<Spinner />);
    const spinner = container.querySelector(".animate-spin");
    expect(spinner).toBeInTheDocument();
    // SVG 元素的 className 是 SVGAnimatedString，需用 getAttribute("class")
    const classAttr = spinner?.getAttribute("class") ?? "";
    expect(classAttr).toContain("h-6");
    expect(classAttr).toContain("w-6");
  });

  it("尺寸 sm", () => {
    const { container } = render(<Spinner size="sm" />);
    const spinner = container.querySelector(".animate-spin");
    const classAttr = spinner?.getAttribute("class") ?? "";
    expect(classAttr).toContain("h-4");
    expect(classAttr).toContain("w-4");
  });

  it("尺寸 lg", () => {
    const { container } = render(<Spinner size="lg" />);
    const spinner = container.querySelector(".animate-spin");
    const classAttr = spinner?.getAttribute("class") ?? "";
    expect(classAttr).toContain("h-8");
    expect(classAttr).toContain("w-8");
  });

  it("自定义类名合并", () => {
    const { container } = render(<Spinner className="text-brand" />);
    const spinner = container.querySelector(".animate-spin");
    const classAttr = spinner?.getAttribute("class") ?? "";
    expect(classAttr).toContain("text-brand");
  });

  it("包含 animate-spin 动画类", () => {
    const { container } = render(<Spinner />);
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });
});

describe("FullScreenSpinner 组件", () => {
  it("渲染 Spinner（无文字）", () => {
    const { container } = render(<FullScreenSpinner />);
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
    // 未传 text 时不渲染文字
    expect(container.querySelector("p")).toBeNull();
  });

  it("渲染文字提示", () => {
    render(<FullScreenSpinner text="加载中..." />);
    expect(screen.getByText("加载中...")).toBeInTheDocument();
  });

  it("Spinner 使用 lg 尺寸和 brand 颜色", () => {
    const { container } = render(<FullScreenSpinner text="加载中" />);
    const spinner = container.querySelector(".animate-spin");
    // SVG 元素的 className 是 SVGAnimatedString，需用 getAttribute("class")
    const classAttr = spinner?.getAttribute("class") ?? "";
    expect(classAttr).toContain("h-8");
    expect(classAttr).toContain("text-brand");
  });
});
