"use client";

/**
 * 导览地图 (v3) — 纯背景图 + 拖动/缩放工具
 *
 * 2026-07-29 v3: 删所有聚落/建筑节点 + 下钻层级
 *   - 之前 v2 在主图上画 6 个聚落圆点, 但用户更想"看图本身", 节点分散注意力
 *   - 现在 InteractiveMap 只剩: 维度 tabs + 主图(可拖动/缩放) + 右栏(维度描述 + 缩放提示)
 *   - 节点相关 state (selectedSettlement/selectedBuilding/level) 全删
 *
 * 2026-07-30: 4 文件 (types/data/InteractiveMap/index) 合成 1 个文件
 *   - 之前目录式拆分 (.ts 文件) 切来切去麻烦, 合成单 .tsx 一次看完
 *   - 删除 components/map/tour-map/ 整个目录
 *
 * 拖动/缩放:
 *   - 滚轮: 以鼠标位置为锚点缩放
 *   - 拖拽: 鼠标按下拖动, 释放
 *   - 右下角 +/- / 复位按钮
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconPlus,
  IconMinus,
  IconPointer,
  IconDeviceMobile,
  IconRotate,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";

/* ============================== Types ============================== */

export type WorldId = "overworld" | "nether" | "end";
export type MapTone = "plains" | "nether" | "end";

/**
 * 地图背景图（多张可拼接成完整 viewBox）
 *  - x/y/w/h 用 viewBox 坐标系
 *  - 主视图放 0,0，补充图按需要摆位
 *  - whiteBg 字段: 设了就在 image 后面画一个白色 rect 当"画框"
 */
export interface MapImage {
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
  whiteBg?: {
    w: number;
    h: number;
    /** 水平偏移, 默认让画框居中 image 周围 (正数向右) */
    dx?: number;
    /** 垂直偏移, 默认让画框居中 image 周围 (正数向下) */
    dy?: number;
  };
}

export interface MapLayer {
  width: number;
  height: number;
  tone: MapTone;
  images?: MapImage[];
  /**
   * SVG preserveAspectRatio (默认 "xMidYMid slice")
   * - 主世界/下界 默认 YMid 居中
   * - 末地 用 "xMidYMax slice" 让 image 底对齐, 中心往上抬 27px (image 比例 1.71 < 容器 1.89, slice 模式下 YMax 底对齐裁顶)
   */
  preserveAspectRatio?: string;
}

export interface World {
  id: WorldId;
  name: string;
  /** 维度标识色 (主世界绿/下界红/末地紫) */
  accent: string;
  version: string;
  description: string;
  banner: string;
  map: MapLayer;
}

/* ============================== Data ============================== */

/* -------------------- 主世界 · 绿色 -------------------- */

const OVERWORLD: World = {
  id: "overworld",
  name: "主世界",
  accent: "#22c55e",
  version: "Overworld",
  description:
    "原版 Minecraft 主世界。森林、雪山、沙漠、海洋、山地应有尽有, 玩家聚落密集。",
  banner: "/icons/global/邮箱图标.svg",
  map: {
    width: 9799,
    height: 5180,
    tone: "plains",
    images: [
      { src: "/images/maps/overworld/主世界-主视图.webp", x: 0, y: 0, w: 9799, h: 5180 },
      { src: "/images/maps/overworld/主世界-翁法罗斯英雄纪.webp", x: 8811, y: 3185, w: 888, h: 1895, whiteBg: { w: 988, h: 1995 } },
      { src: "/images/maps/overworld/主世界-凋灵骷髅农场收集处.webp", x: 9179, y: 2810, w: 520, h: 325, whiteBg: { w: 620, h: 425 } },
    ],
  },
};

/* -------------------- 下界 · 红色 -------------------- */

const NETHER: World = {
  id: "nether",
  name: "下界",
  accent: "#dc2626",
  version: "The Nether",
  description:
    "地狱维度。下界堡垒、灵魂沙峡谷、玄武岩三角洲、猪灵交易所、末影人刷怪塔。",
  banner: "/icons/global/邮箱图标.svg",
  map: {
    width: 5200,
    height: 2699,
    tone: "nether",
    images: [
      { src: "/images/maps/nether/下界-主视图.webp", x: 0, y: 0, w: 5200, h: 2699 },
    ],
  },
};

/* -------------------- 末地 · 紫色 -------------------- */

