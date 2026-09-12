/**
 * 地铁 / 交通 (metro) 网络数据 — 跟 NewGuideMap 配套使用
 *
 * 设计目标: SVG 跟地图放同一个 <g transform="translate(tx,ty) scale(k)"> 里,
 * 所有"世界单位"的东西 (站点大小, 线宽, 转弯半径, 距离) 都跟着 k 缩放
 *  - 默认 scale=1, 跟 k 线性 (自然行为)
 *  - scale=0 恒定大小 (屏幕上看永远不缩)
 *  - scale=0.5 sqrt 缩放, scale=2 平方缩放
 *  - 公式: actual_screen_value = base * k^scale
 *    (在 SVG 里: world_value = base * k^(scale-1), 配合外层 scale(k) 算下来正好)
 *
 * CSS 单位 (字号) 走单独的 css_size = base * k^scale 公式, 不走 SVG
 *
 * 注意: 站名/珍珠站已完全移到地标系统 (NewLandmark, 配 visibleWhen: "transit"),
 *  这里只剩"画线 + 画站点圆/胶囊"的几何/样式信息
 *
 * "两种上下文" 切换 (withLandmarks):
 *  - 只点交通: 用主字段 (fontSize / offsetX 等)
 *  - 地标+交通一起开: 用 withLandmarks 嵌套对象的字段 (不填 fallback 到主字段)
 *  - 渲染时根据 NewGuideMap 算的 `landmarksVisible && transitVisible` 自动挑
 *
 * 注: 此文件 client/server 都能 import (没有 server-only, 没有 fs/path 依赖)
 */
import type { NewWorldId } from "./new-guide-map-data";

/* ============================== Types ============================== */

/**
 * 缩放系数 (所有"随缩放改变"的东西都带这个)
 *  - 0 = 屏幕恒定 (不随 k 缩放)
 *  - 1 (默认) = 跟 k 线性
 *  - 0.5 = sqrt 缩放
 *  - 2 = 平方缩放
 *  - 公式: actual_screen_value = base * k^scale
 *  - SVG 世界单位换算: world_value = base * k^(scale-1) (配合外层 scale(k))
 */
export type NewTransitScale = number;

/**
 * 标签可调字段的子集 — 主字段和 withLandmarks 嵌套都用同一套类型
 *  - fontSize / fontSizeScale: 字号控制
 *  - distance / distanceScale: 极坐标距离控制
 *  - offsetX / offsetY: 在极坐标基础上再加的笛卡尔偏移 (像素)
 */
export type NewTransitLabelFields = {
  fontSize?: number;
  fontSizeScale?: NewTransitScale;
  distance?: number;
  distanceScale?: NewTransitScale;
  /** 在极坐标 (direction/distance) 基础上再叠加的水平像素偏移 */
  offsetX?: number;
  /** 在极坐标基础上再叠加的垂直像素偏移 */
  offsetY?: number;
  /**
   * 方向 (度, 0=右, 90=下, 180=左, 270=上). 主 config 必填,
   * 但 NewTransitLabelFields 里也带上, 这样 withLandmarks 可以单独覆盖方向
   */
  direction?: number;
  /** 显示阈值: withLandmarks 也能单独覆盖 minZoom */
  minZoom?: number;
};

/**
 * 标签 / 名称 通用配置 (站名, 线路名两端, 珍珠站都用同一套)
 *  - direction: 0=右, 90=下, 180=左, 270=上 (跟 CSS rotate 一致)
 *  - distance: CSS pixels (跟 k 一起缩放, 通过 distanceScale 调)
 *  - offsetX/Y: 在 distance 方向的基础上再 +x/+y 像素偏移 (用于跟地标错开)
 *  - withLandmarks: 当地标也开启时, 用这套字段覆盖主字段 (per-field fallback)
 */
