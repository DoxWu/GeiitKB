/**
 * ToastContainer 组件单元测试
 *
 * 覆盖范围：
 *   - 空 toast 列表时不渲染
 *   - 渲染各类 toast（success/error/warning/info）
 *   - toast 标题和描述展示
 *   - 关闭按钮调用 removeToast
 *
 * Mock 策略：mock @/store/toastStore 返回可控 toasts 列表
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mockToastStore } = vi.hoisted(() => ({
  mockToastStore: {
    toasts: [] as Array<{
      id: string;
      type: "success" | "error" | "warning" | "info";
      title: string;
      description?: string;
    }>,
    removeToast: vi.fn(),
  },
}));

vi.mock("@/store/toastStore", () => ({
  useToastStore: () => mockToastStore,
}));

import { ToastContainer } from "../Toast";

describe("ToastContainer 组件", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockToastStore.toasts = [];
  });

  it("空 toast 列表时不渲染", () => {
    const { container } = render(<ToastContainer />);
    expect(container.firstChild).toBeNull();
  });

  it("渲染 success toast", () => {
    mockToastStore.toasts = [
      { id: "1", type: "success", title: "操作成功" },
    ];
    render(<ToastContainer />);
    expect(screen.getByText("操作成功")).toBeInTheDocument();
  });

  it("渲染 error toast（含描述）", () => {
    mockToastStore.toasts = [
      {
        id: "2",
        type: "error",
        title: "操作失败",
        description: "网络错误",
      },
    ];
    render(<ToastContainer />);
    expect(screen.getByText("操作失败")).toBeInTheDocument();
    expect(screen.getByText("网络错误")).toBeInTheDocument();
  });

  it("渲染 warning toast", () => {
    mockToastStore.toasts = [
      { id: "3", type: "warning", title: "警告提示" },
    ];
    render(<ToastContainer />);
    expect(screen.getByText("警告提示")).toBeInTheDocument();
  });

  it("渲染 info toast", () => {
    mockToastStore.toasts = [
      { id: "4", type: "info", title: "信息通知" },
    ];
    render(<ToastContainer />);
    expect(screen.getByText("信息通知")).toBeInTheDocument();
  });

  it("渲染多个 toast", () => {
    mockToastStore.toasts = [
      { id: "1", type: "success", title: "成功1" },
      { id: "2", type: "error", title: "失败2" },
      { id: "3", type: "info", title: "信息3" },
    ];
    render(<ToastContainer />);
    expect(screen.getByText("成功1")).toBeInTheDocument();
    expect(screen.getByText("失败2")).toBeInTheDocument();
    expect(screen.getByText("信息3")).toBeInTheDocument();
  });

  it("无描述时不渲染描述段落", () => {
    mockToastStore.toasts = [
      { id: "1", type: "success", title: "仅标题" },
    ];
    render(<ToastContainer />);
    expect(screen.getByText("仅标题")).toBeInTheDocument();
    // 不应存在 text-xs text-ink-secondary 的描述段落
    expect(screen.queryByText("网络错误")).not.toBeInTheDocument();
  });

  it("点击关闭按钮调用 removeToast", async () => {
    const user = userEvent.setup();
    mockToastStore.toasts = [
      { id: "toast-1", type: "success", title: "可关闭" },
    ];
    render(<ToastContainer />);
    const closeBtn = screen.getByLabelText("关闭通知");
    await user.click(closeBtn);
    expect(mockToastStore.removeToast).toHaveBeenCalledWith("toast-1");
  });
});
