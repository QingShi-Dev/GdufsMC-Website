/**
 * 地铁 / 交通网络 overlay — 拆成 2 个子组件
 *
 *  1. TransitLines (SVG, 进 <g>) — 线路, viewBox 坐标
 *     - 放在 GuideMap 那个 <g transform="translate(tx,ty) scale(k)"> 里面
 *     - 用 vector-effect: non-scaling-stroke 让线宽在屏幕像素空间
 *     - z-order: 按 number 倒序排, 小号线画在后面 (上面)
 *  2. TransitStations (HTML, 走 toScreen) — 站点 (圆 / 胶囊), 屏幕坐标
 *     - 大小用 CSS px, cssScaled 公式
 *
 * 站名/珍珠站已完全移到地标系统 (NewLabel, 配 visibleWhen: "transit"),
 * 这里不再渲染站名文字, 只画站点图标。
 *
 * 线端 label (大数字方型) 在 GuideMap 里直接渲染 (不走 transit overlay),
 * 因为它跟地标一样是 HTML 屏幕坐标 + 走 toScreen。
 */
"use client";

import type {
  NewLine,
  NewTransitStation,
  NewTransitStyleDefaults,
  NewTransitLabelConfig,
  NewPearlLine,
} from "@/lib/map/transit";
import {
  TRANSIT_STATION_MIN_ZOOM,
  TRANSIT_PEARL_MIN_ZOOM,
} from "@/lib/map/transit";

/* ============================== Scale Helpers ============================== */

function cssScaled(base: number, scale: number, k: number): number {
  return base * Math.pow(k, scale);
}

function pick<T>(
  withLM: T | undefined,
  main: T | undefined,
  fallback: T,
  useLandmarks: boolean,
): T {
  if (useLandmarks && withLM !== undefined) return withLM;
  if (main !== undefined) return main;
  return fallback;
}

/* ============================== Path ============================== */