export interface NewTransitLabelConfig extends NewTransitLabelFields {
  /** 显示阈值: 缩放百分比 >= 这个值才显示 (默认 100) */
  minZoom?: number;
  /** 相对锚点的方向 (度, 0=右, 90=下, 180=左, 270=上). 必填 */
  direction: number;
  /**
   * 当地标也开启时的字段覆盖 — 不填的字段 fallback 到主字段
   *  - 典型用途: 当地标开时, 站名小一点 + 往左偏, 避免跟地标 label 重叠
   */
  withLandmarks?: NewTransitLabelFields;
}

/**
 * 站点公共字段
 *  - 站名已完全移入地标 (NewLandmark, 配 visibleWhen: "transit" 只在交通开时显示)
 *  - 这里只剩"画圆/胶囊"需要的图标信息
 */
export interface NewTransitStationBase {
  id: string;
  /** MC 世界坐标 (x, z) */
  x: number;
  z: number;
}

/**
 * 普通站 — 圆点
 *  - radius: 圆的半径 (CSS px@1x, 默认 4)
 */
export interface NewRegularStation extends NewTransitStationBase {
  kind: "regular";
  radius?: number;
  /** 半径的缩放系数 (默认 0.3) */
  radiusScale?: NewTransitScale;
}

/**
 * 换乘站 — 胶囊 (圆角矩形)
 *  - rotation: 胶囊方向 (度, 0=横向, 90=纵向, 默认 0)
 *  - length: 胶囊长边 (CSS px@1x, 默认 14) — 强烈建议每站单独设置
 *  - width: 胶囊短边 (CSS px@1x, 默认 6)
 *  - 注: 胶囊方向建议跟所在线路方向一致 (横向线 = 横向胶囊, 竖向线 = 竖向胶囊)
 */
export interface NewTransferStation extends NewTransitStationBase {
  kind: "transfer";
  rotation?: number;
  length?: number;
  lengthScale?: NewTransitScale;
  width?: number;
  widthScale?: NewTransitScale;
}

export type NewTransitStation = NewRegularStation | NewTransferStation;

/**
 * 线路途径点 (按顺序)
 *  - 不需要在站点位置, 站点是单独的对象; waypoint 是给线路"画"用的拐点
 *  - waypoint 在转角处不必精确通过, 渲染时会用圆角处理 (前后延长线接得上)
 */
export interface NewLineWaypoint {
  x: number;
  z: number;
}

/**
 * 线路配置 (线宽, 转弯圆角, 各自带 scale)
 *  - 都用 world units, 配合 scale 控制"随缩放而改变"的程度
 */
export interface NewLineStyle {
  /** 线宽 (world units, 默认 4) */
  width?: number;
  /** 线宽缩放: 0=恒定, 1=跟k (默认) */
  widthScale?: NewTransitScale;
  /**
   * 线宽上限 (world units): 算完 cssScaled 后再 cap 一下, 不超过这个值
   *  - 用途: 想要"小缩放细, 大缩放封顶不再变粗"的地铁线
   *  - 例: width=1.5, widthScale=0.5, widthMax=3 → 1x=1.5px, 4x=3px (capped), 16x=3px
   *  - 不传就不 cap, 一直跟着 scale 涨
   */
  widthMax?: number;
  /** 转弯圆角 (world units, 默认 12) */
  cornerRadius?: number;
  /** 圆角缩放: 0=恒定, 1=跟k (默认) */
  cornerRadiusScale?: NewTransitScale;
}

/**
 * 线路 (基础)
 *  - 站点名已全部移入地标 (NewLandmark), 这里只管"画线"
 *  - 颜色用 CSS color (如 "#E60012" 红)
 */
export interface NewLine {
  id: string;
  /** 线路数字 (用于 label: 1, 2, 3, ...) */
  number: number;
  /** 线路颜色 (CSS color) — label 背景色也是它 */
  color: string;
  /** 途径点 (按顺序) */
  waypoints: NewLineWaypoint[];
  /** 线路样式 (线宽 + 转弯半径) */
  style?: NewLineStyle;
  /**
   * 名称显示配置 (两端都用同一个样式, 都显示大数字 "X" 的微圆角方型)
   *  - direction 控制 label 相对线路末端的方向 (起点/终点可分别设置)
   *  - distance 控制 label 离线路末端的距离
   *  - fontSize / fontSizeScale 控制 label 字号
   *  - offsetX/Y 在 distance 方向基础上再 +x/+y 像素偏移
   */
  nameConfig: {
    /** 起点端 */
    start: NewTransitLabelConfig;
    /** 终点端 */
    end: NewTransitLabelConfig;
  };
}

