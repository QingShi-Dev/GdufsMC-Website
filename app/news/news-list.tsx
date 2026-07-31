/**
 * News 列表 — 最新 1 条大卡 + 后续 3 列 grid
 * 风格: 跟 home FEATURES / help SERVERS 卡片一致
 *  - rounded-2xl bg-white border hover 渐变光晕
 *  - cover 缩略图 aspect-video
 *  - 暗色 category 标签 + 时间
 */

import Link from "next/link";
import { IconArrowRight } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { CATEGORY_BADGE_CLASS } from "@/lib/news";
import type { NewsItem } from "@/lib/news";

const DECO_GRADIENTS = [
  "from-amber-400/20 to-orange-400/0",
  "from-pink-400/20 to-rose-400/0",
  "from-sky-400/20 to-blue-400/0",
  "from-emerald-400/20 to-teal-400/0",
  "from-violet-400/20 to-purple-400/0",
  "from-yellow-400/20 to-amber-400/0",
];

/** 最新 1 条: featured 大卡 (16:10 cover + 右侧文字) */
function NewsCardFeatured({ item, index }: { item: NewsItem; index: number }) {
  return (
    <Link
      href={`/news/${item.slug}`}
      className="group relative block rounded-2xl bg-white border border-slate-200/80 shadow-sm shadow-slate-900/[0.04] hover:shadow-lg hover:border-slate-300/80 transition-all duration-300 overflow-hidden"
    >
      <div
        aria-hidden="true"
        className={cn(
          "absolute -right-16 -top-16 w-48 h-48 rounded-full bg-gradient-to-br blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none",
          DECO_GRADIENTS[index % DECO_GRADIENTS.length],
        )}
      />
      <div className="relative grid sm:grid-cols-[1.4fr_1fr] gap-0">
        {/* 左侧 cover 图 */}
        <div className="relative aspect-[16/10] sm:aspect-auto overflow-hidden bg-slate-100">
          {/* eslint-disable-next-line @next/next/no-img-element -- 本地图 */}
          <img
            src={item.cover}
            alt={item.title}
            className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500"
          />
          {item.badge && (
            <div className="absolute top-3 left-3">
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-rose-500 text-white">
                {item.badge}
              </span>
            </div>
          )}
        </div>
        {/* 右侧文字 */}
        <div className="p-6 sm:p-7 flex flex-col justify-center">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span
              className={cn(
                "text-[10px] font-semibold px-2 py-0.5 rounded-md uppercase tracking-wider",
                CATEGORY_BADGE_CLASS[item.category] ?? CATEGORY_BADGE_CLASS["公告"],
              )}
            >
              {item.category}
            </span>
            <time className="text-xs text-slate-500 font-mono tabular-nums">{item.date}</time>
          </div>
          <h3 className="text-xl sm:text-2xl font-bold text-slate-900 leading-tight mb-3 group-hover:text-brand-600 transition-colors">
            {item.title}
          </h3>
          <p className="text-sm text-slate-600 leading-relaxed line-clamp-3 mb-4">{item.summary}</p>
          <div className="flex items-center gap-1.5 text-sm text-brand-600 font-medium">
            阅读全文
            <IconArrowRight
              aria-hidden="true"
              className="w-4 h-4 transition-transform group-hover:translate-x-1"
            />
          </div>
        </div>
      </div>
    </Link>
  );
}

/** 后续: 3 列小卡 (aspect-video cover + 文字下) */
function NewsCardDefault({ item, index }: { item: NewsItem; index: number }) {
  return (
    <Link
      href={`/news/${item.slug}`}
      className="group relative block rounded-2xl bg-white border border-slate-200/80 shadow-sm shadow-slate-900/[0.04] hover:shadow-lg hover:border-slate-300/80 transition-all duration-300 overflow-hidden"
    >
      <div
        aria-hidden="true"
        className={cn(
          "absolute -right-16 -top-16 w-40 h-40 rounded-full bg-gradient-to-br blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none",
          DECO_GRADIENTS[index % DECO_GRADIENTS.length],
        )}
      />
      <div className="relative aspect-video overflow-hidden bg-slate-100">
        {/* eslint-disable-next-line @next/next/no-img-element -- 本地图 */}
        <img
          src={item.cover}
          alt={item.title}
          className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500"
        />
        {item.badge && (
          <div className="absolute top-2.5 left-2.5">
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-rose-500 text-white">
              {item.badge}
            </span>
          </div>
        )}
      </div>
      <div className="relative p-4">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span
            className={cn(
              "text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider",
              CATEGORY_BADGE_CLASS[item.category] ?? CATEGORY_BADGE_CLASS["公告"],
            )}
          >
            {item.category}
          </span>
          <time className="text-[10px] text-slate-500 font-mono tabular-nums">{item.date}</time>
        </div>
        <h3 className="text-sm font-bold text-slate-900 leading-snug mb-2 line-clamp-2 group-hover:text-brand-600 transition-colors">
          {item.title}
        </h3>
        <p className="text-xs text-slate-600 leading-relaxed line-clamp-2">{item.summary}</p>
      </div>
    </Link>
  );
}

export function NewsList({ items }: { items: NewsItem[] }) {
  if (items.length === 0) return null;

  const [featured, ...rest] = items;

  return (
    <div className="space-y-4">
      {/* 最新 1 条: featured 大卡 */}
      <NewsCardFeatured item={featured} index={0} />

      {/* 后续: 3 列 grid (sm 以下单列) */}
      {rest.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {rest.map((it, i) => (
            <NewsCardDefault key={it.slug} item={it} index={i + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
