/**
 * Modal 组件单元测试
 *
 * 覆盖范围：
 *   - 渲染：open 时显示内容、close 时不渲染
 *   - 标题：显示标题和关闭按钮
 *   - 交互：点击关闭按钮、点击遮罩关闭、ESC 关闭
 *   - disableBackdropClose：禁止遮罩关闭
 *   - footer：渲染底部操作区
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal } from "../Modal";

describe("Modal 组件", () => {
  it("open=true 时渲染内容", () => {
    render(
      <Modal open={true} onClose={() => {}} title="标题">
        <p>弹窗内容</p>
      </Modal>,
    );
    expect(screen.getByText("弹窗内容")).toBeInTheDocument();
    expect(screen.getByText("标题")).toBeInTheDocument();
  });

  it("open=false 时不渲染", () => {
    render(
      <Modal open={false} onClose={() => {}}>
        <p>弹窗内容</p>
      </Modal>,
    );
    expect(screen.queryByText("弹窗内容")).not.toBeInTheDocument();
  });

  it("点击关闭按钮触发 onClose", async () => {
    const user = userEvent.setup();
    const handleClose = vi.fn();
    render(
      <Modal open={true} onClose={handleClose} title="标题">
        <p>内容</p>
      </Modal>,
    );
    await user.click(screen.getByLabelText("关闭"));
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("按 ESC 键触发 onClose", async () => {
    const user = userEvent.setup();
    const handleClose = vi.fn();
    render(
      <Modal open={true} onClose={handleClose} title="标题">
        <p>内容</p>
      </Modal>,
    );
    await user.keyboard("{Escape}");
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("点击遮罩触发 onClose", async () => {
    const user = userEvent.setup();
    const handleClose = vi.fn();
    const { container } = render(
      <Modal open={true} onClose={handleClose}>
        <p>内容</p>
      </Modal>,
    );
    // 点击最外层容器（遮罩区域）
    const backdrop = container.firstElementChild as HTMLElement;
    await user.click(backdrop);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("disableBackdropClose 时点击遮罩不关闭", async () => {
    const user = userEvent.setup();
    const handleClose = vi.fn();
    const { container } = render(
      <Modal open={true} onClose={handleClose} disableBackdropClose>
        <p>内容</p>
      </Modal>,
    );
    const backdrop = container.firstElementChild as HTMLElement;
    await user.click(backdrop);
    expect(handleClose).not.toHaveBeenCalled();
  });

  it("渲染 footer 底部操作区", () => {
    render(
      <Modal
        open={true}
        onClose={() => {}}
        footer={<button>确认</button>}
      >
        <p>内容</p>
      </Modal>,
    );
    expect(screen.getByText("确认")).toBeInTheDocument();
  });

  it("open 时禁止 body 滚动", () => {
    render(
      <Modal open={true} onClose={() => {}}>
        <p>内容</p>
      </Modal>,
    );
    expect(document.body.style.overflow).toBe("hidden");
  });
});
