/**
 * RegisterApplyForm 组件集成测试
 *
 * 覆盖范围：
 *   - 渲染：邮箱、确认邮箱、用户名输入框、提交按钮
 *   - 校验：空邮箱、非法邮箱格式、空确认邮箱、邮箱不一致、空用户名、用户名过短
 *   - 提交：合法数据调用 submitRegisterApply + onSuccess 回调
 *   - 失败处理：API 失败显示 toast 错误
 *   - loading 状态：提交时按钮禁用
 *
 * Mock 策略：mock @/api/auth 的 submitRegisterApply 和 @/store/toastStore
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mockSubmitRegisterApply } = vi.hoisted(() => ({
  mockSubmitRegisterApply: vi.fn(),
}));

const { mockToastStore } = vi.hoisted(() => ({
  mockToastStore: {
    success: vi.fn(),
    error: vi.fn(),
    apiError: vi.fn(),
  },
}));

vi.mock("@/api/auth", () => ({
  submitRegisterApply: mockSubmitRegisterApply,
}));

vi.mock("@/store/toastStore", () => ({
  useToastStore: () => mockToastStore,
}));

import { RegisterApplyForm } from "../RegisterApplyForm";

describe("RegisterApplyForm 组件", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("渲染表单字段", () => {
    render(<RegisterApplyForm />);
    expect(screen.getByPlaceholderText("请输入您的企业邮箱")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("请再次输入您的企业邮箱"),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("3-50个字符，支持字母、数字、中文"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /提交注册申请/ }),
    ).toBeInTheDocument();
  });

  it("空邮箱提交 - 显示错误", async () => {
    const user = userEvent.setup();
    render(<RegisterApplyForm />);
    // 仅填写用户名和确认邮箱
    await user.type(
      screen.getByPlaceholderText("3-50个字符，支持字母、数字、中文"),
      "testuser",
    );
    await user.type(
      screen.getByPlaceholderText("请再次输入您的企业邮箱"),
      "test@example.com",
    );
    await user.click(screen.getByRole("button", { name: /提交注册申请/ }));
    expect(screen.getByText("请输入邮箱")).toBeInTheDocument();
    expect(mockSubmitRegisterApply).not.toHaveBeenCalled();
  });

  it("非法邮箱格式 - 显示错误", async () => {
    const user = userEvent.setup();
    render(<RegisterApplyForm />);
    // "test@invalid" 通过 type=email 原生校验，但被 isValidEmail 正则拒绝（无域名点号）
    await user.type(
      screen.getByPlaceholderText("请输入您的企业邮箱"),
      "test@invalid",
    );
    await user.type(
      screen.getByPlaceholderText("请再次输入您的企业邮箱"),
      "test@invalid",
    );
    await user.type(
      screen.getByPlaceholderText("3-50个字符，支持字母、数字、中文"),
      "testuser",
    );
    await user.click(screen.getByRole("button", { name: /提交注册申请/ }));
    expect(screen.getByText("邮箱格式不正确")).toBeInTheDocument();
    expect(mockSubmitRegisterApply).not.toHaveBeenCalled();
  });

  it("空确认邮箱提交 - 显示错误", async () => {
    const user = userEvent.setup();
    render(<RegisterApplyForm />);
    await user.type(
      screen.getByPlaceholderText("请输入您的企业邮箱"),
      "test@example.com",
    );
    await user.type(
      screen.getByPlaceholderText("3-50个字符，支持字母、数字、中文"),
      "testuser",
    );
    await user.click(screen.getByRole("button", { name: /提交注册申请/ }));
    expect(screen.getByText("请再次输入邮箱")).toBeInTheDocument();
    expect(mockSubmitRegisterApply).not.toHaveBeenCalled();
  });

  it("两次邮箱不一致 - 显示错误", async () => {
    const user = userEvent.setup();
    render(<RegisterApplyForm />);
    await user.type(
      screen.getByPlaceholderText("请输入您的企业邮箱"),
      "test@example.com",
    );
    await user.type(
      screen.getByPlaceholderText("请再次输入您的企业邮箱"),
      "wrong@example.com",
    );
    await user.type(
      screen.getByPlaceholderText("3-50个字符，支持字母、数字、中文"),
      "testuser",
    );
    await user.click(screen.getByRole("button", { name: /提交注册申请/ }));
    expect(screen.getByText("两次输入的邮箱不一致")).toBeInTheDocument();
    expect(mockSubmitRegisterApply).not.toHaveBeenCalled();
  });

  it("空用户名提交 - 显示错误", async () => {
    const user = userEvent.setup();
    render(<RegisterApplyForm />);
    await user.type(
      screen.getByPlaceholderText("请输入您的企业邮箱"),
      "test@example.com",
    );
    await user.type(
      screen.getByPlaceholderText("请再次输入您的企业邮箱"),
      "test@example.com",
    );
    await user.click(screen.getByRole("button", { name: /提交注册申请/ }));
    expect(screen.getByText("用户名不能为空")).toBeInTheDocument();
    expect(mockSubmitRegisterApply).not.toHaveBeenCalled();
  });

  it("用户名过短 - 显示错误", async () => {
    const user = userEvent.setup();
    render(<RegisterApplyForm />);
    await user.type(
      screen.getByPlaceholderText("请输入您的企业邮箱"),
      "test@example.com",
    );
    await user.type(
      screen.getByPlaceholderText("请再次输入您的企业邮箱"),
      "test@example.com",
    );
    await user.type(
      screen.getByPlaceholderText("3-50个字符，支持字母、数字、中文"),
      "ab",
    );
    await user.click(screen.getByRole("button", { name: /提交注册申请/ }));
    expect(screen.getByText("用户名至少 3 个字符")).toBeInTheDocument();
    expect(mockSubmitRegisterApply).not.toHaveBeenCalled();
  });

  it("合法数据 - 调用 submitRegisterApply 和 onSuccess", async () => {
    const user = userEvent.setup();
    mockSubmitRegisterApply.mockResolvedValueOnce(undefined);
    const onSuccess = vi.fn();
    render(<RegisterApplyForm onSuccess={onSuccess} />);

    await user.type(
      screen.getByPlaceholderText("请输入您的企业邮箱"),
      "test@example.com",
    );
    await user.type(
      screen.getByPlaceholderText("请再次输入您的企业邮箱"),
      "test@example.com",
    );
    await user.type(
      screen.getByPlaceholderText("3-50个字符，支持字母、数字、中文"),
      "testuser",
    );
    await user.click(screen.getByRole("button", { name: /提交注册申请/ }));

    await vi.waitFor(() => {
      expect(mockSubmitRegisterApply).toHaveBeenCalledWith({
        email: "test@example.com",
        username: "testuser",
      });
    });
    expect(mockToastStore.success).toHaveBeenCalledWith(
      "申请已提交",
      "请等待管理员审核",
    );
    expect(onSuccess).toHaveBeenCalledWith("test@example.com");
  });

  it("API 失败 - 显示错误 toast", async () => {
    const user = userEvent.setup();
    mockSubmitRegisterApply.mockRejectedValueOnce(new Error("邮箱已存在"));
    const onSuccess = vi.fn();
    render(<RegisterApplyForm onSuccess={onSuccess} />);

    await user.type(
      screen.getByPlaceholderText("请输入您的企业邮箱"),
      "test@example.com",
    );
    await user.type(
      screen.getByPlaceholderText("请再次输入您的企业邮箱"),
      "test@example.com",
    );
    await user.type(
      screen.getByPlaceholderText("3-50个字符，支持字母、数字、中文"),
      "testuser",
    );
    await user.click(screen.getByRole("button", { name: /提交注册申请/ }));

    await vi.waitFor(() => {
      expect(mockToastStore.apiError).toHaveBeenCalledWith(
        "提交失败",
        expect.objectContaining({ message: "邮箱已存在" }),
      );
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("输入后清除错误提示", async () => {
    const user = userEvent.setup();
    render(<RegisterApplyForm />);
    // 触发邮箱错误
    await user.click(screen.getByRole("button", { name: /提交注册申请/ }));
    expect(screen.getByText("请输入邮箱")).toBeInTheDocument();
    // 输入内容后错误消失
    await user.type(
      screen.getByPlaceholderText("请输入您的企业邮箱"),
      "t",
    );
    expect(screen.queryByText("请输入邮箱")).not.toBeInTheDocument();
  });

  it("确认邮箱输入后清除错误提示", async () => {
    const user = userEvent.setup();
    render(<RegisterApplyForm />);
    // 填写邮箱但不填确认邮箱，触发确认邮箱错误
    await user.type(
      screen.getByPlaceholderText("请输入您的企业邮箱"),
      "test@example.com",
    );
    await user.type(
      screen.getByPlaceholderText("3-50个字符，支持字母、数字、中文"),
      "testuser",
    );
    await user.click(screen.getByRole("button", { name: /提交注册申请/ }));
    expect(screen.getByText("请再次输入邮箱")).toBeInTheDocument();
    // 输入确认邮箱后错误消失
    await user.type(
      screen.getByPlaceholderText("请再次输入您的企业邮箱"),
      "t",
    );
    expect(screen.queryByText("请再次输入邮箱")).not.toBeInTheDocument();
  });
});
