/**
 * News 列表 — 最新 1 条大卡 + 后续 3 列 grid
 * 风格: 跟 home FEATURES / guide SERVERS 卡片一致
 *  - rounded-2xl bg-white border hover 渐变光晕
 *  - cover 缩略图 aspect-video
 *  - 暗色 category 标签 + 时间
 */

import Link from "next/link";
import { IconArrowRight } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { CATEGORY_BADGE_CLASS } from "@/lib/news/types";
import type { NewsItem } from "@/lib/news/types";

/** 最新 1 条: featured 大卡 (16:10 cover + 右侧文字) */
function NewsCardFeatured({ item }: { item: NewsItem }) {
  return (
    <Link
      href={`/news/${item.slug}`}
      className="group relative block rounded-2xl bg-white/70 border border-slate-200/70 hover:border-emerald-300/90 hover:shadow-lg hover:shadow-emerald-500/10 transition-all duration-250 overflow-hidden"
    >
      <div
        aria-hidden="true"
        // 单段 cn(): bg-gradient + opacity + transition + blur 一次性, 避免多段覆盖丢 duration
        className={cn(
          "absolute -right-16 -top-16 w-48 h-48 rounded-full bg-gradient-to-br from-emerald-100/60 to-transparent blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none",
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
            <div className="absolute top-4 left-6">
              <span className="text-[13px] font-semibold px-2 py-1 rounded-md bg-rose-500 text-white">
                {item.badge}
              </span>
            </div>
          )}
        </div>
        {/* 右侧文字 */}
        <div className="p-5 sm:p-7 pb-4 sm:pb-6 flex flex-col justify-center">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span
              className={cn(
                "text-[12px] font-semibold px-2 py-0.5 rounded-md uppercase tracking-wider",
                CATEGORY_BADGE_CLASS[item.category] ?? CATEGORY_BADGE_CLASS["公告"],
              )}
            >
              {item.category}
            </span>
            <time className="text-[14px] text-slate-600 font-mono tabular-nums ml-0.5">{item.date}</time>
          </div>
          <h3 className="text-xl sm:text-2xl font-bold text-slate-800 leading-tight mb-2 sm:mb-3 group-hover:text-brand-600 transition-colors">
            {item.title}
          </h3>
          <p className="text-sm text-slate-600 leading-relaxed line-clamp-3 mb-4">{item.summary}</p>
          <div className="flex items-center gap-1 text-sm text-brand-600 font-medium">
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
function NewsCardDefault({ item }: { item: NewsItem }) {
  return (
    <Link
      href={`/news/${item.slug}`}
      className="group relative block rounded-2xl bg-white/70 border border-slate-200/70 hover:border-emerald-300/90 hover:shadow-lg hover:shadow-emerald-500/10 transition-all duration-250 overflow-hidden"
    >
      <div
        aria-hidden="true"
        className={cn(
          "absolute -right-16 -top-16 w-40 h-40 rounded-full bg-gradient-to-br blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none",
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
          <div className="absolute top-2.5 left-3.5">
            <span className="text-[11px] font-semibold px-1.5 py-1 rounded bg-rose-500 text-white">
              {item.badge}
            </span>
          </div>
        )}
      </div>
      <div className="relative p-4">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span
            className={cn(
              "text-[12px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider",
              CATEGORY_BADGE_CLASS[item.category] ?? CATEGORY_BADGE_CLASS["公告"],
            )}
          >
            {item.category}
          </span>
          <time className="text-[13px] text-slate-600 font-mono tabular-nums">{item.date}</time>
        </div>
        <h3 className="text-[16px] font-bold text-slate-800 leading-snug mb-1 sm:mb-2 line-clamp-2 group-hover:text-brand-600 transition-colors">
          {item.title}
        </h3>
        <p className="text-[13px] text-slate-600 leading-relaxed line-clamp-2">{item.summary}</p>
      </div>
    </Link>
  );
}

export function NewsList({ items }: { items: NewsItem[] }) {
  if (items.length === 0) return null;

  const featured = items[0];
  const rest = items.slice(1);
  // featured 一定存在 (items.length > 0 上行守门), 但 noUncheckedIndexedAccess 要求显式守门
  if (!featured) return null;

  return (
    <div className="space-y-4">
      {/* 最新 1 条: featured 大卡 */}
      <NewsCardFeatured item={featured} />

      {/* 后续: 3 列 grid (sm 以下单列) */}
      {rest.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {rest.map((it) => (
            <NewsCardDefault key={it.slug} item={it} />
          ))}
        </div>
      )}
    </div>
  );
}
