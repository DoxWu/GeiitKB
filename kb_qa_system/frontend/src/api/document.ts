/**
 * 文档相关 API 接口
 *
 * 作用：
 *   封装文档列表、上传、详情、删除、重新处理等接口调用。
 *   文档库分支管理接口需后端新增，当前使用 Mock 实现。
 *
 * 对齐后端路由：kb_qa_system/backend/app/api/v1/documents.py
 */

import { apiClient } from "./client";
import { API_PATHS } from "@/utils/constants";
import type {
  DocumentListResponse,
  DocumentResponse,
  DocumentQueryParams,
  UploadDocumentParams,
  TaskStatusResponse,
  DocumentFolder,
  CreateFolderRequest,
  UpdateFolderRequest,
  FolderListResponse,
  DocumentStats,
  ImportUrlParams,
} from "@/types/document";

/**
 * 获取文档列表
 *
 * 调用 GET /documents，支持分页、搜索、排序、状态筛选。
 *
 * @param params - 查询参数
 * @returns 文档列表响应
 */
export async function getDocuments(
  params: DocumentQueryParams = {},
): Promise<DocumentListResponse> {
  // 构建查询字符串
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.page_size) query.set("page_size", String(params.page_size));
  if (params.status) query.set("status", params.status);
  if (params.search) query.set("search", params.search);
  if (params.sort_by) query.set("sort_by", params.sort_by);
  if (params.sort_order) query.set("sort_order", params.sort_order);
  // [Bug-1 修复] 补充 folder_id 参数传递，确保按分支过滤文档
  if (params.folder_id) query.set("folder_id", String(params.folder_id));
  // 补充 scope 参数传递，支持"我的/公共/全部"文档范围切换
  if (params.scope) query.set("scope", params.scope);

  const queryString = query.toString();
  const endpoint = queryString
    ? `${API_PATHS.DOCUMENTS}?${queryString}`
    : API_PATHS.DOCUMENTS;

  return apiClient.get<DocumentListResponse>(endpoint);
}

/**
 * 获取文档详情
 *
 * @param id - 文档ID
 * @returns 文档信息
 */
export async function getDocumentDetail(
  id: number,
): Promise<DocumentResponse> {
  return apiClient.get<DocumentResponse>(API_PATHS.DOCUMENT_DETAIL(id));
}

/**
 * 删除文档
 *
 * @param id - 文档ID
 */
export async function deleteDocument(id: number): Promise<void> {
  await apiClient.delete(API_PATHS.DOCUMENT_DETAIL(id));
}

/**
 * 重新处理文档
 *
 * @param id - 文档ID
 * @returns 任务状态响应
 */
export async function reprocessDocument(
  id: number,
): Promise<TaskStatusResponse> {
  return apiClient.post<TaskStatusResponse>(
    API_PATHS.DOCUMENT_REPROCESS(id),
  );
}

/**
 * 上传文档
 *
 * 调用 POST /documents/upload，使用 multipart/form-data。
 * 支持上传进度回调和取消。
 *
 * @param params - 上传参数
 * @param onProgress - 上传进度回调
 * @param signal - AbortSignal，用于取消上传
 * @returns 文档信息
 * @throws {DOMException} 当通过 signal 取消时抛出 AbortError
 */
