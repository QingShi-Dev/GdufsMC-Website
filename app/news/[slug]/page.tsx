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
import { getNewsList, getNewsBySlug, CATEGORY_BADGE_CLASS } from "@/lib/news";
import { MarkdownContent } from "@/components/news/markdown";

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
    <article className="mx-auto max-w-4xl px-5 sm:px-6 lg:px-8 pt-22 pb-12 sm:py-12 sm:pt-26">
      {/* 封面图 */}
      <div className="relative aspect-[16/10] rounded-2xl overflow-hidden bg-slate-100 border border-slate-200/80 shadow-sm mb-8">
        {/* eslint-disable-next-line @next/next/no-img-element -- 本地图 */}
        <img src={news.cover} alt={news.title} className="absolute inset-0 w-full h-full object-cover" />
        {news.badge && (
          <div className="absolute top-3.5 sm:top-5 left-4.5 sm:left-6">
            <span className="text-[12px] sm:text-[15px] font-semibold px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-md bg-rose-500 text-white">
              {news.badge}
            </span>
          </div>
        )}
      </div>

      {/* 标题 + meta */}
      <header className="mb-4 sm:mb-8">
        <div className="flex items-center gap-2 mb-2 sm:mb-4 flex-wrap">
          <span
            className={`text-[13px] sm:text-[15px] font-semibold px-2.5 py-1 rounded-md uppercase tracking-wider ${CATEGORY_BADGE_CLASS[news.category] ?? CATEGORY_BADGE_CLASS["公告"]}`}
          >
            {news.category}
          </span>
          <time className="text-[16px] text-slate-500 font-medium tabular-nums ml-0.5 sm:ml-1.5">{news.date}</time>
        </div>
        <h1 className="text-[26px] sm:text-4xl font-bold text-slate-900 leading-tight">
          {news.title}
        </h1>
      </header>

      {/* summary 摘要卡 */}
      <div className="mb-4 sm:mb-8 p-4 sm:p-6 rounded-2xl bg-slate-50 border border-slate-200/80">
        <p className="text-base sm:text-lg text-slate-700 leading-relaxed">{news.summary}</p>
      </div>

      {/* content 正文 — Markdown 渲染 (支持图片/链接/列表/代码块) */}
      <MarkdownContent>{news.content}</MarkdownContent>

      {/* 底部: 上一篇 / 下一篇 */}
      <nav className="mt-8 sm:mt-12 pt-6 sm:pt-8 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-4">
        {prev ? (
          <Link
            href={`/news/${prev.slug}`}
            className="group flex items-start gap-3 p-4 rounded-xl bg-white/80 border border-slate-200/70 hover:border-emerald-300/90 hover:shadow-lg hover:shadow-emerald-500/10 hover:shadow-md transition-all"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- 本地图标 */}
            <img
              src={`/icons/global/${encodeURIComponent("右侧箭头图标.svg")}`}
              alt=""
              className="w-4.5 h-4.5 text-slate-400 group-hover:text-brand-600 shrink-0 mt-0.5 rotate-180"
            />
            <div className="min-w-0 flex-1">
              <div className="text-[15px] text-slate-600 mb-1">上一篇</div>
              <div className="text-[17px] font-semibold text-slate-800 group-hover:text-brand-600 line-clamp-2">
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
            className="group flex items-start gap-3 p-3 sm:p-4 rounded-xl bg-white/80 border border-slate-200/70 hover:border-emerald-300/90 hover:shadow-lg hover:shadow-emerald-500/10 transition-all text-right flex-row-reverse"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- 本地图标 */}
            <img
              src={`/icons/global/${encodeURIComponent("右侧箭头图标.svg")}`}
              alt=""
              className="w-4.5 h-4.5 text-slate-400 group-hover:text-brand-600 shrink-0 mt-0.5"
            />
            <div className="min-w-0 flex-1">
              <div className="text-[15px] text-slate-600 mb-1">下一篇</div>
              <div className="text-[17px] font-semibold text-slate-800 group-hover:text-brand-600 line-clamp-2">
                {next.title}
              </div>
            </div>
          </Link>
        ) : (
          <div />
        )}
      </nav>

      {/* 底部: 返回动态列表 — fixed 浮动在视口右下, max-width 内容右边缘外侧
       *   - max-w-4xl (32rem = 512px), 视口宽度大时文章居中
       *   - 按钮位置: 视口右边 - max(1.5rem, 50vw - 32rem + 1.5rem)
       *     - 视口 >= 36rem (576px): 按钮贴 max-w-4xl 右边 1.5rem 处 (文章右侧 padding 外)
       *     - 视口窄: 按钮贴视口右边 1.5rem
       *   - lg 以上生效 (lg breakpoint = 1024px), 小屏 fallback 到 right-6
       */}
      <Link
        href="/news"
        className="fixed top-24 sm:top-32 right-6 lg:right-[max(1.5rem,calc(50vw-32rem+1.5rem))] z-40 inline-flex flex-col sm:flex-row items-center gap-2 px-2 sm:px-5 py-3 rounded-full bg-white/80 hover:bg-white border border-slate-200/80 shadow-sm text-slate-800 text-[15px] font-medium transition-all"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- 本地图标 */}
          <img
            src={`/icons/news/${encodeURIComponent("列表图标.svg")}`}
            alt=""
            className="w-4 h-4"
          />
        <span className="text-[10px] sm:text-[15px]">返回</span>
      </Link>
    </article>
  );
}
