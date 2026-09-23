// convert-icons-to-webp.mjs
// 遍历 public/icons/ 下所有 PNG → 同名 webp (q=85, 保持原尺寸)
// 例外: Xaero图标 + 地毯图标 强制 w=96
// PNG 输出后保留，不自动删除原图

import sharp from "sharp";
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = "public/icons";
const Q = 85;
// 例外 (强制 w=96)
const FORCE_W96 = new Set(["Xaero图标.png", "地毯图标.png"]);

function walk(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (f.endsWith(".png")) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
console.log(`找到 ${files.length} 个 PNG`);
console.log("");

let totalBefore = 0;
let totalAfter = 0;
let errors = 0;
const start = Date.now();

for (const src of files) {
  const baseName = src.split(/[\\/]/).pop() ?? "";
  const out = src.replace(/\.png$/i, ".webp");
  const before = statSync(src).size;
  totalBefore += before;

  try {
    const transformer = sharp(src).webp({ quality: Q, effort: 4 });
    let buf;
    if (FORCE_W96.has(baseName)) {
      // 强制 w=96, 按原图比例算高 (sharp 默认 cover, 但 we want inside for preserve aspect)
      const meta = await sharp(src).metadata();
      const ratio = meta.height / meta.width;
      buf = await transformer
        .resize({ width: 96, height: Math.round(96 * ratio), fit: "inside", withoutEnlargement: false })
        .toBuffer();
    } else {
      // 同分辨率: 不做 resize
      buf = await transformer.toBuffer();
    }
    writeFileSync(out, buf);
    const after = buf.length;
    totalAfter += after;
    const forced = FORCE_W96.has(baseName) ? " (w=96)" : "";
    console.log(`  ${baseName}: ${(before / 1024).toFixed(1)}KB → ${(after / 1024).toFixed(1)}KB${forced}`);
  } catch (e) {
    console.error(`  [ERROR] ${baseName}: ${e.message}`);
    errors++;
  }
}

const elapsed = ((Date.now() - start) / 1000).toFixed(1);
console.log("");
console.log("=== 完成 ===");
console.log(`耗时: ${elapsed}s`);
console.log(`PNG 总: ${(totalBefore / 1024).toFixed(1)} KB`);
console.log(`webp 总: ${(totalAfter / 1024).toFixed(1)} KB (${((1 - totalAfter / totalBefore) * 100).toFixed(1)}% 节省)`);
console.log(`错误: ${errors}`);