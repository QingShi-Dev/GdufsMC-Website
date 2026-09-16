import "server-only";
import fs from "node:fs";
import path from "node:path";
import { TILE_PX } from "./constants";

/**
 * Server-side 数据加载器 — 把 public/images/maps/20260907/{overworld,nether,end}
 * 下的瓦片拼成 GuideMap 需要的 NewWorld[] 数据
 *
 * 瓦片文件名: {col}_{row}_x{xCoord}_z{zCoord}.{png|webp}
 *   - overworld 现在用 webp (q=95), 跟 PNG 同目录, 这里优先 webp
 *   - nether / end 仍然用 PNG (用户要求其他维度不变)
 * 坐标系: x = (col - minCol) * 1024,  z = (row - minRow) * 1024  (viewBox 单位 = 1024 block)
 *  跟 public/test/ 不同, 这里不显式存世界坐标, 全部映射到 viewBox 局部坐标
 *
 * 维度顺序固定 overworld → nether → end, tab 顺序跟原 guide-map 一致
 */

export interface NewMapTile {
  col: number;
  row: number;
  x: number; // 世界坐标 (用于 hover tooltip / 调试)
  z: number;
  /** viewBox 局部坐标 (放在 SVG 里的 x) */
  vbX: number;
  /** viewBox 局部坐标 (放在 SVG 里的 y) */
  vbY: number;
  src: string;
}

export type NewMapTone = "plains" | "nether" | "end";

/**
 * 地图高亮区域 (viewBox 局部坐标, 单位 = 1024 block)
 *  - 在 SVG 里渲染为白框, 标记特殊区块
 *  - 例如主世界右下角"两个单格拼接"和"6 格块拼接"分别加白框
 *  - lines 可选: 在高亮区域内画额外分隔线 (例如两个单格之间加竖线)
 */
export interface NewMapHighlight {
  x: number;
  y: number;
  width: number;
  height: number;
  /** 高亮区域内的附加分隔线 (viewBox 坐标, 渲染为白线) */
  lines?: Array<{ x1: number; y1: number; x2: number; y2: number }>;
}

export interface NewMapLayer {
  width: number;
  height: number;
  tone: NewMapTone;
  minCol: number;
  minRow: number;
  tiles: NewMapTile[];
  /** 白框高亮区域 (可选, 没有就不渲染) */
  highlights?: NewMapHighlight[];
}

export type NewWorldId = "overworld" | "nether" | "end";

export interface NewWorldMeta {
  id: NewWorldId;
  name: string;
  /** accent 颜色 (tab 小圆点) */
  accent: string;
  version: string;
  description: string;
  map: NewMapLayer;
}

// TILE_PX 从 ./new-guide-map-constants 引入 (single source of truth, client 端也用同一份)
// 注意: overworld 现在有 .webp 跟 .png 同目录, 我们**优先 webp** (体积小, 浏览器原生支持)
// nether / end 仍然只有 PNG (用户要求其他维度不变)
const RE_PNG = /^(\d+)_(\d+)_x(-?\d+)_z(-?\d+)\.png$/;
const RE_WEBP = /^(\d+)_(\d+)_x(-?\d+)_z(-?\d+)\.webp$/;

/**
 * 主世界右下角 8 张瓦片 (col 12-13, row 9-12) 实际是 relayout 时从其他位置搬来的:
 *  - 2 单格: 原 (5,4) 和 (37,1)
 *  - 6 格块: 原 (20-21, 3-5)
 * 它们的图像内容来自其他世界位置, 不是主地图的地理延伸。
 * 文件名按新 col/row 重新生成 (`x = 1024*col - 6144`), 所以默认算出的 x/z 是"网格位置",
 * 跟图像实际对应的世界坐标对不上 — hover 时显示会"跳"到错误位置。
 *
 * 修法: 这些瓦片的 (col,row) → (x,z) 用这里写死的"原始世界坐标"覆盖, 跟图像内容一致。
 * 键 = 当前网格 (col,row), 值 = 图像实际对应的左上角世界坐标 (pre-relayout 公式同款)
 */
const RELOCATED_TILE_OVERRIDES: Record<string, { x: number; z: number }> = {
  "12,9": { x: -1024, z: -6144 }, // 原 5_4
  "13,9": { x: 31744, z: -9216 }, // 原 37_1
  "12,10": { x: 14336, z: -7168 }, // 原 20_3
  "13,10": { x: 15360, z: -7168 }, // 原 21_3
  "12,11": { x: 14336, z: -6144 }, // 原 20_4
  "13,11": { x: 15360, z: -6144 }, // 原 21_4
  "12,12": { x: 14336, z: -5120 }, // 原 20_5
  "13,12": { x: 15360, z: -5120 }, // 原 21_5
};

const DIM_META: Record<
  NewWorldId,
  { name: string; accent: string; version: string; description: string; tone: NewMapTone }
