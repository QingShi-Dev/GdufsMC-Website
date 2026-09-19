/**
 * Pure 几何 / 坐标变换 helpers — guide-map 用的纯函数都集中在这里
 *
 * 之前这些函数散在 components/map/guide-map.tsx (line 460-634), 文件 2359
 * 行, 阅读时要在 1500+ 行的 GuideMap 函数和这些工具函数之间来回跳. 抽到这里
 * 后 guide-map.tsx 只剩 UI 编排逻辑 (state + hooks + JSX), 几何变换可以
 * 单独读/测/改
 *
 * 设计原则:
 *   - 全部 pure (除 PRELOAD_CACHE 这个 module-level cache, 但 cache 是浏览器
 *     全局状态, 跟 React tree 无关)
 *   - 不依赖 React / hooks
 *   - 输入输出都是普通对象 / 数字, 易测试
 *
 * 包含:
 *   - MAX_ZOOM: 各维度最大放大倍数
 *   - preloadImage: hover 预加载主图瓦片 (LRU 缓存)
 *   - worldToVB: MC 世界坐标 (x, z) → viewBox 空间
 *   - screenToVB: 屏幕坐标 → viewBox 坐标 (考虑 SVG meet/slice 缩放 + 居中 offset)
 *   - worldToScreenFactory: MC 世界坐标 → 容器 CSS 像素 (组合 worldToVB +
 *     transform + viewport meet/slice)
 *   - computePanTransform: 视角中心移到 (worldX, worldZ) 并缩放到 targetZoom
 */

import { TILE_PX } from "./constants";
import type { NewWorldId, NewWorldMeta } from "./loader";

/**
 * 各维度最大放大倍数
 * - 主世界: 16× (1600%) — 区域大, 容许看细节 (建筑 / 机器)
 * - 下界: 8× (800%, 默认) — 不变
 * - 末地: 6× (600%) — 末地外岛少, 内容稀疏, 过度放大无意义
 */
export const MAX_ZOOM: Record<NewWorldId, number> = {
  overworld: 16,
  nether: 8,
  end: 6,
};

/**
 * 高清 (1024² webp lossless) 瓦片触发懒加载的缩放阈值.
 * - k < 此值: 只渲染 thumb 层 (q=85, 512², ~46 KB/张) — 缩远时足够清晰, 不浪费带宽
 * - k >= 此值: 渲染高清 webp lossless (1024², ~595 KB/张), 用 loading="lazy" 让浏览器视口接近时再下载
 * - 高清加载完后 sticky 显示, 缩小也不再切回 thumb (用户要求)
 * - 800% (k=8) 是用户实际想看细节的阈值 — 800% 时 thumb 已经明显糊, 高清细节看得清
 *   之前用 k=10 (1000%), 用户体验太长 — 800% 触发更自然
 */
export const HIGH_RES_ZOOM_THRESHOLD = 8;

/**
 * Hover preload Image cache (module-level, 跨组件实例 + 跨 mount 复用)
 * - 之前在 guide-map.tsx 顶层 module scope, 抽到独立文件后 module-level 状态保持
 *   同一个 cache, 行为完全不变
 * - LRU 上限 8 (3 维度 × 平均 ~30 张主图瓦片 — 单次 hover 预加载一组就够了)
 * - 预加载的是「主图」的所有瓦片 (按 col/row 排, 一次拉完避免切换时 N 次网络往返)
 */
const PRELOAD_CACHE = new Map<string, HTMLImageElement>();
const MAX_PRELOAD = 8;

export function preloadImage(src: string) {
  if (PRELOAD_CACHE.has(src)) return;
  if (PRELOAD_CACHE.size >= MAX_PRELOAD) {
    // 简单 FIFO: 清掉最早插入的 (Map 保插入序)
    const firstKey = PRELOAD_CACHE.keys().next().value;
    if (firstKey !== undefined) PRELOAD_CACHE.delete(firstKey);
  }
  const img = new Image();
  img.src = src;
  PRELOAD_CACHE.set(src, img);
}

/**
 * MC 世界坐标 (x, z) → viewBox 空间 (vbX, vbY)
 * 纯几何转换, 不依赖 viewBox 尺寸或屏幕尺寸 — 给 panTo / worldToScreenFactory 共用
 *
 * 跟 MapCanvas 里 SVG <g> 的 transform 前一步对齐: viewBox 空间里的点 (vbX, vbY)
 * 才是后续能直接用 tx/ty/k 变换的输入。
 */
export function worldToVB(
  worldX: number,
  worldZ: number,
  world: NewWorldMeta,
): { vx: number; vy: number } | null {
  for (let i = 0; i < world.map.tiles.length; i++) {
    const t = world.map.tiles[i];
    if (!t) continue;
    if (
      worldX >= t.x &&
      worldX < t.x + TILE_PX &&
      worldZ >= t.z &&
      worldZ < t.z + TILE_PX
    ) {
      return {
        vx: t.vbX + (worldX - t.x),
        vy: t.vbY + (worldZ - t.z),
      };
    }
  }
  return null;
}

