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
// 几何变换 + 预加载 cache (pure functions, 2026-09-17 从 guide-map.tsx 抽出来)
import {
  MAX_ZOOM,
  HIGH_RES_ZOOM_THRESHOLD,
  preloadImage,
  screenToVB,
  worldToVB,
  worldToScreenFactory,
  computePanTransform,
} from "@/lib/map/transforms";

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
        className="border-t border-slate-200 px-3 py-3 text-[13px] text-slate-400"
      >
        暂无搜索结果
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
    <div className="w-full bg-white/60 backdrop-blur-md border border-slate-200/85 rounded-t-2xl p-1.5 pl-3 flex flex-wrap items-center gap-x-2.5 shadow-sm shadow-slate-900/10">
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
              "px-3 sm:px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center text-center gap-1.5 cursor-pointer",
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
          "sm:ml-3.5",
          "px-2.5 py-2 rounded-xl text-[15px] sm:text-[17px] font-semibold",
          "transition-all flex items-center text-center gap-2 cursor-pointer",
          "text-slate-500 hover:text-slate-700 hover:bg-white/40",
        )}
      >
        {searchVisible ? (
          <img src="/icons/map/tabs/显示搜索图标.svg" alt="" className="w-4 h-4" />
        ) : (
          <img src="/icons/map/tabs/隐藏搜索图标.svg" alt="" className="w-4 h-4" />
        )}
        <span className="inline">
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
          "px-2.5 py-2 rounded-xl text-[15px] sm:text-[17px] font-semibold",
          "transition-all flex items-center gap-2 cursor-pointer",
          "text-slate-500 hover:text-slate-700 hover:bg-white/40",
        )}
      >
        {labelsVisible ? (
          <img src="/icons/map/tabs/显示地名图标.svg" alt="" className="w-4 h-4" />
        ) : (
          <img src="/icons/map/tabs/隐藏地名图标.svg" alt="" className="w-4 h-4" />
        )}
        <span className="inline">
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
          "px-2.5 py-2 rounded-xl text-[15px] sm:text-[17px] font-semibold",
          "transition-all flex items-center gap-2 cursor-pointer",
          "text-slate-500 hover:text-slate-700 hover:bg-white/40",
        )}
      >
        {transitVisible ? (
          <img src="/icons/map/tabs/显示交通图标.svg" alt="" className="w-4 h-4" />
        ) : (
          <img src="/icons/map/tabs/隐藏交通图标.svg" alt="" className="w-4 h-4" />
        )}
        <span className="inline">
          交通
        </span>
      </button>
    </div>
  );
}

/* ---- Overworld 高清瓦片 (IntersectionObserver 视口 lazy load) ----
 * SVG <image> 的 `loading="lazy"` 在各浏览器支持参差 (Chrome 早期 + Safari 限缩, Firefox 121+ 才稳定)
 * 实测: k=10 时 78 张全部 eager fetch (SVG 不走 viewport lazy)
 * 解法: 用 <image> 自身做 IO 观察, href 条件控制 fetch —
 *   - 初始 href=undefined, 浏览器看不到请求 URL 不发请求
 *   - IO 触发 isIntersecting=true → setInView(true)
 *   - href=t.src → 浏览器开始 fetch
 *   - onLoad → isLoaded=true → opacity 1 显示
 *   - sticky: isLoaded 后 href 保持, 缩小到 k<10 也保留
 *
 * isPanning gate (关键, 修点击 label 跳变的 leak):
 *   - 用户点 label → panToLandmark 瞬间 setK(16) (新 zoom) 但视觉还在 k=1
 *   - 这种情况下 useEffect 立刻跑 (k 变化触发), IO 也立刻附着, 78 张全 viewport
 *   - 必须 gate 掉 pan 期间的 IO, 等动画完再激活 — 利用已有的 isPanning state
 *
 * 早期版用单独的 <rect> 占位 + IO, 实测 fill="transparent" 的 <rect> 在某些浏览器
 * 不会被 IO 触发 (paint 不计入 layout tree). 用 <image> 自身做 target 稳定
 */
function OverworldTileImage({
  t,
  common,
  isLoaded,
  onLoad,
  shouldMountByZoom,
  isPanning,
}: {
  t: NewMapTile;
  common: Record<string, string | number>;
  isLoaded: boolean;
  onLoad: () => void;
  /** 当前 zoom 是否达到触发懒加载的阈值 (k >= HIGH_RES_ZOOM_THRESHOLD); sticky 时不再用 */
  shouldMountByZoom: boolean;
  /** "点 region 跳视角" 500ms 过渡中 — true 时不激活 IO, 避免 k 跳变期间全 fetch */
  isPanning: boolean;
}) {
  const [inView, setInView] = useState(false);
  const imageRef = useRef<SVGImageElement | null>(null);

  useEffect(() => {
    // 三种情况不激活 IO:
    // 1. k < 阈值 — 不该懒加载
    // 2. 已经加载完 — sticky 显示, 不需要再观察
    // 3. 正在 pan 过渡中 — k 跳变但视觉还在旧位置, 此时激活会误触发
    if (!shouldMountByZoom || isLoaded || isPanning) return;
    const node = imageRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true);
            observer.disconnect(); // 触发一次就够, 后续 sticky
            break;
          }
        }
      },
      { rootMargin: "500px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [shouldMountByZoom, isLoaded, isPanning]);

  // href 条件: 三种语义:
  //  - isLoaded=true → sticky, 始终显示 (包括 isPanning 期间, 用户已加载过的图不能丢)
  //  - isLoaded=false + !isPanning + inView → 浏览器 fetch
  //  - 其他 → undefined, 浏览器不发请求
  //
  // 关键: isPanning 只 gate "未加载"的图, 已加载的必须保留 href, 否则 pan 期间图会消失
  // (之前 isPanning && inView 都 false 时, href=undefined → 已加载的高清图也变成空白元素)
  const shouldSetHref = isLoaded || (!isPanning && inView);

  return shouldMountByZoom && t.src ? (
    <image
      ref={imageRef}
      href={shouldSetHref ? t.src : undefined}
      {...common}
      {...({ decoding: "async" } as Record<string, string>)}
      style={{ opacity: isLoaded ? 1 : 0 }}
      onLoad={onLoad}
    />
  ) : null;
}