> = {
  overworld: {
    name: "主世界",
    accent: "#22c55e",
    version: "The Overworld",
    description:
      "原版 Minecraft 主世界。森林、雪山、沙漠、海洋、山地应有尽有, 玩家聚落密集。",
    tone: "plains",
  },
  nether: {
    name: "下界",
    accent: "#dc2626",
    version: "The Nether",
    description:
      "地狱维度。下界堡垒、灵魂沙峡谷、玄武岩三角洲、猪灵交易所、末影人刷怪塔。",
    tone: "nether",
  },
  end: {
    name: "末地",
    accent: "#7c3aed",
    version: "The End",
    description:
      "末影龙维度。外岛、紫颂果农场、末地城、鞘翅探索。",
    tone: "end",
  },
};

function loadDimension(
  baseDir: string,
  dimId: NewWorldId,
): NewMapLayer | null {
  const dimDir = path.join(baseDir, dimId);
  if (!fs.existsSync(dimDir)) return null;
  // overworld 同时有 .png 和 .webp — 优先选 webp (q=95, 体积小, 浏览器原生支持)
  // nether / end 只有 .png — 跟以前一样
  const isOverworld = dimId === "overworld";
  const files = isOverworld
    ? fs
        .readdirSync(dimDir)
        .filter((f) => f.endsWith(".webp"))
        .sort()
    : fs
        .readdirSync(dimDir)
        .filter((f) => f.endsWith(".png"))
        .sort();
  if (files.length === 0) return null;

  const tiles: NewMapTile[] = [];
  let minCol = Infinity;
  let minRow = Infinity;
  let maxCol = -Infinity;
  let maxRow = -Infinity;

  for (const f of files) {
    const m = f.match(isOverworld ? RE_WEBP : RE_PNG);
    if (!m) continue;
    const col = Number(m[1]);
    const row = Number(m[2]);
    let x = Number(m[3]);
    let z = Number(m[4]);
    // 主世界右下角 8 张瓦片是 relayout 时从其他位置搬来的,
    // 文件名是按新 col/row 重新生成的, x/z 是"网格位置"不是"图像实际世界位置"
    // 改用原始世界坐标, hover 时才跟图像内容对得上
    const override = RELOCATED_TILE_OVERRIDES[`${col},${row}`];
    if (override) {
      x = override.x;
      z = override.z;
    }
    minCol = Math.min(minCol, col);
    minRow = Math.min(minRow, row);
    maxCol = Math.max(maxCol, col);
    maxRow = Math.max(maxRow, row);
    tiles.push({ col, row, x, z, vbX: 0, vbY: 0, src: `/${path.relative(path.join(process.cwd(), "public"), path.join(dimDir, f)).replace(/\\/g, "/")}` });
  }
  if (tiles.length === 0) return null;

  // 计算 viewBox 局部坐标 (相对 minCol/minRow)
  for (const t of tiles) {
    t.vbX = (t.col - minCol) * TILE_PX;
    t.vbY = (t.row - minRow) * TILE_PX;
  }

  const width = (maxCol - minCol + 1) * TILE_PX;
  const height = (maxRow - minRow + 1) * TILE_PX;

  // 主世界特殊标注: 右下角预留区现在被填了"两个单格拼接"和"6 格块拼接"
  // 用白框在 SVG 上标记这两个区域
  //  - 两个单格: (c=12-13, r=9) → x=(12-1)*1024, y=(9-7)*1024, w=2*1024, h=1*1024
  //  - 6 格块:   (c=12-13, r=10-12) → x=11264, y=3072, w=2048, h=3072
  // 两个单格之间加竖线分隔 (x = 12-1 + 1 = 12288, 即 col 12/col 13 的边界)
  const twoTileX = (12 - minCol) * TILE_PX;
  const twoTileY = (9 - minRow) * TILE_PX;
  const sixTileX = (12 - minCol) * TILE_PX;
  const sixTileY = (10 - minRow) * TILE_PX;
  const highlights: NewMapHighlight[] | undefined =
    dimId === "overworld"
      ? [
          {
            x: twoTileX,
            y: twoTileY,
            width: 2 * TILE_PX,
            height: 1 * TILE_PX,
            // 两个单格之间的竖线 (从顶到底, 跟外框连一起)
            lines: [{ x1: twoTileX + TILE_PX, y1: twoTileY, x2: twoTileX + TILE_PX, y2: twoTileY + TILE_PX }],
          },
          { x: sixTileX, y: sixTileY, width: 2 * TILE_PX, height: 3 * TILE_PX },
        ]
      : undefined;

  return {
    width,
    height,
    tone: DIM_META[dimId].tone,
    minCol,
    minRow,
    tiles,
    highlights,
  };
}

export interface LoadOptions {
  /** 瓦片根目录 (相对 process.cwd() 或绝对路径). 默认 public/images/maps/20260907 */
  baseDir?: string;
}

export function loadMapData(
  options: LoadOptions = {},
): NewWorldMeta[] {
  const baseDir = options.baseDir
    ? path.isAbsolute(options.baseDir)
      ? options.baseDir
      : path.join(process.cwd(), options.baseDir)
    : path.join(process.cwd(), "public", "images", "maps", "20260907");

  const out: NewWorldMeta[] = [];
  for (const dimId of ["overworld", "nether", "end"] as const) {
    const layer = loadDimension(baseDir, dimId);
    if (!layer) continue;
    const meta = DIM_META[dimId];
    out.push({
      id: dimId,
      name: meta.name,
      accent: meta.accent,
      version: meta.version,
      description: meta.description,
      map: layer,
    });
  }
  return out;
}
