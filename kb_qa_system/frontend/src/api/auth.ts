/**
 * 认证相关 API 接口
 *
 * 作用：
 *   封装登录、注册、Token 刷新、登出等认证相关接口调用。
 *   注册申请和密码设置接口需后端新增，当前使用 Mock 实现。
 *
 * 对齐后端路由：kb_qa_system/backend/app/api/v1/auth.py
 */

import { apiClient } from "./client";
import { API_PATHS } from "@/utils/constants";
import type {
  LoginRequest,
  TokenResponse,
  RefreshTokenResponse,
  UserResponse,
  RegisterApplyRequest,
  RegisterApplyResponse,
  ApplicationStatusResponse,
  SetPasswordRequest,
} from "@/types/user";

/**
 * 用户登录
 *
 * 调用 POST /auth/login，返回 Token 和用户信息。
 * 后端使用 username 字段，前端将邮箱作为 username 传入。
 *
 * @param data - 登录请求（username + password）
 * @returns Token 响应
 */
export async function login(data: LoginRequest): Promise<TokenResponse> {
  return apiClient.post<TokenResponse>(API_PATHS.LOGIN, data);
}

/**
 * 刷新 Token
 *
 * @param refreshToken - Refresh Token 字符串
 * @returns 新的 Token 响应
 */
export async function refreshToken(
  refreshToken: string,
): Promise<RefreshTokenResponse> {
  return apiClient.post<RefreshTokenResponse>(API_PATHS.REFRESH, {
    refresh_token: refreshToken,
  });
}

/**
 * 登出
 *
 * 调用 POST /auth/logout，将当前 Token 加入黑名单。
 */
export async function logout(): Promise<void> {
  await apiClient.post(API_PATHS.LOGOUT);
}

/**
 * 获取当前用户信息
 *
 * @returns 当前登录用户信息
 */
export async function getCurrentUser(): Promise<UserResponse> {
  return apiClient.get<UserResponse>(API_PATHS.ME);
}

/**
 * 删除当前用户账号（GDPR/PIPL 合规）
 *
 * 调用 DELETE /auth/account，需密码确认。
 * 删除成功后账号及所有数据将被永久删除，Token 立即失效。
 *
 * @param password - 当前账号密码
 * @param refreshToken - Refresh Token（可选，提供后一并吊销）
 * @returns 删除结果消息
 */
export async function deleteAccount(
  password: string,
  refreshToken?: string,
): Promise<{ message: string }> {
  return apiClient.delete<{ message: string }>(API_PATHS.ACCOUNT_DELETE, {
    body: JSON.stringify({ password, refresh_token: refreshToken }),
  });
}

/**
 * 用户注册（直接注册，非审批流程）
 *
 * 调用 POST /auth/register。
 *
 * @param data - 注册数据（username, email, password）
 * @returns 用户信息
 */
export async function register(data: {
  username: string;
  email: string;
  password: string;
}): Promise<UserResponse> {
  return apiClient.post<UserResponse>(API_PATHS.REGISTER, data);
}

/**
 * 导出当前用户个人数据（GDPR 数据可携权）
 *
 * 调用 GET /auth/export-data，返回用户的所有个人数据（JSON 格式），
 * 包括账号信息、文档列表、对话历史等。
 * 前端将 JSON 数据转换为文件下载。
 *
 * @returns 用户个人数据（JSON 字符串）
 */
export async function exportUserData(): Promise<string> {
  const response = await apiClient.get<unknown>(API_PATHS.EXPORT_DATA);
  return JSON.stringify(response, null, 2);
}

// ============================================
// 以下接口需后端新增，当前使用 Mock 实现
// ============================================

/** Mock 延迟（模拟网络请求） */
function mockDelay(ms = 800): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Mock 申请状态存储（localStorage） */
const MOCK_APPLICATION_KEY = "kb_mock_application";

/**
 * 提交注册申请
 *
 * Mock 实现：将申请信息存入 localStorage，返回 pending 状态。
 * 后端就绪后切换为真实接口调用。
 *
 * @param data - 注册申请请求（email + username）
 * @returns 申请响应
 */
export async function submitRegisterApply(
  data: RegisterApplyRequest,
): Promise<RegisterApplyResponse> {
  await mockDelay();
  // 存储到 localStorage 模拟后端记录
  const application = {
    application_id: Date.now(),
    status: "pending" as const,
    email: data.email,
    username: data.username,
    submitted_at: new Date().toISOString(),
  };
  localStorage.setItem(MOCK_APPLICATION_KEY, JSON.stringify(application));

  return {
    application_id: application.application_id,
    status: "pending",
    message: "注册申请已提交，请等待管理员审核。审核通过后，您将收到密码设置邮件。",
  };
}

/**
 * 查询注册申请状态
 *
 * Mock 实现：从 localStorage 读取申请状态。
 *
 * @param email - 申请人邮箱
 * @returns 申请状态响应
 */
export async function getApplicationStatus(
  email: string,
): Promise<ApplicationStatusResponse> {
  await mockDelay(500);
  const raw = localStorage.getItem(MOCK_APPLICATION_KEY);
  if (!raw) {
    throw new Error("未找到申请记录");
  }
  const app = JSON.parse(raw);
  if (app.email !== email) {
    throw new Error("未找到申请记录");
  }
  return {
    status: app.status,
    email: app.email,
    username: app.username,
    submitted_at: app.submitted_at,
    reviewed_at: app.reviewed_at || null,
    reject_reason: app.reject_reason || null,
  };
}

/**
 * 通过 Token 设置密码
 *
 * Mock 实现：模拟设置成功，清除申请记录。
 *
 * @param data - 设置密码请求（token + password）
 * @returns 设置结果
 */
export async function setPassword(
  data: SetPasswordRequest,
): Promise<{ success: boolean; message: string }> {
  await mockDelay();
  // Mock：验证 token 格式
  if (!data.token || data.token.length < 10) {
    throw new Error("无效的设置链接");
  }
  // 清除申请记录
  localStorage.removeItem(MOCK_APPLICATION_KEY);
  return {
    success: true,
    message: "密码设置成功，您现在可以使用邮箱登录了。",
  };
}
