/**
 * 一次性脚本: 把 buildings/machines/regions/transit 图片转两套 webp
 *   - full/<原相对路径>.webp     q=95 (给 lightbox 看大图)
 *   - thumbs/<原相对路径>.webp    头图 q=75 / 细节图 q=60 (给 popup 缩略图)
 *   - 命名规则: 原 `/images/maps/buildings/overworld/八角塔.png` → q=75 thumb
 *              原 `/images/maps/buildings/overworld/八角塔-材料展示馆.png` → q=60 thumb
 *   - overworld 瓦片 q=95 webp (跟 PNG 同目录)
 *
 * 原 PNG 保留 — 用户要求 "原图先不删"
 *
 * 运行: node scripts/gen-image-webps.cjs
 */
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const SRC_ROOT = "public/images/maps";
const FULL_ROOT = "public/images/maps/full";
const THUMBS_ROOT = "public/images/maps/thumbs";
const OVERWORLD_TILES = "public/images/maps/20260907/overworld";

function isHeroImage(filename) {
  // 无 - 横杠 = 头图, 有 - = 细节图
  // "八角塔.png" → 头图 (q75)
  // "八角塔-材料展示馆.png" → 细节图 (q60)
  const stem = filename.replace(/\.[^.]+$/, ""); // 剥扩展名
  return !stem.includes("-");
}

async function processBuildingImages() {
  // 遍历 buildings/machines/regions/transit 下所有 .png
  // 注意: buildings 是单层, machines/regions/transit 是 按维度分 (overworld/nether/end) 双层
  const SUBDIRS = ["buildings", "machines", "regions", "transit"];

  for (const sub of SUBDIRS) {
    const subAbs = path.join(SRC_ROOT, sub);
    if (!fs.existsSync(subAbs)) continue;
    const files = collectPngs(subAbs);
    console.log(`\n[${sub}] 找到 ${files.length} 个 PNG`);
    for (const { abs, rel } of files) {
      const filename = path.basename(rel);
      const qFull = 95;
      const qThumb = isHeroImage(filename) ? 75 : 60;
      // 输出 full/...rel.webp
      const fullRel = rel.replace(/\.png$/i, ".webp");
      const fullAbs = path.join(FULL_ROOT, sub, path.dirname(rel), path.basename(fullRel));
      fs.mkdirSync(path.dirname(fullAbs), { recursive: true });
      await sharp(abs).webp({ quality: qFull }).toFile(fullAbs);
      // 输出 thumbs/...rel.webp
      const thumbRel = rel.replace(/\.png$/i, ".webp");
      const thumbAbs = path.join(THUMBS_ROOT, sub, path.dirname(rel), path.basename(thumbRel));
      fs.mkdirSync(path.dirname(thumbAbs), { recursive: true });
      await sharp(abs).webp({ quality: qThumb }).toFile(thumbAbs);
    }
    console.log(`  → ${files.length * 2} 个 webp 已生成 (full + thumbs)`);
  }
}

function collectPngs(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of fs.readdirSync(d)) {
      const abs = path.join(d, name);
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) walk(abs);
      else if (name.toLowerCase().endsWith(".png")) {
        out.push({ abs, rel: path.relative(dir, abs) });
      }
    }
  };
  walk(dir);
  return out;
}

async function processOverworldTiles() {
  // overworld 瓦片: 全部 q=95 webp, 跟 PNG 同目录
  if (!fs.existsSync(OVERWORLD_TILES)) {
    console.error(`[skip] overworld 瓦片目录不存在: ${OVERWORLD_TILES}`);
    return;
  }
  const files = fs.readdirSync(OVERWORLD_TILES).filter((f) => f.toLowerCase().endsWith(".png"));
  console.log(`\n[overworld 瓦片] 找到 ${files.length} 个 PNG, 转 q=95 webp`);
  for (const name of files) {
    const srcAbs = path.join(OVERWORLD_TILES, name);
    const dstAbs = path.join(OVERWORLD_TILES, name.replace(/\.png$/i, ".webp"));
    await sharp(srcAbs).webp({ quality: 95 }).toFile(dstAbs);
  }
  console.log(`  → ${files.length} 个 webp 已生成`);
}

(async () => {
  console.log("=== 1. 建筑图片 (buildings/machines/regions/transit) ===");
  await processBuildingImages();
  console.log("\n=== 2. overworld 瓦片 ===");
  await processOverworldTiles();
  console.log("\ndone");
})();