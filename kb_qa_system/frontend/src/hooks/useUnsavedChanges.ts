/**
 * 表单未保存提示 Hook（E5-03）
 *
 * 作用：
 *   当表单有未保存数据时，阻止用户意外离开页面导致数据丢失。
 *   支持两种离开方式：
 *   - 刷新/关闭页面：通过 beforeunload 事件弹出浏览器原生确认框
 *   - React Router 导航：通过返回 isDirty 状态供组件判断
 *
 * 使用方式：
 *   const [isDirty, setIsDirty] = useState(false);
 *   useUnsavedChanges(isDirty);
 *
 *   // 表单数据变化时设置 dirty 状态
 *   const handleChange = (e) => {
 *     setIsDirty(true);
 *     // ...更新表单数据
 *   };
 *
 *   // 保存成功后清除 dirty 状态
 *   const handleSubmit = async () => {
 *     await saveData();
 *     setIsDirty(false);
 *   };
 *
 * 参数说明：
 *   - isDirty: boolean — 表单是否有未保存的变更
 *   - message?: string — 自定义提示消息（部分浏览器不显示此消息）
 */

import { useEffect, useRef } from "react";

export function useUnsavedChanges(isDirty: boolean, message?: string) {
  const isDirtyRef = useRef(isDirty);

  // 同步 ref 到最新状态（beforeunload 事件中无法访问最新 state）
  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  // 注册 beforeunload 事件
  useEffect(() => {
    /**
     * beforeunload 事件处理函数
     * 作用：在页面即将卸载时，如果有未保存数据则阻止离开
     */
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (isDirtyRef.current) {
        // 现代浏览器需要调用 preventDefault， returnValue 可为空字符串
        e.preventDefault();
        e.returnValue = message || "";
        return message || "";
      }
    }

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [message]);

  // 返回当前 dirty 状态，供组件在路由导航前检查
  return isDirty;
}
