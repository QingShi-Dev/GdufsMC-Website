"use client";
/* eslint-disable @next/next/no-img-element -- 项目图标用 /public 下的 SVG 文件, next/image 只优化位图不优化 SVG, 这里 <img> 是正确的 */

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
import type { ReactNode } from "react";
import { IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import type {
  NewMapLayer,
  NewMapTile,
  NewWorldId,
  NewWorldMeta,
} from "@/lib/map/loader";
// TILE_PX 在 client 也需要, 单独从 constants 文件 import (data 文件是 server-only)
import { TILE_PX } from "@/lib/map/constants";
import type {
  NewLabel,
  NewLabelGroups,
} from "@/lib/map/labels";
import { MapLabels } from "./map-labels";
import { LabelPopup } from "./label-popup";
import type { NewTransitGroups } from "@/lib/map/transit";
import {
  TransitLines,
  TransitStations,
  PearlLines,
} from "./transit-overlay";
import { toPinyin } from "@/lib/search/pinyin";

/**
 * 搜索匹配类型 — 同一地标可能多个字段同时命中 (e.g. 既匹配 name 也匹配 output)
 * 排序时 name 优先级最高, 用户搜的如果是"产铁"应该优先显示 name 命中的
 *
 * 注意: pinyin-abbr 已在 2026-09-16 删除 — 缩写匹配用户体验差 (太多误命中),
 *   全拼 includes 已能覆盖典型拼音输入
 *
 * 输出 chip 也只显示"产出"一种 — 用户搜出来看 chip 就知道 "这里是因为我搜的产出物", 拼音/缩写 chip 信息冗余
 */
type SearchMatchKind = "name" | "pinyin" | "output";

interface SearchResult {
  label: NewLabel;
  worldId: NewWorldId;
  matched: SearchMatchKind[];
}

/* ============================== Sub-components ============================== */

/**
 * 搜索结果下拉 — 跨 3 维度展示匹配地标
 *  - 当前维度优先 (按 name 升序), 其它维度其次
 *  - 命中的字段 (name / 产出 / 投入) 用小 chip 标注, 让用户知道为啥被搜出来
 *  - 0 结果给空态
 */
function SearchResults({
  results,
  worlds,
  onSelect,
  listDraggingRef,
}: {
  results: SearchResult[];
  worlds: NewWorldMeta[];
  onSelect: (label: NewLabel, worldId: NewWorldId) => void;
  /** 当前 mousedown→mouseup 算不算拖动 (>3px=true); true 时跳过 onSelect (让纯点击 vs 拖动区分生效) */
  listDraggingRef: React.MutableRefObject<boolean>;
}) {
  const worldName = (id: NewWorldId) =>
    worlds.find((w) => w.id === id)?.name ?? id;
  const worldAccent = (id: NewWorldId) =>
    worlds.find((w) => w.id === id)?.accent ?? "#64748b";
  if (results.length === 0) {
    return (
      <div
        role="listbox"
        aria-label="搜索结果"
        className="border-t border-slate-200 px-3 py-3 text-[11px] text-slate-400"
      >
        没有匹配的地标
      </div>
    );
  }
  return (
    <div
      role="listbox"
      aria-label="搜索结果"
      className="border-t border-slate-200 max-h-[40vh] overflow-y-auto"
    >
      {results.map((r) => (
        <button
          key={`${r.worldId}:${r.label.id}`}
          type="button"
          role="option"
          aria-selected="false"
          onClick={(e) => {
            // 拖动时跳过 onSelect (用户拖动是来 scroll list, 不是选结果)
            //   - mousedown 后 mousemove 距离 > 3px → listDraggingRef=true
            //   - pure click (距离 ≤ 3px): listDraggingRef=false → 正常跳转
            //   - 之前用 preventDefault on mousedown 完全阻止 click, 但用户希望纯点击仍跳转
            //   - 注意: 取快照后立刻 reset, 否则 programmatic click (无 mousedown)
            //     会读到上次拖动遗留的 true 值, 误判 skip onSelect
            const dragged = listDraggingRef.current;
            listDraggingRef.current = false;
            if (dragged) {
              e.preventDefault();
              e.stopPropagation();
              return;
            }
            onSelect(r.label, r.worldId);
          }}
          className={cn(
            "w-full flex items-center gap-2.5 px-3 py-2.5 text-left",
            "border-b border-slate-100 last:border-b-0",
            "hover:bg-slate-50 transition-colors",
            "focus:outline-none focus:bg-slate-50",
          )}
        >
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: worldAccent(r.worldId) }}
            aria-hidden="true"
          />
          <span className="text-[14px] font-medium text-slate-800 truncate flex-1 min-w-0">
            {r.label.name}
          </span>
          <span className="text-[13px] font-mono text-slate-500 shrink-0">
            {worldName(r.worldId)}
          </span>
          {/* 命中的字段 chip — 只显示"产出"一种, 让用户知道 "这里是因为我搜的产出物命中"
              (拼音/缩写 chip 信息冗余: 搜的就是这两个, 显示出来没新增信息) */}
          {r.matched.includes("output") && (
            <span
              className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 shrink-0"
              title="该地标的产出匹配搜索词"
            >
              产出
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/* ---- 维度切换 tabs (主世界/下界/末地) ---- */
function WorldTabs({
  worlds,
  value,
  onChange,
  preloadWorld,
  labelsVisible,
  onToggleLabels,
  transitVisible,
  onToggleTransit,
  searchVisible,
  onToggleSearch,
}: {
  worlds: NewWorldMeta[];
  value: NewWorldId;
  onChange: (id: NewWorldId) => void;
  preloadWorld: (id: NewWorldId) => void;
  /** 是否显示地标 — 用来高亮 tab 栏里的地标开关 */
  labelsVisible: boolean;
  onToggleLabels: () => void;
  /** 是否显示交通 (transit 网络) — 用来高亮 tab 栏里的交通开关 */
  transitVisible: boolean;
  onToggleTransit: () => void;
  /** 是否显示搜索框 */
  searchVisible: boolean;
  onToggleSearch: () => void;
}) {
  return (
    // 还原成浅色系 (跟之前一致) — 跟深色地图形成对比
    // w-full: 跟下方地图同宽 (地图也是 100% 宽)
    <div className="w-full bg-white/60 backdrop-blur-md border border-slate-200/85 rounded-t-2xl p-1.5 pl-3 flex flex-wrap items-center gap-2.5 shadow-sm shadow-slate-900/10">
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
              "px-3 sm:px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center text-center gap-1.5",
              active
                ? "bg-white text-slate-800"
                : "text-slate-500 hover:text-slate-700 hover:bg-white/40",
            )}
          >
            <span
              className="w-2.5 h-2.5 rounded-full transition-all"
              style={{
                background: active ? w.accent : "#cbd5e1",
                boxShadow: active ? `0 0 2px ${w.accent}80` : "none",
              }}
            />
            <span className="text-[17px] ml-0.5">{w.name}</span>
            <span className="text-[15px] text-slate-500 font-mono hidden sm:inline">
              {w.version}
            </span>
          </button>
        );
      })}
      {/* 顺序: 3 1 2 — 搜索 / 标签文字 / 交通信息
            搜索排第一 (默认全开), 标签紧跟, 交通最右 (lg+ 给坐标预留空间) */}
      {/* 搜索开关 — 紧贴末地 tab 右边, ml-2 sm:ml-4 跟原"标签文字"一致, 不挤坐标
          默认全开 (searchVisible=true): 按钮显示"隐藏搜索"; 关闭后: 还原并下移 popup */}
      <button
        type="button"
        onClick={onToggleSearch}
        aria-label={searchVisible ? "隐藏搜索" : "显示搜索"}
        aria-pressed={searchVisible}
        className={cn(
          "ml-2 sm:ml-3.5",
          "px-2.5 py-2 rounded-xl text-xs sm:text-[17px] font-semibold",
          "transition-all flex items-center text-center gap-2",
          "text-slate-500 hover:text-slate-700 hover:bg-white/40",
        )}
      >
        {searchVisible ? (
          <img src="/icons/map/tabs/显示搜索图标.svg" alt="" className="w-4 h-4" />
        ) : (
          <img src="/icons/map/tabs/隐藏搜索图标.svg" alt="" className="w-4 h-4" />
        )}
        <span className="hidden sm:inline">
          搜索
        </span>
      </button>
      {/* 标签文字开关 — 紧贴搜索开关右边, 同样不挤坐标 */}
      <button
        type="button"
        onClick={onToggleLabels}
        aria-label={labelsVisible ? "隐藏地名" : "显示地名"}
        aria-pressed={labelsVisible}
        className={cn(
          "px-2.5 py-2 rounded-xl text-xs sm:text-[17px] font-semibold",
          "transition-all flex items-center gap-2",
          "text-slate-500 hover:text-slate-700 hover:bg-white/40",
        )}
      >
        {labelsVisible ? (
          <img src="/icons/map/tabs/显示地名图标.svg" alt="" className="w-4 h-4" />
        ) : (
          <img src="/icons/map/tabs/隐藏地名图标.svg" alt="" className="w-4 h-4" />
        )}
        <span className="hidden sm:inline">
          地名
        </span>
      </button>
      {/* 交通信息开关 — 现排第三 (最右), 桌面端给坐标预留 ~280px (lg+ 才显示坐标)
          移动端不预留 — 跟其他开关一致 */}
      <button
        type="button"
        onClick={onToggleTransit}
        aria-label={transitVisible ? "隐藏交通" : "显示交通"}
        aria-pressed={transitVisible}
        className={cn(
          "lg:mr-72",
          "px-2.5 py-2 rounded-xl text-xs sm:text-[17px] font-semibold",
          "transition-all flex items-center gap-2",
          "text-slate-500 hover:text-slate-700 hover:bg-white/40",
        )}
      >
        {transitVisible ? (
          <img src="/icons/map/tabs/显示交通图标.svg" alt="" className="w-4 h-4" />
        ) : (
          <img src="/icons/map/tabs/隐藏交通图标.svg" alt="" className="w-4 h-4" />
        )}
        <span className="hidden sm:inline">
          交通
        </span>
      </button>
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
  isPanning,
  transitInWorld,
}: {
  layer: NewMapLayer;
  tx: number;
  ty: number;
  k: number;
  isFullscreen: boolean;
  /** < sm (640px) 用 slice, 否则 meet. SSR 时默认 false (走 meet, 跟 server 一致) */
  isMobile: boolean;
  /** 正在做"点 region 跳视角"的过渡动画 — true 时 SVG g 挂 transition,
   *  让 transform 平滑插值; false 时 (用户拖拽/滚轮) 无 transition, 保持直接手感 */
  isPanning: boolean;
  /**
   * 地铁线 + 站点 (世界坐标 SVG) — 在 <g transform> 内部渲染, 跟着地图 transform 走
   *  - 点 region 跳视角时, 跟地图内容一起走 500ms CSS transition, 跟地标 label 同频道
   *  - 不传就不渲染 (默认空)
   */
  transitInWorld?: () => ReactNode;
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
        className={isPanning ? "transition-transform duration-500 ease-in-out" : ""}
        style={{ pointerEvents: "none" }}
      >
        {/* 瓦片 src 按 k 阈值切换:
            - k < 2.5 (默认缩略图阶段): 用 srcThumb (overworld = q=90 webp, 省流量)
            - k >= 2.5 (放大阶段): 用 src (原 PNG, 高清无压缩)
            用户实测 overworld 瓦片全用 webp 视觉损失明显 (细节密集, 压缩 artifact),
            改成两阶段加载 — 缩略图阶段 webp 够用, 放大阶段切 PNG 保留细节
            nether/end 没 srcThumb, 永远用 src */}
        {layer.tiles.map((t) => {
          const useHires = k >= 2.5 || !t.srcThumb;
          const href = useHires ? t.src : t.srcThumb!;
          return (
            <image
              key={`${t.col}-${t.row}`}
              href={href}
              // 修接缝: 每张瓦片向左上各偏 1px, 尺寸 +2 = 1026
              //   → 相邻瓦片重叠 2px, 盖住 SVG sub-pixel 渲染的 1px 白缝
              //   (原来 width=1024 没 overlap, 浮点坐标会留 1px 缝)
              x={t.vbX - 1}
              y={t.vbY - 1}
              width={1026}
              height={1026}
              preserveAspectRatio="xMidYMid meet"
            />
          );
        })}
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
        {/* 地铁线 + 站点 (世界坐标) — 跟地图内容同一个 <g transform>, 点 region 跳视角
            走 500ms CSS transition 时一起平滑移动, 跟地标 label 同频道 */}
        {transitInWorld && transitInWorld()}
      </g>
    </svg>
  );
}

