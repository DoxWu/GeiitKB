/**
 * CreateFolderModal 组件集成测试
 *
 * 覆盖范围：
 *   - 渲染：open 时显示弹窗、close 时不显示
 *   - 校验：空名称、超长名称
 *   - 提交：合法名称调用 createFolder + 关闭弹窗
 *   - 失败处理：createFolder 失败显示 toast
 *   - 取消：点击取消关闭并重置
 *
 * Mock 策略：mock @/store/documentStore 和 @/store/toastStore
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mockDocStore } = vi.hoisted(() => ({
  mockDocStore: {
    createFolder: vi.fn(),
  },
}));

const { mockToastStore } = vi.hoisted(() => ({
  mockToastStore: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/store/documentStore", () => ({
  useDocumentStore: () => mockDocStore,
}));

vi.mock("@/store/toastStore", () => ({
  useToastStore: () => mockToastStore,
}));

import { CreateFolderModal } from "../CreateFolderModal";

describe("CreateFolderModal 组件", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("open=true 时显示弹窗", () => {
    render(<CreateFolderModal open={true} onClose={() => {}} />);
    expect(screen.getByText("新建文档库分支")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("请输入分支名称")).toBeInTheDocument();
  });

  it("open=false 时不显示弹窗", () => {
    render(<CreateFolderModal open={false} onClose={() => {}} />);
    expect(screen.queryByText("新建文档库分支")).not.toBeInTheDocument();
  });

  it("空名称提交 - 显示错误", async () => {
    const user = userEvent.setup();
    render(<CreateFolderModal open={true} onClose={() => {}} />);
    await user.click(screen.getByText("创建"));
    expect(screen.getByText("分支名称不能为空")).toBeInTheDocument();
    expect(mockDocStore.createFolder).not.toHaveBeenCalled();
  });

  it("超长名称提交 - 显示错误", async () => {
    const user = userEvent.setup();
    render(<CreateFolderModal open={true} onClose={() => {}} />);
    const input = screen.getByPlaceholderText("请输入分支名称");
    await user.type(input, "a".repeat(51));
    await user.click(screen.getByText("创建"));
    expect(screen.getByText("分支名称最多 50 个字符")).toBeInTheDocument();
    expect(mockDocStore.createFolder).not.toHaveBeenCalled();
  });

  it("合法名称 - 调用 createFolder 并关闭弹窗", async () => {
    const user = userEvent.setup();
    mockDocStore.createFolder.mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    render(<CreateFolderModal open={true} onClose={onClose} />);

    await user.type(screen.getByPlaceholderText("请输入分支名称"), "项目文档");
    await user.click(screen.getByText("创建"));

    expect(mockDocStore.createFolder).toHaveBeenCalledWith("项目文档");
    expect(mockToastStore.success).toHaveBeenCalledWith("分支创建成功");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("createFolder 失败 - 显示错误 toast", async () => {
    const user = userEvent.setup();
    mockDocStore.createFolder.mockRejectedValueOnce(new Error("名称已存在"));
    const onClose = vi.fn();
    render(<CreateFolderModal open={true} onClose={onClose} />);

    await user.type(screen.getByPlaceholderText("请输入分支名称"), "测试");
    await user.click(screen.getByText("创建"));

    await vi.waitFor(() => {
      expect(mockToastStore.error).toHaveBeenCalledWith(
        "创建失败",
        "名称已存在",
      );
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("点击取消 - 关闭弹窗并重置输入", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CreateFolderModal open={true} onClose={onClose} />);

    await user.type(screen.getByPlaceholderText("请输入分支名称"), "临时");
    await user.click(screen.getByText("取消"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
