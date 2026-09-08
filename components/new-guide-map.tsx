"use client";

/**
 * 新版导览地图 — 多瓦片 SVG 拼图
 *
 * 跟 guide-map.tsx 的差异:
 * - 数据从 prop 传入 (worlds: NewWorldMeta[]), 不再硬编码 WORLDS
 * - viewBox 用各维度的实际网格尺寸 (比例差异大, 1.50 ~ 3.08), 容器 aspect ratio
 *   跟随当前维度, 避免 1.89 固定比例对过宽/过窄的图造成大幅裁切
 * - 每个维度渲染 N 个 <image> (一张瓦片一个), 而非一张大图; 78 张主世界瓦片
 *   实测浏览器能并行解码, 总滞留 < 单张 17MB WebP
 * - 缩放/拖动/全屏/HUD/横屏提示全部沿用 guide-map 逻辑
 *
 * 2026-09-07 v1: 初始版本, 跟 guide-map.tsx 同步
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconPlus,
  IconMinus,
  IconDeviceMobile,
  IconRotate,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import type {
  NewMapLayer,
  NewMapTile,
  NewMapTone,
  NewWorldId,
  NewWorldMeta,
} from "@/lib/new-guide-map-data";
// TILE_PX 在 client 也需要, 单独从 constants 文件 import (data 文件是 server-only)
import { TILE_PX } from "@/lib/new-guide-map-constants";

/* ============================== Sub-components ============================== */

