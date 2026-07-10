/**
 * LoginForm 组件集成测试
 *
 * 覆盖范围：
 *   - 渲染：邮箱/密码输入框、登录按钮
 *   - 校验：空邮箱、非法邮箱、空密码
 *   - 交互：密码显示/隐藏切换
 *   - 提交：成功调用 login + onSuccess、失败处理
 *   - 状态：loading 禁用按钮
 *
 * Mock 策略：mock @/store/authStore，控制 login/loading 行为
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock authStore
const { mockAuthStore } = vi.hoisted(() => ({
  mockAuthStore: {
    login: vi.fn(),
    loading: false,
  },
}));

vi.mock("@/store/authStore", () => ({
  useAuthStore: () => mockAuthStore,
}));

import { LoginForm } from "../LoginForm";

describe("LoginForm 组件", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthStore.loading = false;
  });

  it("渲染邮箱、密码输入框和登录按钮", () => {
    render(<LoginForm />);
    expect(screen.getByPlaceholderText("请输入您的邮箱")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("请输入密码")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /登录/ })).toBeInTheDocument();
  });

  it("空提交 - 显示邮箱和密码错误", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    await user.click(screen.getByRole("button", { name: /登录/ }));
    expect(screen.getByText("请输入邮箱")).toBeInTheDocument();
    expect(screen.getByText("请输入密码")).toBeInTheDocument();
    expect(mockAuthStore.login).not.toHaveBeenCalled();
  });

  it("非法邮箱格式 - 显示错误", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    // "test@invalid" 通过 type=email 原生校验，但被 isValidEmail 正则拒绝（缺少域名点号）
    await user.type(screen.getByPlaceholderText("请输入您的邮箱"), "test@invalid");
    await user.click(screen.getByRole("button", { name: /登录/ }));
    expect(screen.getByText("邮箱格式不正确")).toBeInTheDocument();
    expect(mockAuthStore.login).not.toHaveBeenCalled();
  });

  it("密码显示/隐藏切换", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    const passwordInput = screen.getByPlaceholderText("请输入密码");
    expect(passwordInput).toHaveAttribute("type", "password");
    await user.click(screen.getByLabelText("显示密码"));
    expect(passwordInput).toHaveAttribute("type", "text");
    await user.click(screen.getByLabelText("隐藏密码"));
    expect(passwordInput).toHaveAttribute("type", "password");
  });

  it("有效输入 - 调用 login 并触发 onSuccess", async () => {
    const user = userEvent.setup();
    mockAuthStore.login.mockResolvedValueOnce(undefined);
    const onSuccess = vi.fn();
    render(<LoginForm onSuccess={onSuccess} />);

    await user.type(screen.getByPlaceholderText("请输入您的邮箱"), "test@example.com");
    await user.type(screen.getByPlaceholderText("请输入密码"), "password123");
    await user.click(screen.getByRole("button", { name: /登录/ }));

    expect(mockAuthStore.login).toHaveBeenCalledWith({
      username: "test@example.com",
      password: "password123",
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("login 失败 - 不触发 onSuccess", async () => {
    const user = userEvent.setup();
    mockAuthStore.login.mockRejectedValueOnce(new Error("密码错误"));
    const onSuccess = vi.fn();
    render(<LoginForm onSuccess={onSuccess} />);

    await user.type(screen.getByPlaceholderText("请输入您的邮箱"), "test@example.com");
    await user.type(screen.getByPlaceholderText("请输入密码"), "wrongpass");
    await user.click(screen.getByRole("button", { name: /登录/ }));

    expect(mockAuthStore.login).toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("loading 状态下按钮禁用", () => {
    mockAuthStore.loading = true;
    render(<LoginForm />);
    // 表单中有密码切换按钮和登录按钮，用 name 精确定位登录按钮
    expect(screen.getByRole("button", { name: /登录/ })).toBeDisabled();
  });

  it("输入后清除对应错误", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    // 触发错误
    await user.click(screen.getByRole("button", { name: /登录/ }));
    expect(screen.getByText("请输入邮箱")).toBeInTheDocument();
    // 输入后错误消失
    await user.type(screen.getByPlaceholderText("请输入您的邮箱"), "a");
    expect(screen.queryByText("请输入邮箱")).not.toBeInTheDocument();
  });
});
