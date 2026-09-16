/**
 * 一次性脚本: 在 public/test/ 下生成 3 个维度 × 4 张瓦片 × 5 个压缩质量 = 60 张对比图
 *   - 目的: 人工对比地图瓦片 vs 不同质量 webp 的体积/视觉
 *   - 源图: public/images/maps/20260907/{overworld,nether,end}/*.png
 *   - 每个维度找 4 张最接近 (0, 0) 的瓦片 (按距离平方排序, 取前 4)
 *   - 运行: node scripts/gen-test-tiles.cjs
 *   - 产物: public/test/map-{dim}/{原图.png, q95.webp, q90.webp, q85.webp, q80.webp}
 */
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const TILES_ROOT = "public/images/maps/20260907";
const TEST_ROOT = "public/test";
const QUALITIES = [95, 90, 85, 80];
const TILE_COUNT = 4; // 每个维度取 4 张最接近 (0, 0) 的瓦片

const DIMS = ["overworld", "nether", "end"];

(async () => {
  for (const dim of DIMS) {
    const dimDir = path.join(TILES_ROOT, dim);
    if (!fs.existsSync(dimDir)) {
      console.error(`[skip] 维度目录不存在: ${dimDir}`);
      continue;
    }
    const all = fs
      .readdirSync(dimDir)
      .filter((f) => f.endsWith(".png"))
      .map((f) => {
        // 文件名格式: {col}_{row}_x{x}_z{z}.png — 取 x/z 算到 (0,0) 的距离
        const m = f.match(/x(-?\d+)_z(-?\d+)/);
        if (!m) return null;
        return { name: f, x: +m[1], z: +m[2] };
      })
      .filter(Boolean);
    // 按 x² + z² 排序, 取前 4 张
    all.sort((a, b) => a.x * a.x + a.z * a.z - (b.x * b.x + b.z * b.z));
    const picks = all.slice(0, TILE_COUNT);
    console.log(`\n[${dim}] 选 ${TILE_COUNT} 张最接近 (0,0) 的瓦片:`);
    for (const t of picks) {
      console.log(`  ${t.name}  (x=${t.x}, z=${t.z}, d²=${t.x * t.x + t.z * t.z})`);
    }
    const outDir = path.join(TEST_ROOT, `map-${dim}`);
    fs.mkdirSync(outDir, { recursive: true });
    for (const t of picks) {
      const srcAbs = path.join(dimDir, t.name);
      // 文件名简化 (去掉 col_row_ 前缀): "6_10_x0_z0.png" → "x0_z0.png"
      const simpleName = t.name.replace(/^[^_]+_[^_]+_/, "");
      const origDest = path.join(outDir, `原图_${simpleName}`);
      fs.copyFileSync(srcAbs, origDest);
      const stat = fs.statSync(origDest);
      console.log(`  [${simpleName}] 原图 ${(stat.size / 1024 / 1024).toFixed(2)} MB`);
      for (const q of QUALITIES) {
        const webpDest = path.join(outDir, `q${q}_${simpleName.replace(".png", ".webp")}`);
        await sharp(srcAbs)
          .webp({ quality: q })
          .toFile(webpDest);
      }
    }
  }
  console.log("\ndone");
})();