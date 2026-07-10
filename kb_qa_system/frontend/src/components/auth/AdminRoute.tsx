/**
 * 管理员路由守卫组件
 *
 * 作用：
 *   保护需要管理员权限的页面。
 *   在 ProtectedRoute 基础上额外检查 is_superuser 字段：
 *   1. 未登录 → 重定向至登录页
 *   2. 已登录但非管理员 → 重定向至文档管理页
 *   3. 已登录且是管理员 → 渲染子组件
 *
 * 使用方式：
 *   <AdminRoute><AdminApplicationsPage /></AdminRoute>
 */

import { type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";

/** AdminRoute 组件属性 */
interface AdminRouteProps {
  children: ReactNode;
}

/** AdminRoute 组件 */
export function AdminRoute({ children }: AdminRouteProps) {
  const { isAuthenticated, user } = useAuthStore();
  const location = useLocation();

  // 1. 未认证：重定向至登录页，并记录来源路径
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  // 2. 非管理员：重定向至文档管理页（不暴露管理员页面存在）
  if (!user?.is_superuser) {
    return <Navigate to="/documents" replace />;
  }

  // 3. 管理员：渲染子组件
  return <>{children}</>;
}