/* ---- 维度切换 tabs (主世界/下界/末地) ---- */
function WorldTabs({
  worlds,
  value,
  onChange,
  preloadWorld,
}: {
  worlds: NewWorldMeta[];
  value: NewWorldId;
  onChange: (id: NewWorldId) => void;
  preloadWorld: (id: NewWorldId) => void;
}) {
  return (
    // 还原成浅色系 (跟之前一致) — 跟深色地图形成对比
    // w-full: 跟下方地图同宽 (地图也是 100% 宽)
    <div className="w-full bg-white/60 backdrop-blur-md border border-slate-200/70 rounded-t-2xl p-1.5 flex flex-wrap items-center gap-2 shadow-sm shadow-slate-900/5">
      {worlds.map((w) => {
        const active = value === w.id;
        return (
          <button
            key={w.id}
            data-worldid={w.id}
            onClick={() => onChange(w.id)}
            onMouseEnter={() => preloadWorld(w.id)}
            onFocus={() => preloadWorld(w.id)}
            onTouchStart={() => preloadWorld(w.id)}
            className={cn(
              "px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center gap-2",
              active
                ? "bg-white text-slate-800"
                : "text-slate-500 hover:text-slate-800 hover:bg-white/40",
            )}
          >
            <span
              className="w-2.5 h-2.5 rounded-full transition-all"
              style={{
                background: active ? w.accent : "#cbd5e1",
                boxShadow: active ? `0 0 8px ${w.accent}80` : "none",
              }}
            />
            <span className="text-[16px] ml-0.5">{w.name}</span>
            <span className="text-[14px] text-slate-500 font-mono hidden sm:inline">
              {w.version}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ---- 缩放按钮 ---- */
function ZoomBtn({
  onClick,
  ariaLabel,
  children,
}: {
  onClick: () => void;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={ariaLabel}
      className="w-9 h-9 rounded-lg bg-white/60 border border-slate-200/80 text-slate-600 hover:text-slate-800 hover:bg-slate-50 flex items-center justify-center shadow-sm transition-colors"
    >
      {children}
    </button>
  );
}

/* ---- SVG 画布 (多瓦片版) ---- */
function MapCanvas({
  layer,
  tx,
  ty,
  k,
  isFullscreen,
  isMobile,
}: {
  layer: NewMapLayer;
  tx: number;
  ty: number;
  k: number;
  isFullscreen: boolean;
  /** < sm (640px) 用 slice, 否则 meet. SSR 时默认 false (走 meet, 跟 server 一致) */
  isMobile: boolean;
}) {
  // 移动端 (< sm, 640px): slice 模式 — 容器因 minHeight 比 viewBox 矮胖,
  //   meet 会留上下大量 slate-900 背景; slice 让 viewBox 填满容器
  //   (中心对齐, 两侧裁切), 配合 minHeight 360 几乎不露背景
  // 桌面 / 全屏: meet — 整图完整显示, 比例不一致时容器留灰
  // 用 prop isMobile 而不是直接读 window, 避免 SSR 时 window 不存在的报错
  const par = isFullscreen || !isMobile ? "xMidYMid meet" : "xMidYMid slice";
  return (
    <svg
      viewBox={`0 0 ${layer.width} ${layer.height}`}
      preserveAspectRatio={par}
      data-tour-svg
      className="absolute inset-0 w-full h-full"
    >
      <g
        transform={`translate(${tx} ${ty}) scale(${k})`}
        style={{ pointerEvents: "none" }}
      >
        {layer.tiles.map((t) => (
          <image
            key={`${t.col}-${t.row}`}
            href={t.src}
            // 修接缝: 每张瓦片向左上各偏 1px, 尺寸 +2 = 1026
            //   → 相邻瓦片重叠 2px, 盖住 SVG sub-pixel 渲染的 1px 白缝
            //   (原来 width=1024 没 overlap, 浮点坐标会留 1px 缝)
            x={t.vbX - 1}
            y={t.vbY - 1}
            width={1026}
            height={1026}
            preserveAspectRatio="xMidYMid meet"
          />
        ))}
        {/* 白框高亮 — 标记特殊区块 (主世界右下角的两个拼接区) */}
        {layer.highlights?.map((h, i) => (
          <g key={`hl-${i}`}>
            <rect
              x={h.x}
              y={h.y}
              width={h.width}
              height={h.height}
              fill="none"
              stroke="white"
              strokeWidth={6}
              // 缩放时保持视觉线宽恒定 (6px), 不被 viewBox 缩放吃掉
              vectorEffect="non-scaling-stroke"
            />
            {/* 高亮区域内的附加分隔线 (例如两个单格之间的竖线) */}
            {h.lines?.map((l, j) => (
              <line
                key={`hl-${i}-line-${j}`}
                x1={l.x1}
                y1={l.y1}
                x2={l.x2}
                y2={l.y2}
                stroke="white"
                strokeWidth={6}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
        ))}
        {/* 透明 rect 接收 pointer (拖动 / 滚轮) */}
        <rect
          width={layer.width}
          height={layer.height}
          fill="transparent"
        />
      </g>
    </svg>
  );
}

/* ============================== Helpers ============================== */

const MAP_BG: Record<NewMapTone, string> = {
  plains: "#a7f3d0",
  nether: "#fecaca",
  end: "#ddd6fe",
};

const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

/**
 * Hover preload Image cache (module-level, 跨组件实例 + 跨 mount 复用)
 * - 跟 guide-map 同样的 pattern, 这里 LRU 上限放大到 8 (3 维度 × 平均 ~30 张主图瓦片)
 * - 预加载的是「主图」的所有瓦片 (按 col/row 排, 一次拉完避免切换时 N 次网络往返)
 */
const PRELOAD_CACHE = new Map<string, HTMLImageElement>();
const MAX_PRELOAD = 8;
function preloadImage(src: string) {
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
 * 各维度最大放大倍数
 * - 主世界: 16× (1600%) — 区域大, 容许看细节 (建筑 / 机器)
 * - 下界: 8× (800%, 默认) — 不变
 * - 末地: 6× (600%) — 末地外岛少, 内容稀疏, 过度放大无意义
 */
const MAX_ZOOM: Record<NewWorldId, number> = {
  overworld: 16,
  nether: 8,
  end: 6,
};

const screenToVB = (
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  vbW: number,
  vbH: number,
) => ({
  x: ((clientX - rect.left) * vbW) / rect.width,
  y: ((clientY - rect.top) * vbH) / rect.height,
});

/* ============================== Main Component ============================== */

export interface NewGuideMapProps {
  worlds: NewWorldMeta[];
}

export function NewGuideMap({ worlds }: NewGuideMapProps) {
  // ---- 1. 路由/视图 ----
  // 列表为空时 fallback 到 overworld 防止 .find 出 undefined
  const initialId: NewWorldId = worlds[0]?.id ?? "overworld";
  const [worldId, setWorldId] = useState<NewWorldId>(initialId);

  // ---- 2. 视图变换 ----
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [k, setK] = useState(1);
  const kRef = useRef(1);
  const txRef = useRef(0);
  const tyRef = useRef(0);
  const worldRef = useRef<NewWorldMeta | null>(null);

  // ---- 3. 全屏 + 竖屏提示 + 视口宽度 (是否移动端) ----
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPortrait, setIsPortrait] = useState(false);
  const [showRotateHint, setShowRotateHint] = useState(false);
  // 是否 < sm (640px): SSR 默认 false, 客户端 mount 后再读 window.innerWidth
  //  - 初始 false 保证 server render 跟 client 第一次 render 结果一致 (hydration 匹配)
  //  - mount 后 setIsMobile(true) 会触发 re-render, MapCanvas 切到 slice
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 640);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait)");
    const update = () => setIsPortrait(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (isFullscreen && isPortrait) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowRotateHint(true);
      const t = setTimeout(() => setShowRotateHint(false), 3000);
      return () => clearTimeout(t);
    } else {
      setShowRotateHint(false);
    }
  }, [isFullscreen, isPortrait]);

  // ---- 4. 拖拽 / 滚轮 ref ----
  const containerRef = useRef<HTMLDivElement>(null);
  /**
   * 整个 NewGuideMap 根容器 (包含 WorldTabs + 地图)
   *  scrollMapIntoView 用这个 ref, 这样切维度 / 缩放 / 退出全屏时
   *  "维度选择 tabs + 地图" 一起滚到 header 下方, 而不是只滚地图
   *  (只滚地图会把 tabs 顶到 header 后面挡住)
   */
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<{ tx: number; ty: number; k: number } | null>(null);

  // ---- 5. 派生当前维度 ----
  const world = useMemo(
    () => worlds.find((w) => w.id === worldId) ?? worlds[0] ?? null,
    [worlds, worldId],
  );
  useEffect(() => {
    worldRef.current = world;
  }, [world]);

  const commit = useCallback(() => {
    rafRef.current = null;
    const p = pendingRef.current;
    if (!p) return;
    pendingRef.current = null;
    setTx(p.tx);
    setTy(p.ty);
    setK(p.k);
  }, []);
  const schedule = useCallback(
    (tx: number, ty: number, k: number) => {
      pendingRef.current = { tx, ty, k };
      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(commit);
      }
    },
    [commit],
  );

  const clampBounds = (
    tx: number,
    ty: number,
    k: number,
    vbW: number,
    vbH: number,
    containerW: number,
    containerH: number,
    isSlice: boolean,
  ) => {
    // 基线溢出: slice 模式下 (移动端), 容器比 viewBox 矮胖,
    //   可见区 = containerW/scale × containerH/scale < viewBox
    //   用户能看到 viewBox 的子集, 应该能拖动看隐藏部分
    // meet 模式 (桌面/全屏): 可见区 = viewBox, 基线溢出 = 0
    let baseOverflowX = 0;
    let baseOverflowY = 0;
    if (isSlice && containerW > 0 && containerH > 0) {
      const scale = Math.max(containerW / vbW, containerH / vbH);
      const effectiveW = containerW / scale;
      const effectiveH = containerH / scale;
      baseOverflowX = Math.max(0, vbW - effectiveW);
      baseOverflowY = Math.max(0, vbH - effectiveH);
    }
    // 缩放溢出: k > 1 时, 内容比 viewBox 大
    const zoomOverflowX = Math.max(0, vbW * (k - 1));
    const zoomOverflowY = Math.max(0, vbH * (k - 1));

    // 正确可拖范围 (非对称):
    //   xMidYMid 永远把 viewBox 居中, 可见窗口固定在 viewBox 中心 (vbW/2 ± visibleW/2)
    //   k=1: 用户能看完整张 viewBox, pannable = ±baseOverflow/2
    //   k>1: 内容更大, 但可见窗口还是 viewBox 中心, 往负方向 (看放大的右/下边) 更多
    //   任何方向都不会越出 viewBox → 永远不会露出空背景
    const maxTx = baseOverflowX / 2;
    const minTx = -(baseOverflowX / 2 + zoomOverflowX);
    const maxTy = baseOverflowY / 2;
    const minTy = -(baseOverflowY / 2 + zoomOverflowY);
    return {
      tx: clamp(tx, minTx, maxTx),
      ty: clamp(ty, minTy, maxTy),
    };
  };

  const commitImmediate = (nextTx: number, nextTy: number, nextK: number) => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingRef.current = null;
    kRef.current = nextK;
    txRef.current = nextTx;
    tyRef.current = nextTy;
    setK(nextK);
    setTx(nextTx);
    setTy(nextTy);
  };

  /**
   * 鼠标在地图上的实时坐标 — 跟 WorldTabs 行右侧同步显示
   *  - 反算: 屏幕坐标 → viewBox 坐标 (考虑 translate/scale 变换) → 瓦片索引
   *  - 只对当前 world.map.tiles 命中, 没命中就 null (显示空)
   *  - 鼠标移出地图时清空
   */
  const tileMap = useMemo(() => {
    if (!world) return new Map<string, NewMapTile>();
    const map = new Map<string, NewMapTile>();
    for (const t of world.map.tiles) {
      map.set(`${t.col},${t.row}`, t);
    }
    return map;
  }, [world]);
  const [hoverCoord, setHoverCoord] = useState<{
    col: number;
    row: number;
    x: number;
    z: number;
  } | null>(null);
  const onContainerMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const el = containerRef.current;
      const w = worldRef.current;
      if (!el || !w) return;
      const rect = el.getBoundingClientRect();
      const { width: vbW, height: vbH } = w.map;
      // 屏幕 → viewBox (考虑当前缩放和平移的逆变换)
      const mouseVB = screenToVB(e.clientX, e.clientY, rect, vbW, vbH);
      const contentX = (mouseVB.x - txRef.current) / kRef.current;
      const contentY = (mouseVB.y - tyRef.current) / kRef.current;
      // 1 PNG 像素 = 1 MC 方块 (TILE_PX=1024), 所以在 viewBox 里的 px 直接就是方块数
      // tile 索引用 Math.floor 算 (支持负数: pan 到 viewBox 之外时正确), 在瓦片内偏移同样支持负数
      const localColIdx = Math.floor(contentX / TILE_PX);
      const localRowIdx = Math.floor(contentY / TILE_PX);
      const inTileX = contentX - localColIdx * TILE_PX; // [0, TILE_PX) 或 pan 越界时为负
      const inTileY = contentY - localRowIdx * TILE_PX;
      const col = localColIdx + w.map.minCol;
      const row = localRowIdx + w.map.minRow;
      const tile = tileMap.get(`${col},${row}`);
      if (tile) {
        // 连续世界坐标 = tile 左上角 MC 坐标 + 瓦片内像素偏移
        // contentX/Y 来自浮点除法, inTileX/Y 也是浮点 — 用 Math.round 锁到个位整数
        // (1 PNG 像素 = 1 MC 方块, 浮点误差 < 0.5, 四舍五入即"最接近的方块")
        setHoverCoord({
          col: tile.col,
          row: tile.row,
          x: Math.round(tile.x + inTileX),
          z: Math.round(tile.z + inTileY),
        });
      } else {
        setHoverCoord(null);
      }
    },
    [tileMap],
  );
  const onContainerMouseLeave = useCallback(() => {
    setHoverCoord(null);
  }, []);

  /**
   * 滚到视口中央, 避开 fixed header (仅桌面端)
   *  - 跟 tutorial-steps 同款: 顶部贴 header 下沿, 留 TOP_GAP
   *  - 累加 offsetTop 拿 natural 文档位置 (避开 transform: scale 干扰)
   *  - 用 rootRef (整个组件根, 含 WorldTabs), 切维度 / 缩放 / 退出全屏后
   *    "维度选择 + 地图" 一起滚到 header 下方, tabs 不会被挡
   *  - 切维度 / 按钮缩放 / 退出全屏 / 滚轮缩放 (debounce) 都会触发
   *  - 移动端 (< 640px) 不滚, 用户自己控制页面滚动
   */
  const scrollMapIntoView = useCallback(() => {
    // 移动端不滚 — 用户手指控制滚动
    if (window.innerWidth < 640) return;

    const el = rootRef.current;
    if (!el) return;
    const headerEl = document.querySelector<HTMLElement>("header.fixed.top-0");
    const headerHeight = headerEl ? headerEl.getBoundingClientRect().height : 0;
    const TOP_GAP = window.innerWidth >= 640 ? 8 : 14;

    // 累加 offsetTop 拿到 natural 文档位置 (transform: scale 不影响 offsetTop)
    let naturalTop = 0;
    let node: HTMLElement | null = el;
    while (node) {
      naturalTop += node.offsetTop;
      node = node.offsetParent as HTMLElement | null;
    }

    // 顶部贴 header 下沿 (跟 tutorial-steps 一致)
    const targetVisualTop = headerHeight + TOP_GAP;
    const targetScrollY = Math.max(0, naturalTop - targetVisualTop);

    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({
      top: targetScrollY,
      behavior: reducedMotion ? "auto" : "smooth",
    });
  }, []);

  /**
   * 滚轮缩放专用 — debounce 150ms
   *  滚轮是连续事件, 每次都滚会跳; 停手 150ms 后再滚一次
   */
  const wheelScrollTimeoutRef = useRef<number | null>(null);
  const scheduleScrollAfterWheel = useCallback(() => {
    if (wheelScrollTimeoutRef.current !== null) {
      clearTimeout(wheelScrollTimeoutRef.current);
    }
    wheelScrollTimeoutRef.current = window.setTimeout(() => {
      scrollMapIntoView();
      wheelScrollTimeoutRef.current = null;
    }, 150);
  }, [scrollMapIntoView]);
  // 卸载清理
  useEffect(() => {
    return () => {
      if (wheelScrollTimeoutRef.current !== null) {
        clearTimeout(wheelScrollTimeoutRef.current);
      }
    };
  }, []);

  // 切维度: 重置视图 + 滚到中央
  // 跳过策略: 比对 worldId 跟初始值, 没变就不滚
  //   (比 useRef flag 更稳: React 18 StrictMode 双挂载时, ref flag 会被第 1 次跑改成 false,
  //    第 2 次跑看到 false 就误触发了; 用值对比, 两次 worldId 跟初始值都相等, 都会跳过)
  const initialWorldIdRef = useRef<NewWorldId>(worldId);
  useEffect(() => {
    if (initialWorldIdRef.current === worldId) return;
    queueMicrotask(() => commitImmediate(0, 0, 1));
    scrollMapIntoView();
  }, [worldId, scrollMapIntoView]);

  // 退出全屏: 等 fullscreenchange 完结后滚动
  const prevFullscreenRef = useRef(isFullscreen);
  useEffect(() => {
    const wasFullscreen = prevFullscreenRef.current;
    prevFullscreenRef.current = isFullscreen;
    if (wasFullscreen && !isFullscreen) {
      // 150ms 让浏览器完成 fullscreenchange + 布局稳定
      const t = setTimeout(scrollMapIntoView, 150);
      return () => clearTimeout(t);
    }
  }, [isFullscreen, scrollMapIntoView]);

  // 滚轮缩放
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const curK = kRef.current;
      const curTx = txRef.current;
      const curTy = tyRef.current;
      const delta = -e.deltaY * 0.0025;
      // max zoom 按当前维度取 (主世界 10x, 下界 8x, 末地 6x)
      const maxK = MAX_ZOOM[worldRef.current?.id ?? "overworld"] ?? 8;
      const newK = clamp(curK * (1 + delta), 1, maxK);
      if (newK === curK) return;
      const rect = el.getBoundingClientRect();
      const w = worldRef.current;
      if (!w) return;
      const { width: vbW, height: vbH } = w.map;
      const mouseVB = screenToVB(e.clientX, e.clientY, rect, vbW, vbH);
      const ratio = newK / curK;
      const rawTx = mouseVB.x - (mouseVB.x - curTx) * ratio;
      const rawTy = mouseVB.y - (mouseVB.y - curTy) * ratio;
      const isSlice = !isFullscreen && window.innerWidth < 640;
      const { tx: cTx, ty: cTy } = clampBounds(rawTx, rawTy, newK, vbW, vbH, rect.width, rect.height, isSlice);
      kRef.current = newK;
      txRef.current = cTx;
      tyRef.current = cTy;
      schedule(cTx, cTy, newK);
      // 滚轮缩放后 debounce 滚动 (150ms 内没新滚轮才滚)
      scheduleScrollAfterWheel();
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [schedule, scheduleScrollAfterWheel]);

  /**
   * 双指缩放 (pinch-to-zoom) — 移动端
   *  - touchstart 记录两指初始距离 + 当前 k
   *  - touchmove: 当前距离 / 初始距离 = 缩放比, 应用到 initialK
   *  - 缩放中心 = 两指中点 (跟 wheel 用鼠标位置同款公式)
   *  - touchend/touchcancel 重置初始距离 (单指回到平移)
   *  - 配合容器 touchAction: "none" 阻止浏览器默认缩放/滚动
   */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let pinchInitialDistance = 0;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      if (!t1 || !t2) return;
      pinchInitialDistance = Math.hypot(
        t2.clientX - t1.clientX,
        t2.clientY - t1.clientY,
      );
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      if (pinchInitialDistance === 0) return;
      e.preventDefault();
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      if (!t1 || !t2) return;

      const currentDistance = Math.hypot(
        t2.clientX - t1.clientX,
        t2.clientY - t1.clientY,
      );
      const ratio = currentDistance / pinchInitialDistance;

      const maxK = MAX_ZOOM[worldRef.current?.id ?? "overworld"] ?? 8;
      const newK = clamp(kRef.current * ratio, 1, maxK);
      if (newK === kRef.current) return;

      const rect = el.getBoundingClientRect();
      const w = worldRef.current;
      if (!w) return;
      const { width: vbW, height: vbH } = w.map;

      // 缩放中心 = 两指中点 (跟 wheel 用鼠标位置同款)
      const centerX = (t1.clientX + t2.clientX) / 2;
      const centerY = (t1.clientY + t2.clientY) / 2;
      const centerVB = screenToVB(centerX, centerY, rect, vbW, vbH);

      const kRatio = newK / kRef.current;
      const rawTx = centerVB.x - (centerVB.x - txRef.current) * kRatio;
      const rawTy = centerVB.y - (centerVB.y - tyRef.current) * kRatio;
      const isSlice = !isFullscreen && window.innerWidth < 640;
      const { tx: cTx, ty: cTy } = clampBounds(rawTx, rawTy, newK, vbW, vbH, rect.width, rect.height, isSlice);

      kRef.current = newK;
      txRef.current = cTx;
      tyRef.current = cTy;
      schedule(cTx, cTy, newK);
    };

    const onTouchEnd = (e: TouchEvent) => {
      // 少于 2 指时重置初始距离 (避免下次第 2 指时用旧距离)
      if (e.touches.length < 2) {
        pinchInitialDistance = 0;
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [schedule]);

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      tx: txRef.current,
      ty: tyRef.current,
    };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const el = containerRef.current;
    if (!el) return;
    if (!dragRef.current) return;
    const rect = el.getBoundingClientRect();
    const w = worldRef.current;
    if (!w) return;
    const { width: vbW, height: vbH } = w.map;
    const PAN_SPEED = 2;
    const dx = (e.clientX - dragRef.current.x) * (vbW / rect.width) * PAN_SPEED;
    const dy = (e.clientY - dragRef.current.y) * (vbH / rect.height) * PAN_SPEED;
    const curK = kRef.current;
    const isSlice = !isFullscreen && window.innerWidth < 640;
    const { tx: cTx, ty: cTy } = clampBounds(
      dragRef.current.tx + dx,
      dragRef.current.ty + dy,
      curK,
      vbW,
      vbH,
      rect.width,
      rect.height,
      isSlice,
    );
    txRef.current = cTx;
    tyRef.current = cTy;
    schedule(cTx, cTy, curK);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    dragRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  };
  const onPointerLeave = (e: React.PointerEvent) => {
    onPointerUp(e);
  };

  const zoom = (factor: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const curK = kRef.current;
    const curTx = txRef.current;
    const curTy = tyRef.current;
    const w = worldRef.current;
    if (!w) return;
    const { width: vbW, height: vbH } = w.map;
    const cxVB = vbW / 2;
    const cyVB = vbH / 2;
    // max zoom 按当前维度取 (主世界 10x, 下界 8x, 末地 6x)
    const maxK = MAX_ZOOM[w.id] ?? 8;
    const newK = clamp(curK * factor, 1, maxK);
    if (newK === curK) return;
    const ratio = newK / curK;
    const rawTx = cxVB - (cxVB - curTx) * ratio;
    const rawTy = cyVB - (cyVB - curTy) * ratio;
    const isSlice = !isFullscreen && window.innerWidth < 640;
    const cW = containerRef.current?.getBoundingClientRect().width ?? vbW;
    const cH = containerRef.current?.getBoundingClientRect().height ?? vbH;
    const { tx: cTx, ty: cTy } = clampBounds(rawTx, rawTy, newK, vbW, vbH, cW, cH, isSlice);
    commitImmediate(cTx, cTy, newK);
    // 按钮缩放后滚到中央 (避开 header)
    scrollMapIntoView();
  };

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!document.fullscreenElement) {
      const tryFullscreen = (target: Element) => {
        const req = target.requestFullscreen?.();
        if (req && typeof req.then === "function") {
          return req.catch((err: unknown) => {
            logger.warn("[fullscreen] failed", err);
            return null;
          });
        }
        return Promise.resolve(null);
      };
      if (el) {
        tryFullscreen(el).then((err) => {
          if (err !== null) tryFullscreen(document.documentElement);
        });
      } else {
        tryFullscreen(document.documentElement);
      }
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  /**
   * 预加载整个维度的瓦片 (跟 guide-map 思路一致: 切维度时已经 cache 好, 0 滞留)
   * - 这里不只预加载"主图", 整个维度的所有瓦片都拉 (反正切过去就要全部显示)
   * - 78 张主世界瓦片 ~62MB, 但浏览器并行解码比单张 17MB WebP 快 (浏览器有上限但能 6 并发)
   */
  const preloadWorld = useCallback((id: NewWorldId) => {
    const w = worlds.find((x) => x.id === id);
    if (!w) return;
    for (const t of w.map.tiles) preloadImage(t.src);
  }, [worlds]);

  // 空数据兜底
  if (worlds.length === 0 || !world) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-500">
        没有可显示的地图
      </div>
    );
  }

  // 容器 aspect ratio 固定为主世界的比例 — 切维度时容器大小不变, 避免布局抖动
  // 下界 (5:2) 和末地 (3:2) 比例跟主世界 (13:6 ≈ 2.17) 不一致, SVG meet 模式会在
  // 较"瘦"或较"宽"的方向留 tone 色背景, 不裁切瓦片
  // 从 worlds 里取主世界, 避免硬编码 (主世界改尺寸时这里自动跟)
  const overworld = worlds.find((w) => w.id === "overworld");
  const aspectRatio = overworld
    ? `${overworld.map.width} / ${overworld.map.height}`
    : `${world.map.width} / ${world.map.height}`; // fallback (没传 overworld 数据时)

  return (
    <div ref={rootRef} className="flex flex-col min-w-0">
      {/* WorldTabs 行 — 跟地图同宽, 暗色系 (slate-800 配地图 slate-900)
          实时坐标浮在右上, 不占布局空间 (移动端不显示) */}
      <div className="relative">
        <WorldTabs
          worlds={worlds}
          value={worldId}
          onChange={setWorldId}
          preloadWorld={preloadWorld}
        />
        {!isMobile && hoverCoord && (
          <div
            className="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 items-center gap-1.5 text-[11px] font-mono text-slate-700 whitespace-nowrap tabular-nums select-none pointer-events-none"
            aria-live="polite"
          >
            <span className="text-slate-500">col</span>
            <span className="text-slate-900">{hoverCoord.col}</span>
            <span className="text-slate-400">·</span>
            <span className="text-slate-500">row</span>
            <span className="text-slate-900">{hoverCoord.row}</span>
            <span className="text-slate-400">·</span>
            <span className="text-slate-500">x</span>
            <span className="text-slate-900">{hoverCoord.x}</span>
            <span className="text-slate-400">·</span>
            <span className="text-slate-500">z</span>
            <span className="text-slate-900">{hoverCoord.z}</span>
          </div>
        )}
      </div>

      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onMouseMove={onContainerMouseMove}
        onMouseLeave={onContainerMouseLeave}
        className={cn(
          "relative overflow-hidden select-none",
          isFullscreen
            ? "bg-slate-900"
            : "rounded-b-xl bg-slate-900 shadow-lg shadow-slate-900/5",
        )}
        style={{
          // 背景统一 slate-900
          background: "#0f172a",
          // 全屏 / 退出全屏 缩放过渡
          transition: "transform 150ms cubic-bezier(0.4, 0, 0.2, 1) ease-in-out",
          transformOrigin: "center center",
          aspectRatio: isFullscreen ? "auto" : aspectRatio,
          maxHeight: isFullscreen ? "none" : "min(85vh, 90vw)",
          // 移动端最小高度 — 防止窄屏 (e.g. 375px 宽) 算出来的高度 (~173px) 太小
          // 配合移动端 preserveAspectRatio="xMidYMid slice", 瓦片填满容器不留背景
          // 桌面端: aspectRatio 2.17 + min(85vh, 90vw) 已经够大, minHeight 不生效
          minHeight: isFullscreen ? undefined : 420,
          // 桌面端最大宽度 1374px (居中), 移动端/全屏不限
          maxWidth: isFullscreen ? "none" : 1374,
          marginInline: isFullscreen ? undefined : "auto",
          width: isFullscreen ? "100%" : "100%",
          height: isFullscreen ? "100%" : undefined,
          touchAction: "none",
        }}
      >
        <MapCanvas
          layer={world.map}
          tx={tx}
          ty={ty}
          k={k}
          isFullscreen={isFullscreen}
          isMobile={isMobile}
        />

        {/* 缩放百分比 — 右上角 */}
        <div className="absolute top-3 right-3 z-10 pointer-events-none">
          <div className="px-2 py-1 rounded-lg bg-white/80 border border-slate-200/80 text-[11px] sm:text-[14px] font-mono text-slate-600 shadow-sm tabular-nums">
            {Math.round(k * 100)}%
          </div>
        </div>

        {/* 右下: 放大 / 缩小 / 全屏 */}
        <div className="absolute bottom-3 right-3 z-10 flex flex-col gap-1.5">
          <ZoomBtn onClick={() => zoom(1.3)} ariaLabel="放大">
            <IconPlus className="w-4 h-4" />
          </ZoomBtn>
          <ZoomBtn onClick={() => zoom(1 / 1.3)} ariaLabel="缩小">
            <IconMinus className="w-4 h-4" />
          </ZoomBtn>
          <ZoomBtn
            onClick={toggleFullscreen}
            ariaLabel={isFullscreen ? "退出全屏" : "进入全屏"}
          >
            {isFullscreen ? (
              <IconArrowsMinimize className="w-4 h-4" />
            ) : (
              <IconArrowsMaximize className="w-4 h-4" />
            )}
          </ZoomBtn>
        </div>

        {/* 竖屏提示 */}
        {showRotateHint && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-slate-100 shadow-lg pointer-events-none">
            <div className="relative w-5 h-5 flex items-center justify-center">
              <IconDeviceMobile className="w-4 h-4" />
              <IconRotate
                className="w-3 h-3 absolute -top-0.5 -right-1 text-emerald-400"
                stroke={2.5}
              />
            </div>
            <span>建议横屏查看以获得最佳体验</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default NewGuideMap;
