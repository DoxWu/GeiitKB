/**
 * SetPasswordForm 组件集成测试
 *
 * 覆盖范围：
 *   - 渲染：密码、确认密码输入框、设置密码按钮、密码强度指示器
 *   - 校验：空密码、密码过短、密码缺少字母、密码缺少数字、确认密码为空、两次密码不一致
 *   - 提交：合法数据调用 setPassword + onSuccess
 *   - 失败处理：API 失败显示 toast 错误
 *   - 密码显示/隐藏切换
 *
 * Mock 策略：mock @/api/auth 的 setPassword 和 @/store/toastStore
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mockSetPassword } = vi.hoisted(() => ({
  mockSetPassword: vi.fn(),
}));

const { mockToastStore } = vi.hoisted(() => ({
  mockToastStore: {
    success: vi.fn(),
    error: vi.fn(),
    apiError: vi.fn(),
  },
}));

vi.mock("@/api/auth", () => ({
  setPassword: mockSetPassword,
}));

vi.mock("@/store/toastStore", () => ({
  useToastStore: () => mockToastStore,
}));

import { SetPasswordForm } from "../SetPasswordForm";

describe("SetPasswordForm 组件", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("渲染表单字段", () => {
    render(<SetPasswordForm token="abc123" />);
    expect(screen.getByPlaceholderText("至少8位，包含字母和数字")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("请再次输入密码")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /设置密码/ }),
    ).toBeInTheDocument();
  });

  it("空密码提交 - 显示错误", async () => {
    const user = userEvent.setup();
    render(<SetPasswordForm token="abc123" />);
    await user.click(screen.getByRole("button", { name: /设置密码/ }));
    expect(screen.getByText("密码不能为空")).toBeInTheDocument();
    expect(mockSetPassword).not.toHaveBeenCalled();
  });

  it("密码过短 - 显示错误", async () => {
    const user = userEvent.setup();
    render(<SetPasswordForm token="abc123" />);
    await user.type(screen.getByPlaceholderText("至少8位，包含字母和数字"), "ab12");
    await user.click(screen.getByRole("button", { name: /设置密码/ }));
    expect(screen.getByText("密码至少 8 个字符")).toBeInTheDocument();
    expect(mockSetPassword).not.toHaveBeenCalled();
  });

  it("密码缺少字母 - 显示错误", async () => {
    const user = userEvent.setup();
    render(<SetPasswordForm token="abc123" />);
    await user.type(screen.getByPlaceholderText("至少8位，包含字母和数字"), "12345678");
    await user.click(screen.getByRole("button", { name: /设置密码/ }));
    expect(screen.getByText("密码必须包含至少一个字母")).toBeInTheDocument();
    expect(mockSetPassword).not.toHaveBeenCalled();
  });

  it("密码缺少数字 - 显示错误", async () => {
    const user = userEvent.setup();
    render(<SetPasswordForm token="abc123" />);
    await user.type(screen.getByPlaceholderText("至少8位，包含字母和数字"), "abcdefgh");
    await user.click(screen.getByRole("button", { name: /设置密码/ }));
    expect(screen.getByText("密码必须包含至少一个数字")).toBeInTheDocument();
    expect(mockSetPassword).not.toHaveBeenCalled();
  });

  it("确认密码为空 - 显示错误", async () => {
    const user = userEvent.setup();
    render(<SetPasswordForm token="abc123" />);
    await user.type(screen.getByPlaceholderText("至少8位，包含字母和数字"), "abcd1234");
    await user.click(screen.getByRole("button", { name: /设置密码/ }));
    expect(screen.getByText("请确认密码")).toBeInTheDocument();
    expect(mockSetPassword).not.toHaveBeenCalled();
  });

  it("两次密码不一致 - 显示错误", async () => {
    const user = userEvent.setup();
    render(<SetPasswordForm token="abc123" />);
    await user.type(screen.getByPlaceholderText("至少8位，包含字母和数字"), "abcd1234");
    await user.type(screen.getByPlaceholderText("请再次输入密码"), "abcd5678");
    await user.click(screen.getByRole("button", { name: /设置密码/ }));
    expect(screen.getByText("两次输入的密码不一致")).toBeInTheDocument();
    expect(mockSetPassword).not.toHaveBeenCalled();
  });

  it("合法数据 - 调用 setPassword 和 onSuccess", async () => {
    const user = userEvent.setup();
    mockSetPassword.mockResolvedValueOnce(undefined);
    const onSuccess = vi.fn();
    render(<SetPasswordForm token="mytoken" onSuccess={onSuccess} />);

    await user.type(screen.getByPlaceholderText("至少8位，包含字母和数字"), "abcd1234");
    await user.type(screen.getByPlaceholderText("请再次输入密码"), "abcd1234");
    await user.click(screen.getByRole("button", { name: /设置密码/ }));

    await vi.waitFor(() => {
      expect(mockSetPassword).toHaveBeenCalledWith({
        token: "mytoken",
        password: "abcd1234",
      });
    });
    expect(mockToastStore.success).toHaveBeenCalledWith(
      "密码设置成功",
      "您现在可以使用邮箱登录了",
    );
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("API 失败 - 显示错误 toast", async () => {
    const user = userEvent.setup();
    mockSetPassword.mockRejectedValueOnce(new Error("链接已过期"));
    const onSuccess = vi.fn();
    render(<SetPasswordForm token="mytoken" onSuccess={onSuccess} />);

    await user.type(screen.getByPlaceholderText("至少8位，包含字母和数字"), "abcd1234");
    await user.type(screen.getByPlaceholderText("请再次输入密码"), "abcd1234");
    await user.click(screen.getByRole("button", { name: /设置密码/ }));

    await vi.waitFor(() => {
      expect(mockToastStore.apiError).toHaveBeenCalledWith("设置失败", expect.objectContaining({ message: "链接已过期" }));
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("密码显示/隐藏切换", async () => {
    const user = userEvent.setup();
    render(<SetPasswordForm token="abc123" />);
    const passwordInput = screen.getByPlaceholderText("至少8位，包含字母和数字");
    // 默认 type=password
    expect(passwordInput).toHaveAttribute("type", "password");
    // 点击显示密码按钮（aria-label="显示密码"）
    await user.click(screen.getByLabelText("显示密码"));
    expect(passwordInput).toHaveAttribute("type", "text");
    // 再次点击隐藏
    await user.click(screen.getByLabelText("隐藏密码"));
    expect(passwordInput).toHaveAttribute("type", "password");
  });

  it("输入密码后显示强度指示器", async () => {
    const user = userEvent.setup();
    const { container } = render(<SetPasswordForm token="abc123" />);
    // 初始无密码时不渲染强度指示器
    expect(container.querySelector(".mt-2.flex")).toBeNull();
    // 输入密码后渲染强度指示器
    await user.type(screen.getByPlaceholderText("至少8位，包含字母和数字"), "abcd1234");
    expect(container.querySelector(".mt-2.flex")).toBeInTheDocument();
  });

  it("输入后清除密码错误", async () => {
    const user = userEvent.setup();
    render(<SetPasswordForm token="abc123" />);
    await user.click(screen.getByRole("button", { name: /设置密码/ }));
    expect(screen.getByText("密码不能为空")).toBeInTheDocument();
    // 输入内容后错误消失
    await user.type(screen.getByPlaceholderText("至少8位，包含字母和数字"), "a");
    expect(screen.queryByText("密码不能为空")).not.toBeInTheDocument();
  });

  it("输入后清除确认密码错误", async () => {
    const user = userEvent.setup();
    render(<SetPasswordForm token="abc123" />);
    await user.type(screen.getByPlaceholderText("至少8位，包含字母和数字"), "abcd1234");
    await user.click(screen.getByRole("button", { name: /设置密码/ }));
    expect(screen.getByText("请确认密码")).toBeInTheDocument();
    // 输入确认密码后错误消失
    await user.type(screen.getByPlaceholderText("请再次输入密码"), "x");
    expect(screen.queryByText("请确认密码")).not.toBeInTheDocument();
  });
});
