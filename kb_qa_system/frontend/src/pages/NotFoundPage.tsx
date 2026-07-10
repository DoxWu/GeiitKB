/**
 * 404 页面
 *
 * 作用：
 *   当用户访问不存在的路由时显示 404 提示页面。
 */

import { useNavigate } from "react-router-dom";
import { FileQuestion, ArrowLeft } from "lucide-react";
import { Button } from "@/components/common";

/** NotFoundPage 组件 */
export default function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-canvas px-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-ink-tertiary">
        <FileQuestion className="h-8 w-8" />
      </div>
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-ink">404</h1>
        <p className="text-sm text-ink-secondary">
          抱歉，您访问的页面不存在
        </p>
      </div>
      <Button
        variant="secondary"
        icon={<ArrowLeft className="h-4 w-4" />}
        onClick={() => navigate("/documents")}
      >
        返回首页
      </Button>
    </div>
  );
}