function buildSmoothPath(
  points: { x: number; y: number }[],
  cornerRadius: number,
): string {
  if (points.length < 2) return "";
  const p0 = points[0]!;
  if (points.length === 2) {
    const p1 = points[1]!;
    return `M ${p0.x.toFixed(1)} ${p0.y.toFixed(1)} L ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
  }
  const parts: string[] = [];
  parts.push(`M ${p0.x.toFixed(1)} ${p0.y.toFixed(1)}`);

  for (let i = 1; i < points.length; i++) {
    const cur = points[i]!;
    if (i === points.length - 1) {
      parts.push(`L ${cur.x.toFixed(1)} ${cur.y.toFixed(1)}`);
      continue;
    }
    const prev = points[i - 1]!;
    const next = points[i + 1]!;
    const v1x = cur.x - prev.x;
    const v1y = cur.y - prev.y;
    const v2x = next.x - cur.x;
    const v2y = next.y - cur.y;
    const len1 = Math.hypot(v1x, v1y);
    const len2 = Math.hypot(v2x, v2y);
    if (len1 < 1 || len2 < 1) {
      parts.push(`L ${cur.x.toFixed(1)} ${cur.y.toFixed(1)}`);
      continue;
    }
    const cosA = (v1x * v2x + v1y * v2y) / (len1 * len2);
    if (cosA < -0.9) {
      parts.push(`L ${cur.x.toFixed(1)} ${cur.y.toFixed(1)}`);
      continue;
    }
    const d1 = Math.min(cornerRadius, len1 * 0.4);
    const d2 = Math.min(cornerRadius, len2 * 0.4);
    const tInX = cur.x - (v1x / len1) * d1;
    const tInY = cur.y - (v1y / len1) * d1;
    const tOutX = cur.x + (v2x / len2) * d2;
    const tOutY = cur.y + (v2y / len2) * d2;
    parts.push(`L ${tInX.toFixed(1)} ${tInY.toFixed(1)}`);
    parts.push(`Q ${cur.x.toFixed(1)} ${cur.y.toFixed(1)} ${tOutX.toFixed(1)} ${tOutY.toFixed(1)}`);
  }
  return parts.join(" ");
}

/* ============================== Lines (SVG, 进 <g>) ============================== */

export interface TransitLinesProps {
  lines: NewLine[];
  k: number;
  toVB: (worldX: number, worldZ: number) => { vx: number; vy: number } | null;
  defaults?: NewTransitStyleDefaults;
}

function LineSVG({
  line,
  k,
  toVB,
  defaults,
}: {
  line: NewLine;
  k: number;
  toVB: (worldX: number, worldZ: number) => { vx: number; vy: number } | null;
  defaults?: NewTransitStyleDefaults;
}) {
  const vbPoints: { x: number; y: number }[] = [];
  for (const wp of line.waypoints) {
    const v = toVB(wp.x, wp.z);
    if (v) vbPoints.push({ x: v.vx, y: v.vy });
  }
  if (vbPoints.length < 2) return null;
  const baseW = line.style?.width ?? defaults?.lineWidth ?? 1.5;
  const scaleW = line.style?.widthScale ?? defaults?.lineWidthScale ?? 0.7;
  const maxW = line.style?.widthMax ?? defaults?.lineWidthMax;
  const wRaw = cssScaled(baseW, scaleW, k);
  const w = maxW !== undefined ? Math.min(wRaw, maxW) : wRaw;
  const crW = line.style?.cornerRadius ?? defaults?.lineCornerRadius ?? 200;
  const crScale =
    line.style?.cornerRadiusScale ?? defaults?.lineCornerRadiusScale ?? 0.3;
  const crVBRadius =
    crScale === 0
      ? crW / k
      : crW * Math.pow(k, crScale - 1);
  const d = buildSmoothPath(vbPoints, crVBRadius);
  return (
    <g key={line.id}>
      {/* 白色外描边 (1.5px 屏幕恒定) */}
      <path
        d={d}
        stroke="white"
        strokeWidth={w + 1.5}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.9}
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={d}
        stroke={line.color}
        strokeWidth={w}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}

export function TransitLines({ lines, k, toVB, defaults }: TransitLinesProps) {
  // z-order: 渲染时按 number 倒序排, 小号线画在后面 (上面)
  //   - 用户反馈 "1号线在2号线上面", 1号线 number=1, 2号线 number=2, 倒序排就让 1 后画 = 在上
  const sortedLines = [...lines].sort((a, b) => b.number - a.number);
  return (
    <g data-transit-lines>
      {sortedLines.map((line) => (
        <LineSVG key={line.id} line={line} k={k} toVB={toVB} defaults={defaults} />
      ))}
    </g>
  );
}

/* ============================== Pearl Lines (SVG, 进 <g>, 下界珍珠炮) ============================== */

/**
 * 珍珠炮 transit 抛物线 — 全 SVG 进 <g>
 *  - 抛物线: 二次贝塞尔, control point = 中点 + 垂直偏移 (偏移 = curvature × 距离)
 *  - 颜色默认 #2ccdb1 (淡绿色)
 *  - 实线 (无 stroke-dasharray), 透明度可调
 *  - 只画线, 不画起点/终点圆, 不加白色描边
 *  - 全部走 viewBox 坐标 + vector-effect: non-scaling-stroke, 缩放时线宽恒定
 *  - 跟 TransitLines 同款: SVG 进 <g>, 跟地图 transform 同步动
 */
export interface PearlLinesProps {
  pearls: NewPearlLine[];
  k: number;
  currentZoom: number;
  toVB: (worldX: number, worldZ: number) => { vx: number; vy: number } | null;
  defaults?: NewTransitStyleDefaults;
}

function PearlSVG({
  pearl,
  k,
  toVB,
  defaults,
}: {
  pearl: NewPearlLine;
  k: number;
  toVB: (worldX: number, worldZ: number) => { vx: number; vy: number } | null;
  defaults?: NewTransitStyleDefaults;
}) {
  const startVb = toVB(pearl.cannon.x, pearl.cannon.z);
  if (!startVb) return null;

  const color = pearl.style?.color ?? defaults?.pearlColor ?? "#2ccdb1";
  const opacity = pearl.style?.opacity ?? defaults?.pearlOpacity ?? 0.85;
  const curvature = pearl.style?.curvature ?? defaults?.pearlCurvature ?? 0.3;
  // 抛物线宽度: cssScaled + 屏幕恒定 (vector-effect)
  const baseW = pearl.style?.lineWidthBase ?? defaults?.pearlLineWidth ?? 2;
  const scaleW = pearl.style?.lineWidthScale ?? defaults?.pearlLineWidthScale ?? 0.5;
  const maxW = pearl.style?.lineWidthMax ?? defaults?.pearlLineWidthMax;
  const wRaw = cssScaled(baseW, scaleW, k);
  const w = maxW !== undefined ? Math.min(wRaw, maxW) : wRaw;

  return (
    <g data-transit-pearl-line data-pearl-id={pearl.id}>
      {pearl.receivers.map((rec) => {
        const endVb = toVB(rec.x, rec.z);
        if (!endVb) return null;
        // 抛物线: P0=cannon, P2=receiver, P1 = 中点 + 垂直偏移
        const mx = (startVb.vx + endVb.vx) / 2;
        const my = (startVb.vy + endVb.vy) / 2;
        // 切线方向 (从 cannon 指向 receiver)
        const dx = endVb.vx - startVb.vx;
        const dy = endVb.vy - startVb.vy;
        const dist = Math.hypot(dx, dy);
        if (dist < 1) return null; // 起点终点重合, 跳过
        // 垂直方向 (逆时针 90°)
        const px = -dy;
        const py = dx;
        // 控制点偏移量 = curvature × 距离
        const offset = dist * curvature;
        const cpx = mx + (px / dist) * offset;
        const cpy = my + (py / dist) * offset;
        const d = `M ${startVb.vx.toFixed(1)} ${startVb.vy.toFixed(1)} Q ${cpx.toFixed(1)} ${cpy.toFixed(1)} ${endVb.vx.toFixed(1)} ${endVb.vy.toFixed(1)}`;
        // 单 path, 实线淡绿, 无白色描边, 无虚线
        return (
          <path
            key={rec.id}
            d={d}
            stroke={color}
            strokeWidth={w}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={opacity}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </g>
  );
}

export function PearlLines({ pearls, k, currentZoom, toVB, defaults }: PearlLinesProps) {
  // 缩放阈值: 低于 TRANSIT_PEARL_MIN_ZOOM 不画 (珍珠炮门槛低, 任何缩放都可见)
  if (currentZoom < TRANSIT_PEARL_MIN_ZOOM) return null;
  if (pearls.length === 0) return null;
  return (
    <g data-transit-pearls>
      {pearls.map((pearl) => (
        <PearlSVG key={pearl.id} pearl={pearl} k={k} toVB={toVB} defaults={defaults} />
      ))}
    </g>
  );
}

/* ============================== Stations (HTML, 走 toScreen) ============================== */

export interface TransitStationsProps {
  stations: NewTransitStation[];
  k: number;
  currentZoom: number;
  isPanning: boolean;
  toScreen: (worldX: number, worldZ: number) => { x: number; y: number } | null;
  defaults?: NewTransitStyleDefaults;
  /** 交通总开关 — 关掉时 div 仍挂 DOM, 只 visibility:hidden, 继续跟踪 k/tx/ty */
  transitVisible: boolean;
}

/**
 * 单个站点 (普通: 圆; 换乘: 胶囊)
 *  - 位置: toScreen 投影到 CSS 像素 (跟地标 label 同频道, 一起走 CSS transition)
 *  - 大小: CSS px (cssScaled 公式, 屏幕值 = base * k^scale)
 *  - 屏幕恒定 1.5px 边框
 *  - 站名已归到地标, 这里只画图标
 *  - visible: false 时挂 visibility:hidden, 但 div 仍挂 DOM + 仍跟踪 left/top
 *    (这样 transit 关掉时点地标 → pan 过渡时, 站点 div 一直在 DOM 里, 等用户开 transit
 *     时已经在新位置, 但 k/tx/ty 变化的"中间帧"是被 left/top transition 插值过的;
 *     跟地标 always-rendered 同款, 避免"啪"地跳到终点的 bug)
 */
function StationDiv({
  station,
  center,
  k,
  isPanning,
  defaults,
  visible,
}: {
  station: NewTransitStation;
  center: { x: number; y: number };
  k: number;
  isPanning: boolean;
  defaults?: NewTransitStyleDefaults;
  visible: boolean;
}) {
  const visStyle = visible ? "visible" : "hidden";
  if (station.kind === "regular") {
    const d =
      cssScaled(
        station.radius ?? defaults?.stationRadius ?? 4,
        station.radiusScale ?? defaults?.stationRadiusScale ?? 0.3,
        k,
      ) * 2;
    return (
      <div
        data-transit-station
        data-station-id={station.id}
        className="absolute pointer-events-none"
        style={{
          left: center.x,
          top: center.y,
          transform: "translate(-50%, -50%)",
          width: `${d}px`,
          height: `${d}px`,
          background: "white",
          border: "1.5px solid #0f172a",
          borderRadius: "50%",
          boxSizing: "border-box",
          visibility: visStyle,
          transition: isPanning
            ? "left 500ms cubic-bezier(0.4, 0, 0.2, 1), top 500ms cubic-bezier(0.4, 0, 0.2, 1), width 500ms cubic-bezier(0.4, 0, 0.2, 1), height 500ms cubic-bezier(0.4, 0, 0.2, 1)"
            : undefined,
          zIndex: 4,
        }}
      />
    );
  }
  // transfer: 胶囊
  const length = cssScaled(
    station.length ?? defaults?.stationLength ?? 14,
    station.lengthScale ?? defaults?.stationLengthScale ?? 0.3,
    k,
  );
  const widthV = cssScaled(
    station.width ?? defaults?.stationWidth ?? 6,
    station.widthScale ?? defaults?.stationWidthScale ?? 0.3,
    k,
  );
  const rotation = station.rotation ?? 0;
  return (
    <div
      data-transit-station
      data-station-id={station.id}
      className="absolute pointer-events-none"
      style={{
        left: center.x,
        top: center.y,
        // 旋转中心是元素中心: translate(-50%,-50%) 把元素摆到 center, 再 rotate
        transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
        width: `${length}px`,
        height: `${widthV}px`,
        background: "white",
        border: "1.5px solid #0f172a",
        borderRadius: `${widthV / 2}px`,
        boxSizing: "border-box",
        visibility: visStyle,
        transition: isPanning
          ? "left 500ms cubic-bezier(0.4, 0, 0.2, 1), top 500ms cubic-bezier(0.4, 0, 0.2, 1), width 500ms cubic-bezier(0.4, 0, 0.2, 1), height 500ms cubic-bezier(0.4, 0, 0.2, 1)"
          : undefined,
        zIndex: 4,
      }}
    />
  );
}

/**
 * 站点图层 — 走 HTML 渲染 (CSS 像素)
 *  - 站点的 (x, z) → toScreen → CSS px
 *  - 大小直接是 CSS px, 不走 viewBox 缩放
 *  - isPanning 时挂 left/top/width/height 500ms transition, 跟地标 label 同频道
 *  (NOTE: 之前用 SVG 圆/胶囊, 但 viewBox 14336 宽 1 单位 ≈ 0.05 屏幕像素, 圆/胶囊根本看不见
 *   所以改回 HTML, CSS px 单位让图标在任何缩放下都正常大小)
 *
 * 重要: div 永远渲染 (不因 transitVisible / currentZoom<MIN_ZOOM 而 return null),
 * 显隐走 visibility: hidden. 这样点地标触发 panToLandmark 时, 站点 div 一直在 DOM
 * 里跟踪 tx/ty/k, CSS transition 有"起点"可插值 — 不再"啪"地跳到终点
 */
export function TransitStations({
  stations,
  k,
  currentZoom,
  isPanning,
  toScreen,
  defaults,
  transitVisible,
}: TransitStationsProps) {
  // 显隐: transit 总开关 + 缩放阈值 (>= 500%) 同时满足才 visible
  // 两者任一不满足, div 仍挂 DOM 但 visibility:hidden, 继续跟踪 k/tx/ty 给 transition 用
  const visible = transitVisible && currentZoom >= TRANSIT_STATION_MIN_ZOOM;
  return (
    <>
      {stations.map((station) => {
        const center = toScreen(station.x, station.z);
        if (!center) return null;
        return (
          <StationDiv
            key={station.id}
            station={station}
            center={center}
            k={k}
            isPanning={isPanning}
            defaults={defaults}
            visible={visible}
          />
        );
      })}
    </>
  );
}

/* ============================== Line End Labels (HTML, 走 toScreen) ============================== */

/**
 * 线路端 label — 两端一样的 "X" 大数字方型
 *  - 留在这里因为它是线的一部分, 不在地标里
 *  - 两端可分别设 direction/distance/offsetX/offsetY
 *  - padding 跟字号比例缩放
 *  - 跟地标同款 withLabels 切换
 */
export interface TransitLineEndLabelsProps {
  lines: NewLine[];
  k: number;
  currentZoom: number;
  isPanning: boolean;
  toScreen: (worldX: number, worldZ: number) => { x: number; y: number } | null;
  defaults?: NewTransitStyleDefaults;
  withLabels: boolean;
}

function offsetByDirection(
  base: { x: number; y: number },
  direction: number,
  distancePx: number,
): { left: number; top: number } {
  const rad = (direction * Math.PI) / 180;
  return {
    left: base.x + Math.cos(rad) * distancePx,
    top: base.y + Math.sin(rad) * distancePx,
  };
}

/**
 * 解析线路端 label 样式 — 一次性 pick 6 个字段, 替代 LineEndLabel 内部连 6 次 pick
 * - 之前代码 6 次 pick 散在函数体里, 可读性差 (每个 pick 都 4 个参数)
 * - 合并后: LineEndLabel 只关心如何用 style, 不重复 lookup 逻辑
 * - 字段语义: cfg.withLabels.X (withLabels 时优先) → cfg.X (主配置) → wlm/defaults.X (withLabels 时 wlm, 否则 defaults) → 内置 fallback
 */
function resolveLineEndLabelStyle(
  cfg: NewTransitLabelConfig,
  defaults: NewTransitStyleDefaults | undefined,
  withLabels: boolean,
  k: number,
): { fontSize: number; distance: number; offsetX: number; offsetY: number } {
  const wlm = withLabels ? defaults?.lineEndWithLandmarks : undefined;
  const fontSizeRaw = pick(cfg.withLabels?.fontSize, cfg.fontSize, wlm?.fontSize ?? defaults?.fontSize ?? 12, withLabels);
  const fontSizeScale = pick(cfg.withLabels?.fontSizeScale, cfg.fontSizeScale, wlm?.fontSizeScale ?? defaults?.fontSizeScale ?? 0.3, withLabels);
  const distanceRaw = pick(cfg.withLabels?.distance, cfg.distance, wlm?.distance ?? defaults?.distance ?? 12, withLabels);
  const distanceScale = pick(cfg.withLabels?.distanceScale, cfg.distanceScale, wlm?.distanceScale ?? defaults?.distanceScale ?? 0.3, withLabels);
  const offsetX = pick(cfg.withLabels?.offsetX, cfg.offsetX, wlm?.offsetX ?? defaults?.offsetX ?? 0, withLabels);
  const offsetY = pick(cfg.withLabels?.offsetY, cfg.offsetY, wlm?.offsetY ?? defaults?.offsetY ?? 0, withLabels);
  return {
    fontSize: cssScaled(fontSizeRaw, fontSizeScale, k),
    distance: cssScaled(distanceRaw, distanceScale, k),
    offsetX,
    offsetY,
  };
}

function LineEndLabel({
  line,
  waypoint,
  side,
  k,
  currentZoom,
  isPanning,
  defaults,
  withLabels,
}: {
  line: NewLine;
  waypoint: { x: number; y: number };
  side: "start" | "end";
  k: number;
  currentZoom: number;
  isPanning: boolean;
  defaults?: NewTransitStyleDefaults;
  withLabels: boolean;
}) {
  const cfg = line.nameConfig[side];
  const minZoom = cfg.minZoom ?? 100;
  if (currentZoom < minZoom) return null;

  const style = resolveLineEndLabelStyle(cfg, defaults, withLabels, k);
  if (style.fontSize < 4) return null;

  const pos = offsetByDirection(waypoint, cfg.direction, style.distance);
  const finalPos = { left: pos.left + style.offsetX, top: pos.top + style.offsetY };
  return (
    <div
      data-transit-line-label
      data-line-id={line.id}
      data-line-side={side}
      className="absolute pointer-events-none select-none"
      style={{
        left: finalPos.left,
        top: finalPos.top,
        transform: "translate(-50%, -50%)",
        background: line.color,
        color: "white",
        borderRadius: 3,
        padding: `${style.fontSize * 0.4}px ${style.fontSize * 0.6}px`,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: `${style.fontSize}px`,
        fontWeight: 800,
        lineHeight: 1.0,
        whiteSpace: "nowrap",
        boxShadow: "0 1px 2px rgba(0,0,0,0.35)",
        transition: isPanning
          ? "left 500ms cubic-bezier(0.4, 0, 0.2, 1), top 500ms cubic-bezier(0.4, 0, 0.2, 1), font-size 500ms cubic-bezier(0.4, 0, 0.2, 1)"
          : undefined,
        zIndex: 6,
      }}
    >
      {line.number}
    </div>
  );
}

export function TransitLineEndLabels({
  lines,
  k,
  currentZoom,
  isPanning,
  toScreen,
  defaults,
  withLabels,
}: TransitLineEndLabelsProps) {
  return (
    <>
      {lines.map((line) => {
        const startWp = line.waypoints[0];
        const endWp = line.waypoints[line.waypoints.length - 1];
        if (!startWp || !endWp) return null;
        const startScreen = toScreen(startWp.x, startWp.z);
        const endScreen = toScreen(endWp.x, endWp.z);
        if (!startScreen || !endScreen) return null;
        return (
          <div key={`line-ends-${line.id}`} className="contents">
            <LineEndLabel
              line={line}
              waypoint={startScreen}
              side="start"
              k={k}
              currentZoom={currentZoom}
              isPanning={isPanning}
              defaults={defaults}
              withLabels={withLabels}
            />
            <LineEndLabel
              line={line}
              waypoint={endScreen}
              side="end"
              k={k}
              currentZoom={currentZoom}
              isPanning={isPanning}
              defaults={defaults}
              withLabels={withLabels}
            />
          </div>
        );
      })}
    </>
  );
}
