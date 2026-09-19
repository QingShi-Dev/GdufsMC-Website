/**
 * 一次性脚本: 把 data/map/labels 里 PNG 图片路径批量替换成 thumbs/ webp
 * 一次性脚本: 把 data/map/labels 里 PNG 图片路径批量替换成 thumbs/ webp
 *
 * 替换规则:
 *   /images/maps/buildings/{rest}.png  →  /images/maps/thumbs/buildings/{rest}.webp
 *   /images/maps/machines/{rest}.png   →  /images/maps/thumbs/machines/{rest}.webp
 *   /images/maps/regions/{rest}.png    →  /images/maps/thumbs/regions/{rest}.webp
 *   /images/maps/transit/{rest}.png    →  /images/maps/thumbs/transit/{rest}.webp
 *
 * 完整大图版在 /images/maps/full/...webp, lightbox 那边把 thumbs/ 替换成 full/ 即可拿到。
 * 这样 data 只存一份 (small thumb), 渲染时根据需要派生 full。
 *
 * 注意: 之前 PowerShell `-replace` 把中文 UTF-8 多字节弄坏, 这里用 Node (Buffer + String)
 * 读写, UTF-8 完全安全。
 */
const fs = require("fs");
const path = require("path");

const DATA_FILES = [
  "data/map/labels/overworld.ts",
  "data/map/labels/other-dims.ts",
];

const PATTERN = /(["'])\/images\/maps\/(buildings|machines|regions|transit)\/([^"']+?)\.png\1/g;

let totalReplaced = 0;

for (const rel of DATA_FILES) {
  const abs = path.join(process.cwd(), rel);
  const before = fs.readFileSync(abs, "utf8");
  const beforeCount = (before.match(PATTERN) || []).length;
  const after = before.replace(PATTERN, (_, q1, sub, rest) => {
    return `${q1}/images/maps/thumbs/${sub}/${rest}.webp${q1}`;
  });
  const afterCount = (after.match(PATTERN) || []).length;
  fs.writeFileSync(abs, after, "utf8");
  const replaced = beforeCount - afterCount;
  totalReplaced += replaced;
  console.log(`[${rel}] 替换 ${replaced} 处`);
}

console.log(`\n合计 ${totalReplaced} 处 PNG → webp 替换完成`);