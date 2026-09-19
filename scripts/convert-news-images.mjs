#!/usr/bin/env node
/**
 * CMS 上传 news 图片自动压缩成 webp q=90
 * ============================================================================
 *
 * 用户需求: Sveltia CMS 上传 news 图片后, 自动压缩成 q=90 的 webp
 *
 * 背景:
 * - Sveltia CMS 0.215 字段级 media_folder 模板不解析 (已知 bug, issue #74)
 * - image widget 的 `transform` 选项只用于派生不同尺寸 (srcset), 不做上传时格式转换
 * - 因此转换必须在 GitHub backend commit 后, 在仓库里跑
 *
 * 方案:
 *   GitHub Action (.github/workflows/convert-news-images.yml) 监听 push, 跑本脚本
 *   1. 检测 content/news/images/ 下 png/jpg/jpeg
 *   2. sharp 转 webp q=90 (lossy, 与上传原图不同尺寸)
 *   3. 删除原文件
 *   4. 替换 content/news/*.md 里的图片引用 (frontmatter cover + Markdown 正文 ![](...))
 *   5. 调用方 (workflow) 检测到改动后 commit + push
 *
 * 设计取舍:
 * - 只处理 png/jpg/jpeg, **不动已存在的 webp** (避免双重压缩损失质量)
 *   - 旧数据用 q=95 跑过的 webp 不重压; 新上传非 webp 必转
 *   - 想全部重压到 q=90: 删 .webp 后跑本脚本, 或写个一次性脚本
 * - .md 引用替换走**全路径包含**检测, 避免误改 (Sveltia 引用是绝对路径 /content/news/images/...)
 * - 工作流延迟: 用户 Sveltia 编辑完 → commit → Action 跑 → 再 commit; 总延迟 1-3 分钟
 *   - 期间 web 页面引用的还是 png/jpg 原图, 转换后下次部署替换
 *
 * 用法:
 *   $ node scripts/convert-news-images.mjs
 *
 * 退出码:
 *   0 = 处理完成 (可能 0 改动, 调用方判断 git diff 是否 commit)
 *   1 = 出错
 */

import { readdir, readFile, writeFile, unlink, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import sharp from "sharp";

const IMG_DIR = "content/news/images";
const NEWS_DIR = "content/news";
const QUALITY = 90;
const SOURCE_EXTS = /\.(png|jpg|jpeg)$/i;

/**
 * 主流程
 */
async function main() {
  // 1. 检查 IMG_DIR 存在
  try {
    await stat(IMG_DIR);
  } catch {
    console.log(`Skipped: ${IMG_DIR}/ not found`);
    process.exit(0);
  }

  // 2. 列出待转码图片
  const allFiles = await readdir(IMG_DIR);
  const toConvert = allFiles.filter((f) => SOURCE_EXTS.test(f));

  if (toConvert.length === 0) {
    console.log("No PNG/JPG images to convert (already webp)");
    process.exit(0);
  }

  console.log(`Found ${toConvert.length} image(s) to convert to webp q=${QUALITY}:`);

  // 3. 转码
  /** @type {Array<{oldRel: string, newRel: string, oldSize: number, newSize: number}>} */
  const conversions = [];
  for (const file of toConvert) {
    const oldAbs = join(IMG_DIR, file);
    const newName = file.replace(SOURCE_EXTS, ".webp");
    const newAbs = join(IMG_DIR, newName);
    // relative + 替换 \ 为 / (跨平台兼容, Linux runner 上其实不需要)
    const oldRel = "/" + relative(".", oldAbs).split("\\").join("/");
    const newRel = "/" + relative(".", newAbs).split("\\").join("/");

    try {
      const oldSize = (await stat(oldAbs)).size;
      const buf = await sharp(oldAbs).webp({ quality: QUALITY }).toBuffer();
      await writeFile(newAbs, buf);
      await unlink(oldAbs);

      conversions.push({ oldRel, newRel, oldSize, newSize: buf.length });
      console.log(
        `  ${file} (${(oldSize / 1024).toFixed(1)} KB) -> ${newName} (${(buf.length / 1024).toFixed(1)} KB, ratio ${(buf.length / oldSize).toFixed(2)})`,
      );
    } catch (err) {
      console.error(`  Failed: ${file} -> ${newName}: ${err.message}`);
      process.exitCode = 1;
    }
  }

  if (conversions.length === 0) {
    console.log("No successful conversions");
    process.exit(process.exitCode || 0);
  }

  // 4. 更新 .md 里的图片引用
  let mdCount = 0;
  let mdFiles = [];
  try {
    mdFiles = (await readdir(NEWS_DIR)).filter((f) => f.endsWith(".md"));
  } catch {
    console.log(`(no ${NEWS_DIR} dir, skipping md reference update)`);
  }

  for (const md of mdFiles) {
    const mdPath = join(NEWS_DIR, md);
    let content;
    try {
      content = await readFile(mdPath, "utf-8");
    } catch {
      continue;
    }

    let changed = false;
    for (const { oldRel, newRel } of conversions) {
      if (content.includes(oldRel)) {
        // split/join 全局替换 (replaceAll ES2021, 但 Node 22 已支持; 用 split/join 兜底)
        content = content.split(oldRel).join(newRel);
        changed = true;
      }
    }

    if (changed) {
      await writeFile(mdPath, content, "utf-8");
      mdCount++;
      console.log(`  Updated references in ${md}`);
    }
  }

  console.log(
    `\nDone. ${conversions.length} image(s) converted, ${mdCount} markdown file(s) updated.`,
  );
  // exit 0 让 GitHub Action 通过 git diff --cached --quiet 决定是否 commit
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});