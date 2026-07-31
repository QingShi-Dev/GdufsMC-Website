/**
 * News 抽象层 — 隔离数据来源, 后期接后台只改这一个文件
 *
 * 本期: 同步读 data/news.ts (build 时打包, 0 网络请求)
 * 后期: 改 getNewsList() 内部从 fetch('/api/news') 拿数据, 所有调用方 0 改动
 *
 * 设计原则:
 * - 函数签名稳定 (sortBy 顺序固定: 最新在前)
 * - cache() 包裹: 同一请求内多次调用只跑 1 次 (后期接 CMS 立省 2/3 请求)
 * - 类型化: NewsItem 从 data/news.ts re-export
 * - 共享样式: CATEGORY_BADGE_CLASS 给 3 个组件复用, 改一个不漏
 */

import { cache } from "react";
import { NEWS, type NewsItem, type NewsCategory } from "@/data/news";

export type { NewsItem, NewsCategory } from "@/data/news";

/** 分类色 badge class — 3 个组件 (carousel/list/detail) 共用, 单一来源 */
export const CATEGORY_BADGE_CLASS: Record<NewsCategory, string> = {
  公告: "bg-sky-100 text-sky-700 border-sky-200",
  更新: "bg-emerald-100 text-emerald-700 border-emerald-200",
  活动: "bg-amber-100 text-amber-700 border-amber-200",
  "公告-维护": "bg-slate-100 text-slate-700 border-slate-200",
};

/** 拿全部 news 列表, 已按 date 倒序 (最新在前) — 同请求内 cache */
export const getNewsList = cache(async (): Promise<NewsItem[]> => {
  // 后期接 CMS / 飞书 / Strapi 时, 改这一个函数内部即可:
  //   const res = await fetch(`${API_BASE}/news`);
  //   if (res.ok) return (await res.json()).sort(byDateDesc);
  return [...NEWS].sort((a, b) => (a.date < b.date ? 1 : -1));
});

/** 按 slug 拿单条 news, 没找到返回 null — 同请求内 cache */
export const getNewsBySlug = cache(async (slug: string): Promise<NewsItem | null> => {
  const list = await getNewsList();
  return list.find((n) => n.slug === slug) ?? null;
});

/** 拿最新 N 条 (顶部轮播图用) */
export async function getLatestNews(limit: number = 3): Promise<NewsItem[]> {
  const list = await getNewsList();
  return list.slice(0, limit);
}