export async function uploadDocument(
  params: UploadDocumentParams,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<DocumentResponse> {
  const formData = new FormData();
  formData.append("file", params.file);

  if (params.title) formData.append("title", params.title);
  if (params.category) formData.append("category", params.category);
  if (params.visibility) formData.append("visibility", params.visibility);
  if (params.folder_id) formData.append("folder_id", String(params.folder_id));

  return apiClient.upload<DocumentResponse>(
    API_PATHS.DOCUMENT_UPLOAD,
    formData,
    onProgress,
    signal,
  );
}

/**
 * 查询任务状态（轮询文档处理进度）
 *
 * 调用 GET /documents/{documentId}/task-status，按文档ID查询 Celery 任务状态。
 *
 * @param documentId - 文档ID
 * @returns 任务状态响应
 */
export async function getTaskStatus(
  documentId: number,
): Promise<TaskStatusResponse> {
  return apiClient.get<TaskStatusResponse>(
    API_PATHS.DOCUMENT_TASK_STATUS(documentId),
  );
}

/**
 * 获取文档统计信息
 *
 * 调用 GET /documents/stats/overview，返回当前用户可见范围内的文档统计。
 *
 * @param scope - 范围：accessible（默认）/ mine / public
 * @returns 文档统计信息
 */
export async function getDocumentStats(
  scope?: "accessible" | "mine" | "public",
): Promise<DocumentStats> {
  const query = scope ? `?scope=${scope}` : "";
  return apiClient.get<DocumentStats>(`${API_PATHS.DOCUMENT_STATS}${query}`);
}

/**
 * 从 URL 导入文档
 *
 * 调用 POST /documents/import-url，下载网页内容并创建文档。
 * 内置 SSRF 防护，后端会校验 URL 安全性。
 *
 * @param params - 导入参数（url + title + category + visibility）
 * @returns 新创建的文档信息
 */
export async function importFromUrl(
  params: ImportUrlParams,
): Promise<DocumentResponse> {
  const formData = new FormData();
  formData.append("url", params.url);
  if (params.title) formData.append("title", params.title);
  formData.append("category", params.category || "web");
  formData.append("visibility", params.visibility || "private");

  return apiClient.upload<DocumentResponse>(
    API_PATHS.DOCUMENT_URL,
    formData,
  );
}

// ============================================
// 文档库分支管理（需后端新增，当前使用 Mock 实现）
// ============================================

/** Mock 分支数据存储键 */
const MOCK_FOLDERS_KEY = "kb_mock_folders";

/** Mock 延迟 */
function mockDelay(ms = 500): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 读取 Mock 分支数据 */
function readMockFolders(): DocumentFolder[] {
  try {
    const raw = localStorage.getItem(MOCK_FOLDERS_KEY);
    if (raw) return JSON.parse(raw) as DocumentFolder[];
  } catch {
    // 忽略解析错误
  }
  // 默认分支
  const defaults: DocumentFolder[] = [
    {
      id: 1,
      name: "默认分支",
      document_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];
  localStorage.setItem(MOCK_FOLDERS_KEY, JSON.stringify(defaults));
  return defaults;
}

/** 写入 Mock 分支数据 */
function writeMockFolders(folders: DocumentFolder[]): void {
  localStorage.setItem(MOCK_FOLDERS_KEY, JSON.stringify(folders));
}

/**
 * 获取文档库分支列表
 *
 * Mock 实现：从 localStorage 读取分支数据。
 *
 * @returns 分支列表响应
 */
export async function getFolders(): Promise<FolderListResponse> {
  await mockDelay();
  const items = readMockFolders();
  return { items, total: items.length };
}

/**
 * 创建文档库分支
 *
 * @param data - 创建请求（name）
 * @returns 新建的分支
 */
export async function createFolder(
  data: CreateFolderRequest,
): Promise<DocumentFolder> {
  await mockDelay();
  const folders = readMockFolders();
  const newFolder: DocumentFolder = {
    id: Date.now(),
    name: data.name,
    document_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  folders.push(newFolder);
  writeMockFolders(folders);
  return newFolder;
}

/**
 * 更新文档库分支（重命名）
 *
 * @param id - 分支ID
 * @param data - 更新请求
 * @returns 更新后的分支
 */
export async function updateFolder(
  id: number,
  data: UpdateFolderRequest,
): Promise<DocumentFolder> {
  await mockDelay();
  const folders = readMockFolders();
  const index = folders.findIndex((f) => f.id === id);
  if (index === -1) throw new Error("分支不存在");

  folders[index] = {
    ...folders[index],
    ...data,
    updated_at: new Date().toISOString(),
  };
  writeMockFolders(folders);
  return folders[index];
}

/**
 * 删除文档库分支
 *
 * @param id - 分支ID
 */
export async function deleteFolder(id: number): Promise<void> {
  await mockDelay();
  const folders = readMockFolders();
  const filtered = folders.filter((f) => f.id !== id);
  writeMockFolders(filtered);
}
