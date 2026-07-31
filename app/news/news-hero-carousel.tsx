"use client";

/**
 * News 顶部轮播图 — 大图 + 文字 + dot + 左右按钮
 * - 5 张精选 (carousel prop 控制)
 * - 自动轮播 6s, hover 暂停, 切图时重置计时
 * - framer-motion 左右滑动 (direction: 1=从右, -1=从左), iOS ease
 * - 键盘: ←/→ 切图 (会跳过 input/textarea/contenteditable)
 * - 响应式: sm 以下隐藏左右按钮 (用 dot 切)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { CATEGORY_BADGE_CLASS } from "@/lib/news";
import type { NewsItem } from "@/lib/news";

const AUTO_PLAY_MS = 6000;

/** 滑动方向 variants — direction: 1 = 从右滑入(下一张), -1 = 从左滑入(上一张) */
const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? "100%" : "-100%" }),
  center: { x: 0 },
  exit: (dir: number) => ({ x: dir > 0 ? "-100%" : "100%" }),
};

/** 计算 wrap-around 后的方向: 取最短路径 */
function calcDirection(from: number, to: number, len: number): 1 | -1 {
  if (len <= 1) return 1;
  const diff = to - from;
  if (Math.abs(diff) <= len / 2) {
    return diff >= 0 ? 1 : -1;
  }
  return diff > 0 ? -1 : 1;
}

/** 键盘事件是否应该忽略 (用户在 input/textarea/contenteditable 里) */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

export function NewsHeroCarousel({ items }: { items: NewsItem[] }) {
  const [active, setActive] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 派生值: items 缩短时把 active 钳到合法范围
  // (不是 hook, 不影响 hook 顺序; hook 必须在所有 early return 之前)
  const safeActive = items.length > 0 ? Math.min(active, items.length - 1) : 0;

  const goTo = useCallback(
    (i: number) => {
      if (items.length === 0) return;
      const target = ((i % items.length) + items.length) % items.length;
      if (target === safeActive) return;
      setDirection(calcDirection(safeActive, target, items.length));
      setActive(target);
    },
    [safeActive, items.length],
  );

  // 自动轮播: 6s 后切下一张, hover 暂停
  useEffect(() => {
    if (paused || items.length <= 1) return;
    timerRef.current = setTimeout(() => {
      goTo(safeActive + 1);
    }, AUTO_PLAY_MS);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [safeActive, paused, items.length, goTo]);

  // 键盘导航
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.key === "ArrowLeft") goTo(safeActive - 1);
      else if (e.key === "ArrowRight") goTo(safeActive + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [safeActive, goTo]);

  // early return 必须在所有 hook 之后
  if (items.length === 0) return null;

  const current = items[safeActive];

  return (
    <div
      className="group relative"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* 大图区 — 21:9 比例, 整块可点击进详情 */}
      <Link
        href={`/news/${current.slug}`}
        className="block relative aspect-[21/9] rounded-2xl overflow-hidden bg-slate-100 border border-slate-200/80 shadow-sm shadow-slate-900/[0.04]"
        role="region"
        aria-roledescription="carousel"
        aria-label={`新闻轮播 — 当前: ${current.title}`}
      >
        <AnimatePresence custom={direction} initial={false}>
          <motion.div
            key={current.slug}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{
              x: { type: "tween", ease: [0.32, 0.72, 0, 1], duration: 0.5 },
            }}
            className="absolute inset-0"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- 本地图 */}
            <img
              src={current.cover}
              alt={current.title}
              className="absolute inset-0 w-full h-full object-cover"
            />
            {/* 渐变 overlay 让底部文字可读 */}
            <div className="absolute inset-0 bg-gradient-to-t from-slate-900/30 via-slate-900/15 to-transparent" />

            {/* 底部文字 */}
            <div className="absolute inset-x-0 bottom-0 p-6 sm:p-8">
              <div className="flex items-center gap-2 mb-3">
                <span
                  className={cn(
                    "text-[10px] font-semibold px-2 py-0.5 rounded-md uppercase tracking-wider",
                    CATEGORY_BADGE_CLASS[current.category] ?? CATEGORY_BADGE_CLASS["公告"],
                  )}
                >
                  {current.category}
                </span>
                {current.badge && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-rose-500 text-white">
                    {current.badge}
                  </span>
                )}
                <time className="text-[10px] text-white/70 font-mono tabular-nums">
                  {current.date}
                </time>
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold text-white leading-tight mb-2 max-w-2xl">
                {current.title}
              </h2>
              <p className="text-sm text-white/80 leading-relaxed max-w-2xl line-clamp-2">
                {current.summary}
              </p>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* 左右按钮 — sm 以上显示, stopPropagation 避免触发 Link 跳转 */}
        {items.length > 1 && (
          <>
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                goTo(safeActive - 1);
              }}
              aria-label="上一条"
              className="hidden sm:flex absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 hover:bg-white text-slate-700 items-center justify-center shadow-md opacity-0 group-hover:opacity-100 transition-opacity z-10"
            >
              <IconChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                goTo(safeActive + 1);
              }}
              aria-label="下一条"
              className="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 hover:bg-white text-slate-700 items-center justify-center shadow-md opacity-0 group-hover:opacity-100 transition-opacity z-10"
            >
              <IconChevronRight className="w-5 h-5" />
            </button>
          </>
        )}

        {/* 计数 — 右上角 */}
        {items.length > 1 && (
          <div className="absolute top-3 right-3 px-2 py-1 rounded-md bg-black/40 text-white text-[10px] font-mono tabular-nums z-10 pointer-events-none">
            {safeActive + 1} / {items.length}
          </div>
        )}
      </Link>

      {/* Dot 指示器 */}
      {items.length > 1 && (
        <div className="mt-3 flex items-center justify-center gap-1.5">
          {items.map((it, i) => (
            <button
              key={it.slug}
              onClick={(e) => {
                e.preventDefault();
                goTo(i);
              }}
              aria-label={`跳到第 ${i + 1} 条: ${it.title}`}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === safeActive ? "w-6 bg-slate-700" : "w-1.5 bg-slate-300 hover:bg-slate-400",
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
