/**
 * PublicRoute 组件测试
 *
 * 覆盖范围：
 *   - 未登录时正常渲染子组件
 *   - 已登录时重定向至 /documents
 *
 * Mock 策略：mock @/store/authStore
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { PublicRoute } from "../PublicRoute";

const { mockAuthStore } = vi.hoisted(() => ({
  mockAuthStore: {
    isAuthenticated: false,
  },
}));

vi.mock("@/store/authStore", () => ({
  useAuthStore: () => mockAuthStore,
}));

/** 测试用子组件 */
function TestChild() {
  return <div>公开页面内容</div>;
}

/** 测试用目标页面 */
function DocumentsPage() {
  return <div>文档管理页</div>;
}

describe("PublicRoute 组件", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthStore.isAuthenticated = false;
  });

  it("未登录时正常渲染子组件", () => {
    render(
      <MemoryRouter initialEntries={["/register"]}>
        <Routes>
          <Route
            path="/register"
            element={
              <PublicRoute>
                <TestChild />
              </PublicRoute>
            }
          />
          <Route path="/documents" element={<DocumentsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("公开页面内容")).toBeInTheDocument();
  });

  it("已登录时重定向至 /documents", () => {
    mockAuthStore.isAuthenticated = true;
    render(
      <MemoryRouter initialEntries={["/register"]}>
        <Routes>
          <Route
            path="/register"
            element={
              <PublicRoute>
                <TestChild />
              </PublicRoute>
            }
          />
          <Route path="/documents" element={<DocumentsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    // 应重定向到文档管理页
    expect(screen.getByText("文档管理页")).toBeInTheDocument();
    expect(screen.queryByText("公开页面内容")).not.toBeInTheDocument();
  });
});
