import assert from "node:assert/strict";
import test from "node:test";
import { slugify } from "../lib/slugify-core.mjs";

// Expected values were captured from lib/slugify.ts before extracting the core.
const cases = [
  ["Chinese", "欢迎来到云城像素社", "huan-ying-lai-dao-yun-cheng-xiang-su-she"],
  ["ASCII", "Hello WORLD 2026", "hello-world-2026"],
  ["mixed", "欢迎来到：云城像素社 Alpha 内测", "huan-ying-lai-dao-yun-cheng-xiang-su-she-alpha-nei-ce"],
  ["adjacent Chinese and ASCII", "地下挖矿PvP", "di-xia-wa-kuang-pvp"],
  ["punctuation", "  A___B -- C!  ", "a-b-c"],
  ["only punctuation and emoji", "！... 🎮", "untitled"],
  ["empty", "", "untitled"],
  ["whitespace", "   ", "untitled"],
];

for (const [name, title, expected] of cases) {
  test(`slugify: ${name}`, () => assert.equal(slugify(title), expected));
}

// Preserve the title-derived fallback URLs for all four existing articles,
// independently of their currently explicit frontmatter slugs.
const articleFallbacks = [
  ["国庆限时 PVP 活动地图「掘地争霸」激情开启！", "guo-qing-xian-shi-pvp-huo-dong-di-tu-jue-di-zheng-ba-ji-qing-kai-qi"],
  ["小游戏派对现已常驻，欢迎参加！", "xiao-you-xi-pai-dui-xian-yi-chang-zhu-huan-ying-can-jia"],
  ["云城像素社 PVP 大赛成绩公告", "yun-cheng-xiang-su-she-pvp-da-sai-cheng-ji-gong-gao"],
  ["欢迎来到：云城像素社网站", "huan-ying-lai-dao-yun-cheng-xiang-su-she-wang-zhan"],
];

test("existing article title fallback URLs remain unchanged", () => {
  for (const [title, expected] of articleFallbacks) {
    assert.equal(slugify(title), expected, title);
  }
});
