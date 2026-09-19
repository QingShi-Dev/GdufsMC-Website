// rebuild-images-from-origin.mjs
// 从 origin/ (原图 PNG) 重新生成:
//   - full/{relpath}/{basename}.webp  (q=85, 限制最大尺寸)
//   - thumbs/{relpath}/{basename}.webp:
//       * 头图 (basename 不含 -): w=320, q=75
//       * 细节图 (basename 含 -): w=92, q=70
//
// 覆盖现有 full/ thumbs/ 下的同名 webp — git 会识别 rename/覆盖
//
// 命名规则: origin/buildings/overworld/八角塔-材料展示馆.png
//          → full/buildings/overworld/八角塔-材料展示馆.webp
//          → thumbs/buildings/overworld/八角塔-材料展示馆.webp (细节图, w=92 q=70)

import sharp from "sharp";
import { readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, relative, basename as pathBasename } from "node:path";

const ORIGIN = "public/images/maps/origin";
const FULL = "public/images/maps/full";
const THUMBS = "public/images/maps/thumbs";

const FULL_Q = 85;
// full 限制最大边 — 防止 8000x6000 之类的图把内存/输出打爆
// 大部分 MC 截图 1024-2048 宽, 设 2560 已经够用
const FULL_MAX = 2560;

// === Thumb 分类规则 ===
// 主图条件 (用头图尺寸): basename 不含 -, 或 第一个 - 前的文字是 "副站"/"出口"
//   例: "八角塔.webp" → 主图 (无 -)
//   例: "副站-蜜蜂农场.webp" → 主图 (- 前是 "副站")
//   例: "出口-试炼密室.webp" → 主图 (- 前是 "出口")
// 细节图: 含 - 且第一个 - 前既不是 "副站" 也不是 "出口"
//   例: "八角塔-材料展示馆.webp" → 细节图 (- 前是 "八角塔")
// 注意: baseName 可能含路径 (e.g. "transit/nether/出口-八角塔"), 必须用 basename 再 split
const MAIN_PREFIXES = new Set(["副站", "出口"]);
function classify(baseName) {
  // 去掉路径, 只看文件名部分
  const file = pathBasename(baseName);
  if (!file.includes("-")) return "main";
  const firstPart = file.split("-")[0];
  if (MAIN_PREFIXES.has(firstPart)) return "main";
  return "detail";
}

const MAIN_W = 480;
const MAIN_Q = 85;
const DETAIL_W = 210;
const DETAIL_Q = 80;

// CLI 开关: --thumbs-only 跳过 full (用户上次要求改 thumb 不改 full 时用)
const THUMBS_ONLY = process.argv.includes("--thumbs-only");

// 递归遍历 origin 拿所有 PNG
function walk(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      out.push(...walk(p));
    } else if (f.endsWith(".png")) {
      out.push(p);
    }
  }
  return out;
}

const files = walk(ORIGIN);
console.log(`源文件: ${files.length} 张 PNG`);
console.log(THUMBS_ONLY ? "(模式: thumbs-only, 跳过 full)" : "(模式: full + thumbs)");
console.log("");

let mainCount = 0;
let detailCount = 0;
let fullBytes = 0;
let thumbBytes = 0;
let fullErrors = 0;
let thumbErrors = 0;
const startTime = Date.now();

// 处理每张
for (const src of files) {
  const rel = relative(ORIGIN, src); // buildings/overworld/八角塔.png
  const baseName = rel.replace(/\.png$/i, "");
  const kind = classify(baseName);
  if (kind === "main") mainCount++;
  else detailCount++;

  // === full: 原图尺寸 (限 max) q=85 webp ===
  if (!THUMBS_ONLY) {
    const fullOut = join(FULL, baseName + ".webp");
    mkdirSync(dirname(fullOut), { recursive: true });
    try {
      const buf = await sharp(src)
        .resize({ width: FULL_MAX, height: FULL_MAX, fit: "inside", withoutEnlargement: true })
        .webp({ quality: FULL_Q, effort: 4 })
        .toBuffer();
      writeFileSync(fullOut, buf);
      fullBytes += buf.length;
    } catch (e) {
      console.error(`  [full ERROR] ${rel}: ${e.message}`);
      fullErrors++;
    }
  }

  // === thumb: 按类型选尺寸 + q ===
  const thumbOut = join(THUMBS, baseName + ".webp");
  mkdirSync(dirname(thumbOut), { recursive: true });
  try {
    const w = kind === "main" ? MAIN_W : DETAIL_W;
    const q = kind === "main" ? MAIN_Q : DETAIL_Q;
    const buf = await sharp(src)
      .resize({ width: w, withoutEnlargement: false }) // 强制拉到 w (thumb 都是 16:9 或类似, 拉一下)
      .webp({ quality: q, effort: 4 })
      .toBuffer();
    writeFileSync(thumbOut, buf);
    thumbBytes += buf.length;
  } catch (e) {
    console.error(`  [thumb ERROR] ${rel}: ${e.message}`);
    thumbErrors++;
  }
}

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
console.log("");
console.log("=== 完成 ===");
console.log(`耗时: ${elapsed}s`);
console.log(`主图 (无 - / 副站- / 出口-): ${mainCount} 张`);
console.log(`细节图 (其它 -X): ${detailCount} 张`);
if (!THUMBS_ONLY) {
  console.log(`full 总: ${(fullBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`full 平均: ${(fullBytes / files.length / 1024).toFixed(1)} KB/张`);
}
console.log(`thumbs 总: ${(thumbBytes / 1024 / 1024).toFixed(2)} MB`);
console.log(`thumbs 平均: ${(thumbBytes / files.length / 1024).toFixed(1)} KB/张`);
if (fullErrors || thumbErrors) {
  console.log(`!! errors: full=${fullErrors} thumb=${thumbErrors}`);
}