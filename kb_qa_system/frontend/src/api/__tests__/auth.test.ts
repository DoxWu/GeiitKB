/**
 * auth API 单元测试
 *
 * 覆盖范围：
 *   - 真实 API 函数：login, refreshToken, logout, getCurrentUser, register
 *     （mock apiClient 验证调用参数和返回值）
 *   - Mock 函数：submitRegisterApply, getApplicationStatus, setPassword
 *     （验证 localStorage 存储和分支逻辑）
 *
 * Mock 策略：mock @/api/client 的 apiClient
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockApiClient } = vi.hoisted(() => ({
  mockApiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  },
}));

vi.mock("@/api/client", () => ({
  apiClient: mockApiClient,
  registerTokenExpiredCallback: vi.fn(),
  clearTokens: vi.fn(),
  getStoredTokens: vi.fn(() => null),
  storeTokens: vi.fn(),
  HttpClientError: class HttpClientError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

import {
  login,
  refreshToken,
  logout,
  getCurrentUser,
  register,
  submitRegisterApply,
  getApplicationStatus,
  setPassword,
} from "../auth";

describe("auth API - 真实接口", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("login - 调用 POST /auth/login", async () => {
    const mockResponse = {
      access_token: "token-123",
      refresh_token: "refresh-123",
      token_type: "bearer",
      user: { id: 1, username: "test", email: "test@example.com", role: "user" },
    };
    mockApiClient.post.mockResolvedValueOnce(mockResponse);
    const result = await login({ username: "test@example.com", password: "pass123" });
    expect(mockApiClient.post).toHaveBeenCalledWith("/auth/login", {
      username: "test@example.com",
      password: "pass123",
    });
    expect(result).toEqual(mockResponse);
  });

  it("refreshToken - 调用 POST /auth/refresh", async () => {
    const mockResponse = {
      access_token: "new-token",
      refresh_token: "new-refresh",
      token_type: "bearer",
    };
    mockApiClient.post.mockResolvedValueOnce(mockResponse);
    const result = await refreshToken("old-refresh-token");
    expect(mockApiClient.post).toHaveBeenCalledWith("/auth/refresh", {
      refresh_token: "old-refresh-token",
    });
    expect(result).toEqual(mockResponse);
  });

  it("logout - 调用 POST /auth/logout", async () => {
    mockApiClient.post.mockResolvedValueOnce(undefined);
    await logout();
    expect(mockApiClient.post).toHaveBeenCalledWith("/auth/logout");
  });

  it("getCurrentUser - 调用 GET /auth/me", async () => {
    const mockUser = { id: 1, username: "test", email: "test@example.com", role: "user" };
    mockApiClient.get.mockResolvedValueOnce(mockUser);
    const result = await getCurrentUser();
    expect(mockApiClient.get).toHaveBeenCalledWith("/auth/me");
    expect(result).toEqual(mockUser);
  });

  it("register - 调用 POST /auth/register", async () => {
    const mockUser = { id: 2, username: "newuser", email: "new@example.com", role: "user" };
    mockApiClient.post.mockResolvedValueOnce(mockUser);
    const result = await register({
      username: "newuser",
      email: "new@example.com",
      password: "pass1234",
    });
    expect(mockApiClient.post).toHaveBeenCalledWith("/auth/register", {
      username: "newuser",
      email: "new@example.com",
      password: "pass1234",
    });
    expect(result).toEqual(mockUser);
  });
});

describe("auth API - Mock 注册申请流程", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("submitRegisterApply - 存储到 localStorage 并返回 pending 状态", async () => {
    const promise = submitRegisterApply({
      email: "test@example.com",
      username: "testuser",
    });
    // 推进 mockDelay 的 setTimeout
    vi.advanceTimersByTime(800);
    const result = await promise;

    expect(result.status).toBe("pending");
    expect(result.application_id).toBeTypeOf("number");
    expect(result.message).toContain("注册申请已提交");

    // 验证 localStorage 存储
    const stored = localStorage.getItem("kb_mock_application");
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.email).toBe("test@example.com");
    expect(parsed.username).toBe("testuser");
    expect(parsed.status).toBe("pending");
  });

  it("getApplicationStatus - 存在申请记录时返回状态", async () => {
    // 先提交申请
    const submitPromise = submitRegisterApply({
      email: "test@example.com",
      username: "testuser",
    });
    vi.advanceTimersByTime(800);
    await submitPromise;

    // 查询状态
    const statusPromise = getApplicationStatus("test@example.com");
    vi.advanceTimersByTime(500);
    const result = await statusPromise;

    expect(result.status).toBe("pending");
    expect(result.email).toBe("test@example.com");
    expect(result.username).toBe("testuser");
    expect(result.submitted_at).toBeTypeOf("string");
    expect(result.reviewed_at).toBeNull();
    expect(result.reject_reason).toBeNull();
  });

  it("getApplicationStatus - 无申请记录时抛出错误", async () => {
    const statusPromise = getApplicationStatus("unknown@example.com");
    vi.advanceTimersByTime(500);
    await expect(statusPromise).rejects.toThrow("未找到申请记录");
  });

  it("getApplicationStatus - 邮箱不匹配时抛出错误", async () => {
    // 先提交申请
    const submitPromise = submitRegisterApply({
      email: "test@example.com",
      username: "testuser",
    });
    vi.advanceTimersByTime(800);
    await submitPromise;

    // 用不同邮箱查询
    const statusPromise = getApplicationStatus("other@example.com");
    vi.advanceTimersByTime(500);
    await expect(statusPromise).rejects.toThrow("未找到申请记录");
  });

  it("setPassword - 合法 token 设置成功", async () => {
    // 先提交申请以便 localStorage 有记录
    const submitPromise = submitRegisterApply({
      email: "test@example.com",
      username: "testuser",
    });
    vi.advanceTimersByTime(800);
    await submitPromise;

    // 验证 localStorage 有记录
    expect(localStorage.getItem("kb_mock_application")).not.toBeNull();

    // 设置密码
    const passwordPromise = setPassword({
      token: "valid-token-12345",
      password: "newpass123",
    });
    vi.advanceTimersByTime(800);
    const result = await passwordPromise;

    expect(result.success).toBe(true);
    expect(result.message).toContain("密码设置成功");

    // 验证 localStorage 记录已清除
    expect(localStorage.getItem("kb_mock_application")).toBeNull();
  });

  it("setPassword - token 为空时抛出错误", async () => {
    const passwordPromise = setPassword({ token: "", password: "newpass123" });
    vi.advanceTimersByTime(800);
    await expect(passwordPromise).rejects.toThrow("无效的设置链接");
  });

  it("setPassword - token 过短时抛出错误", async () => {
    const passwordPromise = setPassword({ token: "short", password: "newpass123" });
    vi.advanceTimersByTime(800);
    await expect(passwordPromise).rejects.toThrow("无效的设置链接");
  });
});
