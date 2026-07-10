/**
 * Sidebar 组件集成测试
 *
 * 覆盖范围：
 *   - 渲染：品牌标题、文档库标题、全部文档按钮、分支列表、用户信息
 *   - 全部文档按钮：调用 selectFolder(null)
 *   - 分支列表：渲染 FolderItem、点击调用 selectFolder
 *   - 加载中状态：显示"加载中..."
 *   - 空分支列表：显示"暂无分支"
 *   - 新建分支按钮：打开 CreateFolderModal
 *   - 登出按钮：调用 logout + toast
 *   - 折叠状态：collapsed 样式
 *   - 折叠回调：onCollapse 调用
 *
 * Mock 策略：mock @/store/documentStore、@/store/authStore、@/store/toastStore、FolderItem、CreateFolderModal
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { DocumentFolder } from "@/types/document";

const { mockDocStore } = vi.hoisted(() => ({
  mockDocStore: {
    folders: [] as DocumentFolder[],
    currentFolderId: null as number | null,
    selectFolder: vi.fn(),
    foldersLoading: false,
  },
}));

const { mockAuthStore } = vi.hoisted(() => ({
  mockAuthStore: {
    user: { username: "张三", email: "zhangsan@example.com" },
    logout: vi.fn(),
  },
}));

const { mockToastStore } = vi.hoisted(() => ({
  mockToastStore: {
    info: vi.fn(),
  },
}));

vi.mock("@/store/documentStore", () => ({
  useDocumentStore: () => mockDocStore,
}));

vi.mock("@/store/authStore", () => ({
  useAuthStore: () => mockAuthStore,
}));

vi.mock("@/store/toastStore", () => ({
  useToastStore: () => mockToastStore,
}));

// mock FolderItem 以简化测试，验证其接收正确 props
vi.mock("../FolderItem", () => ({
  FolderItem: ({ folder, selected, onSelect }: {
    folder: DocumentFolder;
    selected: boolean;
    onSelect: () => void;
  }) => (
    <div data-testid={`folder-${folder.id}`} data-selected={selected}>
      <button onClick={onSelect}>{folder.name}</button>
    </div>
  ),
}));

// mock CreateFolderModal
vi.mock("../CreateFolderModal", () => ({
  CreateFolderModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="create-modal">新建分支弹窗</div> : null,
}));

import { Sidebar } from "../Sidebar";

/**
 * 渲染 Sidebar 并注入 Router 上下文
 *
 * 作用：Sidebar 使用 useNavigate（导航到 /chat、/settings），需要 Router 上下文才能渲染。
 */
const renderWithRouter = (ui: React.ReactElement) =>
  render(ui, { wrapper: MemoryRouter });

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

