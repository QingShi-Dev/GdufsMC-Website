/* eslint-disable @typescript-eslint/no-require-imports -- standalone Node script, CommonJS 是合理的 */
/**
 * 一次性脚本: 把 overworld 瓦片转 q=90 webp 到 overworld-thumbs 目录
 *
 * 用法:
 *   - 默认所有 PNG: node scripts/gen-overworld-thumbs.cjs
 *   - 质量可调 (q=90 是甜点, 体积/视觉平衡)
 *
 * 背景: 用户实测 overworld 瓦片全用 webp q=95 视觉损失明显 (瓦片细节密集,
 * 压缩 artifact 在 zoom 2.5×+ 看得很清楚). 改成两阶段:
 *   - 缩略图阶段 (k < 2.5): 用 q=90 webp (体积小, 视觉够用)
 *   - 高清阶段 (k >= 2.5): 用原 PNG (无压缩, 放大清晰)
 *
 * 输出: public/images/maps/20260907/overworld-thumbs/{col}_{row}_x{x}_z{z}.webp
 *   - 跟 overworld/ 同名结构, 客户端按 k 阈值切换 src
 */
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const SRC_DIR = "public/images/maps/20260907/overworld";
const DST_DIR = "public/images/maps/20260907/overworld-thumbs";
const Q = Number(process.env.Q) || 90;

async function main() {
  if (!fs.existsSync(SRC_DIR)) {
    console.error(`[error] 源目录不存在: ${SRC_DIR}`);
    process.exit(1);
  }
  fs.mkdirSync(DST_DIR, { recursive: true });

  const files = fs
    .readdirSync(SRC_DIR)
    .filter((f) => f.toLowerCase().endsWith(".png"))
    .sort();
  console.log(`[overworld] 找到 ${files.length} 个 PNG, 转 q=${Q} webp → ${DST_DIR}`);

  for (const name of files) {
    const srcAbs = path.join(SRC_DIR, name);
    const dstName = name.replace(/\.png$/i, ".webp");
    const dstAbs = path.join(DST_DIR, dstName);
    await sharp(srcAbs).webp({ quality: Q }).toFile(dstAbs);
  }
  console.log(`  → ${files.length} 个 webp 已生成`);
}

main().then(() => console.log("done")).catch((err) => {
  console.error(err);
  process.exit(1);
});