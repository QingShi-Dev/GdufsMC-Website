/**
 * News 抽象层入口 — 真正的实现在 ./news/index.ts
 *
 * 为什么有这个文件:
 * - Next.js + TS bundler 模式下, "./news" 解析为 "./news.ts" 优先于 "./news/index.ts"
 * - 所有调用方都用 `@/lib/news` 导入, 必须有一个 news.ts 才能解析成功
 * - 因此这里只做 re-export, 实际逻辑都在 ./news/index.ts
 *
 * 修改规则:
 * - 不要在这个文件里写实现
 * - 抽象层改动都去 ./news/index.ts
 */

export {
  getNewsList,
  getNewsBySlug,
  getLatestNews,
  CATEGORY_BADGE_CLASS,
} from "./news/index";
export type { NewsItem, NewsCategory, NewsFrontmatter } from "./news/index";