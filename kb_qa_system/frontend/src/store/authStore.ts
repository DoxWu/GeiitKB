/**
 * 认证状态管理 Store
 *
 * 作用：
 *   使用 Zustand 管理用户认证状态，包括：
 *   - 当前登录用户信息
 *   - Token 存储与持久化
 *   - 登录/登出操作
 *   - 应用启动时从 localStorage 恢复会话
 *
 * 使用方式：
 *   import { useAuthStore } from '@/store/authStore';
 *   const { user, login, logout } = useAuthStore();
 */

import { create } from "zustand";
import * as authApi from "@/api/auth";
import {
  clearTokens,
  getStoredTokens,
  registerTokenExpiredCallback,
} from "@/api/client";
import { TOKEN_STORAGE_KEY, USER_STORAGE_KEY } from "@/utils/constants";
import type { TokenResponse, UserResponse, LoginRequest } from "@/types/user";

/** 认证 Store 状态接口 */
interface AuthState {
  /** 当前用户信息（null 表示未登录） */
  user: UserResponse | null;
  /** Token 信息 */
  tokens: TokenResponse | null;
  /** 是否已认证 */
  isAuthenticated: boolean;
  /** 是否正在加载（登录/初始化中） */
  loading: boolean;
  /** 错误信息 */
  error: string | null;

  /** 登录 */
  login: (data: LoginRequest) => Promise<void>;
  /** 登出 */
  logout: () => Promise<void>;
  /** 删除账号（GDPR/PIPL 合规） */
  deleteAccount: (password: string) => Promise<void>;
  /** 从 localStorage 恢复会话 */
  restoreSession: () => void;
  /** 清除错误 */
  clearError: () => void;
}

/**
 * 从 localStorage 恢复 Token 和用户信息
 * @returns Token 和用户信息
 */
function restoreFromStorage(): {
  tokens: TokenResponse | null;
  user: UserResponse | null;
} {
  try {
    const tokensRaw = localStorage.getItem(TOKEN_STORAGE_KEY);
    const userRaw = localStorage.getItem(USER_STORAGE_KEY);
    const tokens = tokensRaw ? (JSON.parse(tokensRaw) as TokenResponse) : null;
    const user = userRaw ? (JSON.parse(userRaw) as UserResponse) : null;
    return { tokens, user };
  } catch {
    return { tokens: null, user: null };
  }
}

/** 认证 Store */
export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  tokens: null,
  isAuthenticated: false,
  loading: false,
  error: null,

  login: async (data: LoginRequest) => {
    set({ loading: true, error: null });
    try {
      const tokenResponse = await authApi.login(data);

      // 持久化到 localStorage
      localStorage.setItem(
        TOKEN_STORAGE_KEY,
        JSON.stringify(tokenResponse),
      );
      localStorage.setItem(
        USER_STORAGE_KEY,
        JSON.stringify(tokenResponse.user),
      );

      set({
        user: tokenResponse.user,
        tokens: tokenResponse,
        isAuthenticated: true,
        loading: false,
        error: null,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "登录失败，请重试";
      set({ loading: false, error: message });
      throw err;
    }
  },

  logout: async () => {
    try {
      // 尝试通知后端登出（失败不阻塞）
      await authApi.logout();
    } catch {
      // 忽略登出请求失败
    } finally {
      clearTokens();
      localStorage.removeItem(USER_STORAGE_KEY);
      set({
        user: null,
        tokens: null,
        isAuthenticated: false,
        error: null,
      });
    }
  },

  deleteAccount: async (password: string) => {
    set({ loading: true, error: null });
    try {
      // 获取当前 Refresh Token，一并吊销
      const tokens = getStoredTokens();
      const refreshToken = tokens?.refresh_token;

      // 调用删除账号 API（后端会删除数据并吊销 Token）
      await authApi.deleteAccount(password, refreshToken);

      // 清除本地状态（不调用 logout API，避免重复黑名单请求）
      clearTokens();
      localStorage.removeItem(USER_STORAGE_KEY);
      set({
        user: null,
        tokens: null,
        isAuthenticated: false,
        loading: false,
        error: null,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "删除账号失败，请重试";
      set({ loading: false, error: message });
      throw err;
    }
  },

  restoreSession: () => {
    const { tokens, user } = restoreFromStorage();
    if (tokens && user) {
      set({
        tokens,
        user,
        isAuthenticated: true,
      });
    }
  },

  clearError: () => set({ error: null }),
}));

/**
 * 注册 Token 过期回调
 * 作用：当 Token 刷新失败时，清除认证状态，触发路由守卫跳转登录页
 */
registerTokenExpiredCallback(() => {
  localStorage.removeItem(USER_STORAGE_KEY);
  useAuthStore.setState({
    user: null,
    tokens: null,
    isAuthenticated: false,
    error: "登录已过期，请重新登录",
  });
});

/**
 * 模块加载时同步恢复会话
 * 作用：从 localStorage 读取已保存的 Token 和用户信息，
 *       确保路由守卫在首次渲染时即可正确判断认证状态，避免登录页闪烁。
 */
useAuthStore.getState().restoreSession();