/**
 * 屏幕坐标 → viewBox 坐标 (考虑 SVG meet/slice 的 scale + 居中 offset)
 *
 * 之前没考虑 offset 是个 bug — 容器永远用主世界 13:6 比例, 下界 (5:2) 和
 * 末地 (3:2) 的 viewBox 跟容器比例不匹配, SVG `meet` 模式会留黑边 (或 slice
 * 模式裁切), 老的公式 ((clientX - rect.left) * vbW / rect.width) 假设了
 * svg 占满整个 container, 算出来的 viewBox 坐标就偏了一段 offsetX/Y
 *
 * 后果: 下界/末地滚轮缩放 zoom 中心点错, 右上角坐标也错. 切到主世界
 * 比例对得上, 数字又对了 → 表现为"切个地图就好了"
 *
 * 现在跟 worldToScreenFactory 用同一套 parScale + offset 公式, 跟 SVG
 * 渲染完全对得回来
 */
export const screenToVB = (
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  vbW: number,
  vbH: number,
  isSlice: boolean = false,
) => {
  const cw = rect.width;
  const ch = rect.height;
  if (cw === 0 || ch === 0) return { x: 0, y: 0 };
  const scale = isSlice
    ? Math.max(cw / vbW, ch / vbH)
    : Math.min(cw / vbW, ch / vbH);
  const offsetX = (cw - vbW * scale) / 2;
  const offsetY = (ch - vbH * scale) / 2;
  return {
    x: (clientX - rect.left - offsetX) / scale,
    y: (clientY - rect.top - offsetY) / scale,
  };
};

/**
 * MC 世界坐标 (x, z) → 当前容器内 CSS 像素 (left, top)
 * 给地标 HTML 标签用的 — 跟 MapCanvas 的 SVG transform + viewBox 渲染保持一致
 *
 * 数学 (跟 MapCanvas 里 SVG `viewBox` + `transform` 严格对应):
 *   1. world (x, z) → viewBox (vbX, vbY): 在哪张瓦片内 + 瓦片内偏移 (走 worldToVB)
 *   2. viewBox (vbX, vbY) → transformed (vbX*k + tx, vbY*k + ty): SVG g transform
 *   3. transformed → 容器 CSS 像素: 跟 preserveAspectRatio 模式有关
 *      - meet: scale = min(cw/vbW, ch/vbH), 居中 (offsetX/Y = (size - content)/2)
 *      - slice: scale = max(...), 居中
 *
 * 注: 容器 size 用 getBoundingClientRect() 实时取, 不缓存 (resize 时自动跟)
 */
export function worldToScreenFactory(args: {
  // 容器尺寸 (state, 不是 ref) — react-hooks/refs 规则要求 render 阶段不能读 ref.current
  //   - 之前用 containerRef.current, 在 React 19 下报 "Cannot access refs during render"
  //   - ResizeObserver 在 layout 完成后回调, 把 {width, height} 存到 state
  //   - render 阶段用 state 即可, 不需要 ref
  containerRect: { width: number; height: number } | null;
  world: NewWorldMeta | null;
  tx: number;
  ty: number;
  k: number;
  isFullscreen: boolean;
  isMobile: boolean;
}): (worldX: number, worldZ: number) => { x: number; y: number } | null {
  const { containerRect, world, tx, ty, k, isFullscreen, isMobile } = args;
  if (!containerRect || !world) return () => null;
  const cw = containerRect.width;
  const ch = containerRect.height;
  if (cw === 0 || ch === 0) return () => null;
  const vbW = world.map.width;
  const vbH = world.map.height;
  const slice = !isFullscreen && isMobile;
  const parScale = slice
    ? Math.max(cw / vbW, ch / vbH)
    : Math.min(cw / vbW, ch / vbH);
  const contentW = vbW * parScale;
  const contentH = vbH * parScale;
  const offsetX = (cw - contentW) / 2;
  const offsetY = (ch - contentH) / 2;
  return (worldX: number, worldZ: number) => {
    const vb = worldToVB(worldX, worldZ, world);
    if (!vb) return null;
    // SVG g transform: translate(tx ty) scale(k) = (vb*k + tx, vb*k + ty)
    const tvbX = vb.vx * k + tx;
    const tvbY = vb.vy * k + ty;
    return {
      x: offsetX + tvbX * parScale,
      y: offsetY + tvbY * parScale,
    };
  };
}

/**
 * 视角中心移到 (worldX, worldZ) 并缩放到 targetZoom
 * 给 region 大地名点击用 — 类似百度地图点地名跳到该区域
 *
 * 数学 (viewBox 中心对准目标点):
 *   想让 viewBox 中心 (vbW/2, vbH/2) 显示目标点的 viewBox 位置 (vbX, vbY)
 *   即 transform 后: (vbX*k + tx, vbY*k + ty) = (vbW/2, vbH/2)
 *   ⇒ tx = vbW/2 - vbX*k, ty = vbH/2 - vbY*k
 */
export function computePanTransform(
  worldX: number,
  worldZ: number,
  targetZoom: number,
  world: NewWorldMeta,
): { tx: number; ty: number; k: number } | null {
  const vb = worldToVB(worldX, worldZ, world);
  if (!vb) return null;
  const { width: vbW, height: vbH } = world.map;
  return {
    k: targetZoom,
    tx: vbW / 2 - vb.vx * targetZoom,
    ty: vbH / 2 - vb.vy * targetZoom,
  };
}