/**
 * 密码设置页面
 *
 * 作用：
 *   通过邮件链接中的 token 设置初始密码。
 *   从 URL query 参数获取 token。
 *   设置成功后显示成功提示并跳转登录。
 */

import { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { CheckCircle2, ArrowLeft } from "lucide-react";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { SetPasswordForm } from "@/components/auth/SetPasswordForm";
import { Button } from "@/components/common";

/** SetPasswordPage 组件 */
export default function SetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const [success, setSuccess] = useState(false);

  /** 设置成功回调 */
  function handleSuccess() {
    setSuccess(true);
  }

  // 设置成功后的展示
  if (success) {
    return (
      <AuthLayout title="设置成功">
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-50">
            <CheckCircle2 className="h-6 w-6 text-success" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-ink">
              密码设置成功
            </p>
            <p className="text-xs text-ink-secondary">
              您现在可以使用邮箱登录系统了
            </p>
          </div>
          <Button
            icon={<ArrowLeft className="h-4 w-4" />}
            onClick={() => navigate("/login")}
            className="mt-2"
          >
            前往登录
          </Button>
        </div>
      </AuthLayout>
    );
  }

  // token 无效
  if (!token) {
    return (
      <AuthLayout title="链接无效">
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <p className="text-sm text-ink-secondary">
            密码设置链接无效或已过期。请重新申请注册或联系管理员。
          </p>
          <Link
            to="/register"
            className="text-sm font-medium text-brand hover:text-brand-hover"
          >
            重新申请注册
          </Link>
        </div>
      </AuthLayout>
    );
  }

  // 密码设置表单
  return (
    <AuthLayout
      title="设置密码"
      subtitle="为您的账号设置登录密码"
      footer={
        <Link
          to="/login"
          className="text-sm text-ink-secondary hover:text-ink"
        >
          返回登录
        </Link>
      }
    >
      <SetPasswordForm token={token} onSuccess={handleSuccess} />
    </AuthLayout>
  );
}
