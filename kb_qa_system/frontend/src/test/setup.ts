/**
 * Vitest 测试环境初始化
 *
 * 作用：
 *   导入 @testing-library/jest-dom 扩展断言方法（如 toBeInTheDocument），
 *   配置全局 mock（如 localStorage、matchMedia）。
 */

import "@testing-library/jest-dom";

/** Mock localStorage（jsdom 环境下可能不完整） */
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
});

/** Mock matchMedia（部分组件可能用到） */
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

/** Mock URL.createObjectURL（文件上传测试需要） */
Object.defineProperty(URL, "createObjectURL", {
  writable: true,
  value: () => "mock://url",
});

/** Mock confirm（删除确认对话框测试需要） */
Object.defineProperty(window, "confirm", {
  writable: true,
  value: () => true,
});

/** Mock scrollIntoView（部分组件可能触发） */
Element.prototype.scrollIntoView = () => {};
