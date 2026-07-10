/**
 * 文档管理主页面
 *
 * 作用：
 *   知识库管理系统的核心页面，采用三栏布局：
 *   - 左侧：文档库分支侧边栏
 *   - 中间：文档列表区（含搜索、排序、上传）
 *   - 右侧：文档预览面板（按需展开）
 *
 * 使用方式：
 *   <DocumentsPage />  // 由路由 /documents 渲染
 */

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Menu, Globe } from "lucide-react";
import { Sidebar } from "@/components/documents/Sidebar";
import { DocumentList } from "@/components/documents/DocumentList";
import { DocumentPreview } from "@/components/documents/DocumentPreview";
import { SearchBar } from "@/components/documents/SearchBar";
import { SortDropdown } from "@/components/documents/SortDropdown";
import { UploadZone } from "@/components/documents/UploadZone";
import { Pagination } from "@/components/documents/Pagination";
import { StatsPanel } from "@/components/documents/StatsPanel";
import { UrlImportModal } from "@/components/documents/UrlImportModal";
import { Button } from "@/components/common/Button";
import { useDocumentStore } from "@/store/documentStore";
import { cn } from "@/lib/utils";

/** DocumentsPage 组件 */
export default function DocumentsPage() {
  const {
    folders,
    currentFolderId,
    documents,
    total,
    page,
    pageSize,
    loadFolders,
    loadDocuments,
    selectFolder,
    setPage,
    stopAllPolling,
  } = useDocumentStore();

  // 从 URL 读取 folderId 参数（支持 /documents/:folderId 路由）
  const { folderId } = useParams<{ folderId: string }>();

  // 移动端侧边栏折叠状态
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // URL 导入弹窗状态
  const [urlImportOpen, setUrlImportOpen] = useState(false);

  // 页面加载时获取分支列表
  useEffect(() => {
    loadFolders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // URL folderId 变化时，同步选中分支并加载文档
  useEffect(() => {
    if (folderId !== undefined) {
      const id = Number(folderId);
      if (!Number.isNaN(id) && id !== currentFolderId) {
        selectFolder(id);
        return;
      }
    } else if (currentFolderId !== null && folderId === undefined) {
      // 从 /documents/:folderId 回到 /documents 时，清除分支选择
      selectFolder(null);
      return;
    }
    // 正常加载文档列表
    loadDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderId]);

  // 组件卸载时停止所有轮询，避免内存泄漏
  useEffect(() => {
    return () => {
      stopAllPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 当前分支名称 */
  const currentFolderName =
    currentFolderId === null
      ? "全部文档"
      : folders.find((f) => f.id === currentFolderId)?.name || "文档库";

  /** 是否为空列表（显示完整上传区） */
  const showFullUploadZone = documents.length === 0 && total === 0;

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      {/* 侧边栏 - 桌面端固定，移动端抽屉 */}
      <div
        className={cn(
          "fixed inset-0 z-50 lg:static lg:z-auto",
          sidebarOpen ? "block" : "hidden lg:block",
        )}
      >
        {/* 移动端遮罩 */}
        {sidebarOpen && (
          <div
            className="absolute inset-0 bg-black/20 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <div className="relative h-full">
          <Sidebar
            collapsed={!sidebarOpen}
            onCollapse={() => setSidebarOpen(false)}
          />
        </div>
      </div>

      {/* 主内容区 */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* 顶部工具栏 */}
        <header className="border-b border-line bg-surface px-4 py-3 lg:px-6">
          <div className="flex items-center gap-3">
            {/* 移动端菜单按钮 */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="rounded p-1.5 text-ink-secondary hover:bg-muted lg:hidden"
              aria-label="打开侧边栏"
            >
              <Menu className="h-5 w-5" />
            </button>

            {/* 页面标题 */}
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold text-ink">
                {currentFolderName}
              </h1>
              {total > 0 && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-ink-secondary">
                  {total}
                </span>
              )}
            </div>

            {/* 搜索框 */}
            <div className="ml-auto hidden sm:block">
              <SearchBar />
            </div>

            {/* 排序 */}
            <SortDropdown />

            {/* 上传按钮 */}
            <UploadZone folderId={currentFolderId} compact />

            {/* URL 导入按钮 */}
            <Button
              variant="secondary"
              size="sm"
              icon={<Globe className="h-4 w-4" />}
              onClick={() => setUrlImportOpen(true)}
            >
              URL 导入
            </Button>
          </div>

          {/* 移动端搜索框 */}
          <div className="mt-2 sm:hidden">
            <SearchBar />
          </div>
        </header>

        {/* 文档列表区 */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-6">
          {/* 空列表时显示完整上传区 */}
          {showFullUploadZone ? (
            <div className="mx-auto max-w-2xl">
              <UploadZone folderId={currentFolderId} />
            </div>
          ) : (
            <div className="mx-auto max-w-4xl space-y-4">
              {/* 文档统计面板 */}
              <StatsPanel />
              <DocumentList />
              {/* 分页控件：文档总数超过每页数量时显示 */}
              {total > pageSize && (
                <Pagination
                  current={page}
                  pageSize={pageSize}
                  total={total}
                  onChange={setPage}
                />
              )}
            </div>
          )}
        </div>
      </main>

      {/* 文档预览面板 */}
      <DocumentPreview />

      {/* URL 导入弹窗 */}
      <UrlImportModal
        open={urlImportOpen}
        onClose={() => setUrlImportOpen(false)}
        folderId={currentFolderId}
        onSuccess={() => loadDocuments()}
      />
    </div>
  );
}
