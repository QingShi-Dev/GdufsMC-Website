/**
 * Title → URL slug
 *
 * 设计:
 * - pinyin-pro 把中文转拼音, nonZh: "consecutive" 让 ASCII 字符原样保留
 * - 再统一小写 + 非字母数字转 dash, 末尾/连续 dash 清理
 * - 空标题返回 "untitled" (兜底, 不让 URL 出现 //)
 *
 * 复用性:
 * - lib/news.ts 里从 frontmatter.title 派生 slug 时用
 * - 脚本里批量生成 slug 时用
 *
 * 为什么不放在 lib/utils.ts:
 * - utils.ts 是无依赖的 cn() helper, 引 pinyin-pro 会让它变重
 * - slug 化是有语义的 (跟"内容"相关), 不是通用工具
 */

import { pinyin } from "pinyin-pro";

export function slugify(title: string): string {
  if (!title || typeof title !== "string") return "untitled";

  // pinyin-pro: 中文 → 拼音 (无音调), ASCII 字母数字原样保留 (nonZh: "consecutive")
  //   "欢迎来到：云城像素社 Alpha 内测" → "huan ying lai dao ： yun cheng xiang su she Alpha nei ce"
  // type: "string" 返回拼接好的字符串
  const romanized = pinyin(title, {
    toneType: "none",
    type: "string",
    nonZh: "consecutive",
  });

  return (
    romanized
      .toLowerCase()
      // 非字母数字 (中文标点、emoji、空格) 全转 dash
      .replace(/[^a-z0-9]+/g, "-")
      // 收尾 dash 去掉
      .replace(/^-+|-+$/g, "")
      // 连续 dash 合并
      .replace(/-{2,}/g, "-") || "untitled"
  );
}