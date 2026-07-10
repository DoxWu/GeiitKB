/**
 * ProtectedRoute 组件集成测试
 *
 * 覆盖范围：
 *   - 已认证：渲染子组件
 *   - 未认证：重定向至 /login
 *
 * Mock 策略：mock @/store/authStore，控制 isAuthenticated
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

// Mock authStore
const { mockAuthStore } = vi.hoisted(() => ({
  mockAuthStore: {
    isAuthenticated: false,
  },
}));

vi.mock("@/store/authStore", () => ({
  useAuthStore: () => mockAuthStore,
}));

import { ProtectedRoute } from "../ProtectedRoute";

describe("ProtectedRoute 组件", () => {
  beforeEach(() => {
    mockAuthStore.isAuthenticated = false;
  });

  it("已认证 - 渲染子组件", () => {
    mockAuthStore.isAuthenticated = true;
    render(
      <MemoryRouter initialEntries={["/documents"]}>
        <Routes>
          <Route
            path="/documents"
            element={
              <ProtectedRoute>
                <div>受保护页面</div>
              </ProtectedRoute>
            }
          />
          <Route path="/login" element={<div>登录页</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("受保护页面")).toBeInTheDocument();
    expect(screen.queryByText("登录页")).not.toBeInTheDocument();
  });

  it("未认证 - 重定向至 /login", () => {
    mockAuthStore.isAuthenticated = false;
    render(
      <MemoryRouter initialEntries={["/documents"]}>
        <Routes>
          <Route
            path="/documents"
            element={
              <ProtectedRoute>
                <div>受保护页面</div>
              </ProtectedRoute>
            }
          />
          <Route path="/login" element={<div>登录页</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.queryByText("受保护页面")).not.toBeInTheDocument();
    expect(screen.getByText("登录页")).toBeInTheDocument();
  });
});
