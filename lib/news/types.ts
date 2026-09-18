/**
 * News 共享类型 + 样式常量
 *
 * 这个文件**不**依赖 server-only / node:fs, 可以被客户端组件安全 import
 *
 * 为什么单独拆出来:
 * - lib/news/index.ts 里有 server-only 的 getNewsList 等函数, 引用了 node:fs
 * - 客户端组件 (hero-carousel / list) 需要 NewsItem 类型 + CATEGORY_BADGE_CLASS
 * - 如果都从 index.ts 拿, 会触发 "should only be used from Server Component" 报错
 *
 * 规则:
 * - 类型 / 常量放这里
 * - 服务端函数 (getNewsList 等) 放 ./index.ts
 */

export type NewsCategory = "公告" | "更新" | "活动" | "公告-维护";

export interface NewsFrontmatter {
  /** URL slug (小写英文/数字/短横线). 手动填写, 不要从 title 自动派生
   *  - 有值: 直接用这个作为 URL slug + 文件名
   *  - 空 (旧 news 没填): fallback 到 lib/slugify.ts 从 title 派生 (pinyin)
   *  - 注意: 改了 slug 不会迁移旧 URL — 旧 slug 已被搜索引擎/外链引用
   */
  slug?: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  category: NewsCategory;
  summary: string;
  cover: string;
  badge?: string;
  /** true = 进顶部轮播图 (精选); 默认 false */
  pinned?: boolean;
}

export interface NewsItem extends NewsFrontmatter {
  /** URL id, 优先用 frontmatter.slug, fallback 到 slugify(title) */
  slug: string;
  /** Markdown 正文 (不含 frontmatter) */
  content: string;
}

/**
 * Category → Tailwind 颜色 class 映射
 * 集中在这里, 列表/详情/轮播图共用, 避免每个组件重写一份
 * 风格: 柔和色 (bg-*-100 + text-*-700 + border-*-200) 跟全站其他 badge 一致
 */
export const CATEGORY_BADGE_CLASS: Record<NewsCategory, string> = {
  公告: "bg-sky-100 text-sky-700 border-sky-200",
  更新: "bg-emerald-100 text-emerald-700 border-emerald-200",
  活动: "bg-amber-100 text-amber-700 border-amber-200",
  "公告-维护": "bg-slate-100 text-slate-700 border-slate-200",
};