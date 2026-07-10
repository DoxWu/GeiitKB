/**
 * toastStore 单元测试
 *
 * 覆盖范围：
 *   - addToast：添加通知、自动关闭
 *   - removeToast：手动移除
 *   - success/error/warning/info：便捷方法
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useToastStore } from "@/store/toastStore";

describe("toastStore", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it("addToast - 添加一条通知", () => {
    const { addToast } = useToastStore.getState();
    addToast({ type: "info", title: "测试消息" });
    const state = useToastStore.getState();
    expect(state.toasts).toHaveLength(1);
    expect(state.toasts[0].title).toBe("测试消息");
    expect(state.toasts[0].type).toBe("info");
    expect(state.toasts[0].id).toBeTruthy();
  });

  it("addToast - 多条通知各有独立 ID", () => {
    const { addToast } = useToastStore.getState();
    addToast({ type: "info", title: "消息1" });
    addToast({ type: "success", title: "消息2" });
    const state = useToastStore.getState();
    expect(state.toasts).toHaveLength(2);
    expect(state.toasts[0].id).not.toBe(state.toasts[1].id);
  });

  it("removeToast - 通过 ID 移除通知", () => {
    const { addToast, removeToast } = useToastStore.getState();
    addToast({ type: "info", title: "测试" });
    const toastId = useToastStore.getState().toasts[0].id;

    removeToast(toastId);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("success - 添加成功类型通知", () => {
    const { success } = useToastStore.getState();
    success("操作成功");
    const state = useToastStore.getState();
    expect(state.toasts).toHaveLength(1);
    expect(state.toasts[0].type).toBe("success");
    expect(state.toasts[0].title).toBe("操作成功");
  });

  it("error - 添加错误类型通知（含描述）", () => {
    const { error } = useToastStore.getState();
    error("操作失败", "详细错误信息");
    const state = useToastStore.getState();
    expect(state.toasts[0].type).toBe("error");
    expect(state.toasts[0].title).toBe("操作失败");
    expect(state.toasts[0].description).toBe("详细错误信息");
  });

  it("warning - 添加警告类型通知", () => {
    const { warning } = useToastStore.getState();
    warning("警告消息");
    expect(useToastStore.getState().toasts[0].type).toBe("warning");
  });

  it("info - 添加信息类型通知", () => {
    const { info } = useToastStore.getState();
    info("提示信息");
    expect(useToastStore.getState().toasts[0].type).toBe("info");
  });

  it("通知自动关闭（定时器）", async () => {
    vi.useFakeTimers();
    const { addToast } = useToastStore.getState();
    addToast({ type: "info", title: "自动关闭", duration: 3000 });

    expect(useToastStore.getState().toasts).toHaveLength(1);

    vi.advanceTimersByTime(3000);

    expect(useToastStore.getState().toasts).toHaveLength(0);
    vi.useRealTimers();
  });
});
