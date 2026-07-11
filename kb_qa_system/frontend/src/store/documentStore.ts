/**
 * 文档状态管理 Store
 *
 * 作用：
 *   使用 Zustand 管理文档管理页面的状态，包括：
 *   - 文档库分支列表与当前选中分支
 *   - 文档列表与分页信息
 *   - 搜索关键词与排序状态
 *   - 文档加载/上传状态
 *   - 当前预览的文档
 *   - 文档处理状态轮询（自动更新 processing 状态的文档进度）
 *
 * 使用方式：
 *   import { useDocumentStore } from '@/store/documentStore';
 *   const { documents, loadDocuments } = useDocumentStore();
 */

import { create } from "zustand";
import * as documentApi from "@/api/document";
import type {
  DocumentResponse,
  DocumentFolder,
  DocumentQueryParams,
  SortField,
  SortOrder,
  UploadDocumentParams,
} from "@/types/document";
import { POLL_INTERVAL, MAX_POLL_COUNT } from "@/utils/constants";

/** 文档 Store 状态接口 */
interface DocumentState {
  // ===== 分支状态 =====
  /** 文档库分支列表 */
  folders: DocumentFolder[];
  /** 当前选中的分支ID（null 表示全部） */
  currentFolderId: number | null;
  /** 分支加载中 */
  foldersLoading: boolean;

  // ===== 文档列表状态 =====
  /** 文档列表 */
  documents: DocumentResponse[];
  /** 文档总数 */
  total: number;
  /** 当前页码 */
  page: number;
  /** 每页数量 */
  pageSize: number;
  /** 文档列表加载中 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;

  // ===== 搜索与排序 =====
  /** 搜索关键词 */
  searchKeyword: string;
  /** 搜索历史（D2-03，最近 10 条，去重，持久化到 localStorage） */
  searchHistory: string[];
  /** 排序字段 */
  sortBy: SortField;
  /** 排序方向 */
  sortOrder: SortOrder;

  // ===== 预览状态 =====
  /** 当前预览的文档 */
  previewDocument: DocumentResponse | null;
  /** 预览面板是否打开 */
  previewOpen: boolean;

  // ===== 分支操作 =====
  /** 加载分支列表 */
  loadFolders: () => Promise<void>;
  /** 创建分支 */
  createFolder: (name: string) => Promise<void>;
  /** 重命名分支 */
  renameFolder: (id: number, name: string) => Promise<void>;
  /** 删除分支 */
  deleteFolder: (id: number) => Promise<void>;
  /** 选择分支 */
  selectFolder: (id: number | null) => void;

  // ===== 文档操作 =====
  /** 加载文档列表 */
  loadDocuments: () => Promise<void>;
  /** 上传文档（支持 AbortSignal 取消） */
  uploadDocument: (
    params: UploadDocumentParams,
    onProgress?: (percent: number) => void,
    signal?: AbortSignal,
  ) => Promise<DocumentResponse>;
  /** 删除文档 */
  removeDocument: (id: number) => Promise<void>;
  /** 重新处理文档 */
  reprocessDocument: (id: number) => Promise<void>;

  // ===== 搜索与排序 =====
  /** 设置搜索关键词（不立即加载，由组件防抖触发） */
  setSearchKeyword: (keyword: string) => void;
  /** 添加搜索关键词到历史（D2-03） */
  addSearchHistory: (keyword: string) => void;
  /** 清空搜索历史（D2-03） */
  clearSearchHistory: () => void;
  /** 设置排序 */
  setSort: (field: SortField, order: SortOrder) => void;
  /** 设置当前页码并加载文档 */
  setPage: (page: number) => void;

  // ===== 预览操作 =====
  /** 打开预览 */
  openPreview: (doc: DocumentResponse) => void;
  /** 关闭预览 */
  closePreview: () => void;

  // ===== 轮询管理 =====
  /** 检查并启动处理中文档的状态轮询 */
  startPollingIfNeeded: () => void;
  /** 停止所有轮询 */
  stopAllPolling: () => void;

  /** 清除错误 */
  clearError: () => void;
}

/**
 * 轮询管理器（模块级，非 React 状态）
 *
 * 存储每个文档ID对应的轮询定时器和轮询次数，
 * 避免在 Store 状态中存储定时器引用。
 */
const pollingManager: Map<
  number,
  { timer: ReturnType<typeof setInterval>; count: number }
> = new Map();

/**
 * 启动单个文档的状态轮询
 *
 * 按文档ID查询任务状态（GET /documents/{docId}/task-status），
 * 轮询 Celery 任务进度直到终态（SUCCESS/FAILURE）。
 *
 * @param docId - 文档ID
 * @param onUpdate - 状态更新回调
 */
