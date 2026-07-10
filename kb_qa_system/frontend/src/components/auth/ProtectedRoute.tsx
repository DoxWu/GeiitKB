/**
 * 路由守卫组件
 *
 * 作用：
 *   保护需要认证的页面，未登录用户重定向至登录页。
 *   会话恢复在 authStore 模块加载时已同步完成，无需在此处理。
 *
 * 使用方式：
 *   <ProtectedRoute><DocumentsPage /></ProtectedRoute>
 */

import { type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";

/** ProtectedRoute 组件属性 */
interface ProtectedRouteProps {
  children: ReactNode;
}

/** ProtectedRoute 组件 */
export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated } = useAuthStore();
  const location = useLocation();

  // 未认证：重定向至登录页，并记录来源路径
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return <>{children}</>;
}
