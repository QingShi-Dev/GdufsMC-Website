/**
 * 下界 / 末地的 transit 示例数据
 *  - 末地: 1 个珍珠炮 (示例坐标, 用户照着自己末地的真实坐标替换)
 *  - 下界: 暂空
 *
 * 珍珠炮 (NewPearlLine) 数据结构:
 *  - cannon: 珍珠炮起点 (世界坐标 x, z)
 *  - receivers: 若干接收终点
 *  - style (可选): 覆盖维度默认 (颜色/虚线/透明度/弧度/圆半径)
 *
 * 4 个全局可调参数在 style 字段:
 *  - color:        抛物线颜色 (默认 #2ccdb1)
 *  - dashLength:   单段虚线长度, world units (默认 80)
 *  - dashSpacing:  虚线间隔, world units (默认 60)
 *  - opacity:      整条线透明度 0-1 (默认 0.85)
 *  - curvature:    抛物线弧度, 0=直线, 正数=鼓出 (默认 0.3) — 控制点偏移 = curvature × 距离
 *
 * 改完保存, dev server 自动重渲染.
 */
import type { NewTransitDimension } from "../new-transit-types";

const nether: NewTransitDimension = {
  stations: [],
  lines: [],
};

const end: NewTransitDimension = {
  stations: [],
  lines: [],
  // 末地珍珠炮示例 — 占位坐标, 用户照着真实末地坐标替换
  pearls: [
    {
      id: "end-pearl-cannon-1",
      // 珍珠炮起点 (末地中央岛之类)
      cannon: { x: 0, z: 0 },
      // 3 个接收终点 (末地外岛方向)
      receivers: [
        { id: "r1", x: 200, z: 100 },
        { id: "r2", x: -150, z: 200 },
        { id: "r3", x: 100, z: -200 },
      ],
      // 4 个参数手动调节 (改这里就行)
      style: {
        // color: "#2ccdb1",         // 颜色 (不填走维度默认)
        // dashLength: 80,            // 虚线单段长, world units
        // dashSpacing: 60,           // 虚线间隔, world units
        // opacity: 0.85,             // 整条线透明度 0-1
        // curvature: 0.3,            // 弧度, 0=直线, 0.3=默认
      },
    },
  ],
  // 维度级默认 — 单条线没填的字段会 fallback 这里
  // (留空就走 BUILT_IN: 颜色 #2ccdb1, dash 80/60, opacity 0.85, curvature 0.3)
  style: {
    // pearlColor: "#2ccdb1",
    // pearlDashLength: 80,
    // pearlDashSpacing: 60,
    // pearlOpacity: 0.85,
    // pearlCurvature: 0.3,
  },
};

export { nether, end };
