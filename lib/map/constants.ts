/**
 * 客户端/服务端共用的常量 (不依赖 fs/path, 可以从 client component 直接 import)
 *
 * - lib/new-guide-map-data.ts 顶部有 `import "server-only"`, 只能从 server component 用
 * - components/new-guide-map.tsx (client) 渲染/计算时需要 TILE_PX, 所以拆出来
 */

/** 每个瓦片在 viewBox 里的尺寸 (同时也是 PNG 像素尺寸) — 1 像素 = 1 MC 方块 */
export const TILE_PX = 1024;
