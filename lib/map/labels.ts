/**
 * 地标 (landmark) 数据 — 跟 GuideMap 配套使用
 *
 * kind 分类 (region/building/machine) — 仅作为数据归类标签, 不影响弹窗/内容显示
 *  - 想弹窗: 显式 `popup: true`, 或数据里有 images/description/inputs/outputs (自动弹)
 *  - 弹窗内容: 有什么就显示什么 (images[0] 作 hero, inputs/outputs/description 分段)
 *  - 地铁站名/珍珠站: `visibleWhen: "transit"` (只在交通开启时显示, 不要求 labelsVisible)
 *
 * 字段:
 *  - minZoom/maxZoom: 分层显示 — 用百分比 (跟地图右上角显示一致: 100=1x, 400=4x)
 *  - offsetX/offsetY?: 像素水平/垂直偏移
 *  - fontSize?: 字体大小 (px)
 *  - targetZoom?: 点击时缩放到的目标值 (百分比)
 *  - visibleWhen?: 'always' (默认) | 'transit' (只在交通开时显示)
 *  - popup?: 是否显示弹窗 (true 必弹, false 永不弹, undefined 自动按内容判断)
 *  - withLabels?: 当地标+交通都开时, 站名/珍珠的字段覆盖 (避免跟地标 label 重叠)
 *
 * 注: 此文件 client/server 都能 import (没有 server-only, 没有 fs/path 依赖)
 */
import type { NewWorldId } from "./loader";

/* ============================== Types ============================== */

/**
 * 字号 + 显示范围合一的配置
 *  - 数字: 固定 px, 全程显示
 *  - { min, max, mid?, midZoom?, minZoom?, maxZoom? }: 字号范围 + 显示范围
 *  - 此类型在 transit 标签里也复用, 所以 export 出来
 */
export type NewLabelFontSize = number | {
  min: number;
  max: number;
  mid?: number;
  midZoom?: number;
  minZoom?: number;
  maxZoom?: number;
};

/** 地标的分类标签 — 不影响弹窗/内容, 只用于数据归类 */
export type NewLabelKind = "region" | "building" | "machine";

/**
 * 机器的输入/输出产物
 *  - icon 可选, 用图标地址作为唯一标识; 没填/无效时不渲染图标也不预留空间
 */
export interface NewLabelProduct {
  label: string;
  /** 图标地址 (/icons/.../xxx.png); null/undefined/空串/"null" 都不会显示图标 */
  icon?: string;
}

/** 当地标 + 交通都开启时, 站名/珍珠的字段覆盖 (让它们不跟地标 label 重叠) */
export type NewLabelWithLabelsOverride = {
  fontSize?: NewLabelFontSize;
  offsetX?: number;
  offsetY?: number;
};

export interface NewLabel {
  id: string;
  name: string;
  /** MC 世界坐标 (x, z) */
  x: number;
  z: number;
  /** 分类标签 (不影响弹窗/内容) */
  kind?: NewLabelKind;
  /** 弹窗开关: 区域类想弹就填 true, 其他有内容会自动弹 */
  popup?: boolean;
  /** 图片: 第一张作 hero, 其余作细节图 (没填就不显示图片区) */
  images?: string[];
  /** 描述 (任何 kind 都可有) */
  description?: string;
  /** 建设者 (可选字段 — 留空不显示, 填了就放在简介之后、投入/产出之前) */
  builder?: string;
  /** 输入产物 (没填就不显示输入区) */
  inputs?: NewLabelProduct[];
  /** 输出产物 (没填就不显示输出区) */
  outputs?: NewLabelProduct[];
  /** 点击时缩放到的目标值 (百分比, 100=1x, 400=4x). 留空 = 保持当前缩放, 只平移 */
  targetZoom?: number;
  /** 水平像素偏移 — 站名/珍珠需要跟地标 label 错开 */
  offsetX?: number;
  /** 垂直像素偏移 — 避免遮挡建筑, 正数下移, 负数上移 */
  offsetY?: number;
  /** 字体配置 (字号 + 显示范围合一):
   *  - 不填: 默认响应式 text-xs sm:text-sm, 全程显示
   *  - { min, max, mid?, midZoom?, minZoom?, maxZoom? }: 字号范围 + 显示范围
   *  - 详细字段说明见 NewLabelFontSize */
  fontSize?: NewLabelFontSize;
  /** 可见性:
   *  - undefined 或 "always" (默认): 一直显示 (前提是 labelsVisible)
   *  - "transit": 只在交通开启时显示 (不要求 labelsVisible) */
  visibleWhen?: "always" | "transit";
  /**
   * 仅 transit-only 项 (visibleWhen: "transit") 用得上
   * 当 landmarks + transit 同时开启时, 用这套字段覆盖主字段
   *  - 不填的字段 fallback 到主字段
   */
  withLabels?: NewLabelWithLabelsOverride;
}

/** 按维度分组的地标列表 */
export type NewLabelGroups = Record<NewWorldId, NewLabel[]>;