function startDocumentPoll(
  docId: number,
  onUpdate: (status: string, progress: number) => void,
): void {
  // 如果已在轮询，不重复启动
  if (pollingManager.has(docId)) return;

  let count = 0;

  const poll = async () => {
    count++;
    // 超过最大轮询次数，停止轮询
    if (count > MAX_POLL_COUNT) {
      stopDocumentPoll(docId);
      return;
    }

    try {
      const taskStatus = await documentApi.getTaskStatus(docId);

      // 更新文档状态
      onUpdate(taskStatus.status, taskStatus.progress);

      // 终态：停止轮询
      if (taskStatus.status === "SUCCESS" || taskStatus.status === "FAILURE") {
        stopDocumentPoll(docId);
      }
    } catch {
      // 轮询失败（网络错误等），停止该文档的轮询
      stopDocumentPoll(docId);
    }
  };

  // 立即执行一次，然后按间隔轮询
  poll();
  const timer = setInterval(poll, POLL_INTERVAL);
  pollingManager.set(docId, { timer, count });
}

/**
 * 停止单个文档的轮询
 * @param docId - 文档ID
 */
function stopDocumentPoll(docId: number): void {
  const entry = pollingManager.get(docId);
  if (entry) {
    clearInterval(entry.timer);
    pollingManager.delete(docId);
  }
}

/** 停止所有轮询 */
function stopAllDocumentPolls(): void {
  pollingManager.forEach((entry) => clearInterval(entry.timer));
  pollingManager.clear();
}

/** 默认排序：创建时间降序（最新优先） */
const DEFAULT_SORT_FIELD: SortField = "created_at";
const DEFAULT_SORT_ORDER: SortOrder = "desc";

/** D2-03 搜索历史：localStorage 存储键名 */
const SEARCH_HISTORY_KEY = "geiit-search-history";
/** D2-03 搜索历史：最大保存条数 */
const MAX_HISTORY_ITEMS = 10;

/**
 * 从 localStorage 加载搜索历史（D2-03）
 *
 * 作用：
 *   在 store 初始化时读取已保存的搜索历史记录。
 *
 * @returns 搜索历史数组，无记录时返回空数组
 */
function loadSearchHistory(): string[] {
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_HISTORY_ITEMS) : [];
  } catch {
    return [];
  }
}

/**
 * 保存搜索历史到 localStorage（D2-03）
 *
 * @param history - 搜索历史数组
 */
function saveSearchHistory(history: string[]): void {
  try {
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history));
  } catch {
    // localStorage 写入失败（如隐私模式），忽略
  }
}

