/**
 * News 数据访问层 — server-only, 不要在 client component 里 import 这里
 *
 * 抽象层 (来自 data/news/items.ts 注释里的承诺):
 * - getNewsList() / getNewsBySlug() / getLatestNews() 接口稳定
 * - 内部实现: 当前是 content/news/*.md (Markdown + frontmatter)
 * - 后期换后台 (DB / API) 只改这个文件, page.tsx 0 改动
 *
 * 当前实现:
 * - 内容物理位置: content/news/*.md
 * - frontmatter: title / date / category / summary / cover / badge / pinned
 * - slug: 从 frontmatter.title 自动派生 (pinyin, lib/slugify.ts)
 *
 * 客户端可见的类型/常量:
 * - 见 ./types.ts (NewsItem / NewsCategory / CATEGORY_BADGE_CLASS)
 * - 客户端组件直接从那里 import, 不要再从本文件 import 任何东西
 */

import "server-only";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import { cache } from "react";
import { slugify } from "@/lib/slugify";
import type { NewsFrontmatter, NewsItem } from "./types";

// 重新导出类型, 让 `@/lib/news` 仍然是完整入口 (服务端使用)
export type { NewsItem, NewsCategory, NewsFrontmatter } from "./types";
export { CATEGORY_BADGE_CLASS } from "./types";

const CONTENT_DIR = join(process.cwd(), "content", "news");

/**
 * 读取所有 news 文件, 解析 frontmatter + body, 按 date 倒序排列
 *
 * 错误处理:
 * - 单个文件解析失败 → 跳过 + log, 不让整个列表挂掉
 * - 目录不存在 (开发期/没内容时) → 返回空数组, 不抛
 *
 * @returns Promise<NewsItem[]>  按 date 倒序 (新 → 旧)
 */
export const getNewsList = cache(async (): Promise<NewsItem[]> => {
  let files: string[];
  try {
    files = await readdir(CONTENT_DIR);
  } catch {
    return [];
  }
  const mdFiles = files.filter((f) => f.endsWith(".md"));

  const items = (
    await Promise.all(
      mdFiles.map(async (file) => {
        const filePath = join(CONTENT_DIR, file);
        try {
          const raw = await readFile(filePath, "utf-8");
          const { data, content } = matter(raw);
          const fm = data as NewsFrontmatter;
          // 校验必填字段
          if (!fm.title || !fm.date || !fm.category || !fm.cover) {
            console.warn(`[news] ${file} 缺少必填 frontmatter, 跳过`);
            return null;
          }
          return {
            ...fm,
            // gray-matter 用 YAML 解析 frontmatter 时, 任何看起来像日期的字段
            // (例如 "2026-09-19") 会被解析成 Date 对象. 直接渲染到 React 会崩
            // (报 "Objects are not valid as a React child"). 强制转 YYYY-MM-DD 字符串.
            date: fm.date instanceof Date
              ? fm.date.toISOString().slice(0, 10)
              : String(fm.date),
            // 优先用 frontmatter.slug (手动填写), fallback 到 slugify(title) (pinyin)
            //   - 旧 news (.md 没 slug 字段) 走 fallback
            //   - 新 news (.md 有 slug 字段) 走手动值
            slug: fm.slug?.trim() || slugify(fm.title),
            content: content.trim(),
          } satisfies NewsItem;
        } catch (err) {
          console.warn(`[news] 解析 ${file} 失败:`, err);
          return null;
        }
      }),
    )
  ).filter((x): x is NewsItem => x !== null);

  items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return items;
});

/**
 * 按 slug 查单条 news
 *
 * @param slug URL 里的 id 部分 (例如 /news/welcome-to-alpha-test 的 slug)
 * @returns NewsItem | null  找不到返回 null (调用方负责 notFound())
 */
export const getNewsBySlug = cache(async (slug: string): Promise<NewsItem | null> => {
  const list = await getNewsList();
  return list.find((n) => n.slug === slug) ?? null;
});

/**
 * 顶部轮播图专用: 拿最新的 N 条
 * 优先 pinned=true 的, 再按 date 倒序补足
 *
 * @param limit 默认 5 (顶部轮播图固定 5 张)
 */
export const getLatestNews = cache(async (limit = 5): Promise<NewsItem[]> => {
  const list = await getNewsList();
  const pinned = list.filter((n) => n.pinned);
  const rest = list.filter((n) => !n.pinned);
  return [...pinned, ...rest].slice(0, limit);
});