/* ---- 缩放按钮 ---- */
function ZoomBtn({
  onClick,
  ariaLabel,
  disabled,
  children,
}: {
  onClick: React.MouseEventHandler<HTMLButtonElement>;
  ariaLabel: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={ariaLabel}
      disabled={disabled}
      className={cn(
        "w-9 h-9 rounded-lg bg-white/60 border border-slate-200/80 text-slate-600 hover:text-slate-800 hover:bg-slate-50 flex items-center justify-center shadow-sm transition-all",
        // 不可用: 半透明 + 取消 hover + 不可点击光标
        // (用户最新要求: 用户一眼能分辨按钮当前是否可操作)
        disabled && "opacity-50 hover:bg-white/60 hover:text-slate-600",
      )}
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
  pngLoaded,
  pngPainted,
  onPngLoaded,
}: {
  layer: NewMapLayer;
  tx: number;
  ty: number;
  k: number;
  isFullscreen: boolean;
  /** < sm (640px) 用 slice, 否则 meet. SSR 时默认 false (走 meet, 跟 server 一致) */
  isMobile: boolean;
  /** "点 region 跳视角"状态 — true 时 SVG g 挂 transition-transform 500ms,
   *  让点击 label 后的地图平移有平滑插值, 跟地标 label 同频道 */
  isPanning: boolean;
  /**
   * 地铁线 + 站点 (世界坐标 SVG) — 在 <g transform> 内部渲染, 跟着地图 transform 走
   *  - 不传就不渲染 (默认空)
   */
  transitInWorld?: () => ReactNode;
  /** 已加载完高清 webp 的 overworld tile key set — 这些 tile 永久显示高清 (sticky, 缩小也不切回)
   *  - parent 用 setState, React 18 自动 batch 同帧多个 onLoad (单 fetch wave)
   *  - 跨 wave 的 setState 各 render 一次, 但用 prev 引用比较, 重复 setState bail out
   *  - 78 个 tile 加载完实际最多 13 次 render (HTTP/1.1 ~6 并发, 13 wave)
   *  - nether/end 没 srcThumb, 此 prop 对它们无效 (走 showHires=true 分支) */
  pngLoaded: Set<string>;
  /** 高清已绘制 (晚 pngLoaded 一帧): 控制 thumb 何时消失 — 避免 thumb 消失瞬间 PNG 还没合成 */
  pngPainted: Set<string>;
  /** 高清 webp tile onLoad 后调用 → 把 tileKey 加进 pngLoaded set, 触发 render 切到高清 */
  onPngLoaded: (tileKey: string) => void;
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
        // "点 region 跳视角" 平移过渡 (用户要求保留): isPanning 时 500ms ease-in-out,
        //   跟地标 label / 地铁线同步; 用户拖拽/滚轮时无 transition, 保持直接手感
        className={isPanning ? "transition-transform duration-500 ease-in-out" : ""}
        style={{ pointerEvents: "none" }}
      >
        {/* 底层秒加载 sprite (256² q=60, 3328×1536, ~698KB, 1 个 HTTP 请求下完整张地图)
            - 用途: "看起来秒加载" 背景 — 用户进 /map 立即看到完整地图 (糊但能辨方向)
            - 上层 78 个 512² q=85 thumb 加载完后逐步盖住 sprite (透明度 0→1)
            - 缩到 1000% 高清 lossless 加载完再盖住 thumb (现有 thumb→hires 切换逻辑不变)
            - 仅 overworld 渲染: nether/end 没秒加载需求 (它们瓦片少, 现有 PNG 加载够快)
            - 浏览器对相同 URL 自动去重, 多个 <image href="..."> 不会重复 fetch — 此处只有 1 个
            - preserveAspectRatio="none" 让 sprite 拉伸到 viewBox 尺寸, 每格自动映射到对应位置
            - 排序: 13 列 × 6 行, 按 (col, row) 数值升序 (跟 loader.ts 一致), 即 (1,7) 在左上, (13,12) 在右下 */}
        {layer.tone === "plains" && (
          <image
            href="/images/maps/20260907/overworld-thumbs-fine-sprite.webp"
            x={0}
            y={0}
            width={layer.width}
            height={layer.height}
            preserveAspectRatio="none"
            style={{ opacity: 1 }}
          />
        )}
        {/* 瓦片双层渲染 (用户最新需求):
            - 高清 webp lossless (1024²) 在前 (z-order 底层) + thumb webp q=85 (512²) 在后 (z-order 上层)
            - 两个 <image> 永久 render, 用 opacity 切换, 不 remount
            - 高清懒加载触发条件 (k >= HIGH_RES_ZOOM_THRESHOLD = 10 = 1000%):
              - k < 10 & !已加载: 只渲染 thumb (高清 <image> 完全不挂载, 零网络请求)
              - k >= 10 | 已加载: 挂载高清 <image loading="lazy">, 浏览器视口接近时下载
            - sticky 高清 (用户要求 "大图替换完了缩小也不要切回缩略图"):
              - shouldRenderHires = k >= 阈值 || pngLoaded.has(tileKey)
              - 已加载的 tile 即使缩小到 k<10 也保留高清 <image> (sticky)
              - 已加载: 高清 opacity=1 (永久, pngLoaded 是 React setState 在 parent 持久)
            - nether/end 没 srcThumb (用户不要 overview, 它们直接显示 PNG):
              - showHires 永远 true (没 thumb 概念)
              - shouldRenderHires 永远 true (没 thumb gate, 直接显示 PNG)
              - 默认 k=1 立刻显示, 不需要 zoom 到 1000%
            - 接缝修复: 每张瓦片向左上各偏 1px, 尺寸 +2 = 1026 */}
        {layer.tiles.map((t) => {
          const tileKey = `${t.col}-${t.row}`;
          const common = {
            x: t.vbX - 1,
            y: t.vbY - 1,
            width: 1026,
            height: 1026,
            preserveAspectRatio: "xMidYMid meet",
          };
          const isLoaded = pngLoaded.has(tileKey);
          const isPainted = pngPainted.has(tileKey);
          // showHires 控 thumb 隐藏: 用 pngPainted (晚 pngLoaded 一帧) — 保证 PNG 真的合成后再藏 thumb
          //   - pngLoaded=true 后 opacity:1 但可能合成层没绘, 立刻 thumb opacity:0 → 背景闪一帧
          //   - pngPainted=true (rAF 后) 浏览器已经画过 PNG, 此时藏 thumb 安全
          const showHires = !t.srcThumb || isPainted;
          // shouldMountByZoom = zoom 是否达到触发阈值 (nether/end 永远 true — 它们没 thumb 不需要 lazy)
          //   - overworld: k >= HIGH_RES_ZOOM_THRESHOLD 才进入 lazy 流程
          //   - 已加载 (sticky): 也算 true, 让 <image> 元素保留挂载
          const shouldMountByZoom =
            !t.srcThumb || k >= HIGH_RES_ZOOM_THRESHOLD || isLoaded;
          return (
            <g key={tileKey}>
              {/* 底层 webp lossless (高清)
                  - overworld (有 thumb): OverworldTileImage 用 IntersectionObserver + 条件 href
                    - <image> 自身做 IO 观察 (不依赖占位 rect, 避免 fill=transparent 的 layout 排除)
                    - href=undefined 直到 IO 触发 → 浏览器不发请求 (零浪费)
                    - 视口内: href=t.src → 浏览器 fetch
                    - 加载完后 sticky: 即使缩小到 k<10 也保留挂载 (用户要求)
                    - isPanning 期间 (点 region 跳视角 500ms) 不激活 IO, 避免 k 跳变期间误触发
                  - nether/end (无 thumb): 直接挂载 <image>, eager load, 永远显示 (没 lazy 必要) */}
              {t.srcThumb ? (
                <OverworldTileImage
                  t={t}
                  common={common}
                  isLoaded={isLoaded}
                  shouldMountByZoom={shouldMountByZoom}
                  isPanning={isPanning}
                  onLoad={() => onPngLoaded(tileKey)}
                />
              ) : (
                t.src && (
                  <image
                    href={t.src}
                    {...common}
                    style={{ opacity: 1 }}
                  />
                )
              )}
              {/* 上层 webp (q=85 thumb, 512²) — overworld 秒显示; nether/end 没 thumb */}
              {t.srcThumb && (
                <image
                  href={t.srcThumb}
                  {...common}
                  {...({ loading: "eager" } as Record<string, string>)}
                  style={{
                    opacity: showHires ? 0 : 1,
                  }}
                />
              )}
            </g>
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
  // 地图 zoom/pan state + rAF 批处理 + commit/schedule 抽到 useMapZoom hook
  //   - tx/ty/k 三个 state + kRef/txRef/tyRef 同步 ref (event handler 不重挂载能读到最新值)
  //   - rafRef/pendingRef rAF 批处理 (commit/schedule 跟 guide-map 异步拖动同款)
  //   - 卸载自动 cancelAnimationFrame (跟 lightbox 的 useLightboxZoom 同款)
  // worldRef 留在主组件 — 切维度同步, 跟地图数据生命周期绑, 不是 zoom 状态
  const worldRef = useRef<NewWorldMeta | null>(null);
  const zoom = useMapZoom();
  const { tx, ty, k, setTx, setTy, setK, txRef, tyRef, kRef, schedule } = zoom;
  // commitImmediate 见下面 (跟 writeHover 一起调)

  // ---- 2b. overworld PNG 加载状态 — 决定 PNG/webp opacity 切换 ----
  // 用户需求 (最新):
  //   - thumbs (q=60 512×512 webp) 秒显示 → 用户先看到 webp
  //   - PNG 加载完成 → 切到 PNG, webp 永久隐藏 (sticky, 缩小不回切)
  //   - 加载模式: thumbs 必须最先加载 (用 fetchPriority='high' 预加载, 不然失去加载意义)
  //   - 只对 overworld 生效 (有 srcThumb 的 tile); nether/end 单 PNG 图不变
  // 实现:
  //   - pngLoaded Set 记录已加载的 overworld tile key (sticky, 不清空)
  //   - 78 个 tile 的 SVG <image> onLoad 各自 setState, 但 React 18 自动 batch:
  //     - 同帧多个 onLoad (HTTP/1.1 ~6 并发 fetch wave 内) → batch → 1 render
  //     - 跨帧多个 onLoad (不同 wave 间) → 各 1 render, 但用 prev 引用比较, 同引用 bail out
  //     - 实际: 78 个 tile 分 ~13 wave, 最多 13 次 render (vs 之前 78 次 setState 创建 78 个 Set)
  //   - 切维度时 pngLoaded 不重置 (粘性, 切回 overworld 仍是 PNG 状态)
  const [pngLoaded, setPngLoaded] = useState<Set<string>>(new Set());
  // 高清已绘制 (晚 pngLoaded 几帧): 控制 thumb 是否隐藏
  // 拆分目的: PNG opacity 跟 isLoaded 同步 (onLoad 后立刻 opacity=1), 但 thumb 必须等浏览器
  //   把 PNG 真正画完再隐藏, 否则 thumb 消失的瞬间 PNG 还没合成, 露出背景
  const [pngPainted, setPngPainted] = useState<Set<string>>(new Set());
  const onPngLoaded = useCallback((tileKey: string) => {
    setPngLoaded((prev) => {
      if (prev.has(tileKey)) return prev; // 同引用 → React bail out, 不 render
      const next = new Set(prev);
      next.add(tileKey);
      return next;
    });
    // 双保险 — 多张大图同时加载时 1 个 rAF 不够, 浏览器合成耗时跟图片数 / GPU 相关:
    //   - 2 个 rAF (快路径, 单图/双图常见情况, ~32ms 隐藏 thumb)
    //   - setTimeout 100ms (兜底, 6+ 张图同时加载时 GPU 还没合成完, 等久点保险)
    // setPngPainted 用 prev.has 幂等去重, 两个路径都触发也只会触发一次 render
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setPngPainted((prev) => {
          if (prev.has(tileKey)) return prev;
          const next = new Set(prev);
          next.add(tileKey);
          return next;
        });
      });
    });
    setTimeout(() => {
      setPngPainted((prev) => {
        if (prev.has(tileKey)) return prev;
        const next = new Set(prev);
        next.add(tileKey);
        return next;
      });
    }, 100);
  }, []);

  // ---- 2c. thumbs 预加载 — 移到 world useMemo 之后 (依赖 world) ----
  // 详见 world 声明后的 useEffect

  // ---- 3. 全屏 + 竖屏提示 + 视口宽度 (是否移动端) ----
  // isFullscreen + toggleFullscreen 在 useFullscreen hook (文件底部), 同文件内定义
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
  // 搜索 state 集中到 useSearchState hook (文件底部) — 包含 searchVisible/searchQuery/
  //   searchListOpen 三个 state + searchQueryRef/searchListOpenRef 同步 ref +
  //   searchInputRef/searchWrapperRef DOM refs + 切换 searchVisible 副作用
  const {
    searchVisible,
    setSearchVisible,
    searchQuery,
    setSearchQuery,
    searchListOpen,
    setSearchListOpen,
    searchInputRef,
    searchWrapperRef,
    searchQueryRef,
  } = useSearchState();
  // 当前打开 popup 的标签 — null = 没开
  // 装可弹窗的标签 — 激进改动后所有 NewLabel 都可能弹窗
  // (是否弹由 shouldShowPopup 决定: popup=true 或 有 images/description/inputs/outputs)
  // popup 位置固定在地图左上角, 不需要 anchor
  const [selectedLabel, setSelectedLabel] = useState<NewLabel | null>(null);
  // searchInputRef / searchWrapperRef 都在 useSearchState hook 内 (上面)
  // popup 根 ref — 让 map.onPointerDown 拦截 popup 子树内的 pointerdown
  //   - 用户要求: popup 内拖动 = 选中文字, 不能拖地图 (跟搜索框 input 同款)
  //   - parent 检查 popupRef.current?.contains(e.target), 命中就 return
  //   - popup 内 onMouseDown stopPropagation 是兜底 (防御 React 18 batched + stopPropagation 偶发不生效)
  const popupRef = useRef<HTMLDivElement | null>(null);
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

  // 搜索开关切换 effect 已搬到 useSearchState hook (内部)

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
    // setSearchListOpen 是 useState setter (稳定引用), 加入 deps 不会触发 re-run 但冗余
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // 标记"刚才这次 pointerdown → up 之间有没有真正拖动"
  //  - pointerup 后浏览器可能仍 fire click (小幅移动也算 click)
  //  - 用 wasDraggedRef 让 click handler 区分"纯点击" vs "拖动结束", 决定是否关 popup
  //  - 阈值 3px 跟 label/option drag-vs-click 一致, 避免手抖误判
  const wasDraggedRef = useRef(false);
  // 双指缩放标记 — onTouchStart (touches.length >= 2) 置 true, onTouchEnd (touches < 2) 置 false
  //   - onPointerDown 检查它: 双指期间不启动 map 单指 drag (用户要求 #1 双指不拖地图)
  const pinchActiveRef = useRef(false);
  // rafRef / pendingRef / commit / schedule 已在 useMapZoom hook 内部

  // ---- 5. 派生当前维度 ----
  const world = useMemo(
    () => worlds.find((w) => w.id === worldId) ?? worlds[0] ?? null,
    [worlds, worldId],
  );
  useEffect(() => {
    worldRef.current = world;
  }, [world]);

  // module-level Set: 跟踪已 preload 的 URL, 跨 mount/切维度不重复插入
//   - 不用 React state (state 不需要 re-render)
//   - 不用 useRef (ref 在 unmount 后被清空, 跨 mount 不保留)
//   - module-level 单例, 整个应用生命周期内跟踪
//   - 隐式副作用: 整个客户端 bundle 共享, 多 GuideMap 实例不重复
//   - 必须在 useEffect 之前声明 (ESLint no-use-before-define)
const preloadedUrls = new Set<string>();

// ---- 5b. thumbs 预加载 — 用 <link rel="preload"> 真 high-priority fetch ----
  // 用户要求: "确保 thumbs 最先加载, 不然失去加载意义"
  //
  // 之前用 new Image() + fetchPriority='high' 失败原因:
  //   - SVG <image> 在 React commit 后立即触发 fetch (low priority 默认)
  //   - useEffect 在 commit 之后跑, 第二次 fetch (new Image) 实际晚于 SVG image
  //   - 浏览器对相同 URL 的 second fetch 通常命中缓存, 但首次 fetch 已经在跑
  //
  // 现在用 <link rel="preload" as="image">:
  //   - 在 layout 阶段 hint 浏览器立即 high-priority fetch 这个 URL
  //   - 浏览器对 preloaded 资源 high priority 调度, SVG <image> 自然 fetch 时已被缓存
  //   - insert 到 document.head, cleanup 时移除 (避免组件 unmount 后残留)
  //   - 用 module-level Set 跟踪已插入 URL, 避免重复插入 (切维度回来时跳过已存在的)
  //
  // 注意: 只对有 srcThumb 的 tile 生效 (overworld); nether/end 跳过.
  // 切维度 (world.id 变) 时重新跑 — 切回 overworld 时也 prefetch 一遍
  //   (但 module-level Set 保证不重复插入 DOM)
  // 必须放在 world useMemo 之后 (依赖 world.map.tiles)

  /* eslint-disable react-hooks/immutability, react-hooks/exhaustive-deps -- module-level 单例 Set 是合理 LRU/cache 模式 (跨 mount 持久, 跨 GuideMap 实例共享), useEffect 修改它不算 anti-pattern */
  useEffect(() => {
    if (!world) return;
    const inserted = new Set<string>();
    for (const t of world.map.tiles) {
      if (!t.srcThumb) continue;
      if (preloadedUrls.has(t.srcThumb)) continue;
      const link = document.createElement("link");
      link.rel = "preload";
      link.as = "image";
      link.href = t.srcThumb;
      // fetchpriority 是 hint, 浏览器支持度高 (Chrome 102+, Firefox 间接支持)
      // 现代 TS lib.dom.d.ts 已支持 fetchPriority 属性, 无需 ts-expect-error
      link.fetchPriority = "high";
      document.head.appendChild(link);
      preloadedUrls.add(t.srcThumb);
      inserted.add(t.srcThumb);
    }
    return () => {
      // cleanup: 只移除本次 useEffect 跑时插入的 (避免误删其他 effect 的 link)
      for (const url of inserted) {
        const link = document.querySelector<HTMLLinkElement>(
          `link[rel="preload"][href="${url}"]`,
        );
        if (link?.parentNode) {
          link.parentNode.removeChild(link);
        }
        preloadedUrls.delete(url);
      }
    };
  }, [world]);

  /**
   * 切维度时是否跳过 "自动重置到中央 100%" — 搜索结果点击会自己 panToLandmark,
   * 此时 reset 一下会闪中央再跳过去, 难看。搜索调用 setWorldId 前先把这个 ref 置 true,
   * 切维度 effect 读到就跳过 reset, 只保留 scrollMapIntoView
   */
  const skipWorldResetRef = useRef(false);

  // ---- 全屏: state + 切换 + 退出滚地图位置 — 集中到 useFullscreen hook ----
  //   - 这里必须在 schedule 后, writeHoverCoordFromScreen 前:
  //     - schedule 后: hook 用 computeMapScrollTarget (hook 内部 useEffect 用, 不是同步读)
  //     - writeHoverCoordFromScreen 前: 该 useCallback 的 deps 包含 isFullscreen
  //   - hook 内部 useEffect 在 commit 后才跑, 此时 computeMapScrollTarget 已初始化
  const computeMapScrollTarget = useCallback((): number => {
    // 之前: 移动端 < 640 直接 return window.scrollY (no-op) — 注释说"用户手指控制滚动"
    //   - 现在: label 点击等操作需要跟桌面端一致滚到地图位置 (用户最新要求)
    //   - 桌面端 < 640 / >= 640 都按"地图贴 header 下"算 (offsetTop 累加 + 减 headerHeight)
    const el = rootRef.current;
    if (!el) return window.scrollY;
    const headerEl = document.querySelector<HTMLElement>("header.fixed.top-0");
    const headerHeight = headerEl ? headerEl.getBoundingClientRect().height : 0;
    const TOP_GAP = window.innerWidth >= 640 ? 8 : 14;
    // 累加 offsetTop 算地图到 page 顶部的 naturalTop, 减去 header + gap
    let top = 0;
    let node: HTMLElement | null = el;
    while (node && node !== document.body) {
      top += node.offsetTop;
      node = node.offsetParent as HTMLElement | null;
    }
    return Math.max(0, top - headerHeight - TOP_GAP);
  }, []);
  const { isFullscreen, toggleFullscreen } = useFullscreen({
    containerRef,
    computeMapScrollTarget,
  });

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
    zoom.commitImmediate(nextTx, nextTy, nextK);
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
    // kRef/txRef/tyRef 是 refs (不变引用 + 读 .current 取最新值), 不放 deps 是正确的
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
  // 计算"地图贴 header 下沿"的目标 scrollY 已搬到 useFullscreen hook 调用前
  // (见上面 schedule 后, writeHoverCoordFromScreen 前)

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
      // commitImmediate 内部已经 cancel rAF + 清 pendingRef, 同步更新 ref + setState
      commitImmediate(finalTx, finalTy, finalT.k);

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
    // commitImmediate / setK / setTx / setTy 都是 useMapZoom 暴露的稳定引用
    //   - useState setter 和 useCallback 引用稳定, 加 deps 是冗余
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
    // commitImmediate 是 useMapZoom 暴露的 useCallback, 引用稳定
  }, [worldId, scrollMapIntoView]);

  // 全屏 + 滚地图逻辑已搬到 useFullscreen hook (上面 scrollMapIntoView 之后调)

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
    // kRef/txRef/tyRef/searchQueryRef 是 refs, setSearchListOpen 是 useState setter
    //   - 加进 deps 会让 callback 在 ref 变化时重建 (但 ref 引用不变, 永远不会)
    //   - 或者让 callback 在 setter 引用变化时重建 (useState setter 永远不变)
    //   - 当前 deps 是真实依赖 (schedule 等会变化的 useCallback), 保留
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

    // native pointerdown capture listener — 比 React 合成 onPointerDown 早跑 (W3C event flow),
    //   能读 e.touches.length 提前判断双指. 解决 React 合成 pointer event 不暴露 touches 的限制,
    //   避免 pinchActiveRef 在 touchstart 才设置导致的 race (问题 #2 修).
    //   touchstart 里也设 pinchActiveRef=true 是双保险 (幂等)
    const onPointerDownCapture = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      // PointerEvent 类型上没 touches 属性 (TS lib.dom), 但实际浏览器 (Chrome/Firefox)
      // 在 touch pointerType 时会带 touches. 用类型断言 + 可选链防御:
      //   - 非触摸设备 (mouse/pen) touches 是 undefined, 跳过
      //   - 触摸设备但只有 1 指 (单指 tap) touches.length === 1, 跳过
      const touches = (e as PointerEvent & { touches?: TouchList }).touches;
      if (touches && touches.length >= 2) {
        pinchActiveRef.current = true;
      }
    };
    el.addEventListener("pointerdown", onPointerDownCapture, { capture: true });

    const onTouchStart = (e: TouchEvent) => {
      // 在 lightbox 打开时跳过 (用户要求 #2: lightbox 双指缩放不泄漏到地图)
      //   - lightbox 在 map container DOM 内, touch 事件按 target 触发不会冒泡,
      //     但 lightbox 内 touchstart 也会触发 map 这个 listener
      //   - 检查 target 在 dialog 内就 return
      const target = e.target as Element | null;
      if (target?.closest('[role="dialog"][aria-modal="true"]')) return;
      if (e.touches.length !== 2) return;
      e.preventDefault();
      // 双指期间标记 pinchActive, onPointerDown 看到后不启动单指 drag (用户要求 #1)
      //   - 实际上 capture-phase native pointerdown 已经设过, 这里是双保险 (幂等)
      pinchActiveRef.current = true;
      // **关键**: 双指 down 时, 第一个指已经触发了 onPointerDown → setPointerCapture + dragRef 启动
      //   - 立刻把 dragRef 设为 null 取消单指 drag (onPointerMove 检测 dragRef null 提前 return)
      //   - 解决竖屏/全屏 "双指识别成拖动" 的根因 (用户最新要求 #4)
      //   - 单指 tap 不会触发双指分支, 不影响单指 drag
      dragRef.current = null;
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      if (!t1 || !t2) return;
      pinchInitialDistance = Math.hypot(
        t2.clientX - t1.clientX,
        t2.clientY - t1.clientY,
      );
    };

    const onTouchMove = (e: TouchEvent) => {
      // 在 lightbox 打开时跳过 (用户要求 #2: lightbox 双指缩放不泄漏到地图)
      const target = e.target as Element | null;
      if (target?.closest('[role="dialog"][aria-modal="true"]')) return;
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
      // 灵敏度调整: 用户最新要求 — 双指缩放太灵敏, 改成现在的 50%
      //   - Math.pow(ratio, 0.5): sqrt 映射 — 比 0.6 还迟钝
      //   - 距离拉大 2 倍 → 缩放 ~1.4x (而不是 2x), 拉大 4 倍 → 缩放 2.0x (而不是 4x)
      //   - ratio=1 时 unchanged; ratio>1 时变缓; ratio<1 时也变缓 (反向)
      const adjustedRatio = Math.pow(ratio, 0.5);
      const newK = clamp(kRef.current * adjustedRatio, 1, maxK);
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
        pinchActiveRef.current = false;
      }
    };

    el.addEventListener("pointerdown", onPointerDownCapture, { capture: true });
    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    return () => {
      el.removeEventListener("pointerdown", onPointerDownCapture, { capture: true });
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
    // kRef/txRef/tyRef 是 refs, 不放 deps 是正确的 (引用稳定 + 读 .current 取最新值)
  }, [schedule, writeHoverCoordFromScreen, isFullscreen]);

  const onPointerDown = (e: React.PointerEvent) => {
    // 新一轮 pointer down — 重置 drag 标记 (上轮 drag 状态不能影响这轮 click)
    wasDraggedRef.current = false;
    // 在搜索 wrapper 子树内 (input / list / icon / padding) pointerdown 不触发地图 drag
    //   - bug 4 修: 用户在 input 内 pointerdown 想选文字/复制, 之前会拖动地图
    //   - 不调用 setPointerCapture → 浏览器默认 input 文字 selection 正常工作
    //   - 不调 dragRef.current = {...} → onPointerMove 检测 dragRef=null 提前 return
    //   - 列表 option button / X 按钮 是 <button>, closest("button") 也能拦住, 但 input 不是 button
    //     必须用 searchWrapperRef.contains 兜底
    if (searchWrapperRef.current?.contains(e.target as Node)) return;
    // 在 popup 子树内 pointerdown 不触发地图 drag — 用户在 popup 内拖动应该选中文字
    //   - 跟搜索 wrapper 同套思路: 不调 setPointerCapture → 浏览器默认 text selection 工作
    //   - 不调 dragRef.current = {...} → onPointerMove 检测 dragRef=null 提前 return
    //   - popup 内 onMouseDown stopPropagation 是 React 18 合成事件兜底, 但 pointerdown 是 native
    //     event 会冒泡到 map, 必须靠 ref.contains 检查显式拦截
    if (popupRef.current?.contains(e.target as Node)) return;
    if ((e.target as HTMLElement).closest("button")) return;
    // lightbox 打开时, map 内的 pointerdown 不响应 (lightbox 接管拖动)
    //   - 阻止用户拖动 lightbox 图片时, 地图同时跟着拖 (双触发)
    //   - lightbox 在 map container 内 (DOM 嵌套), React 事件会冒泡到 map
    if ((e.target as HTMLElement | null)?.closest('[role="dialog"][aria-modal="true"]')) return;
    // 双指缩放期间不启动单指 drag — 用户要求 #1: 双指 zoom 不带单指 pan
    //   - 第二个指 down 时 pinchActiveRef 已经 true (native pointerdown capture 先跑), 此处 return
    //   - 第一个指 down 时 pinchActiveRef 还是 false (touches.length === 1) → 启动 drag
    //     但 onTouchStart 检测到 touches.length === 2 会立刻 dragRef = null 取消
    //   - 双保险: capture listener + onTouchStart 双重取消
    if (e.pointerType === "touch" && pinchActiveRef.current) return;
    // 移动端 single touch 启动 drag — 用户最新要求 #1: 地图要能单指拖动 (之前 #4 的限制删了)
    //   - 单指 drag 地图 vs 浏览器 page scroll 不能并存, 用户现在优先 map drag
    //   - 双指缩放时第一个指 drag 会被 onTouchStart 双指检测 cancel (dragRef = null)
    //   - page scroll 仍可通过浏览器原生手势条 (上/下拉刷新等) 或系统级手势
    //   - popup / search wrapper / lightbox 内的 pointerdown 已在上方早 return, 不影响
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
    // 检测本次 pointer 是否真的"拖动"了 (移动距离 > 3px) — 标记给 click handler 用
    //   - 用户要求: 拖动结束后不关闭 popup, 但 click 仍会 fire (浏览器对小幅移动也派 click)
    //   - 没有这个标记, 用户稍微拖动一下也会触发 click → 关 popup
    if (
      !wasDraggedRef.current &&
      Math.hypot(
        e.clientX - dragRef.current.x,
        e.clientY - dragRef.current.y,
      ) > 3
    ) {
      wasDraggedRef.current = true;
    }
    const rect = el.getBoundingClientRect();
    const w = worldRef.current;
    if (!w) return;
    const { width: vbW, height: vbH } = w.map;
    // PAN_SPEED: 桌面 2 (跟手指移动 1:2 同步), 移动端 2 * 0.75 = 1.5 (用户最新要求 — 拖动更迟钝)
    //   - 0.5 次幂缩放更迟钝, drag 也跟着调成 0.75x, 否则用户两根指头分别 zoom 和 pan 比例失衡
    //   - 用 isMobile state (从 useMediaQuery 拿) 桌面端不受影响
    const PAN_SPEED = isMobile ? 2 * 0.75 : 2;
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

  const zoomByButton = (factor: number) => {
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
    schedule(cTx, cTy, newK);
    // 按钮缩放后滚到中央 (避开 header)
    scrollMapIntoView();
  };

  // 退出全屏同步滚到地图位置 (跟 scrollMapIntoView 一致) — 不用 savedScrollYRef 了
//   - 之前版本保存用户的 scrollY 然后恢复 — 但如果用户原本不在地图位置, 恢复后就不贴 header
//   - 用户期望: "和地图滚动一样" = 跟点击搜索框触发的一致, 地图顶部贴 header 下沿
//   - 无论用户原本 scrollY 在哪, 退出都到目标位置 (用 computeMapScrollTarget 算)
// 全屏 + 滚地图逻辑已搬到 useFullscreen hook (上面 scrollMapIntoView 之后调)

  /**
   * 预加载整个维度的瓦片 (跟 guide-map 思路一致: 切维度时已经 cache 好, 0 滞留)
   * - 这里不只预加载"主图", 整个维度的所有瓦片都拉 (反正切过去就要全部显示)
   * - overworld 预加载 srcThumb (q=75 webp, 切过去秒显示); PNG 由 image onLoad 后台 fetch
   * - nether/end 没 srcThumb, 永远预加载 src
   * - 注意: 这个函数只用于"切维度前预热另一维度", 当前维度 MapCanvas 渲染时 SVG <image>
   *   会自动 fetch, 不依赖这里
   */
  const preloadWorld = useCallback((id: NewWorldId) => {
    const w = worlds.find((x) => x.id === id);
    if (!w) return;
    for (const t of w.map.tiles) {
      const href = t.srcThumb ?? t.src;
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
            // 关闭分支: 在 setState 同步阶段清掉 query + 收起 list (避免下次开启残留)
            //   - 不能放 useEffect 里 (同步 setState 规则会报)
            //   - React 18+ 自动批处理把 3 个 setState 合并到一次 render
            if (searchVisible) {
              setSearchQuery("");
              setSearchListOpen(false);
            }
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
            <span data-x className="text-slate-700">-</span>
            <span className="text-slate-500 ml-2">z</span>
            <span data-z className="text-slate-700">-</span>
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
          // 用户在 popup 内拖动选文字 — 不要被 click 误关 popup
          //   - popup.onClick 已被去掉 stopPropagation (用户要求点击 popup 关 popup)
          //   - 但拖动选文字时, 浏览器派发 click, 也冒泡到 map.onClick
          //   - 跟地图拖动共用 wasDraggedRef 不够: popupRef 拦截了 onPointerDown,
          //     onPointerMove 没运行, wasDraggedRef 一直是 false
          //   - 改用 selection API 判断: 用户真的选了文字 (selection.toString 非空) → 跳关 popup
          //   - 只检查 popup 内点击 (有 popupRef.contains); 地图拖动仍走 wasDraggedRef
          const inPopup = popupRef.current?.contains(target) ?? false;
          const hasTextSelection =
            inPopup && (window.getSelection()?.toString().length ?? 0) > 0;
          if (hasTextSelection) {
            setSearchListOpen(false);
            return;
          }
          // 拖动结束后不关闭 popup — 用户在拖动时点选了某个 label, 想继续看详情同时平移地图探索周边
          //   - 浏览器对小幅移动 (< 3px) 也会派发 click event, 不能简单靠 click 区分
          //   - 用 wasDraggedRef 在 pointermove > 3px 时标记, click handler 检查后跳关 popup
          //   - list 还是收, 因为拖地图明显不是搜索模式了
          if (wasDraggedRef.current) {
            wasDraggedRef.current = false;
            setSearchListOpen(false);
            return;
          }
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
          pngLoaded={pngLoaded}
          pngPainted={pngPainted}
          onPngLoaded={onPngLoaded}
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
          onSelect={(label) => {
            setSelectedLabel(label);
            // 用户最新要求 #6: 移动端点 label 后, 地图滚到跟网页端一样的位置
            //   - 网页端: scrollMapIntoView 把地图滚到 header 下沿 (computeMapScrollTarget)
            //   - 移动端: 之前没调, 用户在地图外 scroll 后点 label, 看不到地图变化 (popup 显示但地图仍在视野外)
            //   - 现在跟 toggle 按钮 / 搜索框 onClick 行为一致 — 都滚到 header 下
            //   - 跟 panToLandmark 不同: 这里**不动**地图视图 (tx/ty/k 不变), 只滚 page scroll
            //     panToLandmark 会跳到 label 位置, 但用户没要求跳; 只要 page scroll 到地图位置
            scrollMapIntoView();
          }}
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
            topOffset={searchVisible ? 70 : 16}
            rootRef={popupRef}
            isFullscreen={isFullscreen}
            isMobile={isMobile}
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
              "absolute top-4 inset-x-4 z-[60]",
              // 宽度策略 — 用户要求 #3: 竖屏直接计算, 左右到地图边框距离一致
              //   - 用 inset-x-4 (left: 16px + right: 16px), 让 left 和 right 都固定 16px,
              //     浏览器自动算 width = container_width - 32px, 跟地图左右边框对齐
              //   - max-w 限制最大宽度, 避免大屏搜索栏太宽 (之前用 w-72 在 360px viewport 上
              //     right = 360-288-16 = 56px, 跟 left=16 不对齐)
              //   - 全屏时: 同样 inset-x-4, max-w 限制 280-360px
              //   - 注意: 不要混用 "left-4 + w-XXX" — w 会让 right 由 width 推导, 跟 left-4 不一致
              isFullscreen
                ? "max-w-[max(280px,min(25vw,360px))]"
                : "max-w-[calc(100vw-32px)] sm:max-w-[clamp(240px,calc(100vw-32px),280px)] lg:max-w-sm",
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
                    // 清掉 query + 收起 list — 跟 toggle 关闭分支同款
                    setSearchQuery("");
                    setSearchListOpen(false);
                    setSearchVisible(false);
                  }
                }}
                placeholder="搜索建筑名称或机器产物"
                className="flex-1 min-w-0 px-2 text-[15px] text-slate-700 bg-transparent outline-none placeholder:text-slate-400"
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

        {/* 缩放百分比 — 右上角
            - sm 以上 (!isMobile): 永远显示 — 用户要求"sm断点以上就显示"
              sm 以上右侧空间足够 (>= 640px), 跟搜索栏 (左上) 不重叠
            - sm 以下 + 搜索关闭 (!searchVisible): 显示 (sm 以下靠的是右侧空间够)
            - sm 以下 + 搜索开启 (searchVisible): 不显示 — 用户要求"开启搜索就不显示",
              sm 以下右侧空间被搜索框挤压, 百分比跟搜索结果重叠
            - 全屏 (isFullscreen): 永远显示 (覆盖以上所有条件, 优先级最高)
              全屏下右上空间足够, 跟搜索栏 (左上) 不重叠 */}
        {(!isMobile || !searchVisible || isFullscreen) && (
          <div className="absolute top-3 right-3 z-10 pointer-events-none">
            <div className="px-2 py-1 rounded-lg bg-white/80 border border-slate-200/80 text-[11px] sm:text-[15px] font-mono text-slate-600 shadow-sm tabular-nums">
              {Math.round(k * 100)}%
            </div>
          </div>
        )}

        {/* 右下: 放大 / 缩小 / 全屏 (一直显示, 跟缩放百分比独立) */}
        <div className="absolute bottom-3 right-3 z-10 flex flex-col gap-1.5">
          {/* 放大不可用 = 已到当前维度 max zoom (跟 zoomByButton clamp 一致)
              用 0.01 epsilon 吸收浮点累计误差, 跟 zoomByButton 内 clamp 同精度 */}
          <ZoomBtn
            onClick={() => zoomByButton(1.3)}
            ariaLabel="放大"
            disabled={k >= (MAX_ZOOM[worldId] ?? 8) - 0.01}
          >
            <img src="/icons/map/tabs/放大图标.svg" alt="" className="w-4 h-4" />
          </ZoomBtn>
          <ZoomBtn
            onClick={() => zoomByButton(1 / 1.3)}
            ariaLabel="缩小"
            disabled={k <= 1 + 0.01}
          >
            <img src="/icons/map/tabs/缩小图标.svg" alt="" className="w-4 h-4" />
          </ZoomBtn>
          <ZoomBtn
            onClick={(e) => {
              // 不让 click 冒泡到 map.onClick 关 popup (用户要求: 全屏前后 popup 保留)
              e.stopPropagation();
              toggleFullscreen();
            }}
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

/* ============================== Hooks ============================== */

/**
 * 全屏状态 + 切换 + 退出时滚动恢复
 * - 集中管理 isFullscreen state + fullscreenchange listener + prevFullscreenRef 兜底
 * - 退出全屏同步滚到地图位置 (跟 scrollMapIntoView 同算法), 用 instant 行为避免
 *   smooth 动画期间浏览器 paint scrollY=0 中间帧 (用户报告的 "tab 闪一下")
 * - prevFullscreenRef 兜底 useEffect: listener 必然触发但保留 effect 补救 race condition
 *   真实浏览器中 listener 先跑 (synchronous), effect 后跑 (async) — 两个都触发
 *   是无害的 (scrollTo 同位置 = noop)
 * - toggleFullscreen: 优先尝试 containerRef.current, 失败 fallback 到 documentElement
 *   (iOS Safari 某些情况只支持 document 全屏)
 *
 * 返回 { isFullscreen, toggleFullscreen }
 */
function useFullscreen(opts: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  computeMapScrollTarget: () => number;
}) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { containerRef, computeMapScrollTarget } = opts;

  const toggleFullscreen = useCallback(() => {
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
  }, [containerRef]);

  // 主路径: fullscreenchange listener — 退出时同步滚到地图位置
  //   - fullscreenchange 是同步事件, 在 listener 回调里直接 scrollTo, 浏览器还没 paint 中间帧
  //   - 用 computeMapScrollTarget 计算目标位置 (跟点击搜索框触发的滚动一致)
  useEffect(() => {
    const onChange = () => {
      const isNowFs = !!document.fullscreenElement;
      setIsFullscreen(isNowFs);
      if (!isNowFs) {
        window.scrollTo(0, computeMapScrollTarget());
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [computeMapScrollTarget]);

  // 兜底: prevFullscreenRef 守护, 只在 true → false 转移时跑
  //   - 真实浏览器中 listener 必然 fire, 保留 effect 是为 race condition 兜底
  //   - 两个 scrollTo 同位置 = noop, 无副作用
  //   - 防止 mount 时 isFullscreen=false 触发 (prevFullscreenRef 初值 = current, 不转移)
  const prevFullscreenRef = useRef(isFullscreen);
  useEffect(() => {
    const wasFullscreen = prevFullscreenRef.current;
    prevFullscreenRef.current = isFullscreen;
    if (wasFullscreen && !isFullscreen) {
      window.scrollTo(0, computeMapScrollTarget());
    }
  }, [isFullscreen, computeMapScrollTarget]);

  return { isFullscreen, toggleFullscreen };
}

/**
 * 搜索 state 集中管理
 * - searchVisible / searchQuery / searchListOpen 三个核心 state
 * - searchInputRef / searchWrapperRef DOM refs
 * - searchQueryRef / searchListOpenRef 同步 ref (event handler 读最新值, 不触发 re-render)
 * - searchVisible toggle effect:
 *   - 开启 → requestAnimationFrame 等 DOM commit 后 focus input
 *     (React 18 自动批处理 — ref 未挂载就 focus 会失败)
 *   - 关闭 → 清空 query + 收起 list (避免下次开启时残留旧关键词/旧展开态)
 *   - 首次挂载 (searchVisible=true 默认全开): 跳过副作用, 不抢焦点
 *     (避免页面加载时移动端自动弹键盘, 也不抢视觉重心)
 *
 * 返回:
 *   state + setters: searchVisible/setSearchVisible, searchQuery/setSearchQuery,
 *                    searchListOpen/setSearchListOpen
 *   DOM refs: searchInputRef, searchWrapperRef
 *   同步 refs (event handler 用): searchQueryRef, searchListOpenRef
 */
function useSearchState() {
  const [searchVisible, setSearchVisible] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchListOpen, setSearchListOpen] = useState(false);
  // DOM refs — input / wrapper
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchWrapperRef = useRef<HTMLDivElement | null>(null);
  // 同步 refs — wheel / pointerdown handler 不重新挂载也能读到最新值
  // (closure 捕获, 但 wheel handler 在 useEffect [deps] 内, deps 不变就不重跑)
  const searchQueryRef = useRef(searchQuery);
  useEffect(() => {
    searchQueryRef.current = searchQuery;
  }, [searchQuery]);
  const searchListOpenRef = useRef(searchListOpen);
  useEffect(() => {
    searchListOpenRef.current = searchListOpen;
  }, [searchListOpen]);
  // 切换 searchVisible 副作用: 开启 focus input, 关闭清空 query + 收 list
  //   - 首次挂载跳过 (searchVisible 初始 true 跟 prevSearchVisibleRef 初值相同)
  //   - StrictMode 双挂载也安全 (prevSearchVisibleRef 用 ref 跟踪上次值)
  const prevSearchVisibleRef = useRef(searchVisible);
  useEffect(() => {
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
    }
    // 关闭搜索时清空 query + 收起 list 的清理, 不在这里做 —
    //   - 写在 effect 里 setState 会触发 cascading-render 规则 error
    //   - 改为在两个关闭点直接调 setSearchQuery("") + setSearchListOpen(false),
    //     React 18+ 自动批处理合并到一次 render, 行为完全等价
    //   - 关闭点: 1680 (toggle 关闭) / 1938 (ESC 关闭)
  }, [searchVisible]);
  return {
    searchVisible,
    setSearchVisible,
    searchQuery,
    setSearchQuery,
    searchListOpen,
    setSearchListOpen,
    searchInputRef,
    searchWrapperRef,
    searchQueryRef,
    searchListOpenRef,
  };
}

