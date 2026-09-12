/**
 * 下界 / 末地的 transit 示例数据
 *  - 下界: 1 个珍珠炮 (用户填的真实下界坐标)
 *  - 末地: 暂空
 *
 * 珍珠炮 (NewPearlLine) 数据结构:
 *  - cannon: 珍珠炮起点 (世界坐标 x, z)
 *  - receivers: 若干接收终点
 *  - style (可选): 覆盖维度默认 (颜色/透明度/弧度)
 *
 * 3 个全局可调参数在 style 字段:
 *  - color:     抛物线颜色 (默认 #2ccdb1, 淡绿色)
 *  - opacity:   整条线透明度 0-1 (默认 0.85)
 *  - curvature: 抛物线弧度, 0=直线, 正数=鼓出 (默认 0.3) — 控制点偏移 = curvature × 距离
 *
 * 渲染: 纯实线淡绿色抛物线 (无白色描边, 无起点/终点圆, 无虚线).
 *
 * 改完保存, dev server 自动重渲染.
 */
import type { NewTransitDimension } from "../new-transit-types";

const nether: NewTransitDimension = {
  stations: [],
  lines: [],
  // 下界珍珠炮
  pearls: [
    {
      id: "nether-pearl-cannon-1",
      // 珍珠炮起点 (下界传送厅之类)
      cannon: { x: 8, z: 25 },
      // 7 个接收终点
      receivers: [
        { id: "r1", x: -622, z: -53 },
        { id: "r2", x: 4034, z: -1068 },
        { id: "r3", x: 712, z: 4 },
        { id: "r4", x: 1853, z: -527 },
        { id: "r5", x: 4, z: 283 },
        { id: "r6", x: -342, z: 87 },
        { id: "r7", x: -17, z: -643 },
      ],
      // 3 个参数手动调节 (改这里就行)
      style: {
        color: "#2ccdb1",         // 颜色 (不填走维度默认, 淡绿色)
        opacity: 0.65,             // 整条线透明度 0-1
        curvature: 0.075,            // 弧度, 0=直线, 0.3=默认
      },
    },
  ],
  // 维度级默认 — 单条线没填的字段会 fallback 这里
  // (留空就走 BUILT_IN: 颜色 #2ccdb1, opacity 0.85, curvature 0.3)
  style: {
    // pearlColor: "#2ccdb1",
    // pearlOpacity: 0.85,
    // pearlCurvature: 0.3,
  },
};

const end: NewTransitDimension = {
  stations: [],
  lines: [],
  pearls: [
    {
      id: "end-pearl-cannon-1",
      // 珍珠炮起点 (下界传送厅之类)
      cannon: { x: -58, z: -78 },
      // 7 个接收终点
      receivers: [
        { id: "r1", x: -567, z: -818 },
      ],
      // 3 个参数手动调节 (改这里就行)
      style: {
        color: "#8e3d93",         // 颜色 (不填走维度默认, 淡绿色)
        opacity: 0.85,             // 整条线透明度 0-1
        curvature: 0.2,            // 弧度, 0=直线, 0.3=默认
      },
    },
  ],
  // 维度级默认 — 单条线没填的字段会 fallback 这里
  // (留空就走 BUILT_IN: 颜色 #2ccdb1, opacity 0.85, curvature 0.3)
  style: {
    // pearlColor: "#2ccdb1",
    // pearlOpacity: 0.85,
    // pearlCurvature: 0.3,
  },
};

export { nether, end };
