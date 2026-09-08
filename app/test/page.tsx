import fs from "node:fs";
import path from "node:path";
import { cn } from "@/lib/utils";

/**
 * Test 页 — 把 public/test/ 下的地图瓦片按 (col, row) 拼回完整地图
 *
 * 文件名约定: `{col}_{row}_x{xCoord}_z{zCoord}.png`
 * - 坐标系: x = (col * 1024) - 5632, z = ((row - 6) * 1024) - 3072
 *   验证: col=0 row=9 → x=-5632 z=0 ✓
 * - 每张瓦片 1024x1024 px (PNG), 1 瓦片 = 1024 区块
 * - 网格范围: col 0..37, row 0..12 (38 × 13 = 494 格, 实际有数据的 ~106)
 *
 * 数据源: public/test/ 下的最新时间戳文件夹 (按名字字典序倒序取第一)
 *  每次重新导出地图会生成新文件夹, 不用改代码
 *
 * Server component (动态渲染): 读 fs → 每次请求拿最新文件列表
 */

interface TileInfo {
  col: number;
  row: number;
  x: number;
  z: number;
  filename: string;
  sizeBytes: number;
}

function parseTileFilename(filename: string): TileInfo | null {
  // 0_9_x-5632_z0.png
  const m = filename.match(/^(\d+)_(\d+)_x(-?\d+)_z(-?\d+)\.png$/);
  if (!m) return null;
  return {
    col: Number(m[1]),
    row: Number(m[2]),
    x: Number(m[3]),
    z: Number(m[4]),
    filename,
    sizeBytes: 0,
  };
}

const TEST_DIR = path.join(process.cwd(), "public", "test");
const CELL_PX = 100; // 每格展示尺寸 (原 1024px, 缩到 100px 看全图)