/**
 * 单维度地铁的全局默认值 — per-station / per-line / per-label 字段不填时 fallback 这里
 *  - 用户在数据里改一处, 整个维度的站标/站名/线端都跟着变
 *  - 字段同名同义, 渲染时 station.radius ?? defaults.stationRadius ?? BUILT_IN
 *  - 想要某个站特殊处理才在 station 里显式填
 *  - 继承 NewTransitLabelFields: fontSize/fontSizeScale/distance/distanceScale/offsetX/offsetY
 *    这 6 个字段是"标签通用"配置, 站名/线端/珍珠站共用同一组默认值
 */
export interface NewTransitStyleDefaults extends NewTransitLabelFields {
  /** 普通站 radius 默认 (CSS px@1x, 默认 4) */
  stationRadius?: number;
  /** 普通站 radius 缩放 (默认 0.3) */
  stationRadiusScale?: NewTransitScale;
  /** 换乘站 length 默认 (CSS px@1x, 默认 14) */
  stationLength?: number;
  stationLengthScale?: NewTransitScale;
  /** 换乘站 width 默认 (CSS px@1x, 默认 6) */
  stationWidth?: number;
  stationWidthScale?: NewTransitScale;
  /** 线路端 label 的"withLandmarks"字段覆盖 (fontSize / distance / offsetX / offsetY) */
  lineEndWithLandmarks?: NewTransitLabelFields;
  /** 线路线宽全局默认 (CSS px@1x, 跟 per-line 的 line.style?.width 同义) */
  lineWidth?: number;
  lineWidthScale?: NewTransitScale;
  lineWidthMax?: number;
  /** 线路圆角全局默认 */
  lineCornerRadius?: number;
  lineCornerRadiusScale?: NewTransitScale;
  /* ---- 珍珠炮 transit (末地专用) 全局默认 ---- */
  /** 抛物线颜色 (默认 #2ccdb1) */
  pearlColor?: string;
  /** 虚线单段长度 (world units, 默认 8) — 整条抛物线均匀虚线 */
  pearlDashLength?: number;
  /** 虚线间隔 (world units, 默认 6) */
  pearlDashSpacing?: number;
  /** 整条线透明度 (0-1, 默认 0.85) */
  pearlOpacity?: number;
  /** 抛物线弧度 (0=直线, 正数=鼓出, 默认 0.3)
   *  - 偏移量 = curvature × 起点到终点的距离 (即 viewBox 距离)
   *  - 每条线自己可以在 NewPearlLine.style.curvature 覆盖 */
  pearlCurvature?: number;
  /** 珍珠炮起点圆半径 (world units, 默认 4) */
  pearlCannonRadius?: number;
  /** 接收点圆半径 (world units, 默认 3) */
  pearlReceiverRadius?: number;
  /** 单条线线宽 (world units, 默认 2) — 跟普通 line width 同款, 走 cssScaled */
  pearlLineWidth?: number;
  /** 单条线线宽缩放 (默认 0.5 — 缩放时线宽变化小一点, 跟普通线路一致感) */
  pearlLineWidthScale?: NewTransitScale;
  /** 单条线线宽上限 (world units) — 缩放时线宽封顶, 跟 lineWidthMax 同款 */
  pearlLineWidthMax?: number;
}

/**
 * 单一维度的地铁数据 (lines + stations + pearls 拆开放, 方便扩展)
 *  - 站名/珍珠站都已移入地标 (NewLandmark, 配 visibleWhen: "transit")
 *  - 这里只剩"画线 + 画站点图标 + 珍珠炮抛物线"需要的几何/样式信息
 *  - style 字段是单维度全局默认值, 不填就走 BUILT_IN fallback
 */