const END: World = {
  id: "end",
  name: "末地",
  accent: "#7c3aed",
  version: "The End",
  description:
    "末影龙维度。外岛、紫颂果农场、末地城、鞘翅探索。",
  banner: "/icons/global/邮箱图标.svg",
  map: {
    width: 2500,
    height: 1460,
    tone: "end",
    // 末地 (1.71) 比主世界容器 (1.89) 窄, slice 模式下 YMid 会让 image 几何中心在屏幕中点
    // 改 YMax (底对齐) 裁顶部, 让中心在屏幕上往上抬约 27px, 视觉上更平衡
    preserveAspectRatio: "xMidYMax slice",
    images: [
      { src: "/images/maps/end/末地-主视图.webp", x: 0, y: 0, w: 2500, h: 1460 },
    ],
  },
};

export const WORLDS: World[] = [OVERWORLD, NETHER, END];

/** 路由友好的 world id 类型守卫 */
export function getWorld(id: string): World | undefined {
  return WORLDS.find((w) => w.id === id);
}

/* ============================== Helpers ============================== */

/** 地图底色 (兜底用, 填了 images 时基本不可见) */
const MAP_BG: Record<
  MapTone,
  { primary: string; secondary: string; accent: string }
> = {
  plains: { primary: "#a7f3d0", secondary: "#6ee7b7", accent: "#22c55e" },
  nether: { primary: "#fecaca", secondary: "#f87171", accent: "#dc2626" },
  end: { primary: "#ddd6fe", secondary: "#a78bfa", accent: "#7c3aed" },
};

const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

/**
 * Hover preload Image cache (module-level, 跨组件实例 + 跨 mount 复用)
 * - 每次 `new Image()` 拉 WebP 进浏览器 image cache, 但 Image 对象本身在函数返回后没人引用
 *   → 浏览器内部 image decode 缓存 + Image 对象本身可能都长期占用内存
 * - module-level Map 复用同一组 Image 对象, decode 后浏览器内部 image cache 仍生效,
 *   但 JS heap 不重复持有 3 张大图的 Image 包装
 * - 容量: 3 维度主图最多 3 个, 满了 clearAll 重来 (懒)
 */
const PRELOAD_CACHE = new Map<string, HTMLImageElement>();
const preloadImage = (src: string) => {
  if (PRELOAD_CACHE.has(src)) return;
  if (PRELOAD_CACHE.size >= 3) PRELOAD_CACHE.clear();
  const img = new Image();
  img.src = src;
  PRELOAD_CACHE.set(src, img);
};

/**
 * 屏幕坐标 → viewBox 坐标 单位换算
 *  - 1 屏幕像素 = vbW / rectW viewBox 像素 (主世界约 8.4)
 */
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

/* ============================== Sub-components ============================== */