/* ============================== Helpers ============================== */

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
const screenToVB = (
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
 * MC 世界坐标 (x, z) → viewBox 空间 (vbX, vbY)
 * 纯几何转换, 不依赖 viewBox 尺寸或屏幕尺寸 — 给 panTo / worldToScreenFactory 共用
 *
 * 跟 MapCanvas 里 SVG <g> 的 transform 前一步对齐: viewBox 空间里的点 (vbX, vbY)
 * 才是后续能直接用 tx/ty/k 变换的输入。
 */
function worldToVB(
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
function worldToScreenFactory(args: {
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
function computePanTransform(
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

/* ============================== Main Component ============================== */

export interface GuideMapProps {
  worlds: NewWorldMeta[];
  /**
   * 标签数据 (按维度分组) — 父组件从数据层传进来
   * 不传就不渲染标签 (老用法 / 教程里用)
   */
  labels?: NewLabelGroups;
  /**
   * 地铁 / 交通网络数据 (按维度分组, lines + stations)
   * 不传就不渲染交通层 (老用法 / 教程里用)
   */
  transit?: NewTransitGroups;
}

export function GuideMap({ worlds, labels, transit }: GuideMapProps) {
  // 缺省 fallback 用 useMemo 包装 — 让引用稳定, 不然放进 deps 会让 useMemo/useCallback 每次重 render
  //   (空对象每次新建, 引用变化, deps 看着像变了)
  const lb: NewLabelGroups = useMemo(
    () =>
      labels ?? {
        overworld: [],
        nether: [],
        end: [],
      },
    [labels],
  );
  const mt: NewTransitGroups = useMemo(
    () =>
      transit ?? {
        overworld: { lines: [], stations: [] },
        nether: { lines: [], stations: [] },
        end: { lines: [], stations: [] },
      },
    [transit],
  );
  // ---- 1. 路由/视图 ----
  // 列表为空时 fallback 到 overworld 防止 .find 出 undefined
  const initialId: NewWorldId = worlds[0]?.id ?? "overworld";
  const [worldId, setWorldId] = useState<NewWorldId>(initialId);

  // ---- 2. 视图变换 ----
  // tx/ty/k 是 SVG g 的 transform, 也是地标 HTML 标签 left/top 的依据
  // 过渡时 (isPanning=true) SVG g 走 CSS transition, 标签也走 (left/top 500ms ease-in-out)
  // 两个动画同步开始/结束, 视觉上标签"绑"在地图上, 没有 drift, 没有 snap
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [k, setK] = useState(1);
  const kRef = useRef(1);
  const txRef = useRef(0);
  const tyRef = useRef(0);
  const worldRef = useRef<NewWorldMeta | null>(null);

  // ---- 3. 全屏 + 竖屏提示 + 视口宽度 (是否移动端) ----
  const [isFullscreen, setIsFullscreen] = useState(false);
  // 是否 < sm (640px): SSR 默认 false, 客户端 mount 后再读 window.innerWidth
  //  - 初始 false 保证 server render 跟 client 第一次 render 结果一致 (hydration 匹配)
  //  - mount 后 setIsMobile(true) 会触发 re-render, MapCanvas 切到 slice
  const [isMobile, setIsMobile] = useState(false);

  // ---- 4. 地标: toggle / 选中 ----
  // 默认全开 — 进入页面就看到地标 + 交通, 跟搜索一致 (commit 0b9fbd1 之后三者顺序 3 1 2)
  // 跟之前 off 不同: 之前第一次打开不想被地标盖住, 现在默认开更"开箱即用"
  const [labelsVisible, setLabelsVisible] = useState(true);
  // 交通 (transit 网络) 同样默认 on, 跟地标独立
  const [transitVisible, setTransitVisible] = useState(true);
  // 搜索: 开关 + 当前关键词 + 列表显隐
  //   - searchVisible: 整个搜索 wrapper 显隐 (input 一直在)
  //   - searchQuery: 用户输入的文字 (不清零, 让 X 按钮可恢复显示)
  //   - searchListOpen: list 是否展开 — 跟 query 解耦
  //       默认收起, 输入文字 / 点 input 展开, 点地图收起, X 按钮清空时也收起
  // 关系: list 渲染 = searchVisible && searchListOpen && searchQuery.trim() !== ""
  // 默认全开: 进入页面就看到搜索框, 用户可主动关 (按钮顺序排第一)
  const [searchVisible, setSearchVisible] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchListOpen, setSearchListOpen] = useState(false);
  // 让 wheel / pointerdown handler 在不重新挂载的情况下读到最新的 query/listOpen
  // (closure 捕获, 但 wheel handler 在 useEffect [deps] 内, deps 不变就不重跑)
  const searchQueryRef = useRef(searchQuery);
  useEffect(() => { searchQueryRef.current = searchQuery; }, [searchQuery]);
  const searchListOpenRef = useRef(searchListOpen);
  useEffect(() => { searchListOpenRef.current = searchListOpen; }, [searchListOpen]);
  // 当前打开 popup 的标签 — null = 没开
  // 装可弹窗的标签 — 激进改动后所有 NewLabel 都可能弹窗
  // (是否弹由 shouldShowPopup 决定: popup=true 或 有 images/description/inputs/outputs)
  // popup 位置固定在地图左上角, 不需要 anchor
  const [selectedLabel, setSelectedLabel] = useState<NewLabel | null>(null);
  // 搜索 input ref — 开启时自动 focus
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  // 搜索 wrapper ref — 用于挂 native event listener 阻止事件冒泡到地图
  // (React 合成事件的 stopPropagation 在某些 path 下没真阻止 native 冒泡,
  //  导致 list 内的 wheel 触发地图缩放, list 内的 click 触发地图 onClick 收起)
  const searchWrapperRef = useRef<HTMLDivElement | null>(null);
  // 搜索结果 option 是否正在被"拖动" (mousedown 后 mousemove 距离 > 3px)
  //   - 区分"纯点击"(跳转) vs "拖动"(不跳转, 触发 list scroll)
  //   - 共享给 SearchResults 的 onClick — 拖动时不调 onSelect
  //   - 只在 mousedown 时 reset 到 false (mouseup 后 click 仍能看到 flag)
  const listDraggingRef = useRef(false);

  // 正在过渡动画中 (click region 跳视角) — 用这个 flag 控制 SVG g 的 transition class
  // 用户拖拽 / 滚轮缩放时不挂 transition, 保持直接手感
  const [isPanning, setIsPanning] = useState(false);
  const panTimeoutRef = useRef<number | null>(null);
  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 640);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  // (showRotateHint + isPortrait 已删除 — 之前想加"全屏时竖屏提示旋转"但没实际渲染, 死代码)

  // 搜索开关切换:
  //  - 开启 → input 自动 focus (focus 顺带触发 onFocus → list 展开)
  //  - 关闭 → 清空 query + 收起 list (避免下次开启时残留旧关键词/旧展开态)
  //  - 首次挂载 (searchVisible=true 默认全开): 不抢焦点, 让用户自己点 input
  //    (避免页面加载时移动端自动弹键盘, 也避免与 dim tab / 视觉重心抢焦点)
  const prevSearchVisibleRef = useRef(searchVisible);
  useEffect(() => {
    // 首次挂载: searchVisible 跟初始值相同, 跳过副作用 (StrictMode 双挂载也安全)
    if (searchVisible === prevSearchVisibleRef.current) {
      prevSearchVisibleRef.current = searchVisible;
      return;
    }
    prevSearchVisibleRef.current = searchVisible;

    if (searchVisible) {
      // requestAnimationFrame 等 DOM commit 后再 focus (避免 React 18 自动批处理导致 ref 未挂载)
      const id = requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
      return () => cancelAnimationFrame(id);
    } else {
      // 关闭搜索时清空 query + 收起 list — 避免下次开启时残留旧关键词/旧展开态
      //   - 这是 toggle 边界用例 (searchVisible → false), 不是普通 setState 同步重 render
      //   - 触发频率低 (用户主动关闭搜索), 不存在 cascade render 性能问题
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSearchQuery("");
      setSearchListOpen(false);
    }
  }, [searchVisible]);

  // 关键修复: 搜索 wrapper 内的事件需要差异化处理
  // 用 window 上挂 listener + 检查 target 在 wrapper 内 (event delegation),
  // 这样 HMR 替换 wrapper DOM 后 listener 不会失效 (因为 listener 在 window 上)
  //   - wheel:
  //       list 显示 → stopPropagation 阻止地图缩放, 但**不** preventDefault 让 list 自己滚
  //         (滚到边界时浏览器默认 page scroll, list 自己处理滚到底/顶)
  //       list 收起 → 不 stopPropagation, wheel bubble 到 containerRef 缩地图
  //         但 preventDefault 阻止 page scroll (避免页面滚走 wrapper)
  //   - mousedown/move/up: 按 hit-test 分模式
  //       input 内: 让用户选文字, 不干预 (不 preventDefault, 让浏览器默认 selection 行为)
  //       list 内: drag 转 wheel 翻页 — pointermove 累加 deltaY 直接写 scrollTop
  //         跟 wheel 一样翻页 (滚到底/顶 preventDefault page scroll)
  //       其他 (wrapper padding / icon / 列表外的 wrapper 部分): drag 收起 list
  //   - click 在 wrapper 内: 兜底 setSearchListOpen(true) (任何位置 click 都展开列表)
  //     让搜索栏可点击区域更大 — 不只 input 本身
  useEffect(() => {
    if (!searchVisible) return;
    const stopWheel = (e: Event) => {
      const wrapper = document.querySelector('[role="search"]');
      if (!wrapper || !wrapper.contains(e.target as Node)) return;
      const list = wrapper.querySelector('[role="listbox"][aria-label="搜索结果"]');
      if (list) {
        // list 显示: 阻止地图缩放
        e.stopPropagation();
        // 滚到边界时阻止 page scroll — 浏览器默认会让 wheel event 触发 page scroll,
        // 这里 preventDefault 才能拦 (stopPropagation 只阻止 bubble, 不阻止默认)
        const el = list as HTMLElement;
        const atTop = el.scrollTop <= 0;
        const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
        const scrollingDown = (e as WheelEvent).deltaY > 0;
        if ((scrollingDown && atBottom) || (!scrollingDown && atTop)) {
          e.preventDefault();
        }
      } else {
        // list 收起: 不阻止地图缩放, 但阻止 page scroll (wrapper 跟 page 一起滚会很难看)
        e.preventDefault();
      }
    };
    window.addEventListener("wheel", stopWheel, { passive: false, capture: true });
    // mousedown 按 hit-test 分模式:
    //   "input":   mousedown 在 input 内 — 让用户选文字, 不阻止默认
    //   "list-drag": mousedown 在 list (option button / padding) 内 — drag 转 wheel 翻页 + 阻止 option click 误触发
    //   "drag":    mousedown 在 wrapper 其他位置 — 原"drag 收起 list"模式
    let mode: "input" | "list-drag" | "drag" | null = null;
    let dragOrigin: { x: number; y: number } | null = null;
    let dragActive = false;
    // list drag-scroll 状态: 上次 pointer Y + 上次 scrollTop, 累加避免大延迟
    let listDragLastY = 0;
    let listDragLastScrollTop = 0;
    // list-drag 模式 mousedown 起点 — 用来在 mousemove 时算拖动距离,
    //   距离 > 3px 时设 listDraggingRef=true, 后续 option onClick 跳过 onSelect
    //   (区分"纯点击"vs"拖动", 纯点击仍触发跳转)
    let listDragOriginX = 0;
    let listDragOriginY = 0;
    const onMouseDown = (e: MouseEvent) => {
      const wrapper = document.querySelector('[role="search"]');
      if (!wrapper || !wrapper.contains(e.target as Node)) return;
      // 优先用 e.target (真实派发事件的元素), 兜底用 elementFromPoint
      //   - 真鼠标点击 e.target 可靠 (浏览器派发)
      //   - dispatchEvent 模拟 mousedown 时 e.target 也是 dispatch 的元素, 同样可靠
      //   - elementFromPoint 偶尔拿到遮挡元素 (e.g. 上层 z-index 高的 WorldTabs dim 按钮),
      //     list 滚后 option 视口位置变化, (rect.x+10, rect.y+10) 命中错位元素
      //   - 修法: e.target 是权威源, elementFromPoint 仅在 e.target 不在 wrapper 时兜底
      let hit: HTMLElement | null = e.target as HTMLElement;
      if (!hit || !wrapper.contains(hit)) {
        hit = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      }
      if (!hit) return;
      // input 内 — 让用户选文字 + 不触发地图拖动, 不启动自定义 drag
      //   - 不 preventDefault: 浏览器默认 selection 行为 (允许拖动选文字)
      //   - 不 setPointerCapture: 让 wheel 还能滚到地图 (input focus 状态下 wheel 会缩地图)
      if (hit.tagName === "INPUT") {
        mode = "input";
        // bug 2 修: mousedown 在 input 立即展开 list (不依赖 click event)
        //   - user 滚轮缩放后 input 仍 focus, 再次点击 input 没用 click event (focus 已在了)
        //   - 直接在 mousedown 时展开, 保证 user 体验
        setSearchListOpen(true);
        return;
      }
      // option button (搜索结果) 内 — 区分"纯点击" vs "拖动":
      //   - 纯点击 (mousedown → mouseup 距离 ≤ 3px): 走默认 click 序列, onSelect 触发跳转 ✓
      //   - 拖动 (mousemove 距离 > 3px): 设 listDraggingRef=true, 后续 onClick 检查到就跳过 onSelect
      //   - 之前用 preventDefault on mousedown 阻止所有 click, 但用户希望纯点击仍跳转
      //   - 现在改用 drag 检测: 不 preventDefault, 让默认 click 通过; 由 onClick 决定是否响应
      //   - 副作用: button 在 mousedown 时会被 focus (默认行为, 之前 preventDefault 已阻止)
      const option = hit.closest('[role="option"]');
      if (option) {
        mode = "list-drag";
        listDraggingRef.current = false;  // 重置: 新一次 mousedown 不继承上次的 drag 标记
        setSearchListOpen(true);
        listDragLastY = e.clientY;
        listDragLastScrollTop = option.parentElement?.scrollTop ?? 0;
        // 记录 mousedown 起点, 用来在 mousemove 时算拖动距离
        listDragOriginX = e.clientX;
        listDragOriginY = e.clientY;
        return;
      }
      // list padding 内 — drag 转 wheel 翻页 (跟 option 一样, 只是不进 option button)
      const list = hit.closest('[role="listbox"][aria-label="搜索结果"]') as HTMLElement | null;
      if (list) {
        mode = "list-drag";
        // 也重置 listDraggingRef + 记起点 — list padding 起步拖动也算 drag,
        //   防止 mouseup 在 option 上时误触发 onSelect (拖动中掠过 option)
        listDraggingRef.current = false;
        setSearchListOpen(true);
        listDragLastY = e.clientY;
        listDragLastScrollTop = list.scrollTop;
        listDragOriginX = e.clientX;
        listDragOriginY = e.clientY;
        return;
      }
      // 其他 wrapper 区域 (放大镜 icon / X 按钮附近 / padding) — 原"drag 收起 list"模式
      //   bug 2 修: 同样在 mousedown 时展开 list (不是等 click event)
      //   - 但 drag 模式如果移动 > 3px 仍会 setSearchListOpen(false)
      //   - 所以这里先展开, drag 后再收 (跟之前一致)
      mode = "drag";
      setSearchListOpen(true);
      dragOrigin = { x: e.clientX, y: e.clientY };
      dragActive = false;
    };
    const onMouseMove = (e: MouseEvent) => {
      // list drag-scroll: pointermove 直接写 scrollTop, 跟 wheel 翻页一样
      if (mode === "list-drag") {
        // 距离 mousedown 起点 > 3px → 标记 drag, 后续 option onClick 会跳过 onSelect
        if (!listDraggingRef.current) {
          const dx = e.clientX - listDragOriginX;
          const dy = e.clientY - listDragOriginY;
          if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
            listDraggingRef.current = true;
          }
        }
        const wrapper = document.querySelector('[role="search"]');
        const list = wrapper?.querySelector('[role="listbox"][aria-label="搜索结果"]') as HTMLElement | null;
        if (!list) return;
        const dy = listDragLastY - e.clientY;  // 手指往上拖 = scrollTop 增加
        let next = listDragLastScrollTop + dy;
        // 边界 clamp + preventDefault 阻止 page scroll
        const atTop = next <= 0;
        const atBottom = next + list.clientHeight >= list.scrollHeight - 1;
        next = Math.max(0, Math.min(next, list.scrollHeight - list.clientHeight));
        list.scrollTop = next;
        listDragLastScrollTop = next;
        listDragLastY = e.clientY;
        // 在边界时, 浏览器可能继续触发 page scroll, 阻止默认
        if (atTop || atBottom) e.preventDefault();
        return;
      }
      // drag 模式: mousemove > 3px 触发收起 list
      if (mode === "drag" && dragOrigin && !dragActive) {
        if (
          Math.abs(e.clientX - dragOrigin.x) > 3 ||
          Math.abs(e.clientY - dragOrigin.y) > 3
        ) {
          dragActive = true;
          setSearchListOpen(false);
        }
      }
    };
    const onMouseUp = () => {
      mode = null;
      dragOrigin = null;
      dragActive = false;
      listDragLastY = 0;
      listDragLastScrollTop = 0;
    };
    // click 在 wrapper 内任何位置都展开 list (不只 input)
    //   - 之前只 input 触发, 点 wrapper padding / icon 周围 不展开
    //   - 用户滚轮缩放后 list 收起, 再次点搜索栏 (任何位置) 都应展开
    //   - 但点 result button / X 按钮时这两个 element 自己会处理, 没必要再开 list
    const onClickNative = (e: MouseEvent) => {
      const wrapper = document.querySelector('[role="search"]');
      if (!wrapper || !wrapper.contains(e.target as Node)) return;
      const target = e.target as HTMLElement;
      // 点 result button 时结果自己处理 (跳视角 + 弹 popup), 不再开 list
      if (target.closest('[role="option"]')) return;
      // 点 X 按钮 (清空) 时清空自己处理, 不再开 list
      if (target.closest('button[aria-label="清空搜索"]')) return;
      // wrapper 内任何 click 都展开 list (不只 input 本身)
      //   - 之前只 input 触发, 点 wrapper padding / icon 周围 不展开
      //   - 用户滚轮缩放后 list 收起, 再次点搜索栏 (任何位置) 都应展开
      setSearchListOpen(true);
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("click", onClickNative);
    return () => {
      window.removeEventListener("wheel", stopWheel, { capture: true } as EventListenerOptions);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("click", onClickNative);
    };
  }, [searchVisible]);

  // 跨 3 维度搜索: 同时匹配 name + 拼音(全拼) + outputs.label
  //   - name 匹配: 直接命中地标名 (例 "猪人塔")
  //   - 拼音匹配 (label.name): 打入 "yongzongzhen" → 命中 "雍宗镇"
  //     - 缩写匹配已删 (体验差, 太多误命中)
  //   - output 匹配: 中文直接 match OR 拼音 match — 用户搜 "tie" 也命中产出 "铁"
  //   - inputs 故意不参与: 搜"泥土"不该匹配到一堆只用泥土当建材的机器, 产出更精准
  // 排序: 当前维度优先, 其它维度按 name 字母顺序; 同一维度内 name > pinyin > output
  const searchResults = useMemo(() => {
    // 剔除中文输入法自动插入的拼音分隔号 (单引号家族: ASCII ' + 弯引号 ' ')
    //   例: 用户打 "ni'hao" 实际想搜 "nihao" → 飞键 IME 会加 ' 分隔
    const q = searchQuery.trim().replace(/['\u2018\u2019]/g, "");
    if (!q) return [] as SearchResult[];
    const qLower = q.toLowerCase();
    const out: SearchResult[] = [];
    (Object.keys(lb) as NewWorldId[]).forEach((wid) => {
      (lb[wid] ?? []).forEach((label) => {
        const matched: SearchMatchKind[] = [];
        if (label.name.includes(q)) matched.push("name");
        // 拼音匹配 (label.name): 全拼 includes 允许搜中间片段 (例 "luzu" 匹配 "rongluzu")
        //   仅在 name 没匹配时检查 (name 直命中优先级最高, 加 pinyin 反而冗余)
        if (!matched.includes("name")) {
          const fullPinyin = toPinyin(label.name);
          if (fullPinyin.includes(qLower)) matched.push("pinyin");
        }
        // output 匹配: 中文直接 match OR 拼音 match — 后者覆盖用户英文输入找产出的场景
        //   例: 用户搜 "tie" → 命中产出 "铁" (toPinyin("铁") = "tie")
        if (
          (label.outputs ?? []).some((o) => {
            const lbl = o.label ?? "";
            return lbl.includes(q) || toPinyin(lbl).includes(qLower);
          })
        )
          matched.push("output");
        if (matched.length > 0) out.push({ label, worldId: wid, matched });
      });
    });
    out.sort((a, b) => {
      // 当前维度优先 (按 name 升序), 其它维度其次 (按 name 升序)
      const aCur = a.worldId === worldId;
      const bCur = b.worldId === worldId;
      if (aCur !== bCur) return aCur ? -1 : 1;
      // 同维度内按匹配强度 (name > pinyin > output) 再按字母序
      const rank = (m: SearchMatchKind[]) =>
        m.includes("name") ? 0 :
        m.includes("pinyin") ? 1 : 2;
      const ra = rank(a.matched);
      const rb = rank(b.matched);
      if (ra !== rb) return ra - rb;
      return a.label.name.localeCompare(b.label.name, "zh");
    });
    return out;
  }, [searchQuery, lb, worldId]);

  // ---- 4. 拖拽 / 滚轮 ref ----
  const containerRef = useRef<HTMLDivElement>(null);
  // container DOM 已 mount / 尺寸变化标记 — render 阶段 inline 调用 worldToScreenFactory 时
  //   containerRef.current 还是 null (ref 在 commit 阶段才 attach), labels 会渲染 0 个
  //  - 用 useState + useEffect 在 commit 后 setState(true) 触发重 render, 此时 ref 已有值
  //  - 进一步加 ResizeObserver 监听容器尺寸变化 — 退出全屏时 container 从 fullscreen 缩到正常
  //    浏览器 layout 还没完全 settled, React 同步 re-render 算 label 位置时 rect 错位
  //    ResizeObserver 在 layout 完成后异步 fire, 此时再 setState 触发 render, labels 位置正确
  //    不再需要"拖一下地图才刷新"
  //  - 同时维护 containerRect state — render 阶段传给 worldToScreenFactory, 不读 ref (react-hooks/refs 规则)
  //  用户体验: 刷新 / 退出全屏 / 窗口 resize — label 都立刻正确显示
  const [, setContainerTick] = useState(0);
  const [containerRect, setContainerRect] = useState<{
    width: number;
    height: number;
  } | null>(null);
  useEffect(() => {
    const update = () => {
      const el = containerRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        setContainerRect({ width: r.width, height: r.height });
      }
      setContainerTick((t) => t + 1);  // 触发 render, 重新读 containerRect
    };
    update();  // 首次 mount: ref 已 attach 后 setState
    const target = containerRef.current;
    if (!target) return;
    const observer = new ResizeObserver(update);  // 尺寸变化: layout settled 后再 setState
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  /**
   * 整个 GuideMap 根容器 (包含 WorldTabs + 地图)
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

  /**
   * 切维度时是否跳过 "自动重置到中央 100%" — 搜索结果点击会自己 panToLandmark,
   * 此时 reset 一下会闪中央再跳过去, 难看。搜索调用 setWorldId 前先把这个 ref 置 true,
   * 切维度 effect 读到就跳过 reset, 只保留 scrollMapIntoView
   */
  const skipWorldResetRef = useRef(false);

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
    // 同步刷新右上角坐标 — 改 transform 后不调就 stale
    //  (覆盖路径: + 按钮 (zoom), 点地标 (panToLandmark), 切维度 — 都走 commitImmediate)
    //  用 lastMouse 位置; 没记录过 (鼠标没进过地图) 就不刷
    const last = lastMouseRef.current;
    const w = writeHoverRef.current;
    if (last && w) w(last.x, last.y);
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
  // 右上角坐标直接写 DOM — 不走 React state
  //  - mousemove 60fps 也不触发 re-render, 不抖
  //  - wheel/pinch 缩放后是"真同步"更新, 不会因为 setState batching 延迟
  //  - 鼠标/手指位置没变, 但 tx/ty/k 变了, 同一屏幕点对应的 viewBox 位置变了
  //    右上角坐标也得跟着重算, 否则显示就 stale
  //    (mousemove 自然触发, wheel/pinch 不发 mousemove, 所以得显式调一次)
  const coordBoxRef = useRef<HTMLDivElement>(null);
  // 最后一次鼠标在地图上的位置 (clientX/Y) — commitImmediate 用它刷坐标
  // 原因: + 按钮 / 点地标 / 切维度 这些"非 mousemove"的 transform 变化
  //   也要刷新右上角, 但 React 事件 e 没传进 commit, 没法直接拿 e.clientX/Y
  //   退而求其次用 lastMouse 位置 (mousemove 时更新, 大多数情况是准的)
  const lastMouseRef = useRef<{ x: number; y: number } | null>(null);
  // 写坐标函数的 ref 间接 — 让 commitImmediate 也能调到 (commit 在 writeHover 之前定义)
  const writeHoverRef = useRef<((x: number, y: number) => void) | null>(null);
  const writeHoverCoordFromScreen = useCallback(
    (clientX: number, clientY: number) => {
      const box = coordBoxRef.current;
      const el = containerRef.current;
      const w = worldRef.current;
      if (!box || !el || !w) return;
      // 记录最后位置, 给 commitImmediate 在按钮/点地标 transform 后用
      lastMouseRef.current = { x: clientX, y: clientY };
      const rect = el.getBoundingClientRect();
      // 鼠标位置可能在 container 之外 (e.g. + 按钮触发 scrollMapIntoView 后, 鼠标被
      //   page scroll 抖到 container 下方), 这种"老位置"算出来会落到瓦片外, 显示就被
      //   设成 "none". 这里提前判一下, 是这种情况就保持隐藏, 别瞎算老位置
      if (
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      ) {
        box.style.display = "none";
        return;
      }
      const { width: vbW, height: vbH } = w.map;
      // 屏幕 → viewBox (考虑当前缩放和平移的逆变换, isSlice 跟 SVG 实际渲染一致)
      const isSlice = !isFullscreen && isMobile;
      const mouseVB = screenToVB(clientX, clientY, rect, vbW, vbH, isSlice);
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
        const finalX = Math.round(tile.x + inTileX);
        const finalZ = Math.round(tile.z + inTileY);
        box.style.display = "";
        const colEl = box.querySelector<HTMLElement>("[data-col]");
        const rowEl = box.querySelector<HTMLElement>("[data-row]");
        const xEl = box.querySelector<HTMLElement>("[data-x]");
        const zEl = box.querySelector<HTMLElement>("[data-z]");
        if (colEl) colEl.textContent = String(tile.col);
        if (rowEl) rowEl.textContent = String(tile.row);
        if (xEl) xEl.textContent = String(finalX);
        if (zEl) zEl.textContent = String(finalZ);
      } else {
        // 越界 (拖到 viewBox 之外): 隐藏, 别显示老数字
        box.style.display = "none";
      }
    },
    [tileMap, isFullscreen, isMobile],
  );
  // 同步 ref, 让更早定义的 commitImmediate 能调到最新 writeHoverCoordFromScreen
  //   - 不能在 render 阶段写 ref (react-hooks/refs 规则), 放 useEffect 里在 commit 后同步
  useEffect(() => {
    writeHoverRef.current = writeHoverCoordFromScreen;
  }, [writeHoverCoordFromScreen]);
  const onContainerMouseMove = useCallback(
    (e: React.MouseEvent) => {
      writeHoverCoordFromScreen(e.clientX, e.clientY);
    },
    [writeHoverCoordFromScreen],
  );
  const onContainerMouseLeave = useCallback(() => {
    // 鼠标离开: 隐藏坐标 (mousemove 不再触发, wheel/pinch 在地图上也无 touchstart)
    const box = coordBoxRef.current;
    if (box) box.style.display = "none";
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
  // 计算"地图贴 header 下沿"的目标 scrollY — 给 scrollMapIntoView (smooth 滚动) + 退出全屏 (instant 同步) 共用
  const computeMapScrollTarget = useCallback((): number => {
    // 移动端不滚 — 用户手指控制滚动
    if (window.innerWidth < 640) return window.scrollY;

    const el = rootRef.current;
    if (!el) return window.scrollY;
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
    return Math.max(0, naturalTop - targetVisualTop);
  }, []);

  const scrollMapIntoView = useCallback(() => {
    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({
      top: computeMapScrollTarget(),
      behavior: reducedMotion ? "auto" : "smooth",
    });
  }, [computeMapScrollTarget]);

  /**
   * 视角跳到 (worldX, worldZ) 并缩放到 targetZoomPercent (百分比: 100=1x, 400=4x)
   * 给 region 大地名点击用, 类似百度地图点地名跳区域
   *  - 用 worldToVB + computePanTransform 算出新 tx/ty/k
   *  - 内部 k 是缩放比 (1.0=1x, 4.0=4x), 数据用百分比, 这里 /100 转换
   *  - clamp 缩放到该维度允许的范围 (MAX_ZOOM[worldId])
   *  - 500ms 过渡动画 (ease-in-out), SVG g 挂 transition class
   *    - 用户连续点击不同 region 时清掉旧 timeout, 用新动画
   *    - prefers-reduced-motion 直接跳, 不动画
   *  - 滚到 header 下 (跟按钮缩放/退出全屏行为一致)
   *  - 关闭可能打开的 popup
   */
  const PAN_ANIMATION_MS = 500;
  const panToLandmark = useCallback(
    (worldX: number, worldZ: number, targetZoomPercent: number) => {
      const w = worldRef.current;
      if (!w) return;
      // 百分比 → 缩放比: 400% → k=4
      const targetK = targetZoomPercent / 100;
      const t = computePanTransform(worldX, worldZ, targetK, w);
      if (!t) return;
      // clamp k 到 [1, MAX_ZOOM[worldId]] 范围, 防止超出边界
      const maxK = MAX_ZOOM[w.id];
      const clampedK = Math.max(1, Math.min(maxK, t.k));
      // 如果 k 被 clamp 了, 重新算 tx/ty (因为 k 变了, 中心点也会变)
      const finalT =
        clampedK === t.k
          ? t
          : computePanTransform(worldX, worldZ, clampedK, w) ?? t;

      // clampBounds: 边缘区域不强行居中
      // 如果区域在地图边上, 居中会让 viewBox 跑到地图内容之外 (露出空背景),
      // 这里把 tx/ty clamp 到合法范围, 让视图"尽可能向中间但不出地图"
      const rect = containerRef.current?.getBoundingClientRect();
      let finalTx = finalT.tx;
      let finalTy = finalT.ty;
      if (rect) {
        const { width: vbW, height: vbH } = w.map;
        const isSlice = !isFullscreen && window.innerWidth < 640;
        const clamped = clampBounds(
          finalT.tx,
          finalT.ty,
          finalT.k,
          vbW,
          vbH,
          rect.width,
          rect.height,
          isSlice,
        );
        finalTx = clamped.tx;
        finalTy = clamped.ty;
      }

      // 关键修复 1: 清掉 pendingRef 和 rAF, 避免之前的 drag rAF 用旧 k 覆盖 setK
      // 506% 跳变的根因: onPointerMove → schedule(curK) → rAF commit → setK(curK=旧值)
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      pendingRef.current = null;

      // 关键修复 2: 同步更新 ref, 跟 setK 保持一致
      // 之后的 onPointerMove 读 kRef.current 才是新值, schedule 才传正确 k
      kRef.current = finalT.k;
      txRef.current = finalTx;
      tyRef.current = finalTy;

      setK(finalT.k);
      setTx(finalTx);
      setTy(finalTy);
      // 注意: 不关 popup, 让用户能继续看详情 (popup 在地图左上角, 不挡操作)
      // 关闭方式: 点地图 (容器 onClick) 或点 X

      // 过渡开关: 尊重 prefers-reduced-motion
      const reducedMotion =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!reducedMotion) {
        // 重新点击先清掉旧 timeout, 避免提前关掉新一轮动画
        if (panTimeoutRef.current !== null) {
          clearTimeout(panTimeoutRef.current);
        }
        setIsPanning(true);
        panTimeoutRef.current = window.setTimeout(() => {
          setIsPanning(false);
          panTimeoutRef.current = null;
        }, PAN_ANIMATION_MS);
      } else {
        // 不动画: 直接关掉 (走一次 setState 防止上一轮还挂着)
        if (panTimeoutRef.current !== null) {
          clearTimeout(panTimeoutRef.current);
          panTimeoutRef.current = null;
        }
        setIsPanning(false);
      }

      // 滚到 header 下 (跟按钮缩放/退出全屏行为一致, 桌面端)
      scrollMapIntoView();
    },
    [scrollMapIntoView, isFullscreen],
  );

  /**
   * 搜索结果点击 — 跨维度跳转: 切维度 + 跳视角 + 弹 popup
   *
   * 时序问题:
   *   1. setWorldId(next) 是异步, worldRef.current 要等下次 render 的 useEffect 同步
   *   2. panToLandmark 内部用 worldRef.current 算坐标 — 切维度后必须等 worldRef 同步
   *   3. 切维度 effect 默认会 reset (commitImmediate(0,0,1)) — 会闪中央再跳, 难看
   *
   * 处理:
   *   - 提前 skipWorldResetRef.current = true 告诉 effect 别 reset
   *   - 用 rAF 嵌套: 第一帧 React render + useEffect 跑完, 第二帧 worldRef 已是新 world
   *     再调 panToLandmark 用新 world 算 tx/ty/k, 同时保留 500ms transition 动画
   */
  const goToSearchResult = useCallback(
    (label: NewLabel, fromWorldId: NewWorldId) => {
      setSelectedLabel(label);
      if (fromWorldId !== worldId) {
        skipWorldResetRef.current = true;
        setWorldId(fromWorldId);
        // 双 rAF: 第一帧 React 提交 + useEffect 跑完 (worldRef 同步成新 world)
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            panToLandmark(label.x, label.z, label.targetZoom ?? 100);
          });
        });
      } else {
        panToLandmark(label.x, label.z, label.targetZoom ?? 100);
      }
    },
    // deps: worldId (当前维度, 切维度时才生效) + panToLandmark (内部用 worldRef, 跟 worldId 解耦)
    // setSelectedLabel/setWorldId 是 useState setter (引用稳定) — React Compiler 仍要求显式列出
    [worldId, panToLandmark, setSelectedLabel, setWorldId],
  );

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
      if (panTimeoutRef.current !== null) {
        clearTimeout(panTimeoutRef.current);
      }
    };
  }, []);

  // 切维度: 重置视图 + 滚到中央 + 关 popup (用户切 tab 旧 label 详情不相关了)
  // 跳过策略: 比对 prevWorldIdRef 跟当前 worldId, 相同就跳过
  //   - 首次挂载 (StrictMode 双挂载) 两次 prevRef 都等于 worldId, 都跳过
  //   - **切回初始 dim (如 主世界 → 下界 → 主世界) 也要跑**: 不能用 initialWorldIdRef
  //     (那是 mount 时捕获, 切回初始值时会误判为"没变化", 跳过 reset + 关 popup)
  // skipWorldResetRef 由搜索结果点击置 true: search 自己会跳视角, 跳过自动 reset
  //   跨维度搜索也要保留 popup: goToSearchResult 自己 setSelectedLabel(label), 不应被这里覆盖
  const prevWorldIdRef = useRef<NewWorldId>(worldId);
  useEffect(() => {
    if (prevWorldIdRef.current === worldId) return;
    prevWorldIdRef.current = worldId;
    // 用户手动切维度 (非跨维度搜索): 关掉旧的 label 详情
    // 跨维度搜索 (skipWorldReset) 跳过这里, 让 goToSearchResult 自己设置新 popup
    if (!skipWorldResetRef.current) {
      setSelectedLabel(null);
    }
    if (skipWorldResetRef.current) {
      // 搜索路径: 自己负责跳视角, 这里只滚到 header 下方 (跟标签/交通/搜索开关一致)
      skipWorldResetRef.current = false;
      scrollMapIntoView();
      return;
    }
    queueMicrotask(() => commitImmediate(0, 0, 1));
    scrollMapIntoView();
  }, [worldId, scrollMapIntoView]);

  // 退出全屏: 兜底同步滚到地图位置 (主路径在 fullscreenchange listener 里同步处理 — 见下面 useEffect)
