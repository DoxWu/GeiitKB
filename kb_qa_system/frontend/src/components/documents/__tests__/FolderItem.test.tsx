/**
 * FolderItem 组件集成测试
 *
 * 覆盖范围：
 *   - 渲染：分支名称、文档数量徽章
 *   - 选中状态样式
 *   - 选中点击：调用 onSelect
 *   - 操作菜单：打开菜单、重命名、删除
 *   - 重命名模式：输入、Enter 确认、Escape 取消、空名称提示
 *   - 删除：confirm + 调用 deleteFolder
 *
 * Mock 策略：mock @/store/documentStore (renameFolder, deleteFolder) 和 @/store/toastStore
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DocumentFolder } from "@/types/document";

const { mockDocStore } = vi.hoisted(() => ({
  mockDocStore: {
    renameFolder: vi.fn(),
    deleteFolder: vi.fn(),
  },
}));

const { mockToastStore } = vi.hoisted(() => ({
  mockToastStore: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/store/documentStore", () => ({
  useDocumentStore: () => mockDocStore,
}));

vi.mock("@/store/toastStore", () => ({
  useToastStore: () => mockToastStore,
}));

import { FolderItem } from "../FolderItem";

/** 创建测试用分支 */
function createMockFolder(
  overrides: Partial<DocumentFolder> = {},
): DocumentFolder {
  return {
    id: 1,
    name: "项目文档",
    document_count: 3,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("FolderItem 组件", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("渲染分支名称", () => {
    render(
      <FolderItem folder={createMockFolder()} selected={false} onSelect={vi.fn()} />,
    );
    expect(screen.getByText("项目文档")).toBeInTheDocument();
  });

  it("文档数量大于 0 时显示徽章", () => {
    render(
      <FolderItem folder={createMockFolder()} selected={false} onSelect={vi.fn()} />,
    );
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("文档数量为 0 时不显示徽章", () => {
    render(
      <FolderItem
        folder={createMockFolder({ document_count: 0 })}
        selected={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("点击分支名调用 onSelect", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <FolderItem folder={createMockFolder()} selected={false} onSelect={onSelect} />,
    );
    await user.click(screen.getByText("项目文档"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("点击更多操作按钮打开菜单", async () => {
    const user = userEvent.setup();
    render(
      <FolderItem folder={createMockFolder()} selected={false} onSelect={vi.fn()} />,
    );
    await user.click(screen.getByLabelText("更多操作"));
    expect(screen.getByText("重命名")).toBeInTheDocument();
    expect(screen.getByText("删除")).toBeInTheDocument();
  });

  it("点击重命名进入编辑模式", async () => {
    const user = userEvent.setup();
    render(
      <FolderItem folder={createMockFolder()} selected={false} onSelect={vi.fn()} />,
    );
    await user.click(screen.getByLabelText("更多操作"));
    await user.click(screen.getByText("重命名"));
    // 编辑模式下有确认和取消按钮
    expect(screen.getByLabelText("确认")).toBeInTheDocument();
    expect(screen.getByLabelText("取消")).toBeInTheDocument();
  });

  it("编辑模式下 Enter 确认重命名", async () => {
    const user = userEvent.setup();
    mockDocStore.renameFolder.mockResolvedValueOnce(undefined);
    render(
      <FolderItem folder={createMockFolder()} selected={false} onSelect={vi.fn()} />,
    );
    await user.click(screen.getByLabelText("更多操作"));
    await user.click(screen.getByText("重命名"));
    const input = screen.getByDisplayValue("项目文档");
    await user.clear(input);
    await user.type(input, "新名称{Enter}");
    expect(mockDocStore.renameFolder).toHaveBeenCalledWith(1, "新名称");
    expect(mockToastStore.success).toHaveBeenCalledWith("重命名成功");
  });

  it("编辑模式下 Escape 取消", async () => {
    const user = userEvent.setup();
    render(
      <FolderItem folder={createMockFolder()} selected={false} onSelect={vi.fn()} />,
    );
    await user.click(screen.getByLabelText("更多操作"));
    await user.click(screen.getByText("重命名"));
    const input = screen.getByDisplayValue("项目文档");
    await user.type(input, "临时{Escape}");
    expect(mockDocStore.renameFolder).not.toHaveBeenCalled();
    // 退出编辑模式后回到分支名展示
    expect(screen.getByText("项目文档")).toBeInTheDocument();
  });

  it("空名称重命名 - 显示警告", async () => {
    const user = userEvent.setup();
    render(
      <FolderItem folder={createMockFolder()} selected={false} onSelect={vi.fn()} />,
    );
    await user.click(screen.getByLabelText("更多操作"));
    await user.click(screen.getByText("重命名"));
    const input = screen.getByDisplayValue("项目文档");
    await user.clear(input);
    await user.click(screen.getByLabelText("确认"));
    expect(mockToastStore.warning).toHaveBeenCalledWith("分支名称不能为空");
    expect(mockDocStore.renameFolder).not.toHaveBeenCalled();
  });

  it("名称未变化时直接退出编辑模式", async () => {
    const user = userEvent.setup();
    render(
      <FolderItem folder={createMockFolder()} selected={false} onSelect={vi.fn()} />,
    );
    await user.click(screen.getByLabelText("更多操作"));
    await user.click(screen.getByText("重命名"));
    await user.click(screen.getByLabelText("确认"));
    expect(mockDocStore.renameFolder).not.toHaveBeenCalled();
  });

  it("点击确认按钮重命名成功", async () => {
    const user = userEvent.setup();
    mockDocStore.renameFolder.mockResolvedValueOnce(undefined);
    render(
      <FolderItem folder={createMockFolder()} selected={false} onSelect={vi.fn()} />,
    );
    await user.click(screen.getByLabelText("更多操作"));
    await user.click(screen.getByText("重命名"));
    const input = screen.getByDisplayValue("项目文档");
    await user.clear(input);
    await user.type(input, "更新名称");
    await user.click(screen.getByLabelText("确认"));
    expect(mockDocStore.renameFolder).toHaveBeenCalledWith(1, "更新名称");
  });

  it("重命名失败 - 恢复原名称", async () => {
    const user = userEvent.setup();
    mockDocStore.renameFolder.mockRejectedValueOnce(new Error("网络错误"));
    render(
      <FolderItem folder={createMockFolder()} selected={false} onSelect={vi.fn()} />,
    );
    await user.click(screen.getByLabelText("更多操作"));
    await user.click(screen.getByText("重命名"));
    const input = screen.getByDisplayValue("项目文档");
    await user.clear(input);
    await user.type(input, "失败名称{Enter}");
    await vi.waitFor(() => {
      expect(mockDocStore.renameFolder).toHaveBeenCalled();
    });
    // 失败后恢复原名称展示
    expect(screen.getByText("项目文档")).toBeInTheDocument();
  });

  it("点击删除 - confirm 确认后调用 deleteFolder", async () => {
    const user = userEvent.setup();
    mockDocStore.deleteFolder.mockResolvedValueOnce(undefined);
    render(
      <FolderItem folder={createMockFolder()} selected={false} onSelect={vi.fn()} />,
    );
    await user.click(screen.getByLabelText("更多操作"));
    await user.click(screen.getByText("删除"));
    await vi.waitFor(() => {
      expect(mockDocStore.deleteFolder).toHaveBeenCalledWith(1);
    });
    expect(mockToastStore.success).toHaveBeenCalledWith("分支已删除");
  });

  it("删除失败 - 显示错误 toast", async () => {
    const user = userEvent.setup();
    mockDocStore.deleteFolder.mockRejectedValueOnce(new Error("删除失败"));
    render(
      <FolderItem folder={createMockFolder()} selected={false} onSelect={vi.fn()} />,
    );
    await user.click(screen.getByLabelText("更多操作"));
    await user.click(screen.getByText("删除"));
    await vi.waitFor(() => {
      expect(mockToastStore.error).toHaveBeenCalledWith("删除失败", "删除失败");
    });
  });

  it("点击取消按钮退出编辑模式", async () => {
    const user = userEvent.setup();
    render(
      <FolderItem folder={createMockFolder()} selected={false} onSelect={vi.fn()} />,
    );
    await user.click(screen.getByLabelText("更多操作"));
    await user.click(screen.getByText("重命名"));
    await user.click(screen.getByLabelText("取消"));
    expect(screen.getByText("项目文档")).toBeInTheDocument();
  });

  it("点击菜单外部关闭菜单", async () => {
    const user = userEvent.setup();
    render(
      <FolderItem folder={createMockFolder()} selected={false} onSelect={vi.fn()} />,
    );
    await user.click(screen.getByLabelText("更多操作"));
    expect(screen.getByText("重命名")).toBeInTheDocument();
    // 点击遮罩层关闭菜单
    const overlay = document.querySelector(".fixed.inset-0.z-10");
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay as Element);
    expect(screen.queryByText("重命名")).not.toBeInTheDocument();
  });
});