/* ---- 维度切换 tabs (主世界/下界/末地) ---- */
function WorldTabs({
  value,
  onChange,
}: {
  value: WorldId;
  onChange: (id: WorldId) => void;
}) {
  /**
   * Hover 预加载: 鼠标移到 tab 上, 提前把目标世界的主图拉进浏览器 image cache
   * 点击时 SVG <image href> 切过去, 浏览器直接命中 cache, 跳过网络 + 部分解码
   * 17.66MB WebP 的解码是 500ms+ 的滞留主因, 预加载能把滞留压到 50-100ms
   */
  const preloadWorld = (id: WorldId) => {
    const world = WORLDS.find((w) => w.id === id);
    if (!world) return;
    // 只预加载主图 (最大的那张, 收益最大). inset 小图随主图一起在 SW cache 里, 不单独预加载
    const mainImage = world.map.images?.[0];
    if (!mainImage) return;
    preloadImage(mainImage.src);
  };
  return (
    <div className="bg-white/60 backdrop-blur-md border border-slate-200/70 rounded-2xl p-2 flex flex-wrap items-center gap-1 shadow-sm shadow-slate-900/5">
      {WORLDS.map((w) => {
        const active = value === w.id;
        return (
          <button
            key={w.id}
            data-worldid={w.id}
            onClick={() => onChange(w.id)}
            onMouseEnter={() => preloadWorld(w.id)}
            onFocus={() => preloadWorld(w.id)}
            // 触屏: 触摸开始就预加载 (没有 hover)
            onTouchStart={() => preloadWorld(w.id)}
            className={cn(
              "px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center gap-2",
              active
                ? "bg-white text-slate-800"
                : "text-slate-500 hover:text-slate-800 hover:bg-white/40",
            )}
          >
            <span
              className="w-2 h-2 rounded-full transition-all"
              style={{
                background: active ? w.accent : "#cbd5e1",
                boxShadow: active ? `0 0 8px ${w.accent}80` : "none",
              }}
            />
            <span>{w.name}</span>
            <span className="text-[10px] text-slate-400 font-mono hidden sm:inline">
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
      className="w-9 h-9 rounded-lg bg-white/80 backdrop-blur-sm border border-white/60 text-slate-600 hover:text-slate-800 hover:bg-white flex items-center justify-center shadow-sm transition-colors"
    >
      {children}
    </button>
  );
}

/* ---- SVG 画布 (无节点版) ---- */
function MapCanvas({
  layer,
  tx,
  ty,
  k,
  isFullscreen,
  showVignette,
}: {
  layer: MapLayer;
  tx: number;
  ty: number;
  k: number;
  isFullscreen: boolean;
  showVignette: boolean;
}) {
  const bg = MAP_BG[layer.tone];
  // 全屏时: meet (横向填满, 完整显示, 上下灰色兜底) — 让用户看清楚整张图
  // 非全屏: slice (填满容器, 切维度不抖动) — 主世界/下界/末地比例统一
  const par = isFullscreen
    ? "xMidYMid meet"
    : layer.preserveAspectRatio ?? "xMidYMid slice";
  return (
    <svg
      viewBox={`0 0 ${layer.width} ${layer.height}`}
      preserveAspectRatio={par}
      data-tour-svg
      className="absolute inset-0 w-full h-full"
    >
      {showVignette && (
        <defs>
          <radialGradient id="map-vignette" cx="50%" cy="50%" r="70%">
            <stop offset="65%" stopColor="rgba(255,255,255,0)" />
            <stop offset="100%" stopColor="rgba(15,23,42,0.12)" />
          </radialGradient>
        </defs>
      )}

      <g
        transform={`translate(${tx} ${ty}) scale(${k})`}
        style={{ pointerEvents: "none" }}
      >
        {layer.images && layer.images.length > 0 ? (
          <>
            <image
              key="main-map"
              href={layer.images[0].src}
              x={layer.images[0].x}
              y={layer.images[0].y}
              width={layer.images[0].w}
              height={layer.images[0].h}
              preserveAspectRatio="xMidYMid meet"
            />
            {layer.images.slice(1).map((img, i) => (
              <g key={`inset-${i}`}>
                {img.whiteBg && (
                  <rect
                    x={
                      img.x -
                      (img.whiteBg.w - img.w) / 2 +
                      (img.whiteBg.dx ?? 0)
                    }
                    y={
                      img.y -
                      (img.whiteBg.h - img.h) / 2 +
                      (img.whiteBg.dy ?? 0)
                    }
                    width={img.whiteBg.w}
                    height={img.whiteBg.h}
                    fill="white"
                  />
                )}
                <image
                  href={img.src}
                  x={img.x}
                  y={img.y}
                  width={img.w}
                  height={img.h}
                  preserveAspectRatio="xMidYMid meet"
                />
              </g>
            ))}
          </>
        ) : (
          <>
            <rect width={layer.width} height={layer.height} fill={bg.primary} />
            <rect
              width={layer.width}
              height={layer.height}
              fill={bg.secondary}
              opacity="0.4"
            />
          </>
        )}
        <rect
          width={layer.width}
          height={layer.height}
          fill="transparent"
        />
      </g>

      {showVignette && (
        <rect
          width={layer.width}
          height={layer.height}
          fill="url(#map-vignette)"
          pointerEvents="none"
        />
      )}
    </svg>
  );
}

/* ============================== Main Component ============================== */

export function GuideMap() {
  // ---- 1. 路由/视图 (驱动 render) ----
  const [worldId, setWorldId] = useState<WorldId>("overworld");

  // ---- 2. 视图变换 (state 触发 render, ref 镜像给高频 wheel/pointer 读) ----
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [k, setK] = useState(1);
  const kRef = useRef(1);
  const txRef = useRef(0);
  const tyRef = useRef(0);
  // 镜像当前 world — 解决 useEffect [] 依赖 + useCallback 的 stale closure
  const worldRef = useRef<World>(WORLDS[0]);

  // ---- 3. 全屏 + 方向 + 提示 ----
  // 全屏状态 — 监听 fullscreenchange 同步 (用户按 ESC 退出也能跟)
  const [isFullscreen, setIsFullscreen] = useState(false);
  // 竖屏检测 — 全屏 + 竖屏时显示 "建议横屏" 提示
  const [isPortrait, setIsPortrait] = useState(false);
  // 横屏提示显示控制 — 显示 3 秒后自动关闭 (避免持续挡视野)
  const [showRotateHint, setShowRotateHint] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait)");
    const update = () => setIsPortrait(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  // 全屏 + 竖屏时: 显示横屏提示 3 秒后自动关闭
  //  - 横屏时立即清空 (用户已经看到, 不需要再提示)
  //  - 退出全屏时清空
  useEffect(() => {
    if (isFullscreen && isPortrait) {
      setShowRotateHint(true);
      const t = setTimeout(() => setShowRotateHint(false), 3000);
      return () => clearTimeout(t);
    } else {
      setShowRotateHint(false);
    }
  }, [isFullscreen, isPortrait]);

  // ---- 4. 拖拽/手势 (ref 镜像, 不触发 render) ----
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  // RAF 同步 — 高频事件 (wheel/move) 写 ref, requestAnimationFrame 里统一 setState
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<{ tx: number; ty: number; k: number } | null>(null);

  const world = useMemo(
    () => WORLDS.find((w) => w.id === worldId)!,
    [worldId],
  );
  useEffect(() => {
    worldRef.current = world;
  }, [world]);

  const commit = () => {
    rafRef.current = null;
    const p = pendingRef.current;
    if (!p) return;
    pendingRef.current = null;
    setTx(p.tx);
    setTy(p.ty);
    setK(p.k);
  };
  const schedule = (tx: number, ty: number, k: number) => {
    pendingRef.current = { tx, ty, k };
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(commit);
    }
  };

  const clampBounds = (tx: number, ty: number, k: number, vbW: number, vbH: number) => {
    const overflowX = Math.max(0, vbW * (k - 1));
    const overflowY = Math.max(0, vbH * (k - 1));
    return {
      tx: clamp(tx, -overflowX, 0),
      ty: clamp(ty, -overflowY, 0),
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

  // 切维度时重置视图
  useEffect(() => {
    queueMicrotask(() => commitImmediate(0, 0, 1));
  }, [worldId]);

  // 滚轮缩放 — 原生 addEventListener 才能 preventDefault
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const curK = kRef.current;
      const curTx = txRef.current;
      const curTy = tyRef.current;
      const delta = -e.deltaY * 0.0025;
      const newK = clamp(curK * (1 + delta), 1, 8);
      if (newK === curK) return;
      const rect = el.getBoundingClientRect();
      const { width: vbW, height: vbH } = worldRef.current.map;
      const mouseVB = screenToVB(e.clientX, e.clientY, rect, vbW, vbH);
      const ratio = newK / curK;
      const rawTx = mouseVB.x - (mouseVB.x - curTx) * ratio;
      const rawTy = mouseVB.y - (mouseVB.y - curTy) * ratio;
      const { tx: cTx, ty: cTy } = clampBounds(rawTx, rawTy, newK, vbW, vbH);
      kRef.current = newK;
      txRef.current = cTx;
      tyRef.current = cTy;
      schedule(cTx, cTy, newK);
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    // 按钮点击不要抢 pointer capture — 否则 click 事件被重定向到容器,
    // 按钮的 onClick (放大/缩小/全屏) 不触发, 桌面 Chrome/Edge 严, 触屏宽
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
    const { width: vbW, height: vbH } = worldRef.current.map;
    const PAN_SPEED = 2;
    const dx = (e.clientX - dragRef.current.x) * (vbW / rect.width) * PAN_SPEED;
    const dy = (e.clientY - dragRef.current.y) * (vbH / rect.height) * PAN_SPEED;
    const curK = kRef.current;
    const { tx: cTx, ty: cTy } = clampBounds(
      dragRef.current.tx + dx,
      dragRef.current.ty + dy,
      curK,
      vbW,
      vbH,
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
    const { width: vbW, height: vbH } = worldRef.current.map;
    const cxVB = vbW / 2;
    const cyVB = vbH / 2;
    const newK = clamp(curK * factor, 1, 8);
    if (newK === curK) return;
    const ratio = newK / curK;
    const rawTx = cxVB - (cxVB - curTx) * ratio;
    const rawTy = cyVB - (cyVB - curTy) * ratio;
    const { tx: cTx, ty: cTy } = clampBounds(rawTx, rawTy, newK, vbW, vbH);
    commitImmediate(cTx, cTy, newK);
  };

  // 全屏切换 — 优先 map 容器, 失败兜底到整个页面
  // (某些环境里 container 进全屏会被拒, 比如嵌套 iframe / 父级 transform / 跨域)
  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!document.fullscreenElement) {
      const tryFullscreen = (target: Element) => {
        const req = target.requestFullscreen?.();
        if (req && typeof req.then === "function") {
          return req.catch((err: unknown) => {
            console.warn("[fullscreen] failed:", err);
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

  return (
    <div className="flex flex-col gap-3 min-w-0">
      <WorldTabs value={worldId} onChange={setWorldId} />

      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        className={cn(
          "relative overflow-hidden border select-none transition-colors",
          // 全屏时: 深灰兜底, 取消圆角/边框/shadow, 让图占满整个屏幕
          isFullscreen
            ? "bg-slate-900 border-slate-800"
            : "rounded-2xl bg-gradient-to-br from-sky-50 via-white to-emerald-50/60 border-slate-200/60 shadow-lg shadow-slate-900/5",
        )}
        style={{
          // 非全屏: 容器宽高比 9799/5180 (≈1.89), 切维度时容器大小不变
          //   - 下界 (1.93)/末地 (1.71) 用 SVG slice 模式填满, 左右各裁一点
          // 全屏: 取消宽高比限制, 让 SVG meet 模式横向填满, 纵向多出的用灰色兜底
          //   - 移动端竖屏 (9:16) 时 image 高度只有屏幕一半, 上下大量灰
          //   - 横屏 (16:9) 时 image 高度接近屏幕高度, 几乎无灰
          aspectRatio: isFullscreen ? "auto" : "9799 / 5180",
          maxHeight: isFullscreen ? "none" : "min(85vh, 88vw)",
          width: isFullscreen ? "100%" : undefined,
          height: isFullscreen ? "100%" : undefined,
          touchAction: "none",
        }}
      >
        {/* 主图直接渲染, 不加淡入/spinner:
            - 切维度瞬切 (用户明确要求)
            - 首次加载: 17MB WebP 浏览器渐进式解码, 一边下一边显示, 不挡
            - hover preload 已经把目标图提前拉进 image cache, 切维度基本 0 滞留 */}
        <MapCanvas
          layer={world.map}
          tx={tx}
          ty={ty}
          k={k}
          isFullscreen={isFullscreen}
          // 全屏时一律不要 vignette: 沉浸观看, 暗角干扰
          // 非全屏: 正常显示 vignette (主世界 1.89 容器, 暗角有助聚焦中心)
          showVignette={!isFullscreen}
        />

        {/* 缩放百分比 — 右上角, 唯一保留的 HUD */}
        <div className="absolute top-3 right-3 z-10 pointer-events-none">
          <div className="px-2 py-1 rounded-lg bg-white/80 backdrop-blur-sm border border-white/60 text-[10px] font-mono text-slate-600 shadow-sm tabular-nums">
            {Math.round(k * 100)}%
          </div>
        </div>

        {/* 左下: 移动端隐藏, 全屏时也隐藏 (沉浸观看, 不挡视野) */}
        <div
          className={cn(
            "absolute bottom-3 left-3 z-10 items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/80 backdrop-blur-sm border border-white/60 text-[10px] text-slate-500 pointer-news-none shadow-sm",
            // 全屏时整条提示隐藏, 桌面端非全屏时显示 (sm 以上 + 触屏没 hover/光标意义)
            isFullscreen ? "hidden" : "hidden sm:flex",
          )}
        >
          <IconPointer className="w-3 h-3" />
          拖拽平移 · 滚轮缩放
        </div>

        {/* 右下: 放大 / 缩小 / 全屏切换 */}
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

        {/* 全屏 + 竖屏时显示: 建议横屏查看
            - 移动端竖屏 (9:16): image 高度只有屏幕一半, 上下大量灰, 体验差
            - 旋转设备到横屏 (16:9): image 高度接近屏幕, 几乎无灰
            - 显示 3 秒后自动关闭 (showRotateHint 由 useEffect 控, 避免持续挡视野) */}
        {showRotateHint && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800/90 backdrop-blur-sm border border-slate-700/60 text-xs text-slate-100 shadow-lg pointer-events-none">
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

export default GuideMap;