export default function TestMapPage() {
  let folder: string | null = null;
  let tiles: TileInfo[] = [];

  if (fs.existsSync(TEST_DIR)) {
    const folders = fs
      .readdirSync(TEST_DIR)
      .filter((f) => fs.statSync(path.join(TEST_DIR, f)).isDirectory())
      .sort()
      .reverse(); // 时间戳格式 ISO-like, 字典序 = 时间序
    const firstFolder = folders[0];
    if (firstFolder) {
      folder = firstFolder;
      const folderPath = path.join(TEST_DIR, firstFolder);
      const files = fs
        .readdirSync(folderPath)
        .filter((f) => f.endsWith(".png"));
      tiles = files
        .map((f) => {
          const t = parseTileFilename(f);
          if (t) {
            try {
              t.sizeBytes = fs.statSync(path.join(folderPath, f)).size;
            } catch {
              /* ignore */
            }
          }
          return t;
        })
        .filter((t): t is TileInfo => t !== null);
    }
  }

  // 网格范围 (含空格的完整 bounding box)
  const allCols = tiles.map((t) => t.col);
  const allRows = tiles.map((t) => t.row);
  const minCol = tiles.length > 0 ? Math.min(...allCols) : 0;
  const maxCol = tiles.length > 0 ? Math.max(...allCols) : 0;
  const minRow = tiles.length > 0 ? Math.min(...allRows) : 0;
  const maxRow = tiles.length > 0 ? Math.max(...allRows) : 0;
  const numCols = maxCol - minCol + 1;
  const numRows = maxRow - minRow + 1;

  // O(1) 查表
  const tileMap = new Map<string, TileInfo>();
  for (const t of tiles) tileMap.set(`${t.col},${t.row}`, t);

  const totalBytes = tiles.reduce((a, t) => a + t.sizeBytes, 0);
  const emptyCells = numCols * numRows - tiles.length;

  // ---- 坐标原点反推 ----
  // 文件名里 x/z 是世界坐标, col/row 是网格索引. 不同文件夹用不同的原点
  // (例如旧文件夹 x_origin ≈ -6144, 新文件夹 x_origin = -32768), 不能写死公式.
  // 从 col=0 / row=0 实际存在的瓦片反推:
  //   stepX = x(col+1) - x(col)  (应该恒为 1024)
  //   x_origin = x - col * stepX
  // 同理 z_origin / stepZ
  function detectOrigin(
    pickBy: (t: TileInfo) => number,
    valueOf: (t: TileInfo) => number,
  ): { step: number; origin: number; hasZero: boolean } {
    if (tiles.length === 0) return { step: 1024, origin: 0, hasZero: false };
    // 用最常见的 step (mode of diff)
    const diffs: number[] = [];
    const byIndex = new Map<number, TileInfo>();
    for (const t of tiles) byIndex.set(pickBy(t), t);
    const idxs = [...byIndex.keys()].sort((a, b) => a - b);
    for (let i = 1; i < idxs.length; i++) {
      const a = idxs[i - 1];
      const b = idxs[i];
      if (a === undefined || b === undefined) continue;
      const ta = byIndex.get(a);
      const tb = byIndex.get(b);
      if (!ta || !tb) continue;
      diffs.push(valueOf(tb) - valueOf(ta));
    }
    // 取绝对值众数 (1024 是正常, 异常值跳过)
    const freq = new Map<number, number>();
    for (const d of diffs) {
      const k = Math.abs(d);
      if (k > 0 && k < 100000) freq.set(k, (freq.get(k) ?? 0) + 1);
    }
    const step = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 1024;
    // origin: 用 index=0 那个瓦片反推
    const zeroTile = byIndex.get(0);
    if (zeroTile) {
      return { step, origin: valueOf(zeroTile), hasZero: true };
    }
    // 没有 index=0, 用最小 index 外推
    const minIdx = idxs[0];
    if (minIdx === undefined) return { step: 1024, origin: 0, hasZero: false };
    const minTile = byIndex.get(minIdx);
    if (!minTile) return { step: 1024, origin: 0, hasZero: false };
    return { step, origin: valueOf(minTile) - minIdx * step, hasZero: false };
  }

  const xAxis = detectOrigin((t) => t.col, (t) => t.x);
  const zAxis = detectOrigin((t) => t.row, (t) => t.z);
  // 世界坐标范围 = 整个 bounding box (含空格)
  const worldXMin = xAxis.origin + minCol * xAxis.step;
  const worldXMax = xAxis.origin + maxCol * xAxis.step + xAxis.step;
  const worldZMin = zAxis.origin + minRow * zAxis.step;
  const worldZMax = zAxis.origin + maxRow * zAxis.step + zAxis.step;

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
      {/* 顶部信息 */}
      <div className="max-w-full mb-4">
        <h1 className="text-2xl font-bold text-slate-900 mb-1">
          Test Map 拼接
        </h1>
        <p className="text-sm text-slate-600 mb-3">
          从 <code className="bg-slate-200 px-1.5 py-0.5 rounded text-[12px]">public/test/</code> 读瓦片, 按 (col, row) 排回完整地图
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-slate-700">
          <span>
            文件夹:{" "}
            <code className="bg-white border border-slate-200 px-1.5 py-0.5 rounded text-[12px] font-mono">
              {folder ?? "—"}
            </code>
          </span>
          <span>
            瓦片数:{" "}
            <span className="font-semibold text-slate-900">{tiles.length}</span>
            <span className="text-slate-400">
              {" "}
              / {numCols * numRows} 格
            </span>
            {emptyCells > 0 && (
              <span className="text-slate-400">
                {" "}
                ({emptyCells} 空)
              </span>
            )}
          </span>
          <span>
            网格: {numCols} × {numRows}
          </span>
          <span title="整个 bounding box 的世界坐标范围 (含空格)">
            x: {worldXMin} ~ {worldXMax}
          </span>
          <span title="整个 bounding box 的世界坐标范围 (含空格)">
            z: {worldZMin} ~ {worldZMax}
          </span>
          <span>
            体积:{" "}
            <span className="font-mono">
              {(totalBytes / 1024 / 1024).toFixed(1)} MB
            </span>
          </span>
        </div>
        {/* 坐标原点 (自动从数据反推) */}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-slate-600">
          <span>
            坐标原点:{" "}
            <code className="bg-white border border-slate-200 px-1.5 py-0.5 rounded font-mono">
              x_origin = {xAxis.origin}
              {xAxis.hasZero ? "" : " (外推)"}
              , z_origin = {zAxis.origin}
              {zAxis.hasZero ? "" : " (外推)"}
            </code>
          </span>
          <span>
            步长:{" "}
            <code className="bg-white border border-slate-200 px-1.5 py-0.5 rounded font-mono">
              {xAxis.step} × {zAxis.step}
            </code>{" "}
            block/格
          </span>
          <span className="text-slate-400">·</span>
          <code className="text-slate-500 font-mono">
            x = col·{xAxis.step} + ({xAxis.origin}), z = row·{zAxis.step} + ({zAxis.origin})
          </code>
        </div>
        {/* 图例 */}
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px] text-slate-600">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3.5 h-3.5 bg-white border border-slate-500" />
            有数据
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3.5 h-3.5 bg-slate-200 border border-slate-400" />
            空 (未导出)
          </span>
          <span className="text-slate-400">· 网格: 北上南下, 西左东右</span>
        </div>
      </div>

      {/* 地图网格 */}
      {tiles.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-500">
          public/test/ 下没找到瓦片
        </div>
      ) : (
        <div className="overflow-auto rounded-2xl border border-slate-300 bg-slate-200 p-2 shadow-inner">
          <div
            className="grid"
            style={{
              gridTemplateColumns: `repeat(${numCols}, ${CELL_PX}px)`,
              gridTemplateRows: `repeat(${numRows}, ${CELL_PX}px)`,
              gap: 0,
            }}
          >
            {Array.from({ length: numRows }).map((_, rowIdx) => {
              const row = rowIdx + minRow;
              return Array.from({ length: numCols }).map((_, colIdx) => {
                const col = colIdx + minCol;
                const tile = tileMap.get(`${col},${row}`);
                return (
                  <div
                    key={`${col}-${row}`}
                    title={
                      tile
                        ? `c${tile.col} r${tile.row}  x=${tile.x} z=${tile.z}  (${(tile.sizeBytes / 1024).toFixed(0)} KB)`
                        : `空 c=${col} r=${row}`
                    }
                    className={cn(
                      "relative border border-slate-500/70 overflow-hidden",
                      tile ? "bg-white" : "bg-slate-200/70",
                    )}
                    style={{ width: CELL_PX, height: CELL_PX }}
                  >
                    {tile && (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element -- 本地瓦片, 不走 next/image 优化 */}
                        <img
                          src={`/test/${folder}/${tile.filename}`}
                          alt={`c${tile.col} r${tile.row} x${tile.x} z${tile.z}`}
                          loading="lazy"
                          className="w-full h-full object-cover block"
                        />
                        {/* 左下角坐标 (白底黑字, 始终可见) */}
                        <span className="absolute bottom-0 left-0 px-1 text-[9px] leading-tight font-mono bg-white/85 text-slate-800 border-t border-r border-slate-300 rounded-tr">
                          c{tile.col}·r{tile.row}
                        </span>
                      </>
                    )}
                  </div>
                );
              });
            })}
          </div>
        </div>
      )}

      <p className="mt-4 text-[12px] text-slate-500">
        调试用页面 — 每次新导出地图生成新文件夹, 页面自动读最新的; 坐标原点 + 步长
        从数据反推, 不同导出用不同原点 (例如旧 ≈ (-6144, -3072), 新 = (-32768, -4608))。
      </p>
    </div>
  );
}
