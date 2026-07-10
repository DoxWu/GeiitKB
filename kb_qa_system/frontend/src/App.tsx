/**
 * 应用根组件
 *
 * 作用：
 *   配置路由表、全局 Toast 容器、错误边界。
 *   路由结构：
 *   - /login            → 登录页（已登录则重定向至 /documents）
 *   - /register          → 注册申请页（已登录则重定向至 /documents）
 *   - /set-password      → 设置密码页（已登录则重定向至 /documents）
 *   - /documents         → 文档管理页（受保护）
 *   - /documents/:folderId → 指定分支的文档管理页（受保护）
 *   - /                  → 重定向至 /documents
 *   - *                  → 404 页面
 *
 * 使用方式：
 *   由 main.tsx 渲染
 */

import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { ToastContainer, ErrorBoundary } from "@/components/common";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { PublicRoute } from "@/components/auth/PublicRoute";
import LoginPage from "@/pages/LoginPage";
import RegisterApplyPage from "@/pages/RegisterApplyPage";
import SetPasswordPage from "@/pages/SetPasswordPage";
import DocumentsPage from "@/pages/DocumentsPage";
import ChatPage from "@/pages/ChatPage";
import SettingsPage from "@/pages/SettingsPage";
import PrivacyPage from "@/pages/PrivacyPage";
import TermsPage from "@/pages/TermsPage";
import NotFoundPage from "@/pages/NotFoundPage";
import { useAuthStore } from "@/store/authStore";

/** 登录页重定向组件（已登录用户访问 /login 时重定向至 /documents） */
function LoginRoute() {
  const { isAuthenticated } = useAuthStore();

  if (isAuthenticated) {
    return <Navigate to="/documents" replace />;
  }
  return <LoginPage />;
}

/** App 根组件 */
export default function App() {
  return (
    <ErrorBoundary>
      <Router>
        <Routes>
          {/* 根路径重定向至文档管理页 */}
          <Route path="/" element={<Navigate to="/documents" replace />} />

          {/* 认证相关页面（已登录用户重定向至 /documents） */}
          <Route path="/login" element={<LoginRoute />} />
          <Route
            path="/register"
            element={
              <PublicRoute>
                <RegisterApplyPage />
              </PublicRoute>
            }
          />
          <Route
            path="/set-password"
            element={
              <PublicRoute>
                <SetPasswordPage />
              </PublicRoute>
            }
          />
          {/* 隐私政策页面（公开访问，无需登录） */}
          <Route path="/privacy" element={<PrivacyPage />} />
          {/* 用户协议页面（公开访问，无需登录） */}
          <Route path="/terms" element={<TermsPage />} />

          {/* 受保护页面 */}
          <Route
            path="/documents"
            element={
              <ProtectedRoute>
                <DocumentsPage />
              </ProtectedRoute>
            }
          />
          {/* 指定分支的文档管理页（直接访问指定文档库分支） */}
          <Route
            path="/documents/:folderId"
            element={
              <ProtectedRoute>
                <DocumentsPage />
              </ProtectedRoute>
            }
          />
          {/* 设置页面（账号管理、删除账号） */}
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <SettingsPage />
              </ProtectedRoute>
            }
          />
          {/* 聊天页面（问答对话） */}
          <Route
            path="/chat"
            element={
              <ProtectedRoute>
                <ChatPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/chat/:conversationId"
            element={
              <ProtectedRoute>
                <ChatPage />
              </ProtectedRoute>
            }
          />

          {/* 404 页面 */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>

        {/* 全局 Toast 通知容器 */}
        <ToastContainer />
      </Router>
    </ErrorBoundary>
  );
}