//   - listener 必然触发 (fullscreenchange 浏览器原生事件), 但保留 effect 兜底
//   - 万一 listener 因为某些 race condition 没机会跑, 这里还能补救
//   - 用 computeMapScrollTarget 同算法, 保证跟点击搜索框触发的滚动一致 (地图顶部贴 header 下沿)
//   - prevFullscreenRef 守护: 只在 true → false 转移时跑, mount 时不滚 (isFullscreen 初始 false)
const prevFullscreenRef = useRef(isFullscreen);
useEffect(() => {
  const wasFullscreen = prevFullscreenRef.current;
  prevFullscreenRef.current = isFullscreen;
  if (wasFullscreen && !isFullscreen) {
    window.scrollTo(0, computeMapScrollTarget());
  }
}, [isFullscreen, computeMapScrollTarget]);

  // 滚轮缩放
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      // lightbox 打开时 (image-lightbox.tsx 的 dialog 接管滚轮) 不响应 — 避免双触发
      if ((e.target as HTMLElement | null)?.closest('[role="dialog"][aria-modal="true"]')) return;
      // 搜索框有内容时, 缩放地图顺手收起搜索列表 — 用户进入"专注地图"模式
      if (searchQueryRef.current.trim().length > 0) {
        setSearchListOpen(false);
      }
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
      const isSlice = !isFullscreen && window.innerWidth < 640;
      const mouseVB = screenToVB(e.clientX, e.clientY, rect, vbW, vbH, isSlice);
      const ratio = newK / curK;
      const rawTx = mouseVB.x - (mouseVB.x - curTx) * ratio;
      const rawTy = mouseVB.y - (mouseVB.y - curTy) * ratio;
      const { tx: cTx, ty: cTy } = clampBounds(rawTx, rawTy, newK, vbW, vbH, rect.width, rect.height, isSlice);
      kRef.current = newK;
      txRef.current = cTx;
      tyRef.current = cTy;
      schedule(cTx, cTy, newK);
      // 滚轮缩放后刷新右上角坐标 — 鼠标位置没动, 但世界坐标变了, 不调就 stale
      // (mousemove 要等用户真动鼠标才触发, 滚轮不发 mousemove)
      writeHoverCoordFromScreen(e.clientX, e.clientY);
      // 滚轮缩放后 debounce 滚动 (150ms 内没新滚轮才滚)
      scheduleScrollAfterWheel();
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [schedule, scheduleScrollAfterWheel, writeHoverCoordFromScreen, isFullscreen]);

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
      const isSlice = !isFullscreen && window.innerWidth < 640;

      // 缩放中心 = 两指中点 (跟 wheel 用鼠标位置同款)
      const centerX = (t1.clientX + t2.clientX) / 2;
      const centerY = (t1.clientY + t2.clientY) / 2;
      const centerVB = screenToVB(centerX, centerY, rect, vbW, vbH, isSlice);

      const kRatio = newK / kRef.current;
      const rawTx = centerVB.x - (centerVB.x - txRef.current) * kRatio;
      const rawTy = centerVB.y - (centerVB.y - tyRef.current) * kRatio;
      const { tx: cTx, ty: cTy } = clampBounds(rawTx, rawTy, newK, vbW, vbH, rect.width, rect.height, isSlice);

      kRef.current = newK;
      txRef.current = cTx;
      tyRef.current = cTy;
      schedule(cTx, cTy, newK);
      // 双指缩放后刷新右上角坐标 — 两指中点没动, 但世界坐标变了
      // (移动端没有 mousemove, 只能从 touchmove 里主动算)
      writeHoverCoordFromScreen(centerX, centerY);
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
  }, [schedule, writeHoverCoordFromScreen, isFullscreen]);

  const onPointerDown = (e: React.PointerEvent) => {
    // 在搜索 wrapper 子树内 (input / list / icon / padding) pointerdown 不触发地图 drag
    //   - bug 4 修: 用户在 input 内 pointerdown 想选文字/复制, 之前会拖动地图
    //   - 不调用 setPointerCapture → 浏览器默认 input 文字 selection 正常工作
    //   - 不调 dragRef.current = {...} → onPointerMove 检测 dragRef=null 提前 return
    //   - 列表 option button / X 按钮 是 <button>, closest("button") 也能拦住, 但 input 不是 button
    //     必须用 searchWrapperRef.contains 兜底
    if (searchWrapperRef.current?.contains(e.target as Node)) return;
    if ((e.target as HTMLElement).closest("button")) return;
    // lightbox 打开时, map 内的 pointerdown 不响应 (lightbox 接管拖动)
    //   - 阻止用户拖动 lightbox 图片时, 地图同时跟着拖 (双触发)
    //   - lightbox 在 map container 内 (DOM 嵌套), React 事件会冒泡到 map
    if ((e.target as HTMLElement | null)?.closest('[role="dialog"][aria-modal="true"]')) return;
    // 搜索框有内容时, 在地图上按下鼠标拖动也收起搜索列表
    if (searchQueryRef.current.trim().length > 0) {
      setSearchListOpen(false);
    }
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

  // 退出全屏同步滚到地图位置 (跟 scrollMapIntoView 一致) — 不用 savedScrollYRef 了
//   - 之前版本保存用户的 scrollY 然后恢复 — 但如果用户原本不在地图位置, 恢复后就不贴 header
//   - 用户期望: "和地图滚动一样" = 跟点击搜索框触发的一致, 地图顶部贴 header 下沿
//   - 无论用户原本 scrollY 在哪, 退出都到目标位置 (用 computeMapScrollTarget 算)

// 全屏切换
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
    const onChange = () => {
      const isNowFs = !!document.fullscreenElement;
      setIsFullscreen(isNowFs);
      // 退出全屏: 同步立即 scrollTo 到地图位置 (跟 scrollMapIntoView 同算法, 但 instant)
      //   - fullscreenchange 是同步事件, 在它回调里直接 scrollTo, 浏览器还没 paint 中间帧
      //   - 目标位置用 computeMapScrollTarget — 跟点击搜索框触发的滚动一致 (地图顶部贴 header 下沿)
      //   - 用默认 instant 行为 (window.scrollTo(x, y)), 不要 smooth — smooth 期间浏览器会 paint scrollY=0
      if (!isNowFs) {
        window.scrollTo(0, computeMapScrollTarget());
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [computeMapScrollTarget]);

  /**
   * 预加载整个维度的瓦片 (跟 guide-map 思路一致: 切维度时已经 cache 好, 0 滞留)
   * - 这里不只预加载"主图", 整个维度的所有瓦片都拉 (反正切过去就要全部显示)
   * - 跟 MapCanvas 同款按 k 阈值选 src:
   *   - k < 2.5 (切维度时默认): 用 srcThumb (webp 缩略图, 省内存)
   *   - k >= 2.5: 用 src (原 PNG, 高清)
   * - 不同时预加载 PNG — 用户放大跨过 2.5× 阈值时按需 fetch, 接受这一次小延迟
   *   (vs 一次性全预加载 78 张 PNG 多花 60MB 内存)
   * - nether/end 没 srcThumb, 永远用 src
   */
  const preloadWorld = useCallback((id: NewWorldId) => {
    const w = worlds.find((x) => x.id === id);
    if (!w) return;
    const useHires = kRef.current >= 2.5;
    for (const t of w.map.tiles) {
      const href = useHires || !t.srcThumb ? t.src : t.srcThumb;
      preloadImage(href);
    }
  }, [worlds]);

  // 地铁线路 + 珍珠炮 (SVG, 进 MapCanvas 的 <g>) — 给 transitInWorld 回调用
  //  - 关 transitVisible 时直接 return null, <g> 内部什么都不渲染
  //  - 依赖: mt[worldId].lines + mt[worldId].pearls + k (线宽按 cssScaled 算)
  //    + world (toVB) + 默认值
  //  注: 必须在 early return 之前定义, 保持 hooks 顺序一致
  //  注: world 在 useCallback 闭包里可能是 null (early return 触发时),
  //  但这个 cb 只在 early return 之后被 MapCanvas 调用, 那时 world 一定非空
  //  这里加 null check 让 TS 满意, 实际不会走到 null 分支
  const transitInWorldCb = useCallback(() => {
    if (!transitVisible || !world) return null;
    return (
      <>
        <TransitLines
          lines={mt[worldId]?.lines ?? []}
          k={k}
          toVB={(wx, wz) => worldToVB(wx, wz, world)}
          defaults={mt[worldId]?.style}
        />
        <PearlLines
          pearls={mt[worldId]?.pearls ?? []}
          k={k}
          currentZoom={k * 100}
          toVB={(wx, wz) => worldToVB(wx, wz, world)}
          defaults={mt[worldId]?.style}
        />
      </>
    );
  }, [transitVisible, mt, worldId, k, world]);

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
          labelsVisible={labelsVisible}
          onToggleLabels={() => {
            setLabelsVisible((v) => !v);
            // 跟其他视角变化操作一致: 切换标签后也滚到 header 下方
            scrollMapIntoView();
          }}
          transitVisible={transitVisible}
          onToggleTransit={() => {
            setTransitVisible((v) => !v);
            scrollMapIntoView();
          }}
          searchVisible={searchVisible}
          onToggleSearch={() => {
            setSearchVisible((v) => !v);
            // 搜索开关也滚到 header 下方, 跟另外两个开关保持一致
            scrollMapIntoView();
          }}
        />
        {!isMobile && (
          // 始终渲染, 显示/隐藏由 JS 直接改 style.display (无 React state)
          //   - 初始 display:none: 用户没动鼠标前不露 "-"
          //   - mousemove/wheel/pinch 写入坐标: box.style.display = ""
          //   - mouseleave / 越界: box.style.display = "none"
          // 文字大小跟上方两个开关按钮 (text-xs sm:text-sm) 对齐
          <div
            ref={coordBoxRef}
            className="hidden sm:flex absolute right-5 top-1/2 -translate-y-1/2 items-center gap-2 text-xs sm:text-[15px] font-mono text-slate-700 whitespace-nowrap tabular-nums select-none pointer-events-none"
            aria-live="polite"
            style={{ display: "none" }}
          >
            <span className="text-slate-500">x</span>
            <span data-x className="text-slate-900">-</span>
            <span className="text-slate-400"> </span>
            <span className="text-slate-500">z</span>
            <span data-z className="text-slate-900">-</span>
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
        // 点地图 (非 button) 关闭 popup — 拖动/缩放不触发 onClick, 所以不影响
        // 搜索 wrapper 内的 click 不能用 stopPropagation 拦 (会阻止 React 合成事件分发,
        // input.onFocus/onClick 不触发, list 永远展不开), 改用 contains 检查 target
        // 点标签 (label button) 时也收起 list — 让用户专注看标签详情 (popup 由 label 自己设)
        onClick={(e) => {
          // search wrapper 内的 click 属于搜索框自己的逻辑, 地图不响应
          // 双保险: ref 可能 stale (HMR / 反复重渲染), 用 ref + querySelector fallback
          const wrapperEl =
            searchWrapperRef.current ?? document.querySelector('[role="search"]');
          const target = e.target as HTMLElement;
          const contains = wrapperEl?.contains(target);
          if (contains) return;
          // 兜底: React 18 + 反复重渲染下 click event 的 e.target 偶尔跟 hit-test 不一致
          // (target 是 React root container 的 child DIV, 但 hit-test 在 wrapper 内 input 上)
          // hit-test 在 wrapper 内 → 这次 click 实际是 wrapper 内的, 不应被地图处理
          const hitTestEl = document.elementFromPoint(e.clientX, e.clientY);
          if (wrapperEl?.contains(hitTestEl)) return;
          const isLabel = !!target.closest("button[data-label-id]");
          // 点 label 时 label.onClick 已 setSelectedLabel, 这里不要清掉 (React 18 batched)
          if (!isLabel) setSelectedLabel(null);
          // 任何点击地图都收起搜索列表
          setSearchListOpen(false);
        }}
        // wheel 必须 stopPropagation 让 list 内 wheel 不缩地图 — 用 capture 阶段 native listener
        // (不能用 React onWheel, 因为 map 上 wheel handler 也是 native addEventListener,
        //  React stopPropagation 不影响 native bubble)
        onWheelCapture={(e) => {
          if (searchWrapperRef.current?.contains(e.target as Node)) {
            e.stopPropagation();
          }
        }}
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
          isPanning={isPanning}
          transitInWorld={transitInWorldCb}
        />

        {/* 标签层 — 永远渲染, 内部按 visibleWhen 过滤
            站名/珍珠 (visibleWhen: "transit") 只在 transitVisible=true 时显示,
            不要求 labelsVisible=true (开了交通就能看到站名)
            普通标签只在 labelsVisible=true 时显示
            withLabels 上下文 (labels && transit) 走不同 font/offset 配置
            标签 button 自己带 left/top 的 CSS transition, 跟 SVG g 的 transition-transform 同步 */}
        <MapLabels
          labels={lb[worldId] ?? []}
          currentZoom={k}
          isPanning={isPanning}
          labelsVisible={labelsVisible}
          transitVisible={transitVisible}
          toScreen={worldToScreenFactory({
            containerRect,
            // 用 React state 的 world (不是 worldRef.current),
            // 切维度时 useEffect 还没跑, ref 还是旧 world,
            // 用 ref 会让标签位置错 (parScale 用错世界算)
            world,
            tx,
            ty,
            k,
            isFullscreen,
            isMobile,
          })}
          onSelect={(label) => setSelectedLabel(label)}
          onPan={panToLandmark}
        />

        {/* 交通 (地铁网络) overlay — 拆成两块:
            1) 线 (SVG, 进 MapCanvas 的 <g>) — 跟地图内容同一条 CSS transition,
               点 region 跳视角时一起平滑移动
            2) 站点 (HTML, 屏幕坐标) — 走 toScreen + CSS transition, 跟地标同频道
            站点 div 永远挂在 DOM 里 (用 visibility:hidden 控显隐), 这样点地标触发
            panToLandmark 时, 即使 transit 之前是关的 / 缩放 < 500%, 站点 div 也已经
            在 DOM 里跟踪 tx/ty/k — 500ms 过渡里 CSS transition 有"起点"可以插值,
            而不是"啪"地出现在终点 (跟地标 always-rendered + visibility:hidden 同款)
            (不挂门控 {transitVisible && ...} 是这个 bug 的根因: 站点不进 DOM,
             pan 过渡里没东西可插值) */}
        <TransitStations
          stations={mt[worldId]?.stations ?? []}
          k={k}
          currentZoom={k * 100}
          isPanning={isPanning}
          transitVisible={transitVisible}
          toScreen={worldToScreenFactory({
            containerRect,
            world,
            tx,
            ty,
            k,
            isFullscreen,
            isMobile,
          })}
          defaults={mt[worldId]?.style}
        />

        {/* 标签详情卡片 — 左上角, 拖动/缩放不关, 点地图关
            搜索开启时 popup 用 absolute + top-[60px] 让位搜索栏 (wrapper 也是 absolute,
            跟 page scroll 走; click map 触发的 scrollMapIntoView 让地图 + wrapper 一起到 viewport 顶部) */}
        {selectedLabel && (
          <LabelPopup
            label={selectedLabel}
            onClose={() => setSelectedLabel(null)}
            topClassName={searchVisible ? "absolute top-[70px] left-4" : undefined}
          />
        )}

        {/* 搜索框 + 结果下拉 — 浮在地图左上角, 跟 popup 同一 absolute 容器 (map container 内)
            - 开启搜索才显示 (跟开关同步), 关闭时整个卸载
            - z-30 高于 popup (z-20): 搜索时列表覆盖 popup 是预期, 用户主动开搜索
              时本来就不需要同时看旧 popup, 点结果后会替换
            - ESC / X 按钮 / 点结果都能关闭/跳转; 关闭 useEffect 会清空 query */}
        {searchVisible && (
          <div
            ref={searchWrapperRef}
            data-list-open={searchListOpen ? "1" : "0"}
            data-query={searchQuery}
            role="search"
            aria-label="搜索地标"
            className={cn(
              "absolute top-4 left-4 z-[60]",
              "w-72 sm:w-80 max-w-[calc(100%-24px)]",
              "bg-white border border-slate-200 rounded-lg",
              "shadow-2xl shadow-slate-900/20",
              "animate-in fade-in slide-in-from-top-2 duration-200",
              "overflow-hidden",
            )}
            // 事件冒泡用 native listener (capture 阶段) 统一处理 — 见 useEffect,
            // 不要在这里再用 React onClick stopPropagation, 双重 stop 反而有副作用
          >
            {/* input 行 — X 按钮只在有内容时出现, 用于清空文字 (不是关闭搜索)
                关闭搜索走 ESC 键 (input 上 onKeyDown) 或顶部"搜索"开关按钮 */}
            <div className="flex items-center pl-3 pr-1.5 py-2.5">
              <img src="/icons/map/tabs/显示搜索图标.svg" alt="" className="w-4 h-4 shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onClick={() => {
                  // 跟 toggle labels / transit / search 一致 — 点击搜索框也触发地图滚到 header 下方
                  // 用户从其他位置 (e.g. 滚到页面底部) 想用搜索时, 地图应该滚回视野
                  scrollMapIntoView();
                  setSearchListOpen(true);
                }}
                onFocus={() => {
                  setSearchListOpen(true);
                  // 聚焦输入框时关掉之前的 popup — 用户进入"搜索模式", 不想看旧 label 详情
                  setSelectedLabel(null);
                }}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSearchListOpen(true);
                }}
                onKeyDown={(e) => {
                  // ESC 关闭整个搜索 (区别于 X 按钮只清空文字)
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setSearchVisible(false);
                  }
                }}
                placeholder="搜索建筑名称或机器产物"
                className="flex-1 min-w-0 px-2 text-[15px] text-slate-700 bg-transparent outline-none placeholder:text-slate-500/90"
              />
              {searchQuery.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    // 清空文字, list 也收起 (X 是"清空"动作, 不是单纯改字)
                    setSearchQuery("");
                    setSearchListOpen(false);
                    searchInputRef.current?.focus();
                  }}
                  aria-label="清空搜索"
                  className="w-6 h-6 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors"
                >
                  <IconX className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* 结果下拉 — searchVisible && searchListOpen && query 非空 才显示
                三重条件:
                  - searchVisible: 整个搜索 wrapper 开着
                  - searchListOpen: list 没被点地图收起
                  - query.trim(): 有实际内容
                wheel 事件 stopPropagation 防止滚轮缩地图 (list 内滚轮只滚 list) */}
            {searchListOpen && searchQuery.trim().length > 0 && (
              <SearchResults
                results={searchResults}
                worlds={worlds}
                listDraggingRef={listDraggingRef}
                onSelect={(label, wid) => {
                  // 点结果: 跳过去 + 弹 popup
                  // 搜索栏文字保持不变 (user 选择, 不清空 query, 让搜索栏干净)
                  // 收起 list + blur input (退出"输入"状态, 视觉上跟点地图一致)
                  goToSearchResult(label, wid);
                  setSearchListOpen(false);
                  searchInputRef.current?.blur();
                }}
              />
            )}
          </div>
        )}

        {/* 缩放百分比 — 右上角 */}
        <div className="absolute top-3 right-3 z-10 pointer-events-none">
          <div className="px-2 py-1 rounded-lg bg-white/80 border border-slate-200/80 text-[11px] sm:text-[15px] font-mono text-slate-600 shadow-sm tabular-nums">
            {Math.round(k * 100)}%
          </div>
        </div>

        {/* 右下: 放大 / 缩小 / 全屏 */}
        <div className="absolute bottom-3 right-3 z-10 flex flex-col gap-1.5">
          <ZoomBtn onClick={() => zoom(1.3)} ariaLabel="放大">
            <img src="/icons/map/tabs/放大图标.svg" alt="" className="w-4 h-4" />
          </ZoomBtn>
          <ZoomBtn onClick={() => zoom(1 / 1.3)} ariaLabel="缩小">
            <img src="/icons/map/tabs/缩小图标.svg" alt="" className="w-4 h-4" />
          </ZoomBtn>
          <ZoomBtn
            onClick={toggleFullscreen}
            ariaLabel={isFullscreen ? "退出全屏" : "进入全屏"}
          >
            {isFullscreen ? (
              <img src="/icons/map/tabs/还原图标.svg" alt="" className="w-4.5 h-4.5" />
            ) : (
              <img src="/icons/map/tabs/全屏图标.svg" alt="" className="w-4.5 h-4.5" />
            )}
          </ZoomBtn>
        </div>
      </div>

      {/* popup 改放到 map container 内 (顶部 absolute), 详见 LabelPopup 组件 */}
    </div>
  );
}

export default GuideMap;
