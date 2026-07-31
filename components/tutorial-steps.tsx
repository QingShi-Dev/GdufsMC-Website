"use client";

/**
 * 4 步教程 — 左：图标 + 数字 + 标题 + 描述（竖向） / 右：图片 + 文字区 + 翻页
 *
 * 架构:
 * - 翻页逻辑抽到 useCarousel hook (跨 step 边界 + disabled)
 * - state 分 2 块: 视图 (imgLoaded 切图淡入) / 翻页 (hook 内)
 * - 键盘 ArrowLeft / ArrowRight 切图 (focus 在 carousel 区域时)
 * - A11y: role="region" + aria-roledescription="carousel" + 文字区 aria-live
 *
 * 数据契约 (Step / StepContent / StepLink / StepPanel): 同之前,
 * - images[0] 可以是 panel (替代图, 占 aspect-video 容器)
 * - textContent[i] 对应 images[i], 元素 string 或 ReactNode (含 <a>/<CopyHost>)
 */

import { Children, useState, type KeyboardEvent, type ReactNode } from "react";
import { IconChevronLeft, IconChevronRight, IconExternalLink, IconLock } from "@tabler/icons-react";
import { useCarousel } from "@/components/hooks/use-carousel";
import { cn } from "@/lib/utils";

export interface StepLink {
  label: string;
  url: string;
  desc?: string;
  /** 蓝奏云提取码等可选提示 */
  password?: string;
  /** 推荐标记 (视觉强调) */
  primary?: boolean;
  /** 补充说明 (例如 "需要邀请码") */
  note?: string;
  /** 整行占满 (col-span-2), 适合主推链接 */
  wide?: boolean;
}

/**
 * 步骤面板 — 渲染在 carousel 图片区 (作为 images 数组第 0 项, 替代图)
 */
export interface StepPanel {
  title: string;
  subtitle?: string;
  links: StepLink[];
}

/**
 * carousel 内容项 — discriminated union
 */
export type StepContent =
  | { type: "panel"; panel: StepPanel }
  | { type: "image"; src: string };

export interface Step {
  title: string;
  desc: string;
  iconSrc: string;
  accent: string;
  /** carousel 内容数组: 第 0 项可以是 panel, 之后是 image (顺延) */
  images: StepContent[];
  /** 文字区细分动作列表 (索引 === contentIdx, 元素 string 或 ReactNode) */
  textContent?: ReactNode[];
}

