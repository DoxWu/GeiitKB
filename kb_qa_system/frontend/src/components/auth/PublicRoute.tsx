/**
 * 公开路由守卫组件
 *
 * 作用：
 *   保护公开页面（如 /register、/set-password），已登录用户访问时
 *   自动重定向至 /documents，避免已登录用户重复访问认证流程页面。
 *
 * 使用方式：
 *   <PublicRoute>
 *     <RegisterApplyPage />
 *   </PublicRoute>
 *
 * 对称设计：
 *   ProtectedRoute — 未登录用户访问受保护页面 → 重定向至 /login
 *   PublicRoute    — 已登录用户访问公开页面 → 重定向至 /documents
 */

import { type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";

/** PublicRoute 组件属性 */
interface PublicRouteProps {
  children: ReactNode;
}

/** PublicRoute 组件 */
export function PublicRoute({ children }: PublicRouteProps) {
  const { isAuthenticated } = useAuthStore();

  // 已认证：重定向至文档管理页
  if (isAuthenticated) {
    return <Navigate to="/documents" replace />;
  }

  return <>{children}</>;
}
