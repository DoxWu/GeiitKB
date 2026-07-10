/**
 * format.ts 单元测试
 *
 * 覆盖范围：
 *   - formatFileSize：B/KB/MB/GB 转换、边界值
 *   - formatDate：ISO 格式化、含/不含时间
 *   - formatRelativeTime：相对时间计算
 *   - getStatusLabel：状态文案映射
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  formatFileSize,
  formatDate,
  formatRelativeTime,
  getStatusLabel,
} from "@/utils/format";

describe("formatFileSize", () => {
  it("0 字节返回 '0 B'", () => {
    expect(formatFileSize(0)).toBe("0 B");
  });

  it("负数返回 '—'", () => {
    expect(formatFileSize(-1)).toBe("—");
  });

  it("字节级别不显示小数", () => {
    expect(formatFileSize(500)).toBe("500 B");
  });

  it("KB 级别显示 1 位小数（当值 < 10）", () => {
    expect(formatFileSize(1024)).toBe("1.0 KB");
    expect(formatFileSize(1536)).toBe("1.5 KB");
  });

  it("KB 级别不显示小数（当值 >= 10）", () => {
    expect(formatFileSize(10240)).toBe("10 KB");
  });

  it("MB 级别正确转换", () => {
    expect(formatFileSize(1048576)).toBe("1.0 MB");
    expect(formatFileSize(5242880)).toBe("5.0 MB");
  });

  it("GB 级别正确转换", () => {
    expect(formatFileSize(1073741824)).toBe("1.0 GB");
  });
});

describe("formatDate", () => {
  it("空字符串返回 '—'", () => {
    expect(formatDate("")).toBe("—");
  });

  it("合法 ISO 字符串格式化为 YYYY-MM-DD HH:mm", () => {
    const result = formatDate("2026-07-10T14:30:00Z");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it("withTime=false 时只返回日期", () => {
    const result = formatDate("2026-07-10T14:30:00Z", false);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result).not.toContain(":");
  });

  it("默认 withTime=true 包含时间", () => {
    const result = formatDate("2026-07-10T14:30:00Z");
    expect(result).toContain(":");
  });
});

describe("formatRelativeTime", () => {
  beforeEach(() => {
    // 固定当前时间为 2026-07-10T12:00:00Z
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("空字符串返回 '—'", () => {
    expect(formatRelativeTime("")).toBe("—");
  });

  it("30 秒前返回 '刚刚'", () => {
    expect(formatRelativeTime("2026-07-10T11:59:40Z")).toBe("刚刚");
  });

  it("5 分钟前返回 '5 分钟前'", () => {
    expect(formatRelativeTime("2026-07-10T11:55:00Z")).toBe("5 分钟前");
  });

  it("3 小时前返回 '3 小时前'", () => {
    expect(formatRelativeTime("2026-07-10T09:00:00Z")).toBe("3 小时前");
  });

  it("2 天前返回 '2 天前'", () => {
    expect(formatRelativeTime("2026-07-08T12:00:00Z")).toBe("2 天前");
  });

  it("7 天以上返回日期格式", () => {
    const result = formatRelativeTime("2026-06-01T12:00:00Z");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("getStatusLabel", () => {
  it("各状态返回正确中文文案", () => {
    expect(getStatusLabel("pending")).toBe("等待处理");
    expect(getStatusLabel("processing")).toBe("处理中");
    expect(getStatusLabel("completed")).toBe("已完成");
    expect(getStatusLabel("failed")).toBe("处理失败");
    expect(getStatusLabel("low_quality")).toBe("质量较低");
  });

  it("未知状态返回原值", () => {
    expect(getStatusLabel("unknown")).toBe("unknown");
    expect(getStatusLabel("custom_status")).toBe("custom_status");
  });
});
