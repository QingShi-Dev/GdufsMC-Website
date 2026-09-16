/**
 * 一次性脚本: 在 public/test/ 下生成 6 个建筑的 5 张对比图 (原图 + q=95/90/85/80 webp)
 *   - 目的: 人工对比原图 vs 不同质量 webp 的体积/视觉
 *   - 运行: node scripts/gen-test-images.cjs
 *   - 产物: public/test/<建筑名>/{原图.png, q95.webp, q90.webp, q85.webp, q80.webp}
 */
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

// 源图 → 建筑名映射
const BUILDINGS = [
  { name: "320熔炉组", src: "public/images/maps/machines/overworld/320熔炉组.png" },
  { name: "地图画展览馆-内饰", src: "public/images/maps/buildings/overworld/地图画展览馆-内饰.png" },
  { name: "矢量珍珠炮", src: "public/images/maps/machines/nether/矢量珍珠炮.png" },
  { name: "船吸刷怪塔收集", src: "public/images/maps/machines/nether/船吸刷怪塔收集.png" },
  { name: "水流全物品-内饰", src: "public/images/maps/machines/end/水流全物品-内饰.png" },
  { name: "袭击塔", src: "public/images/maps/machines/overworld/袭击塔.png" },
];

const QUALITIES = [95, 90, 85, 80];
const TEST_ROOT = "public/test";

(async () => {
  for (const { name, src } of BUILDINGS) {
    const srcAbs = path.resolve(src);
    if (!fs.existsSync(srcAbs)) {
      console.error(`[skip] 源图不存在: ${src}`);
      continue;
    }
    const outDir = path.join(TEST_ROOT, name);
    fs.mkdirSync(outDir, { recursive: true });
    const origDest = path.join(outDir, "原图.png");
    fs.copyFileSync(srcAbs, origDest);
    const stat = fs.statSync(origDest);
    console.log(`[${name}] 原图 → ${(stat.size / 1024 / 1024).toFixed(2)} MB`);
    for (const q of QUALITIES) {
      const webpDest = path.join(outDir, `q${q}.webp`);
      await sharp(srcAbs)
        .webp({ quality: q })
        .toFile(webpDest);
      const ws = fs.statSync(webpDest);
      console.log(`  q=${q}: ${(ws.size / 1024).toFixed(0)} KB`);
    }
  }
  console.log("done");
})();