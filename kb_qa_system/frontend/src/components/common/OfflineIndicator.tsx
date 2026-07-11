/**
 * 离线状态提示组件（E5-02）
 *
 * 作用：
 *   监听浏览器的 online/offline 事件，在用户离线时显示提示条，
 *   上线时自动隐藏并 Toast 通知"已恢复连接"。
 *
 * 使用方式：
 *   在 App 根组件中渲染一次即可（全局生效）：
 *   <OfflineIndicator />
 *
 * 实现方式：
 *   - 通过 navigator.onLine 判断初始状态
 *   - 监听 window 的 online/offline 事件
 *   - 使用 toastStore 通知上线恢复
 */

import { useEffect, useState } from "react";
import { Wifi, WifiOff } from "lucide-react";
import { useToastStore } from "@/store/toastStore";

/** OfflineIndicator 组件 */
export function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const { success } = useToastStore();

  useEffect(() => {
    /**
     * 处理上线事件
     * 作用：更新状态并通知用户已恢复连接
     */
    function handleOnline() {
      setIsOnline(true);
      success("已恢复连接", "网络已恢复，您可以正常使用所有功能。");
    }

    /**
     * 处理离线事件
     * 作用：更新状态，提示条将自动显示
     */
    function handleOffline() {
      setIsOnline(false);
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 在线时不渲染任何内容
  if (isOnline) {
    return null;
  }

  // 离线时显示顶部提示条
  return (
    <div
      className="fixed top-0 left-0 right-0 z-[100] flex items-center justify-center gap-2 bg-warning px-4 py-2 text-sm font-medium text-white shadow-md"
      role="status"
      aria-live="polite"
    >
      <WifiOff className="h-4 w-4" />
      <span>您当前处于离线状态，部分功能不可用</span>
      <Wifi className="h-4 w-4 opacity-0" aria-hidden="true" />
    </div>
  );
}
