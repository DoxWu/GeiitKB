/**
 * DocumentItem 组件集成测试
 *
 * 覆盖范围：
 *   - 渲染：文件名、文件大小、状态徽章、相对时间
 *   - 处理中状态：显示进度条
 *   - 处理失败状态：菜单显示"重新处理"选项
 *   - 点击卡片：调用 openPreview
 *   - 预览按钮：调用 openPreview
 *   - 删除操作：confirm + removeDocument + toast
 *   - 重新处理操作：reprocessDocument + toast
 *   - 分块数量展示
 *
 * Mock 策略：mock @/store/documentStore (openPreview, removeDocument, reprocessDocument) 和 @/store/toastStore
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DocumentResponse } from "@/types/document";

const { mockDocStore } = vi.hoisted(() => ({
  mockDocStore: {
    openPreview: vi.fn(),
    removeDocument: vi.fn(),
    reprocessDocument: vi.fn(),
    searchKeyword: "", // D2-02 搜索高亮所需（Task #143 新增）
    selectionMode: false,
    selectedDocIds: new Set<number>(),
    toggleSelect: vi.fn(),
  },
}));

const { mockToastStore } = vi.hoisted(() => ({
  mockToastStore: {
    success: vi.fn(),
    error: vi.fn(),
    apiError: vi.fn(),
  },
}));

vi.mock("@/store/documentStore", () => ({
  useDocumentStore: () => mockDocStore,
}));

vi.mock("@/store/toastStore", () => ({
  useToastStore: () => mockToastStore,
}));

// mock MoveToFolderModal 以避免其从 store 读取 folders（DocumentItem 测试不关注此组件行为）
vi.mock("../MoveToFolderModal", () => ({
  MoveToFolderModal: () => null,
}));

import { DocumentItem } from "../DocumentItem";

/** 创建测试用文档 */
function createMockDoc(
  overrides: Partial<DocumentResponse> = {},
): DocumentResponse {
  return {
    id: 1,
    title: "测试文档",
    file_name: "test.pdf",
    file_type: ".pdf",
    file_size: 1024,
    status: "completed",
    visibility: "private",
    folder_id: null,
    processing_step: null,
    processing_progress: 100,
    quality_score: 85,
    quality_issues: null,
    chunk_count: 5,
    total_tokens: 1000,
    task_id: null,
    error_message: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("DocumentItem 组件", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("渲染文件名", () => {
    render(<DocumentItem document={createMockDoc()} />);
    expect(screen.getByText("test.pdf")).toBeInTheDocument();
  });

  it("渲染文件大小", () => {
    render(<DocumentItem document={createMockDoc({ file_size: 1048576 })} />);
    // formatFileSize(1048576) 返回 "1.0 MB"
    expect(screen.getByText("1.0 MB")).toBeInTheDocument();
  });

  it("渲染状态徽章 - 已完成", () => {
    render(<DocumentItem document={createMockDoc({ status: "completed" })} />);
    expect(screen.getByText("已完成")).toBeInTheDocument();
  });

  it("渲染状态徽章 - 处理中", () => {
    render(<DocumentItem document={createMockDoc({ status: "processing" })} />);
    expect(screen.getByText("处理中")).toBeInTheDocument();
  });

  it("渲染状态徽章 - 失败", () => {
    render(<DocumentItem document={createMockDoc({ status: "failed" })} />);
    // getStatusLabel("failed") 返回 "处理失败"
    expect(screen.getByText("处理失败")).toBeInTheDocument();
  });

  it("渲染分块数量", () => {
    render(<DocumentItem document={createMockDoc({ chunk_count: 8 })} />);
    expect(screen.getByText(/8 个分块/)).toBeInTheDocument();
  });

  it("分块数为 0 时不显示分块信息", () => {
    render(<DocumentItem document={createMockDoc({ chunk_count: 0 })} />);
    expect(screen.queryByText(/个分块/)).not.toBeInTheDocument();
  });

  it("处理中状态显示进度条", () => {
    const { container } = render(
      <DocumentItem
        document={createMockDoc({
          status: "processing",
          processing_progress: 60,
          processing_step: "解析中",
        })}
      />,
    );
    expect(screen.getByText("解析中")).toBeInTheDocument();
    expect(screen.getByText("60%")).toBeInTheDocument();
    // 进度条宽度
    const progressBar = container.querySelector(
      '[style*="width: 60%"]',
    );
    expect(progressBar).toBeInTheDocument();
  });

  it("点击卡片调用 openPreview", async () => {
    const user = userEvent.setup();
    const doc = createMockDoc();
    render(<DocumentItem document={doc} />);
    // 点击文件名区域（卡片本身）
    await user.click(screen.getByText("test.pdf"));
    expect(mockDocStore.openPreview).toHaveBeenCalledWith(doc);
  });

  it("点击预览按钮调用 openPreview", async () => {
    const user = userEvent.setup();
    const doc = createMockDoc();
    render(<DocumentItem document={doc} />);
    await user.click(screen.getByLabelText("预览"));
    expect(mockDocStore.openPreview).toHaveBeenCalledWith(doc);
  });

  it("点击更多操作打开菜单", async () => {
    const user = userEvent.setup();
    render(<DocumentItem document={createMockDoc()} />);
    await user.click(screen.getByLabelText("更多操作"));
    expect(screen.getByText("删除")).toBeInTheDocument();
  });

  it("失败状态菜单显示重新处理选项", async () => {
    const user = userEvent.setup();
    render(<DocumentItem document={createMockDoc({ status: "failed" })} />);
    await user.click(screen.getByLabelText("更多操作"));
    expect(screen.getByText("重新处理")).toBeInTheDocument();
  });

  it("已完成状态菜单不显示重新处理选项", async () => {
    const user = userEvent.setup();
    render(<DocumentItem document={createMockDoc({ status: "completed" })} />);
    await user.click(screen.getByLabelText("更多操作"));
    expect(screen.queryByText("重新处理")).not.toBeInTheDocument();
  });

  it("点击删除 - confirm 确认后调用 removeDocument", async () => {
    const user = userEvent.setup();
    mockDocStore.removeDocument.mockResolvedValueOnce(undefined);
    render(<DocumentItem document={createMockDoc()} />);
    await user.click(screen.getByLabelText("更多操作"));
    await user.click(screen.getByText("删除"));
    await vi.waitFor(() => {
      expect(mockDocStore.removeDocument).toHaveBeenCalledWith(1);
    });
    expect(mockToastStore.success).toHaveBeenCalledWith("文档已删除");
  });

  it("删除失败 - 显示错误 toast", async () => {
    const user = userEvent.setup();
    mockDocStore.removeDocument.mockRejectedValueOnce(new Error("权限不足"));
    render(<DocumentItem document={createMockDoc()} />);
    await user.click(screen.getByLabelText("更多操作"));
    await user.click(screen.getByText("删除"));
    await vi.waitFor(() => {
      expect(mockToastStore.apiError).toHaveBeenCalledWith("删除失败", expect.objectContaining({ message: "权限不足" }));
    });
  });

  it("点击重新处理 - 调用 reprocessDocument", async () => {
    const user = userEvent.setup();
    mockDocStore.reprocessDocument.mockResolvedValueOnce(undefined);
    render(<DocumentItem document={createMockDoc({ status: "failed" })} />);
    await user.click(screen.getByLabelText("更多操作"));
    await user.click(screen.getByText("重新处理"));
    await vi.waitFor(() => {
      expect(mockDocStore.reprocessDocument).toHaveBeenCalledWith(1);
    });
    expect(mockToastStore.success).toHaveBeenCalledWith("已重新提交处理");
  });

  it("重新处理失败 - 显示错误 toast", async () => {
    const user = userEvent.setup();
    mockDocStore.reprocessDocument.mockRejectedValueOnce(new Error("服务繁忙"));
    render(<DocumentItem document={createMockDoc({ status: "failed" })} />);
    await user.click(screen.getByLabelText("更多操作"));
    await user.click(screen.getByText("重新处理"));
    await vi.waitFor(() => {
      expect(mockToastStore.apiError).toHaveBeenCalledWith("操作失败", expect.objectContaining({ message: "服务繁忙" }));
    });
  });

  it("点击菜单外部关闭菜单", async () => {
    const user = userEvent.setup();
    render(<DocumentItem document={createMockDoc()} />);
    await user.click(screen.getByLabelText("更多操作"));
    expect(screen.getByText("删除")).toBeInTheDocument();
    // 点击遮罩层关闭菜单
    const overlay = document.querySelector(".fixed.inset-0.z-10");
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay as Element);
    expect(screen.queryByText("删除")).not.toBeInTheDocument();
  });
});