describe("Sidebar 组件", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDocStore.folders = [];
    mockDocStore.currentFolderId = null;
    mockDocStore.foldersLoading = false;
  });

  it("渲染品牌标题", () => {
    renderWithRouter(<Sidebar />);
    expect(screen.getByText("GeiIt企业知识库")).toBeInTheDocument();
  });

  it("渲染文档库标题", () => {
    renderWithRouter(<Sidebar />);
    expect(screen.getByText("文档库")).toBeInTheDocument();
  });

  it("渲染全部文档按钮", () => {
    renderWithRouter(<Sidebar />);
    expect(screen.getByText("全部文档")).toBeInTheDocument();
  });

  it("点击全部文档调用 selectFolder(null)", async () => {
    const user = userEvent.setup();
    renderWithRouter(<Sidebar />);
    await user.click(screen.getByText("全部文档"));
    expect(mockDocStore.selectFolder).toHaveBeenCalledWith(null);
  });

  it("渲染分支列表", () => {
    mockDocStore.folders = [
      createMockFolder({ id: 1, name: "分支1" }),
      createMockFolder({ id: 2, name: "分支2" }),
    ];
    renderWithRouter(<Sidebar />);
    expect(screen.getByText("分支1")).toBeInTheDocument();
    expect(screen.getByText("分支2")).toBeInTheDocument();
  });

  it("点击分支调用 selectFolder", async () => {
    const user = userEvent.setup();
    mockDocStore.folders = [createMockFolder({ id: 1, name: "分支1" })];
    renderWithRouter(<Sidebar />);
    await user.click(screen.getByText("分支1"));
    expect(mockDocStore.selectFolder).toHaveBeenCalledWith(1);
  });

  it("加载中状态显示加载提示", () => {
    mockDocStore.foldersLoading = true;
    renderWithRouter(<Sidebar />);
    expect(screen.getByText("加载中...")).toBeInTheDocument();
  });

  it("空分支列表显示暂无分支", () => {
    mockDocStore.folders = [];
    mockDocStore.foldersLoading = false;
    renderWithRouter(<Sidebar />);
    expect(screen.getByText("暂无分支")).toBeInTheDocument();
  });

  it("点击新建分支按钮打开弹窗", async () => {
    const user = userEvent.setup();
    renderWithRouter(<Sidebar />);
    await user.click(screen.getByLabelText("新建分支"));
    expect(screen.getByTestId("create-modal")).toBeInTheDocument();
  });

  it("渲染用户名", () => {
    renderWithRouter(<Sidebar />);
    expect(screen.getByText("张三")).toBeInTheDocument();
  });

  it("渲染用户邮箱", () => {
    renderWithRouter(<Sidebar />);
    expect(screen.getByText("zhangsan@example.com")).toBeInTheDocument();
  });

  it("渲染用户名首字母头像", () => {
    renderWithRouter(<Sidebar />);
    expect(screen.getByText("张")).toBeInTheDocument();
  });

  it("用户名为空时显示默认头像 U", () => {
    mockAuthStore.user = { username: "", email: "test@example.com" };
    renderWithRouter(<Sidebar />);
    expect(screen.getByText("U")).toBeInTheDocument();
  });

  it("用户为 null 时显示默认用户和头像", () => {
    mockAuthStore.user = null;
    renderWithRouter(<Sidebar />);
    expect(screen.getByText("用户")).toBeInTheDocument();
    expect(screen.getByText("U")).toBeInTheDocument();
  });

  it("点击登出按钮调用 logout 和 toast", async () => {
    const user = userEvent.setup();
    mockAuthStore.logout = vi.fn().mockResolvedValueOnce(undefined);
    renderWithRouter(<Sidebar />);
    await user.click(screen.getByLabelText("退出登录"));
    expect(mockAuthStore.logout).toHaveBeenCalled();
    expect(mockToastStore.info).toHaveBeenCalledWith("已退出登录");
  });

  it("currentFolderId 为 null 时全部文档高亮", () => {
    mockDocStore.currentFolderId = null;
    const { container } = renderWithRouter(<Sidebar />);
    const allDocsBtn = screen.getByText("全部文档").closest("button");
    expect(allDocsBtn?.className).toContain("bg-brand-light");
  });

  it("currentFolderId 不为 null 时全部文档不高亮", () => {
    mockDocStore.currentFolderId = 1;
    renderWithRouter(<Sidebar />);
    const allDocsBtn = screen.getByText("全部文档").closest("button");
    expect(allDocsBtn?.className).not.toContain("bg-brand-light");
  });

  it("传入 onCollapse 时渲染折叠按钮", () => {
    renderWithRouter(<Sidebar onCollapse={vi.fn()} />);
    expect(screen.getByLabelText("折叠侧边栏")).toBeInTheDocument();
  });

  it("未传入 onCollapse 时不渲染折叠按钮", () => {
    renderWithRouter(<Sidebar />);
    expect(screen.queryByLabelText("折叠侧边栏")).not.toBeInTheDocument();
  });

  it("点击折叠按钮调用 onCollapse", async () => {
    const user = userEvent.setup();
    const onCollapse = vi.fn();
    renderWithRouter(<Sidebar onCollapse={onCollapse} />);
    await user.click(screen.getByLabelText("折叠侧边栏"));
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it("collapsed=true 时应用折叠样式", () => {
    const { container } = renderWithRouter(<Sidebar collapsed={true} />);
    const aside = container.querySelector("aside");
    expect(aside?.className).toContain("w-0");
    expect(aside?.className).toContain("-translate-x-full");
  });
});
