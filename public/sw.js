/**
 * Service Worker — 缓存 /images/maps/* 资源
 *
 * 策略: Cache-first (cache hit 直接返, miss 走网络 + 缓存)
 * - 地图文件基本不变, cache-first 体感最快
 * - 改图后 bump CACHE_VERSION (v1 → v2), 旧 cache 自动清
 * - install 不预缓存 (懒缓存: 用户访问哪个就缓存哪个, install 0 开销)
 * - activate 清旧版本 + clients.claim 立即接管 (不用等下次刷新)
 *
 * 限制:
 * - 只缓存 /images/maps/* (跟 IndexedDB 方案互不冲突, 互为兜底)
 * - 跨域资源 (CDN 之类的) 不动, 让浏览器默认处理
 * - dev 模式也注册 (见 ServiceWorkerRegister), 但 cache pattern 严格只匹配 /images/maps/*,
 *   不碰 HMR bundle / Next.js dev chunk, 不会引起 dev 卡顿
 */

const CACHE_VERSION = "v1";
const CACHE_NAME = `mc-maps-${CACHE_VERSION}`;
// 缓存路径 pattern — 只缓存地图资源
const CACHE_PATTERNS = [
  /^\/images\/maps\/.*\.(webp|png|jpg|jpeg|avif)$/i,
];

self.addEventListener("install", (event) => {
  // 不预缓存, install 阶段 0 网络开销
  // 立即激活, 不等旧 SW (如果有) 退出
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // 清掉旧版本 cache (例如 v1 → v2 后, v1 留着浪费空间)
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("mc-maps-") && k !== CACHE_NAME)
          .map((k) => caches.delete(k)),
      );
      // 立即接管所有 open clients (用户已经在浏览的页面), 不用刷新
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // 只处理 GET
  if (request.method !== "GET") return;

  // 只处理同源
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 只处理地图资源
  const shouldCache = CACHE_PATTERNS.some((p) => p.test(url.pathname));
  if (!shouldCache) return;

  event.respondWith(cacheFirst(request));
});

/** Cache-first: 命中返, miss 走网络 + 缓存. 网络失败返 408 */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }
  try {
    const response = await fetch(request);
    // 只缓存 2xx 响应 (3xx/4xx/5xx 不缓存, 避免污染)
    if (response && response.ok) {
      // response 是流, 必须 clone 才能既返回给浏览器又存 cache
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("Network error", {
      status: 408,
      headers: { "Content-Type": "text/plain" },
    });
  }
}
