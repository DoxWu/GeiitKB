/**
 * 表单校验工具函数
 *
 * 作用：
 *   提供邮箱、密码、用户名等输入字段的校验逻辑，
 *   与后端 Schema 校验规则保持一致。
 *
 * 对齐后端文件：kb_qa_system/backend/app/schemas/user.py
 */

/** 邮箱正则（简化版，后端使用 EmailStr 严格校验） */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 用户名合法字符正则：字母、数字、下划线、横线、中文（对齐后端 _USERNAME_PATTERN） */
const USERNAME_PATTERN = /^[a-zA-Z0-9_\-\u4e00-\u9fa5]+$/;

/** 密码需包含字母 */
const PASSWORD_LETTER = /[a-zA-Z]/;
/** 密码需包含数字 */
const PASSWORD_DIGIT = /[0-9]/;

/**
 * 校验邮箱格式
 *
 * @param email - 邮箱字符串
 * @returns 是否合法
 */
export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email);
}

/**
 * 校验用户名格式
 *
 * 规则（对齐后端）：
 *   - 长度 3-50 字符
 *   - 仅允许字母、数字、下划线、横线、中文
 *
 * @param username - 用户名
 * @returns 校验结果对象
 */
export function validateUsername(username: string): {
  valid: boolean;
  message?: string;
} {
  if (!username) {
    return { valid: false, message: "用户名不能为空" };
  }
  if (username.length < 3) {
    return { valid: false, message: "用户名至少 3 个字符" };
  }
  if (username.length > 50) {
    return { valid: false, message: "用户名最多 50 个字符" };
  }
  if (!USERNAME_PATTERN.test(username)) {
    return {
      valid: false,
      message: "用户名只能包含字母、数字、下划线、横线和中文",
    };
  }
  return { valid: true };
}

/**
 * 校验密码复杂度
 *
 * 规则（对齐后端 UserCreate.validate_password_complexity）：
 *   - 长度 8-100 字符
 *   - 必须包含至少一个字母
 *   - 必须包含至少一个数字
 *
 * @param password - 密码明文
 * @returns 校验结果对象
 */
export function validatePassword(password: string): {
  valid: boolean;
  message?: string;
} {
  if (!password) {
    return { valid: false, message: "密码不能为空" };
  }
  if (password.length < 8) {
    return { valid: false, message: "密码至少 8 个字符" };
  }
  if (password.length > 100) {
    return { valid: false, message: "密码最多 100 个字符" };
  }
  if (!PASSWORD_LETTER.test(password)) {
    return { valid: false, message: "密码必须包含至少一个字母" };
  }
  if (!PASSWORD_DIGIT.test(password)) {
    return { valid: false, message: "密码必须包含至少一个数字" };
  }
  return { valid: true };
}

/**
 * 计算密码强度等级
 *
 * @param password - 密码明文
 * @returns 强度等级：0-4（0=空，1=弱，2=中，3=强，4=极强）
 */
export function getPasswordStrength(password: string): number {
  if (!password) return 0;

  let score = 0;

  // 长度评分
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;

  // 字符多样性评分
  if (PASSWORD_LETTER.test(password) && PASSWORD_DIGIT.test(password)) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;

  return Math.min(score, 4);
}

/**
 * 获取密码强度文案
 *
 * @param strength - 强度等级 0-4
 * @returns 文案和颜色
 */
export function getStrengthLabel(strength: number): {
  label: string;
  color: string;
} {
  const map = [
    { label: "—", color: "text-ink-tertiary" },
    { label: "弱", color: "text-danger" },
    { label: "中", color: "text-warning" },
    { label: "强", color: "text-success" },
    { label: "极强", color: "text-success" },
  ];
  return map[strength] ?? map[0];
}