/**
 * 地图 zoom/pan state machine + rAF 批处理
 * - tx/ty/k 三元组 + kRef/txRef/tyRef 同步 ref (event handler 读最新值不重挂载)
 * - rafRef/pendingRef rAF 批处理 — wheel/drag/pinch 高频事件只 commit 一次
 * - commit/schedule 是跟 guide-map 异步拖动同款 (commit 用 setState, schedule 累积 + rAF 触发)
 * - 卸载自动 cancelAnimationFrame
 *
 * 返回:
 *   state + setters: tx/setTx, ty/setTy, k/setK
 *   同步 refs (event handler 用): txRef, tyRef, kRef
 *   rAF 操作: schedule(tx, ty, k), commit (内部用)
 */
function useMapZoom() {
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [k, setK] = useState(1);
  // 同步 refs — wheel/drag/pinch event handler 不重新挂载也能读到最新值
  //   (useEffect 同步, deps 是 state 本身, 引用稳定)
  const txRef = useRef(0);
  const tyRef = useRef(0);
  const kRef = useRef(1);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<{ tx: number; ty: number; k: number } | null>(null);

  useEffect(() => {
    txRef.current = tx;
  }, [tx]);
  useEffect(() => {
    tyRef.current = ty;
  }, [ty]);
  useEffect(() => {
    kRef.current = k;
  }, [k]);

  // rAF 提交 (跟 guide-map 异步拖动同款)
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
    (nextTx: number, nextTy: number, nextK: number) => {
      pendingRef.current = { tx: nextTx, ty: nextTy, k: nextK };
      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(commit);
      }
    },
    [commit],
  );
  // 同步提交 (按钮 zoom / 点地标 / 切维度用) — 跟 schedule 不同, 不走 rAF 批处理
  //   - schedule 把状态写到 pendingRef 等下一帧 commit, 期间 ref 跟 state 不一致
  //   - commitImmediate 直接 setState + 同步 ref, 保证 hook 内部 + 外部立即一致
  //   - 适用: 按钮 zoom 后立刻写 hover coord (ref 已是新值), 点地标 pan 后立刻再 hover
  //   - 不走 rAF 也避免 schedule 半完成的 pendingRef 覆盖新状态
  const commitImmediate = useCallback(
    (nextTx: number, nextTy: number, nextK: number) => {
      // 先取消可能挂起的 rAF, 防止半完成的 schedule 覆盖我们刚 commit 的新值
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
    },
    [],
  );

  // 卸载清理 rAF
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  return {
    tx,
    ty,
    k,
    setTx,
    setTy,
    setK,
    txRef,
    tyRef,
    kRef,
    schedule,
    commit,
    commitImmediate,
  };
}
