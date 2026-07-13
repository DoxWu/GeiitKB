/**
 * 密码设置表单组件
 *
 * 作用：
 *   通过邮件链接中的 token 设置初始密码。
 *   包含密码强度校验、确认密码一致性校验。
 *
 * 使用方式：
 *   <SetPasswordForm token={tokenFromUrl} onSuccess={handleSuccess} />
 */

import { useState } from "react";
import { Lock, Eye, EyeOff, Check } from "lucide-react";
import { Button, Input } from "@/components/common";
import { PasswordStrength } from "./PasswordStrength";
import { useToastStore } from "@/store/toastStore";
import { setPassword } from "@/api/auth";
import { validatePassword } from "@/utils/validate";

/** SetPasswordForm 组件属性 */
interface SetPasswordFormProps {
  /** 邮件链接中的 token */
  token: string;
  /** 设置成功回调 */
  onSuccess?: () => void;
}

/** 表单错误类型 */
interface FormErrors {
  password?: string;
  confirmPassword?: string;
}

/** SetPasswordForm 组件 */
export function SetPasswordForm({ token, onSuccess }: SetPasswordFormProps) {
  const toast = useToastStore();
  const [password, setPasswordValue] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [loading, setLoading] = useState(false);

  /** 校验表单 */
  function validate(): boolean {
    const newErrors: FormErrors = {};

    const passwordResult = validatePassword(password);
    if (!passwordResult.valid) {
      newErrors.password = passwordResult.message;
    }

    if (!confirmPassword) {
      newErrors.confirmPassword = "请确认密码";
    } else if (password !== confirmPassword) {
      newErrors.confirmPassword = "两次输入的密码不一致";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  /** 提交设置密码 */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    try {
      await setPassword({ token, password });
      toast.success("密码设置成功", "您现在可以使用邮箱登录了");
      onSuccess?.();
    } catch (err) {
      toast.apiError("设置失败", err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="设置密码"
        type={showPassword ? "text" : "password"}
        name="password"
        placeholder="至少8位，包含字母和数字"
        value={password}
        onChange={(e) => {
          setPasswordValue(e.target.value);
          if (errors.password) setErrors({ ...errors, password: undefined });
        }}
        error={errors.password}
        icon={<Lock className="h-4 w-4" />}
        rightIcon={
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="transition-colors hover:text-ink"
            aria-label={showPassword ? "隐藏密码" : "显示密码"}
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        }
        autoComplete="new-password"
        autoFocus
      />

      {/* 密码强度指示器 */}
      <PasswordStrength password={password} />

      <Input
        label="确认密码"
        type={showPassword ? "text" : "password"}
        name="confirmPassword"
        placeholder="请再次输入密码"
        value={confirmPassword}
        onChange={(e) => {
          setConfirmPassword(e.target.value);
          if (errors.confirmPassword)
            setErrors({ ...errors, confirmPassword: undefined });
        }}
        error={errors.confirmPassword}
        icon={<Lock className="h-4 w-4" />}
        autoComplete="new-password"
      />

      <Button
        type="submit"
        fullWidth
        loading={loading}
        icon={<Check className="h-4 w-4" />}
      >
        设置密码
      </Button>
    </form>
  );
}
