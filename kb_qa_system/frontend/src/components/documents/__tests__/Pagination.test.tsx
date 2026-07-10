/**
 * Pagination 组件测试
 *
 * 覆盖范围：
 *   - 总页数 ≤ 1 时不渲染
 *   - 总页数 ≤ 7 时显示全部页码
 *   - 总页数 > 7 时显示省略号
 *   - 当前页高亮
 *   - 上一页/下一页按钮
 *   - 首页/末页禁用状态
 *   - 点击页码调用 onChange
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Pagination } from "../Pagination";

describe("Pagination 组件", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("总页数 ≤ 1 时不渲染", () => {
    const { container } = render(
      <Pagination current={1} pageSize={20} total={20} onChange={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("总页数 ≤ 7 时显示全部页码", () => {
    // 5 页
    render(
      <Pagination current={1} pageSize={20} total={100} onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText("第 1 页")).toBeInTheDocument();
    expect(screen.getByLabelText("第 2 页")).toBeInTheDocument();
    expect(screen.getByLabelText("第 3 页")).toBeInTheDocument();
    expect(screen.getByLabelText("第 4 页")).toBeInTheDocument();
    expect(screen.getByLabelText("第 5 页")).toBeInTheDocument();
    expect(screen.queryByText("…")).not.toBeInTheDocument();
  });

  it("总页数 > 7 时显示省略号", () => {
    // 10 页，当前第 1 页
    render(
      <Pagination current={1} pageSize={20} total={200} onChange={vi.fn()} />,
    );
    // 首页和末页始终显示
    expect(screen.getByLabelText("第 1 页")).toBeInTheDocument();
    expect(screen.getByLabelText("第 10 页")).toBeInTheDocument();
    // 省略号
    expect(screen.getByText("…")).toBeInTheDocument();
  });

  it("当前页高亮显示", () => {
    render(
      <Pagination current={3} pageSize={20} total={100} onChange={vi.fn()} />,
    );
    const activeButton = screen.getByLabelText("第 3 页");
    expect(activeButton).toHaveAttribute("aria-current", "page");
  });

  it("点击页码调用 onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Pagination
        current={1}
        pageSize={20}
        total={100}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByLabelText("第 3 页"));
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it("点击当前页不调用 onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Pagination
        current={1}
        pageSize={20}
        total={100}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByLabelText("第 1 页"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("首页时上一页按钮禁用", () => {
    render(
      <Pagination current={1} pageSize={20} total={100} onChange={vi.fn()} />,
    );
    const prevButton = screen.getByLabelText("上一页");
    expect(prevButton).toBeDisabled();
  });

  it("末页时下一页按钮禁用", () => {
    render(
      <Pagination current={5} pageSize={20} total={100} onChange={vi.fn()} />,
    );
    const nextButton = screen.getByLabelText("下一页");
    expect(nextButton).toBeDisabled();
  });

  it("点击下一页调用 onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Pagination
        current={1}
        pageSize={20}
        total={100}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByLabelText("下一页"));
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it("点击上一页调用 onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Pagination
        current={3}
        pageSize={20}
        total={100}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByLabelText("上一页"));
    expect(onChange).toHaveBeenCalledWith(2);
  });
});
