/**
 * validate.ts 单元测试
 *
 * 覆盖范围：
 *   - isValidEmail：合法/非法邮箱格式
 *   - validateUsername：空值/长度/字符校验
 *   - validatePassword：空值/长度/字母/数字校验
 *   - getPasswordStrength：强度等级计算
 *   - getStrengthLabel：文案映射
 */

import { describe, it, expect } from "vitest";
import {
  isValidEmail,
  validateUsername,
  validatePassword,
  getPasswordStrength,
  getStrengthLabel,
} from "@/utils/validate";

describe("isValidEmail", () => {
  it("合法邮箱应返回 true", () => {
    expect(isValidEmail("user@example.com")).toBe(true);
    expect(isValidEmail("test.user@domain.org")).toBe(true);
    expect(isValidEmail("a@b.co")).toBe(true);
  });

  it("非法邮箱应返回 false", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("plaintext")).toBe(false);
    expect(isValidEmail("missing@domain")).toBe(false);
    expect(isValidEmail("@domain.com")).toBe(false);
    expect(isValidEmail("user@")).toBe(false);
    expect(isValidEmail("user space@domain.com")).toBe(false);
  });
});

describe("validateUsername", () => {
  it("合法用户名应返回 valid: true", () => {
    expect(validateUsername("abc")).toEqual({ valid: true });
    expect(validateUsername("user_name")).toEqual({ valid: true });
    expect(validateUsername("user-name")).toEqual({ valid: true });
    expect(validateUsername("用户名")).toEqual({ valid: true });
    expect(validateUsername("User123")).toEqual({ valid: true });
  });

  it("空用户名应返回错误", () => {
    const result = validateUsername("");
    expect(result.valid).toBe(false);
    expect(result.message).toBe("用户名不能为空");
  });

  it("长度不足 3 应返回错误", () => {
    const result = validateUsername("ab");
    expect(result.valid).toBe(false);
    expect(result.message).toBe("用户名至少 3 个字符");
  });

  it("长度超过 50 应返回错误", () => {
    const result = validateUsername("a".repeat(51));
    expect(result.valid).toBe(false);
    expect(result.message).toBe("用户名最多 50 个字符");
  });

  it("包含非法字符应返回错误", () => {
    const result = validateUsername("user@name");
    expect(result.valid).toBe(false);
    expect(result.message).toContain("只能包含");
  });

  it("恰好 3 和 50 字符的边界值应合法", () => {
    expect(validateUsername("abc").valid).toBe(true);
    expect(validateUsername("a".repeat(50)).valid).toBe(true);
  });
});

describe("validatePassword", () => {
  it("合法密码应返回 valid: true", () => {
    expect(validatePassword("password1")).toEqual({ valid: true });
    expect(validatePassword("Abc12345")).toEqual({ valid: true });
    expect(validatePassword("a1b2c3d4")).toEqual({ valid: true });
  });

  it("空密码应返回错误", () => {
    const result = validatePassword("");
    expect(result.valid).toBe(false);
    expect(result.message).toBe("密码不能为空");
  });

  it("长度不足 8 应返回错误", () => {
    const result = validatePassword("abc123");
    expect(result.valid).toBe(false);
    expect(result.message).toBe("密码至少 8 个字符");
  });

  it("长度超过 100 应返回错误", () => {
    const result = validatePassword("a1".repeat(51));
    expect(result.valid).toBe(false);
    expect(result.message).toBe("密码最多 100 个字符");
  });

  it("缺少字母应返回错误", () => {
    const result = validatePassword("12345678");
    expect(result.valid).toBe(false);
    expect(result.message).toBe("密码必须包含至少一个字母");
  });

  it("缺少数字应返回错误", () => {
    const result = validatePassword("password");
    expect(result.valid).toBe(false);
    expect(result.message).toBe("密码必须包含至少一个数字");
  });

  it("恰好 8 字符的边界值应合法", () => {
    expect(validatePassword("pass1234").valid).toBe(true);
  });
});

describe("getPasswordStrength", () => {
  it("空密码返回 0", () => {
    expect(getPasswordStrength("")).toBe(0);
  });

  it("短密码（< 8 字符）但有字母+数字返回低分", () => {
    expect(getPasswordStrength("abc123")).toBeLessThanOrEqual(2);
  });

  it("8 字符含字母+数字返回至少 2 分", () => {
    expect(getPasswordStrength("abcd1234")).toBeGreaterThanOrEqual(2);
  });

  it("12 字符含大小写+数字+特殊字符返回 4 分", () => {
    expect(getPasswordStrength("Abcdefgh123!")).toBe(4);
  });

  it("强度不超过 4", () => {
    expect(getPasswordStrength("VeryStrongP@ssw0rd2024!")).toBeLessThanOrEqual(4);
  });
});

describe("getStrengthLabel", () => {
  it("各等级返回正确文案", () => {
    expect(getStrengthLabel(0).label).toBe("—");
    expect(getStrengthLabel(1).label).toBe("弱");
    expect(getStrengthLabel(2).label).toBe("中");
    expect(getStrengthLabel(3).label).toBe("强");
    expect(getStrengthLabel(4).label).toBe("极强");
  });

  it("超出范围的值返回默认（0）", () => {
    expect(getStrengthLabel(99).label).toBe("—");
    expect(getStrengthLabel(-1).label).toBe("—");
  });

  it("每个等级都有 color 属性", () => {
    for (let i = 0; i <= 4; i++) {
      expect(getStrengthLabel(i).color).toBeTruthy();
    }
  });
});
