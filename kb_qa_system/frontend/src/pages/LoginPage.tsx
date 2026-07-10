/**
 * 登录页面
 *
 * 作用：
 *   渲染登录表单，处理登录成功后的路由跳转。
 *   已登录用户自动重定向至文档管理页。
 */

import { useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { LoginForm } from "@/components/auth/LoginForm";
import { useAuthStore } from "@/store/authStore";

/** LoginPage 组件 */
export default function LoginPage() {
  const navigate = useNavigate();
  const { isAuthenticated, error } = useAuthStore();

  // 已登录则重定向
  useEffect(() => {
    if (isAuthenticated) {
      navigate("/documents", { replace: true });
    }
  }, [isAuthenticated, navigate]);

  /** 登录成功回调 */
  function handleLoginSuccess() {
    navigate("/documents", { replace: true });
  }

  return (
    <AuthLayout
      title="登录"
      subtitle="欢迎使用GeiIt企业知识库"
      footer={
        <p className="text-sm text-ink-secondary">
          还没有账号？{" "}
          <Link
            to="/register"
            className="font-medium text-brand hover:text-brand-hover"
          >
            申请注册
          </Link>
        </p>
      }
    >
      {/* 全局错误提示（来自 store） */}
      {error && (
        <div className="mb-4 rounded-lg border border-danger/20 bg-red-50 px-4 py-2.5">
          <p className="text-sm text-danger">{error}</p>
        </div>
      )}
      <LoginForm onSuccess={handleLoginSuccess} />
    </AuthLayout>
  );
}
