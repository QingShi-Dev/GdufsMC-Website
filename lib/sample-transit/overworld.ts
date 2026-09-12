/**
 * 主世界示例地铁线路
 *  - 1 号线: 一个 U 型, 经过 5 个站
 *  - 2 号线: 横跨东西, 经过 3 个站
 *
 * 激进改动 (2026-09-11):
 *  - 站名/珍珠站已完全移入地标 (NewLandmark, 配 visibleWhen: "transit")
 *  - 这里只剩"画线 + 画站点圆/胶囊"需要的几何/样式
 *  - 站点的 (x, z) 跟地标里的同名 landmark 重合 (visual coupling)
 */
import type { NewTransitDimension } from "../map/transit";

const overworld: NewTransitDimension = {
  // 全维度统一默认值 — 改这里, 全维度所有站/标签都跟着变
  style: {
    // 普通站
    stationRadius: 4,
    stationRadiusScale: 0.12,
    // 换乘站 — 强烈建议每个换乘站单独设 length/lengthScale
    stationLength: 14,
    stationLengthScale: 0.3,
    stationWidth: 6,
    stationWidthScale: 0.3,
    // 线路
    lineWidth: 2,
    lineWidthScale: 0.7,
    lineWidthMax: 6,
    lineCornerRadius: 200,
    lineCornerRadiusScale: 0.3,
  },
  stations: [
    // 换乘站 — length 单独设置, 不走全局默认
    {
      id: "1-1/2-2",
      kind: "transfer",
      x: 47,
      z: -6,
      rotation: 90, // 竖向
      length: 16,
      lengthScale: 0.25,
      width: 6,
      widthScale: 0.25,
    },
    {
      id: "1-2",
      kind: "regular",
      x: 139,
      z: -144,
    },
    {
      id: "1-3/2-4",
      kind: "transfer",
      x: 139,
      z: -294,
      rotation: 90,
      length: 18,
      lengthScale: 0.25,
      width: 6,
      widthScale: 0.25,
    },
    {
      id: "1-4",
      kind: "regular",
      x: 139,
      z: -610,
    },
    {
      id: "1-5",
      kind: "regular",
      x: 187,
      z: -845,
    },
    {
      id: "2-1",
      kind: "regular",
      x: 186,
      z: 77,
    },
    {
      id: "2-3",
      kind: "regular",
      x: -61,
      z: -226,
    },
    {
      id: "2-5",
      kind: "regular",
      x: 366,
      z: -300,
    },
  ],
  lines: [
    {
      id: "line-1",
      number: 1,
      color: "#F06B00", // 橙色
      waypoints: [
        { x: 47, z: -12 }, // 起点
        { x: 61, z: -12 },
        { x: 69, z: -24 },
        { x: 125, z: -24 },
        { x: 139, z: -38 },
        { x: 139, z: -839 },
        { x: 145, z: -845 },
        { x: 187, z: -845 }, // 终点
      ],
      // style 不填 → 走 dimension.style 默认 (1.5→3px cap)
      nameConfig: {
        start: {
          direction: 180, // 起点左
        },
        end: {
          direction: 0, // 终点右
        },
      },
    },
    {
      id: "line-2",
      number: 2,
      color: "#2F32A7", // 蓝色
      waypoints: [
        { x: 186, z: 77 }, // 起点
        { x: 186, z: 1 },
        { x: 184, z: -1 },
        { x: -59, z: -1 },
        { x: -61, z: -3 },
        { x: -61, z: -238 },
        { x: -53, z: -246 },
        { x: -36, z: -246 },
        { x: -33, z: -249 },
        { x: -33, z: -296 },
        { x: -29, z: -300 },
        { x: 366, z: -300 }, // 终点
      ],
      nameConfig: {
        start: { direction: 180 },
        end: { direction: 0 },
      },
    },
  ],
};

export default overworld;
