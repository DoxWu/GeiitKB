/**
 * Service Worker（D5-03 PWA 支持）
 *
 * 作用：
 *   缓存静态资源，支持离线访问和快速加载。
 *   采用缓存优先策略（静态资源）+ 网络优先策略（API 请求）。
 *
 * 缓存策略：
 *   1. 静态资源（JS/CSS/图片/字体）：缓存优先，回退到网络
 *   2. API 请求（/api/）：网络优先，回退到缓存
 *   3. 页面导航：网络优先，回退到缓存的 index.html
 */

/** 缓存名称（版本号用于更新时清理旧缓存） */
const CACHE_NAME = "geiit-kb-v1";

/** 需要预缓存的资源列表 */
const PRECACHE_URLS = ["/", "/index.html", "/favicon.svg", "/manifest.json"];

/** 安装事件：预缓存核心资源 */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)),
  );
  // 立即激活，不等旧 SW 释放
  self.skipWaiting();
});

/** 激活事件：清理旧版本缓存 */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      ),
    ),
  );
  // 立即接管所有客户端
  self.clients.claim();
});

/** 请求拦截：根据请求类型选择缓存策略 */
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // 仅处理 GET 请求，其他方法直接放行
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // API 请求：网络优先策略
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request)),
    );
    return;
  }

  // 页面导航：网络优先，回退到缓存
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/index.html")),
    );
    return;
  }

  // 静态资源：缓存优先策略
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        // 成功的响应才缓存
        if (response.ok && response.type === "basic") {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return response;
      });
    }),
  );
});
