"use client";

/**
 * News 顶部轮播图 — 大图 + 文字 + dot + 左右按钮
 * - 5 张精选 (carousel prop 控制)
 * - 自动轮播 6s, hover 暂停, 切图时重置计时
 * - framer-motion 左右滑动 (direction: 1=从右, -1=从左), iOS ease
 * - 键盘: ←/→ 切图 (会跳过 input/textarea/contenteditable)
 * - 响应式: sm 以下隐藏左右按钮 (用 dot 切)
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as RMouseEvent,
  type TouchEvent as RTouchEvent,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { CATEGORY_BADGE_CLASS } from "@/lib/news/types";
import type { NewsItem } from "@/lib/news/types";

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

export function HeroCarousel({ items }: { items: NewsItem[] }) {
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

  // 触摸滑动切换 — 移动端左右滑切换图片 (用户要求)
  //   - 阈值 50px 触发切换, 方向判定阈值 10px (避免误触)
  //   - 一次手势只切一次 (switched 标记), 想切多张需抬起再滑
  //   - 滑动后**不**打开详情页 (用户要求):
  //     - 浏览器 swipe 行为 (touchmove > ~10px) 通常不合成 click
  //     - 即便触发了 click, onClickCapture 用 touchRef.switched 拦截, preventDefault 阻止 Link history.push
  //   - 短距离移动 (< 10px) → browser 视为 tap → switched=false → Link 正常跳详情页 ✓
  //   - 为什么用 ref 而不是 state: state 更新异步, 同步访问 ref 才能在 onClickCapture 里读到最新手势状态
  const touchRef = useRef({
    startX: 0,
    startY: 0,
    judged: false,
    horizontal: false,
    switched: false,
  });
  const SWIPE_THRESHOLD = 50;
  const DIRECTION_THRESHOLD = 10;

  const onTouchStart = (e: RTouchEvent) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    if (!t) return;
    touchRef.current = {
      startX: t.clientX,
      startY: t.clientY,
      judged: false,
      horizontal: false,
      switched: false,
    };
  };

  const onTouchMove = (e: RTouchEvent) => {
    if (e.touches.length !== 1) return;
    const touch = touchRef.current;
    const t = e.touches[0];
    if (!t) return;
    const dx = t.clientX - touch.startX;
    const dy = t.clientY - touch.startY;

    if (!touch.judged) {
      if (
        Math.abs(dx) > DIRECTION_THRESHOLD ||
        Math.abs(dy) > DIRECTION_THRESHOLD
      ) {
        touch.judged = true;
        // 水平占优 (dx > dy * 1.2) 才算水平滑动, 阈值较松避免斜向 ~30° 误判
        touch.horizontal = Math.abs(dx) > Math.abs(dy) * 1.2;
      }
    }

    if (touch.judged && touch.horizontal && !touch.switched) {
      if (Math.abs(dx) > SWIPE_THRESHOLD) {
        touch.switched = true;
        // 左滑 (dx < 0) → 下一张 (+1), 右滑 (dx > 0) → 上一张 (-1)
        goTo(safeActive + (dx < 0 ? 1 : -1));
      }
    }
  };

  // touchend 立即 reset switched, 不等下次 onTouchStart
  //   - 浏览器 swipe 行为可能不合成 click → switched 一直 true 到下次触摸
  //   - 立即 reset 后, 期间用户连续快速点同一位置 (双击) 不会被误判为 swipe 后被拦截
  //   - 仍然比 browser 的 tap 判定 (~300ms timeout) 快, 用户感知不到差别
  const onTouchEnd = () => {
    touchRef.current.switched = false;
  };

  // Link 点击拦截 — 滑动切换后阻止进入详情页 (用户要求)
  //   - capture phase 早于 React Link 自己的 handler, 能 preventDefault 阻止 history.push
  //   - 重置 switched, 后续普通点击 (无 touch) 仍能正常跳详情页
  const onLinkClickCapture = (e: RMouseEvent) => {
    if (touchRef.current.switched) {
      e.preventDefault();
      e.stopPropagation();
      touchRef.current.switched = false;
    }
  };

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
  // safeActive 来自 modulo, 理论上必合法; 但 noUncheckedIndexedAccess 要求显式守门
  if (!current) return null;

  return (
    <div
      className="group relative"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* 大图区 — 21:9 比例, 整块可点击进详情 (移动端可左右滑切换, 滑动后不跳) */}
      <Link
        href={`/news/${current.slug}`}
        onClickCapture={onLinkClickCapture}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        className="block relative min-h-[200px] sm:aspect-[21/7] rounded-2xl overflow-hidden bg-slate-100 border border-slate-200/80 shadow-sm shadow-slate-900/[0.04] cursor-pointer"
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
              x: { type: "tween", ease: [0.32, 0.72, 0, 1], duration: 0.75 },
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
            <div className="absolute inset-x-0 bottom-0 p-4 sm:p-6 sm:p-8 sm:pb-6">
              <div className="flex items-center gap-2 mb-1 sm:mb-3">
                <span
                  className={cn(
                    "text-[11px] sm:text-[12px] font-semibold px-2 py-0.5 rounded-md uppercase tracking-wider",
                    CATEGORY_BADGE_CLASS[current.category] ?? CATEGORY_BADGE_CLASS["公告"],
                  )}
                >
                  {current.category}
                </span>
                {current.badge && (
                  <span className="text-[11px] sm:text-[12px] font-semibold px-2 py-0.5 rounded-md bg-rose-500 text-white">
                    {current.badge}
                  </span>
                )}
                <time className="text-[15px] sm:text-[16px] text-white font-semibold tabular-nums ml-2">
                  {current.date}
                </time>
              </div>
              <h2 className="text-[22px] sm:text-[30px] font-bold text-white leading-tight sm:mb-2 max-w-2xl">
                {current.title}
              </h2>
              <p className="hidden sm:flex text-[14px] text-white/80 leading-relaxed max-w-2xl line-clamp-2">
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
              className="hidden sm:flex absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 hover:bg-white text-slate-700/90 items-center justify-center shadow-md opacity-0 group-hover:opacity-100 transition-opacity z-10"
            >
              <IconChevronLeft className="w-6.5 h-6.5" />
            </button>
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                goTo(safeActive + 1);
              }}
              aria-label="下一条"
              className="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 hover:bg-white text-slate-700/90 items-center justify-center shadow-md opacity-0 group-hover:opacity-100 transition-opacity z-10"
            >
              <IconChevronRight className="w-6.5 h-6.5" />
            </button>
          </>
        )}

        {/* 计数 — 右上角 */}
        {items.length > 1 && (
          <div className="hidden sm:flex absolute top-4 right-6 px-2.5 py-1 rounded-full bg-black/40 text-white text-[13px] font-mono tabular-nums z-10 pointer-events-none">
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
                i === safeActive ? "w-5 bg-emerald-500/90" : "w-1.5 bg-slate-300 hover:bg-slate-400 cursor-pointer",
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