export function TutorialSteps({ steps }: { steps: Step[] }) {
  // ---- 1. 翻页状态 (hook 接管: 跨 step 边界 + disabled 标记) ----
  const {
    active,
    activeIdx,
    contentIdx,
    contents,
    current,
    hasContent,
    goTo,
    prev,
    next,
    prevDisabled,
    nextDisabled,
  } = useCarousel<StepContent, Step>(steps);

  // ---- 2. 视图状态: 切图淡入 ----
  // 用 key={`${activeIdx}-${contentIdx}`} 触发 img remount, imgLoaded 在 image
  // remount 时自动重置为初始 false, onLoad 后变 true. 不需要 useEffect 手动重置
  // (之前 useEffect + setState 触发 react-hooks/set-state-in-effect 警告)
  const [imgLoaded, setImgLoaded] = useState(false);

  // ---- 3. 键盘导航: focus 在 carousel 区域时, ArrowLeft/Right 翻页 ----
  const onCarouselKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      prev();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      next();
    } else if (e.key === "Home") {
      e.preventDefault();
      goTo(0);
    } else if (e.key === "End") {
      e.preventDefault();
      goTo(steps.length - 1);
    }
  };

  return (
    <div className="mt-10 grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.8fr)] gap-6 lg:gap-8 items-start">
      {/* ---- 左栏: 4 步 (图标 + 序号+标题一行 + 描述, 竖向) ---- */}
      <ol className="flex flex-col gap-5">
        {steps.map((s, i) => {
          const isActive = i === activeIdx;
          return (
            <li key={s.title}>
              <button
                onClick={() => goTo(i)}
                aria-current={isActive ? "step" : undefined}
                className={cn(
                  "group w-full text-left flex items-start gap-2.5 py-2 px-3 -mx-3 rounded-xl transition-colors",
                  isActive
                    ? "bg-sky-100"
                    : "hover:bg-slate-50",
                )}
              >
                {/* 图标 (左, 小尺寸) */}
                <span
                  className={cn(
                    "w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 p-0.5 transition-colors",
                    isActive ? "bg-white shadow-sm border border-slate-200/80" : "bg-slate-100",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={s.iconSrc}
                    alt=""
                    className="w-full h-full object-contain"
                  />
                </span>
                {/* 序号 + 标题一行 / 描述下一行 */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span
                      className={cn(
                        "font-bold tracking-tighter tabular-nums leading-none transition-colors text-sm sm:text-base flex-shrink-0",
                        isActive ? "text-slate-800" : "text-slate-300 group-hover:text-slate-400",
                      )}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <h3
                      className={cn(
                        "font-semibold text-sm sm:text-base transition-colors truncate",
                        isActive ? "text-slate-900" : "text-slate-600 group-hover:text-slate-800",
                      )}
                    >
                      {s.title}
                    </h3>
                  </div>
                  <p
                    className={cn(
                      "text-xs leading-relaxed transition-colors mt-1",
                      isActive ? "text-slate-600" : "text-slate-500",
                    )}
                  >
                    {s.desc}
                  </p>
                </div>
              </button>
            </li>
          );
        })}
      </ol>

      {/* ---- 右栏: 图片区 (panel/image 混合) + 文字区 + 翻页 ---- */}
      <div className="lg:sticky lg:top-24">
        <div
          role="region"
          aria-roledescription="carousel"
          aria-label="四步教程"
          tabIndex={0}
          onKeyDown={onCarouselKeyDown}
          className="relative rounded-2xl overflow-hidden bg-slate-100 border border-slate-200/80 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
        >
          {/* 图片区 — panel 占第 0 项, 图顺延到 1..N */}
          {hasContent && current ? (
            current.type === "image" ? (
              <div
                className="relative aspect-video bg-slate-50 overflow-hidden"
                role="group"
                aria-roledescription="slide"
                aria-label={`${active.title} 第 ${contentIdx + 1} / ${contents.length} 张`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- 本地图, 不走 next/image 优化 */}
                <img
                  key={`${activeIdx}-${contentIdx}`}
                  src={current.src}
                  alt={`${active.title} - ${contentIdx + 1}/${contents.length}`}
                  // 原图分辨率 ~736x440, 显式 width/height 让浏览器在加载前预留空间
                  width={736}
                  height={440}
                  onLoad={() => setImgLoaded(true)}
                  // 加载失败时回退到占位图 (1x1 灰 SVG, 避免白屏)
                  onError={(e) => {
                    const img = e.currentTarget;
                    if (img.dataset.fallback === "1") return;
                    img.dataset.fallback = "1";
                    img.src =
                      "data:image/svg+xml;utf8," +
                      encodeURIComponent(
                        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"><rect width="16" height="9" fill="#f1f5f9"/><text x="8" y="4.5" font-size="1.2" text-anchor="middle" fill="#94a3b8" font-family="sans-serif">图片加载失败</text></svg>',
                      );
                  }}
                  className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ease-out"
                  style={{ opacity: imgLoaded ? 1 : 0 }}
                />
              </div>
            ) : (
              /* panel — 占图片区 (aspect-video) 跟原皮肤站 section 同样的卡片框体 */
              <div
                className="relative aspect-video bg-gradient-to-br from-slate-50/40 to-white p-6 flex flex-col justify-center overflow-hidden"
                role="group"
                aria-roledescription="slide"
                aria-label={`${active.title} 链接面板`}
              >
                <div className="mb-3 flex items-center gap-2">
                  <span className="font-semibold text-base text-slate-800">
                    {current.panel.title}
                  </span>
                  {current.panel.subtitle && (
                    <>
                      <span className="text-slate-300">·</span>
                      <span className="text-xs text-slate-500">
                        {current.panel.subtitle}
                      </span>
                    </>
                  )}
                </div>
                <div
                  className={cn(
                    "grid gap-2",
                    current.panel.links.length === 1
                      ? "grid-cols-1"
                      : "grid-cols-1 sm:grid-cols-2",
                  )}
                >
                  {current.panel.links.map((l) => (
                    <a
                      key={l.url}
                      href={l.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(
                        "group relative block p-3.5 rounded-xl border transition-all overflow-hidden",
                        l.primary
                          ? "bg-gradient-to-br from-sky-50 to-purple-50 border-sky-500/25 hover:border-sky-500/85"
                          : "bg-white border-slate-200/80 hover:border-slate-300/80",
                        l.wide && "sm:col-span-2",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold flex items-center gap-1.5 text-sm text-slate-900">
                            <span className="truncate">{l.label}</span>
                            {l.primary && (
                              <span className="text-[9px] px-1.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 font-medium flex-shrink-0">
                                推荐
                              </span>
                            )}
                            {l.password && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 flex-shrink-0">
                                <IconLock className="w-2.5 h-2.5" />
                                {l.password}
                              </span>
                            )}
                          </div>
                          {l.desc && (
                            <div className="text-xs text-slate-500 mt-1 line-clamp-2">
                              {l.desc}
                            </div>
                          )}
                        </div>
                        <IconExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-sky-600 transition-colors flex-shrink-0 mt-0.5" />
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )
          ) : (
            /* step 无 content (空数组) — 占位 */
            <div
              className="relative aspect-video flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100/60"
              role="group"
              aria-roledescription="slide"
              aria-label="本步骤暂无内容"
            >
              <div className="text-center px-6 max-w-xs">
                <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-white border border-slate-200/80 flex items-center justify-center shadow-sm">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={active.iconSrc} alt="" className="w-7 h-7 object-contain" />
                </div>
                <div className="text-sm font-semibold text-slate-700 mb-1">本步骤暂无内容</div>
                <div className="text-xs text-slate-500 leading-relaxed">请参考左侧文字描述</div>
              </div>
            </div>
          )}

          {/* 文字区 — 跟当前 content 一一对应
              - 数组索引 === contentIdx (panel 占 0 位)
              - aria-live="polite" 让屏幕阅读器在切换时朗读 */}
          <div
            aria-live="polite"
            aria-atomic="true"
            className="px-4 py-3 bg-white border-t border-slate-200/80 min-h-[3rem]"
          >
            {(() => {
              const text = active.textContent?.[contentIdx];
              if (text === undefined || text === null) {
                return (
                  <div className="text-slate-400 italic select-none text-xs flex items-center min-h-[1.5rem]">
                    文字区域 · 等待编辑
                  </div>
                );
              }
              return (
                <div className="flex items-start gap-2.5 text-sm text-slate-700 leading-relaxed">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-100 text-slate-600 text-[11px] font-mono font-semibold flex items-center justify-center mt-0.5 tabular-nums border border-slate-200/60">
                    {String(contentIdx + 1).padStart(2, "0")}
                  </span>
                  <div className="flex-1 pt-0.5">{Children.toArray(text)}</div>
                </div>
              );
            })()}
          </div>

          {/* 翻页 footer: prev/next + 计数 + 边界提示 (手动 + 键盘) */}
          {hasContent && (
            <>
              <div
                className="flex items-center justify-between px-3 py-2 bg-white/70 border-t border-slate-200/80"
                role="group"
                aria-label="教程图翻页"
              >
                <button
                  onClick={prev}
                  disabled={prevDisabled}
                  aria-label="上一张教程图"
                  className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center transition-colors",
                    prevDisabled
                      ? "text-slate-300 cursor-not-allowed"
                      : "text-slate-500 hover:text-slate-800 hover:bg-slate-100",
                  )}
                >
                  <IconChevronLeft className="w-4 h-4" />
                </button>

                <span
                  className="text-[14px] font-mono text-slate-400 tabular-nums"
                  aria-current="true"
                >
                  {contentIdx + 1} / {contents.length}
                </span>

                <button
                  onClick={next}
                  disabled={nextDisabled}
                  aria-label="下一张教程图"
                  className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center transition-colors",
                    nextDisabled
                      ? "text-slate-300 cursor-not-allowed"
                      : "text-slate-500 hover:text-slate-800 hover:bg-slate-100",
                  )}
                >
                  <IconChevronRight className="w-4 h-4" />
                </button>
              </div>
              {/* 边界提示 + 键盘提示 */}
              <div className="px-3 py-1.5 text-[10px] text-slate-400 text-center bg-white/40 border-t border-slate-100">
                左右按钮点击翻页
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
