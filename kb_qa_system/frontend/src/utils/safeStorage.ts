/**
 * 安全存储工具
 *
 * 作用：
 *   提供兼容国产浏览器的存储层，解决夸克/QQ/百度等浏览器的
 *   隐私保护模式阻止 localStorage 写入导致登录失败的问题。
 *
 * 降级策略：
 *   localStorage（首选）→ sessionStorage（降级）→ 内存（兜底）
 *
 *   1. localStorage：首选，跨标签页共享，关闭浏览器后仍保留
 *   2. sessionStorage：降级，仅当前标签页有效，关闭标签页后丢失
 *   3. 内存 Map：兜底，页面刷新即丢失，仅保证当前会话内可用
 *
 * 使用方式：
 *   import { safeStorage } from '@/utils/safeStorage';
 *   safeStorage.setItem('key', 'value');
 *   const val = safeStorage.getItem('key');
 *   safeStorage.removeItem('key');
 */

/** 存储可用性状态 */
let _storageType: "localStorage" | "sessionStorage" | "memory" | null = null;

/** 内存存储（兜底） */
const _memoryStore = new Map<string, string>();

/**
 * 检测 localStorage 是否可用
 *
 * 作用：
 *   某些浏览器（夸克隐私模式、QQ 浏览器、百度浏览器）会阻止
 *   localStorage 写入，调用 setItem 时抛出 SecurityError 或
 *   QuotaExceededError。此函数通过实际写入/读取/删除来检测。
 *
 * @returns 是否可用
 */
function isLocalStorageAvailable(): boolean {
  const testKey = "__storage_test__";
  try {
    const ls = window.localStorage;
    ls.setItem(testKey, "1");
    const result = ls.getItem(testKey);
    ls.removeItem(testKey);
    return result === "1";
  } catch {
    return false;
  }
}

/**
 * 检测 sessionStorage 是否可用
 *
 * 作用：与 localStorage 检测逻辑一致，作为降级选项
 *
 * @returns 是否可用
 */
function isSessionStorageAvailable(): boolean {
  const testKey = "__storage_test__";
  try {
    const ss = window.sessionStorage;
    ss.setItem(testKey, "1");
    const result = ss.getItem(testKey);
    ss.removeItem(testKey);
    return result === "1";
  } catch {
    return false;
  }
}

/**
 * 获取当前可用的存储类型
 *
 * 作用：
 *   懒检测并缓存结果，避免每次调用都重新检测。
 *   优先 localStorage → sessionStorage → 内存兜底
 *
 * @returns 存储类型
 */
function detectStorageType(): "localStorage" | "sessionStorage" | "memory" {
  if (_storageType !== null) return _storageType;

  if (isLocalStorageAvailable()) {
    _storageType = "localStorage";
  } else if (isSessionStorageAvailable()) {
    _storageType = "sessionStorage";
  } else {
    _storageType = "memory";
  }

  return _storageType;
}

/**
 * 获取底层存储对象
 *
 * 作用：根据检测到的存储类型返回对应的存储对象
 *
 * @returns 存储对象或 null（内存模式）
 */
function getBackend(): Storage | null {
  const type = detectStorageType();
  if (type === "localStorage") return window.localStorage;
  if (type === "sessionStorage") return window.sessionStorage;
  return null;
}

/** 安全存储接口 */
export interface SafeStorage {
  /** 获取存储类型 */
  getType: () => "localStorage" | "sessionStorage" | "memory";
  /** 读取项 */
  getItem: (key: string) => string | null;
  /** 写入项 */
  setItem: (key: string, value: string) => void;
  /** 删除项 */
  removeItem: (key: string) => void;
  /** 是否使用了降级存储（非 localStorage） */
  isDegraded: () => boolean;
  /** 获取降级提示消息 */
  getDegradedMessage: () => string | null;
}

/** 安全存储实例 */
export const safeStorage: SafeStorage = {
  /**
   * 获取当前存储类型
   */
  getType(): "localStorage" | "sessionStorage" | "memory" {
    return detectStorageType();
  },

  /**
   * 读取存储项
   *
   * @param key - 存储键
   * @returns 存储值或 null
   */
  getItem(key: string): string | null {
    try {
      const backend = getBackend();
      if (backend) return backend.getItem(key);
      return _memoryStore.get(key) ?? null;
    } catch {
      return _memoryStore.get(key) ?? null;
    }
  },

  /**
   * 写入存储项
   *
   * @param key - 存储键
   * @param value - 存储值
   */
  setItem(key: string, value: string): void {
    try {
      const backend = getBackend();
      if (backend) {
        backend.setItem(key, value);
      } else {
        _memoryStore.set(key, value);
      }
    } catch {
      // 即使检测通过，实际写入时仍可能失败（如存储空间满）
      // 降级到内存存储
      _memoryStore.set(key, value);
    }
  },

  /**
   * 删除存储项
   *
   * @param key - 存储键
   */
  removeItem(key: string): void {
    try {
      const backend = getBackend();
      if (backend) backend.removeItem(key);
      _memoryStore.delete(key);
    } catch {
      _memoryStore.delete(key);
    }
  },

  /**
   * 是否使用了降级存储
   *
   * 作用：前端可根据此值显示兼容性提示
   */
  isDegraded(): boolean {
    return detectStorageType() !== "localStorage";
  },

  /**
   * 获取降级提示消息
   *
   * 作用：当存储降级时，返回用户友好的提示消息，
   *       建议用户更换浏览器或关闭隐私模式
   */
  getDegradedMessage(): string | null {
    const type = detectStorageType();
    if (type === "localStorage") return null;

    if (type === "sessionStorage") {
      return "当前浏览器限制了本地存储功能，登录状态将在关闭标签页后失效。建议使用 Chrome、Edge 或 Firefox 浏览器获得最佳体验。";
    }

    return "当前浏览器不支持本地存储，登录状态将在刷新页面后失效。建议使用 Chrome、Edge 或 Firefox 浏览器，或关闭浏览器的隐私/无痕模式。";
  },
};