export interface NewTransitDimension {
  lines: NewLine[];
  stations: NewTransitStation[];
  /**
   * 珍珠炮 transit 线路 (末地用, 主世界/下界不挂)
   *  - 一门珍珠炮 + 若干接收点
   *  - 起点到每个终点用一条抛物线相连 (中间是虚线)
   *  - 颜色默认 #2ccdb1
   */
  pearls?: NewPearlLine[];
  /** 单维度全局默认 (统一控制站标/字号/距离/线宽) */
  style?: NewTransitStyleDefaults;
}

/** 按维度分组 */
export type NewTransitGroups = Record<NewWorldId, NewTransitDimension>;

/* ============================== Pearl Lines (末地珍珠炮) ============================== */

/**
 * 珍珠炮的接收点 (终点)
 *  - 一个珍珠炮可以挂 N 个接收点, 每个接收点画一条抛物线
 */
export interface NewPearlReceiver {
  id: string;
  /** MC 世界坐标 (x, z) */
  x: number;
  z: number;
}

/**
 * 单条珍珠炮线 (一个起点 + 一组接收终点)
 *  - 每条 NewPearlLine 画 N 条抛物线 (N = receivers.length)
 *  - curvature 控制抛物线中点的垂直偏移 (相对直线的距离)
 *    curvature > 0 = 向某个方向鼓出去, 0 = 直线, < 0 = 反方向
 *  - 颜色/虚线/透明度不填走 NewPearlLineStyleDefaults (再 fallback 到 NewTransitStyleDefaults)
 */
export interface NewPearlLine {
  id: string;
  /** 珍珠炮起点 (世界坐标) */
  cannon: { x: number; z: number };
  /** 若干接收终点 */
  receivers: NewPearlReceiver[];
  /** 这条线自己的样式覆盖 (不填走维度默认) */
  style?: NewPearlLineStyle;
}

/**
 * 单条珍珠炮线的样式覆盖字段
 *  - 所有字段都可选, 不填走 NewTransitStyleDefaults.pearl* 默认
 *  - curvature 是 per-line 必填语义 (每条抛物线可以不同弧度)
 */
export interface NewPearlLineStyle {
  /** 抛物线颜色 (默认 #2ccdb1) */
  color?: string;
  /** 单段虚线长度 (world units, 默认 80) — 整条抛物线均匀虚线 */
  dashLength?: number;
  /** 虚线间隔 (world units, 默认 60) */
  dashSpacing?: number;
  /** 整条线透明度 (0-1, 默认 0.85) */
  opacity?: number;
  /** 抛物线弧度 (0=直线, 正数=鼓出, 默认 0.3) — 偏移 = curvature × 起点-终点距离 */
  curvature?: number;
  /** 起点圆半径 (world units, 默认 6) */
  cannonRadius?: number;
  /** 终点圆半径 (world units, 默认 4) */
  receiverRadius?: number;
  /** 抛物线线宽 (world units, 默认 2) — 跟普通 line width 同款 */
  lineWidthBase?: number;
  /** 抛物线线宽缩放 (默认 0.5) */
  lineWidthScale?: NewTransitScale;
  /** 抛物线线宽上限 (world units) */
  lineWidthMax?: number;
}

/* ============================== Defaults ============================== */

/** 站点本身 (icon) 何时显示: 缩放 >= 5.0x (500%)
 *  - 500% 以下只能看到线路, 看不到站点 (跟用户需求一致) */
export const TRANSIT_STATION_MIN_ZOOM = 500;

/** 珍珠炮抛物线 + 起点/终点圆 何时显示: 缩放 >= 1.0x (100%)
 *  - 珍珠炮是末地主要交通手段, 任何缩放都该看到 (不像 station 要 500% 才显)
 *  - 不填走此默认, 单条线自己也能在 NewPearlLineStyle.minZoom 覆盖
 */
export const TRANSIT_PEARL_MIN_ZOOM = 100;
