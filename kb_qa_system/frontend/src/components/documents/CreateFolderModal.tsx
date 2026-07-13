/**
 * 新建分支弹窗组件
 *
 * 作用：
 *   提供创建文档库分支的表单弹窗。
 *   包含分支名称输入和校验。
 */

import { useState } from "react";
import { Modal, Button, Input } from "@/components/common";
import { useDocumentStore } from "@/store/documentStore";
import { useToastStore } from "@/store/toastStore";

/** CreateFolderModal 组件属性 */
interface CreateFolderModalProps {
  /** 是否打开 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
}

/** CreateFolderModal 组件 */
export function CreateFolderModal({ open, onClose }: CreateFolderModalProps) {
  const { createFolder } = useDocumentStore();
  const toast = useToastStore();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  /** 提交创建 */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();

    if (!trimmed) {
      setError("分支名称不能为空");
      return;
    }
    if (trimmed.length > 50) {
      setError("分支名称最多 50 个字符");
      return;
    }

    setLoading(true);
    try {
      await createFolder(trimmed);
      toast.success("分支创建成功");
      setName("");
      setError("");
      onClose();
    } catch (err) {
      toast.apiError("创建失败", err);
    } finally {
      setLoading(false);
    }
  }

  /** 关闭时重置状态 */
  function handleClose() {
    setName("");
    setError("");
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="新建文档库分支"
      footer={
        <>
          <Button variant="ghost" onClick={handleClose}>
            取消
          </Button>
          <Button
            form="create-folder-form"
            type="submit"
            loading={loading}
          >
            创建
          </Button>
        </>
      }
    >
      <form id="create-folder-form" onSubmit={handleSubmit}>
        <Input
          label="分支名称"
          placeholder="请输入分支名称"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError("");
          }}
          error={error}
          autoFocus
        />
      </form>
    </Modal>
  );
}
