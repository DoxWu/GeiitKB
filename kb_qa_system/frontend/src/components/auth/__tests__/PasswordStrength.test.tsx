/**
 * PasswordStrength 组件单元测试
 *
 * 覆盖范围：
 *   - 无密码时不渲染
 *   - 各强度等级（弱/中/强/极强）正确显示文字标签
 *   - 4 段进度条根据强度着色
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PasswordStrength } from "../PasswordStrength";

describe("PasswordStrength 组件", () => {
  it("无密码时不渲染", () => {
    const { container } = render(<PasswordStrength password="" />);
    expect(container.firstChild).toBeNull();
  });

  it("强度为弱 - 显示弱标签", () => {
    // 仅长度达标但无字符多样性 → score=1 → 弱
    render(<PasswordStrength password="aaaaaaaa" />);
    expect(screen.getByText("弱")).toBeInTheDocument();
  });

  it("强度为中 - 显示中标签", () => {
    // 长度>=8 + 字母数字 → score=2 → 中
    render(<PasswordStrength password="abcd1234" />);
    expect(screen.getByText("中")).toBeInTheDocument();
  });

  it("强度为强 - 显示强标签", () => {
    // 长度>=8 + 字母数字 + 大小写 → score=3 → 强
    render(<PasswordStrength password="Abcd1234" />);
    expect(screen.getByText("强")).toBeInTheDocument();
  });

  it("强度为极强 - 显示极强标签", () => {
    // 长度>=12 + 字母数字 + 大小写 + 特殊字符 → score=4 → 极强
    render(<PasswordStrength password="Abcd1234!@#xyz" />);
    expect(screen.getByText("极强")).toBeInTheDocument();
  });

  it("渲染 4 段进度条", () => {
    const { container } = render(<PasswordStrength password="Abcd1234" />);
    const bars = container.querySelectorAll(".h-1.w-8");
    expect(bars).toHaveLength(4);
  });

  it("强度越高填充进度条越多", () => {
    const { container: weakContainer } = render(
      <PasswordStrength password="aaaaaaaa" />,
    );
    // 弱强度：1 段着色（非 bg-muted），3 段未着色（bg-muted）
    const weakBars = weakContainer.querySelectorAll(".h-1.w-8");
    const weakFilled = Array.from(weakBars).filter(
      (b) => !b.className.includes("bg-muted"),
    );
    expect(weakFilled).toHaveLength(1);

    const { container: strongContainer } = render(
      <PasswordStrength password="Abcd1234" />,
    );
    const strongBars = strongContainer.querySelectorAll(".h-1.w-8");
    const strongFilled = Array.from(strongBars).filter(
      (b) => !b.className.includes("bg-muted"),
    );
    expect(strongFilled).toHaveLength(3);
  });
});
