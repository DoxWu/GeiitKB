/**
 * 通用组件库统一导出
 *
 * 作用：
 *   集中导出所有通用 UI 组件，方便其他模块统一导入。
 *
 * 使用方式：
 *   import { Button, Input, Badge, Modal } from '@/components/common';
 */

export { Button } from "./Button";
export { Input } from "./Input";
export { Badge } from "./Badge";
export { Spinner, FullScreenSpinner } from "./Spinner";
export { Skeleton, DocumentListSkeleton } from "./Skeleton";
export { Modal } from "./Modal";
export { EmptyState } from "./EmptyState";
export { ErrorState } from "./ErrorState";
export { ToastContainer } from "./Toast";
export { ErrorBoundary } from "./ErrorBoundary";
