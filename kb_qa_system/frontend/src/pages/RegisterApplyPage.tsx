/**
 * 注册申请页面
 *
 * 作用：
 *   渲染注册申请表单，展示申请审批流程指引。
 *   提交成功后显示成功状态页面。
 */

import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  FileEdit,
  MailCheck,
  KeyRound,
  CheckCircle2,
  ArrowLeft,
} from "lucide-react";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { RegisterApplyForm } from "@/components/auth/RegisterApplyForm";
import { Button } from "@/components/common";

/** 流程步骤配置 */
const STEPS = [
  {
    icon: FileEdit,
    title: "提交申请",
    description: "填写邮箱和用户名",
  },
  {
    icon: MailCheck,
    title: "管理员审核",
    description: "等待管理员审批确认",
  },
  {
    icon: KeyRound,
    title: "设置密码",
    description: "通过邮件链接设置密码",
  },
];

/** RegisterApplyPage 组件 */
export default function RegisterApplyPage() {
  const navigate = useNavigate();
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  /** 提交成功回调 */
  function handleSuccess(email: string) {
    setSubmittedEmail(email);
  }

  // 提交成功后的展示
  if (submittedEmail) {
    return (
      <AuthLayout title="申请已提交">
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-50">
            <CheckCircle2 className="h-6 w-6 text-success" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-ink">
              注册申请已成功提交
            </p>
            <p className="text-xs text-ink-secondary">
              我们已将申请发送至管理员审核。审核通过后，密码设置链接将发送至{" "}
              <span className="font-medium text-ink">
                {submittedEmail}
              </span>
            </p>
          </div>
          <Button
            variant="secondary"
            icon={<ArrowLeft className="h-4 w-4" />}
            onClick={() => navigate("/login")}
            className="mt-2"
          >
            返回登录
          </Button>
        </div>
      </AuthLayout>
    );
  }

  // 申请表单
  return (
    <AuthLayout
      title="注册申请"
      subtitle="填写信息提交注册申请"
      footer={
        <p className="text-sm text-ink-secondary">
          已有账号？{" "}
          <Link
            to="/login"
            className="font-medium text-brand hover:text-brand-hover"
          >
            返回登录
          </Link>
        </p>
      }
    >
      <RegisterApplyForm onSuccess={handleSuccess} />

      {/* 流程指引 */}
      <div className="mt-6 border-t border-line pt-4">
        <p className="mb-3 text-xs font-medium text-ink-secondary">
          注册流程
        </p>
        <div className="flex items-start justify-between gap-2">
          {STEPS.map((step, index) => (
            <div
              key={index}
              className="flex flex-1 flex-col items-center gap-1.5 text-center"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-ink-secondary">
                <step.icon className="h-4 w-4" />
              </div>
              <p className="text-xs font-medium text-ink">{step.title}</p>
              <p className="text-[10px] text-ink-tertiary">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </AuthLayout>
  );
}
