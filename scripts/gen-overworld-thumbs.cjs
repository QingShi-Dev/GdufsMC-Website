/**
 * 一次性脚本: 把 overworld 瓦片转 512×512 q=60 webp 到 overworld-thumbs 目录
 *
 * 用法:
 *   - 默认所有 PNG: node scripts/gen-overworld-thumbs.cjs
 *   - 质量可调: Q=70 node scripts/gen-overworld-thumbs.cjs
 *
 * 背景: 缩略图用于秒显示 (底层 PNG 显示前占位). 用户最新要求:
 *   - 1/4 分辨率 (每边 1/2, 512×512): 比 q=60 1024×1024 又省 ~75% 体积
 *   - PNG 加载完成后 opacity 切到 PNG, webp 永久隐藏 (用户要求"png 传来了直接替换 webp")
 *   - fetchPriority='high' 预加载 thumbs, 确保先到 (浏览器不会让 PNG 抢先)
 * 真实数据 (overworld 1024×1024 瓦片):
 *   - 原图 PNG ~846 KB
 *   - q=60 1024×1024 webp ~210 KB
 *   - q=60 512×512 webp  ~50 KB (省 94%)
 *
 * 客户端逻辑 (MapCanvas, 双层渲染 + 加载完成切):
 *   - thumbs + PNG 同时在 DOM (两个 <image>), opacity 切 0/1
 *   - 初始: webp opacity=1, PNG opacity=0 (秒显示 webp)
 *   - PNG onLoad 后: webp opacity=0, PNG opacity=1 (永久, 缩小也不再切回)
 *   - fetchPriority='high' 预加载 thumbs, 确保先到
 *   - nether/end 没 srcThumb, 单 PNG 图不变
 *
 * 输出: public/images/maps/20260907/overworld-thumbs/{col}_{row}_x{x}_z{z}.webp
 *   - 跟 overworld/ 同名结构, 客户端两层叠加渲染
 */
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const SRC_DIR = "public/images/maps/20260907/overworld";
const DST_DIR = "public/images/maps/20260907/overworld-thumbs";
const Q = Number(process.env.Q) || 60;
// 1/4 分辨率: 长宽各 1/2, 总像素 1/4. 比 q=60 1024×1024 又省 ~75% 体积
const THUMB_SIZE = Number(process.env.SIZE) || 512;

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
    await sharp(srcAbs)
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: "fill" })
      .webp({ quality: Q })
      .toFile(dstAbs);
  }
  console.log(`  → ${files.length} 个 webp 已生成`);
}

main().then(() => console.log("done")).catch((err) => {
  console.error(err);
  process.exit(1);
});