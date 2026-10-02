import { pinyin } from "pinyin-pro";

/**
 * Shared title-to-slug implementation for the application and Node scripts.
 * @param {string} title
 * @returns {string}
 */
export function slugify(title) {
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
