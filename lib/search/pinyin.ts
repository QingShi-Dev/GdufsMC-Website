/**
 * 拼音搜索 helper — 给地图搜索框用的轻量封装
 *
 * 用 pinyin-pro 把汉字转成:
 *  - 全拼字符串 (小写, 无声调): 搜 "yzz" 匹配 "雍宗镇"(yongzongzhen) — 用户可以用任意一段
 *  - 首字母缩写 (小写):           搜 "yzz" 也匹配 "雍宗镇"(yzz)
 *
 * 设计取舍:
 *  - 用 array + join("", ...) 而不是 separator 字符串, 避免空格的歧义
 *  - 不做声调: 用户不会输入声调, 多音字也按常用读音 (pinyin-pro 默认) — 匹配粒度足够搜索用
 *  - 非汉字字符 (ASCII / 数字 / 标点) 原样保留, 便于搜混合词 (e.g. "320熔炉组" → "320rongluzu")
 *
 * 不放在 server-only: pinyin-pro 在客户端直接 import 即可, 不依赖 fs
 */
import { pinyin } from "pinyin-pro";

/** 汉字 → 全拼小写字符串, 无声调, 无分隔符 */
export function toPinyin(s: string): string {
  if (!s) return "";
  // type: "array" 让每个字单独返回字符串 (多音字也按默认读音给)
  return pinyin(s, { toneType: "none", type: "array", nonZh: "consecutive" })
    .join("")
    .toLowerCase();
}

/** 汉字 → 首字母缩写, 小写 */
export function toPinyinAbbr(s: string): string {
  if (!s) return "";
  return pinyin(s, { pattern: "first", type: "array", nonZh: "consecutive" })
    .join("")
    .toLowerCase();
}