/** 文档 Store */
export const useDocumentStore = create<DocumentState>((set, get) => ({
  // ===== 初始状态 =====
  folders: [],
  currentFolderId: null,
  foldersLoading: false,

  documents: [],
  total: 0,
  page: 1,
  pageSize: 20,
  loading: false,
  error: null,

  searchKeyword: "",
  searchHistory: loadSearchHistory(),
  sortBy: DEFAULT_SORT_FIELD,
  sortOrder: DEFAULT_SORT_ORDER,

  previewDocument: null,
  previewOpen: false,

  // ===== 分支操作 =====
  loadFolders: async () => {
    set({ foldersLoading: true });
    try {
      const response = await documentApi.getFolders();
      set({ folders: response.items, foldersLoading: false });
    } catch (err) {
      set({
        foldersLoading: false,
        error: err instanceof Error ? err.message : "加载分支失败",
      });
    }
  },

  createFolder: async (name: string) => {
    try {
      const folder = await documentApi.createFolder({ name });
      set((state) => ({ folders: [...state.folders, folder] }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "创建分支失败" });
      throw err;
    }
  },

  renameFolder: async (id: number, name: string) => {
    try {
      const updated = await documentApi.updateFolder(id, { name });
      set((state) => ({
        folders: state.folders.map((f) => (f.id === id ? updated : f)),
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "重命名失败" });
      throw err;
    }
  },

  deleteFolder: async (id: number) => {
    try {
      await documentApi.deleteFolder(id);
      set((state) => ({
        folders: state.folders.filter((f) => f.id !== id),
        currentFolderId:
          state.currentFolderId === id ? null : state.currentFolderId,
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "删除分支失败" });
      throw err;
    }
  },

  selectFolder: (id: number | null) => {
    set({ currentFolderId: id, page: 1 });
    get().loadDocuments();
  },

  // ===== 文档操作 =====
  loadDocuments: async () => {
    const state = get();
    set({ loading: true, error: null });
    try {
      const params: DocumentQueryParams = {
        page: state.page,
        page_size: state.pageSize,
        search: state.searchKeyword || undefined,
        sort_by: state.sortBy,
        sort_order: state.sortOrder,
        folder_id: state.currentFolderId ?? undefined,
      };
      const response = await documentApi.getDocuments(params);
      set({
        documents: response.items,
        total: response.total,
        loading: false,
      });
      // 加载完成后，检查是否需要启动轮询
      get().startPollingIfNeeded();
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "加载文档失败",
      });
    }
  },

  uploadDocument: async (params, onProgress, signal) => {
    try {
      const doc = await documentApi.uploadDocument(params, onProgress, signal);
      // 上传成功后重新加载列表
      await get().loadDocuments();
      return doc;
    } catch (err) {
      // 如果是取消操作（AbortError），不设置错误状态
      // 注意：DOMException 在部分环境中不是 Error 实例，需通过 name 判断
      if (err && typeof err === "object" && err.name === "AbortError") {
        throw err;
      }
      set({ error: err instanceof Error ? err.message : "上传失败" });
      throw err;
    }
  },

  removeDocument: async (id: number) => {
    try {
      await documentApi.deleteDocument(id);
      // 停止该文档的轮询（如有）
      stopDocumentPoll(id);
      set((state) => ({
        documents: state.documents.filter((d) => d.id !== id),
        total: state.total - 1,
        previewDocument:
          state.previewDocument?.id === id ? null : state.previewDocument,
        previewOpen:
          state.previewDocument?.id === id ? false : state.previewOpen,
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "删除失败" });
      throw err;
    }
  },

  reprocessDocument: async (id: number) => {
    try {
      await documentApi.reprocessDocument(id);
      await get().loadDocuments();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "重新处理失败" });
      throw err;
    }
  },

  // ===== 搜索与排序 =====
  setSearchKeyword: (keyword: string) => {
    set({ searchKeyword: keyword, page: 1 });
  },

  addSearchHistory: (keyword: string) => {
    const trimmed = keyword.trim();
    if (!trimmed) return;
    // 去重后放到最前，保留最多 MAX_HISTORY_ITEMS 条
    const current = get().searchHistory;
    const filtered = current.filter((item) => item !== trimmed);
    const updated = [trimmed, ...filtered].slice(0, MAX_HISTORY_ITEMS);
    saveSearchHistory(updated);
    set({ searchHistory: updated });
  },

  clearSearchHistory: () => {
    saveSearchHistory([]);
    set({ searchHistory: [] });
  },

  setSort: (field: SortField, order: SortOrder) => {
    set({ sortBy: field, sortOrder: order, page: 1 });
    get().loadDocuments();
  },

  setPage: (page: number) => {
    set({ page });
    get().loadDocuments();
  },

  // ===== 预览操作 =====
  openPreview: (doc: DocumentResponse) => {
    set({ previewDocument: doc, previewOpen: true });
  },

  closePreview: () => {
    set({ previewOpen: false, previewDocument: null });
  },

  // ===== 轮询管理 =====
  startPollingIfNeeded: () => {
    const { documents } = get();

    // 找出所有处理中的文档（有 task_id）
    const processingDocs = documents.filter(
      (d) =>
        (d.status === "processing" || d.status === "pending") && d.task_id,
    );

    for (const doc of processingDocs) {
      // 尚未在轮询的文档才启动
      if (!pollingManager.has(doc.id) && doc.task_id) {
        startDocumentPoll(doc.id, (status, progress) => {
          // 将 Celery 任务状态映射为文档状态
          let docStatus: DocumentResponse["status"] = doc.status;
          if (status === "SUCCESS") {
            docStatus = "completed";
          } else if (status === "FAILURE") {
            docStatus = "failed";
          }

          // 更新 store 中该文档的状态和进度
          set((state) => ({
            documents: state.documents.map((d) =>
              d.id === doc.id
                ? {
                    ...d,
                    status: docStatus,
                    processing_progress: progress,
                    processing_step:
                      status === "STARTED" ? "处理中" : d.processing_step,
                  }
                : d,
            ),
            // 同步更新预览中的文档（如正在预览）
            previewDocument:
              state.previewDocument?.id === doc.id
                ? {
                    ...state.previewDocument,
                    status: docStatus,
                    processing_progress: progress,
                  }
                : state.previewDocument,
          }));

          // 如果任务完成，重新加载文档列表以获取最终数据
          if (status === "SUCCESS" || status === "FAILURE") {
            get().loadDocuments();
          }
        });
      }
    }

    // 停止已不在列表中或已完成的文档轮询
    const activeIds = new Set(processingDocs.map((d) => d.id));
    pollingManager.forEach((_, docId) => {
      if (!activeIds.has(docId)) {
        stopDocumentPoll(docId);
      }
    });
  },

  stopAllPolling: () => {
    stopAllDocumentPolls();
  },

  clearError: () => set({ error: null }),
}));
