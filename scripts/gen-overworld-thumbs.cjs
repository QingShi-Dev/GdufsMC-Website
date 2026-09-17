/* eslint-disable @typescript-eslint/no-require-imports -- standalone Node script, CommonJS 是合理的 */
/**
 * 一次性脚本: 把 overworld 瓦片转 q=90 webp 到 overworld-thumbs 目录
 *
 * 用法:
 *   - 默认所有 PNG: node scripts/gen-overworld-thumbs.cjs
 *   - 质量可调 (q=90 是甜点, 体积/视觉平衡)
 *
 * 背景: 缩略图仅用于"首次加载占位"——让用户视觉上秒加载, 然后 PNG 在后台慢慢
 * fetch 替换. q=75 是甜点: 体积小 (比 q=90 又省 ~30%), 视觉质量对缩略图场景够用.
 * 真实数据 (1024×1024 overworld 瓦片):
 *   - 原图 PNG ~846 KB
 *   - q=90 webp ~466 KB (省 45%)
 *   - q=75 webp ~280 KB (省 67%)
 *
 * 客户端逻辑 (MapCanvas):
 *   - 首次渲染: 用 srcThumb (q=75 webp, 秒显示)
 *   - PNG onLoad 后: 切到 src, 标记 hiresLoaded tile key, 持久化 localStorage
 *   - 跨刷新/切维度/SW 命中: hiresLoaded set 还在 → 直接 PNG
 *
 * 输出: public/images/maps/20260907/overworld-thumbs/{col}_{row}_x{x}_z{z}.webp
 *   - 跟 overworld/ 同名结构, 客户端按 k 阈值切换 src
 */
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const SRC_DIR = "public/images/maps/20260907/overworld";
const DST_DIR = "public/images/maps/20260907/overworld-thumbs";
const Q = Number(process.env.Q) || 75;

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