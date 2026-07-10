/**
 * 密码强度指示器组件
 *
 * 作用：
 *   实时显示密码强度，通过 4 段进度条和文字标签反馈。
 *   帮助用户设置更安全的密码。
 *
 * 使用方式：
 *   <PasswordStrength password={password} />
 */

import { getPasswordStrength, getStrengthLabel } from "@/utils/validate";
import { cn } from "@/lib/utils";

/** PasswordStrength 组件属性 */
interface PasswordStrengthProps {
  /** 密码明文 */
  password: string;
}

/** 强度颜色映射（4 段进度条颜色） */
const strengthColors = [
  "bg-muted",
  "bg-danger",
  "bg-warning",
  "bg-success",
  "bg-success",
];

/** PasswordStrength 组件 */
export function PasswordStrength({ password }: PasswordStrengthProps) {
  const strength = getPasswordStrength(password);
  const { label, color } = getStrengthLabel(strength);

  if (!password) return null;

  return (
    <div className="mt-2 flex items-center gap-2">
      {/* 4 段进度条 */}
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((level) => (
          <div
            key={level}
            className={cn(
              "h-1 w-8 rounded-full transition-colors duration-200",
              level <= strength
                ? strengthColors[strength]
                : "bg-muted",
            )}
          />
        ))}
      </div>
      {/* 强度文字 */}
      <span className={cn("text-xs", color)}>{label}</span>
    </div>
  );
}
