// build-thumbs-fine-sprite.mjs
// 把 78 张 overworld 1024² 原 PNG → 256² webp → 合成 13×6 sprite (3328×1536)
// 输出: public/images/maps/20260907/overworld-thumbs-fine-sprite.webp
//
// 用途: 作为 SVG 底层的"秒加载背景" — 浏览器 1 个请求下完整张地图 (秒显示, 模糊但完整)
// 上层 78 个 512² q=85 thumb 加载完后逐步盖住 sprite
//
// 拼接布局 (重要 — 之前 (col, row) 排序镜像, 已修):
//   - SVG viewBox: vbX = (col-minCol)*1024, vbY = (row-minRow)*1024
//     → col 沿 X (左→右), row 沿 Y (上→下)
//   - sprite 网格 13×6 = 3328×1536, 拉伸到 viewBox 13312×6144 (preserveAspectRatio="none")
//   - tiles 必须按 (row asc, col asc) 排 — 同 row 内 col 从左到右, 跨 row 上到下
//   - grid layout 用 row-major: i%COLS=列, i/COLS=行

import sharp from "sharp";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SRC_DIR = "public/images/maps/20260907/overworld";
const OUT = "public/images/maps/20260907/overworld-thumbs-fine-sprite.webp";
const COLS = 13; // 主世界 col 1-13
const ROWS = 6;  // row 7-12
const TILE = 168; // 用户要求"再缩三分之一" — 256 × 2/3 ≈ 170, 取 168 (跟 13 互质, 但 6×168=1008 整除)
const Q = 45; // q=45 是上轮定的平衡点

const allFiles = readdirSync(SRC_DIR).filter((f) => f.endsWith(".png"));
const sorted = allFiles
  .map((f) => {
    const m = f.match(/^(\d+)_(\d+)_/);
    return { f, col: m ? Number(m[1]) : 0, row: m ? Number(m[2]) : 0 };
  })
  .sort((a, b) => a.row - b.row || a.col - b.col)
  .map((x) => x.f);
console.log(`源文件数: ${sorted.length}`);
console.log(`排序前 5 (row=7): ${sorted.slice(0, 5).join(", ")}`);
console.log(`切到 row=8 (索引 12-16): ${sorted.slice(12, 17).join(", ")}`);
console.log(`末 5 (row=12): ${sorted.slice(-5).join(", ")}`);

// === Multi-q 对比 (全 78 张都跑, 给出真实平均值) ===
console.log("");
console.log("=== 各 q 下 256² 单张均值 + 78 张总和 + 估算 sprite 大小 ===");
const allBuffers = [];
for (const f of sorted) {
  allBuffers.push(await sharp(join(SRC_DIR, f)).toBuffer());
}
console.log("已加载 78 张原 PNG 进内存, 现在测各 q ...");
for (const q of [35, 40, 45, 50, 55, 60, 70]) {
  const sizes = [];
  for (const buf of allBuffers) {
    const out = await sharp(buf)
      .resize(TILE, TILE, { fit: "cover" })
      .webp({ quality: q, effort: 4 })
      .toBuffer();
    sizes.push(out.length);
  }
  const avg = sizes.reduce((s, v) => s + v, 0) / sizes.length;
  const total = sizes.reduce((s, v) => s + v, 0);
  // sprite 二次 webp 压缩 ~ 80-90% 总和
  const estSprite = total * 0.85;
  console.log(
    `q=${String(q).padStart(2)}: 单张 ${(avg / 1024).toFixed(1).padStart(5)} KB  ` +
      `78 张总和 ${(total / 1024).toFixed(1).padStart(6)} KB  ` +
      `估算 sprite ~${(estSprite / 1024).toFixed(0)} KB`
  );
}

// === 生成 sprite (用 Q) ===
console.log("");
console.log(`=== 生成 sprite (q=${Q}) ===`);
const tiles = [];
for (const buf of allBuffers) {
  const t = await sharp(buf)
    .resize(TILE, TILE, { fit: "cover" })
    .webp({ quality: Q, effort: 4 })
    .toBuffer();
  tiles.push(t);
}
console.log(`单张平均: ${(tiles.reduce((s, b) => s + b.length, 0) / tiles.length / 1024).toFixed(1)} KB`);

const SPRITE_W = COLS * TILE; // 3328
const SPRITE_H = ROWS * TILE; // 1536
const canvas = sharp({
  create: {
    width: SPRITE_W,
    height: SPRITE_H,
    channels: 3,
    background: { r: 30, g: 41, b: 59 },
  },
});

// row-major grid: tiles[i] → sprite (i%COLS, i/COLS)
const compositeInput = tiles.map((buf, i) => ({
  input: buf,
  top: Math.floor(i / COLS) * TILE,
  left: (i % COLS) * TILE,
}));

const out = await canvas
  .composite(compositeInput)
  .webp({ quality: Q, effort: 4 })
  .toBuffer();

writeFileSync(OUT, out);
console.log(`输出: ${OUT}`);
console.log(`大小: ${(out.length / 1024).toFixed(1)} KB (${(out.length / 1024 / 1024).toFixed(3)} MB)`);