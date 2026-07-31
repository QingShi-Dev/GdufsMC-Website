/**
 * News 详情页 — /news/[slug]
 *
 * 纯静态渲染, 走 lib/news.ts 抽象层
 * - 顶部 cover (16:10) + 标题 + meta
 * - summary 摘要卡
 * - content 长文 (white-space: pre-line 保留换行)
 * - 底部"返回新闻列表" + 上一篇/下一篇导航
 * - generateStaticParams 预生成所有 slug (SSG)
 * - notFound() 处理 404
 */

import { notFound } from "next/navigation";
import Link from "next/link";
import { IconArrowLeft, IconArrowRight, IconChevronLeft, IconList } from "@tabler/icons-react";
import { getNewsList, getNewsBySlug, CATEGORY_BADGE_CLASS } from "@/lib/news";
import { MarkdownContent } from "./markdown-content";

type Props = { params: Promise<{ slug: string }> };

/** SSG: 预生成所有 news slug, build 时跑, ISR 60s 缓存 */
export async function generateStaticParams() {
  const list = await getNewsList();
  return list.map((n) => ({ slug: n.slug }));
}

/** 详情页 metadata: 标题 + 描述给 SEO */
export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const news = await getNewsBySlug(slug);
  if (!news) return { title: "未找到动态 — GdufsMC" };
  return {
    title: `${news.title} — GdufsMC`,
    description: news.summary,
  };
}

export default async function NewsDetailPage({ params }: Props) {
  const { slug } = await params;
  const news = await getNewsBySlug(slug);
  if (!news) notFound();

  // 找上一篇 / 下一篇 (按 date 倒序列表)
  const list = await getNewsList();
  const idx = list.findIndex((n) => n.slug === news.slug);
  const prev = idx < list.length - 1 ? list[idx + 1] : null; // 倒序里 idx+1 是更早的
  const next = idx > 0 ? list[idx - 1] : null; // 倒序里 idx-1 是更新的

  return (
    <article className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
      {/* 顶部: 返回 + meta */}
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/news"
          className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-brand-600 transition-colors"
        >
          <IconChevronLeft className="w-4 h-4" />
          返回新闻列表
        </Link>
      </div>

      {/* 封面图 */}
      <div className="relative aspect-[16/10] rounded-2xl overflow-hidden bg-slate-100 border border-slate-200/80 shadow-sm mb-8">
        {/* eslint-disable-next-line @next/next/no-img-element -- 本地图 */}
        <img src={news.cover} alt={news.title} className="absolute inset-0 w-full h-full object-cover" />
        {news.badge && (
          <div className="absolute top-4 left-4">
            <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-rose-500 text-white">
              {news.badge}
            </span>
          </div>
        )}
      </div>

      {/* 标题 + meta */}
      <header className="mb-8">
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span
            className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-md uppercase tracking-wider ${CATEGORY_BADGE_CLASS[news.category] ?? CATEGORY_BADGE_CLASS["公告"]}`}
          >
            {news.category}
          </span>
          <time className="text-xs text-slate-500 font-mono tabular-nums">{news.date}</time>
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 leading-tight">
          {news.title}
        </h1>
      </header>

      {/* summary 摘要卡 */}
      <div className="mb-8 p-5 sm:p-6 rounded-2xl bg-slate-50 border border-slate-200/80">
        <p className="text-base sm:text-lg text-slate-700 leading-relaxed">{news.summary}</p>
      </div>

      {/* content 正文 — Markdown 渲染 (支持图片/链接/列表/代码块) */}
      <MarkdownContent>{news.content}</MarkdownContent>

      {/* 底部: 上一篇 / 下一篇 */}
      <nav className="mt-12 pt-8 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-4">
        {prev ? (
          <Link
            href={`/news/${prev.slug}`}
            className="group flex items-start gap-3 p-4 rounded-xl bg-white border border-slate-200/80 hover:border-slate-300 hover:shadow-md transition-all"
          >
            <IconArrowLeft className="w-5 h-5 text-slate-400 group-hover:text-brand-600 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="text-xs text-slate-500 mb-1">上一篇</div>
              <div className="text-sm font-semibold text-slate-900 group-hover:text-brand-600 line-clamp-2">
                {prev.title}
              </div>
            </div>
          </Link>
        ) : (
          <div />
        )}
        {next ? (
          <Link
            href={`/news/${next.slug}`}
            className="group flex items-start gap-3 p-4 rounded-xl bg-white border border-slate-200/80 hover:border-slate-300 hover:shadow-md transition-all sm:text-right sm:flex-row-reverse"
          >
            <IconArrowRight className="w-5 h-5 text-slate-400 group-hover:text-brand-600 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="text-xs text-slate-500 mb-1">下一篇</div>
              <div className="text-sm font-semibold text-slate-900 group-hover:text-brand-600 line-clamp-2">
                {next.title}
              </div>
            </div>
          </Link>
        ) : (
          <div />
        )}
      </nav>

      {/* 底部: 返回新闻列表 (大按钮, 读完一篇后最显眼位置) */}
      <div className="mt-8 flex justify-center">
        <Link
          href="/news"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium shadow-sm hover:shadow-md transition-all"
        >
          <IconList className="w-4 h-4" />
          返回动态列表
        </Link>
      </div>
    </article>
  );
}
