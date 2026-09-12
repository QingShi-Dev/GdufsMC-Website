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
 * - images[0] 可以是 panel (替代图, 占 aspect-[16/10] 容器)
 * - textContent[i] 对应 images[i], 元素 string 或 ReactNode (含 <a>/<CopyHost>)
 */

import { Children, useCallback, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { IconChevronLeft, IconChevronRight, IconExternalLink, IconLock } from "@tabler/icons-react";
import { useCarousel } from "@/components/guide/hooks/use-carousel";
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

export function Tutorial({ steps }: { steps: Step[] }) {
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

  // ---- 3. 顶部对齐滚动: 鼠标点击步骤 / 上下页时, 把整个 tutorial-steps 组件
  //          顶部滚到 header 下方 (留出适当间距), 移动 / 桌面一致 ----
  // 故意只挂在 click handler, 不挂键盘 handler: 键盘用户可能正用 Tab 定位到侧栏,
  // 强制滚动会把焦点带出可视区. 不用 scrollIntoView({ block: 'start' }) 因为:
  //   (a) header 是 fixed top-0, scrollIntoView 不知道 header 存在, 元素顶会
  //       被 header 压住
  //   (b) 想留出视觉间距 (header 跟组件之间有点呼吸感)
  // 改成手算: 累加 offsetTop 拿 natural 文档位置, 动态量 header 高度
  const carouselRef = useRef<HTMLDivElement>(null);
  const scrollComponentToTopUnderHeader = useCallback(() => {
    const el = carouselRef.current;
    if (!el) return;

    // 动态量 fixed header 高度 (匹配 <header className="fixed top-0 inset-x-0 z-50">)
    const headerEl = document.querySelector<HTMLElement>("header.fixed.top-0");
    const headerHeight = headerEl ? headerEl.getBoundingClientRect().height : 0;

    // 跟 header 之间的视觉间距 — 移动端 14px, 桌面端 24px
    // 跟 Tailwind 断点一致: < sm (640px) 用 14, >= sm 用 24
    const TOP_GAP = window.innerWidth >= 640 ? 24 : 14;

    // 累加 offsetTop 拿到 element 在 document 里的 natural 顶部位置
    let naturalTop = 0;
    let node: HTMLElement | null = el;
    while (node) {
      naturalTop += node.offsetTop;
      node = node.offsetParent as HTMLElement | null;
    }

    // 目标: 整个组件顶部贴 header 下沿, 留出 TOP_GAP 间距
    const targetVisualTop = headerHeight + TOP_GAP;
    const targetScrollY = Math.max(0, naturalTop - targetVisualTop);

    // 尊重 prefers-reduced-motion
    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    window.scrollTo({
      top: targetScrollY,
      behavior: reducedMotion ? "auto" : "smooth",
    });
  }, []);

  // ---- 4. 键盘导航: focus 在 carousel 区域时, ArrowLeft/Right 翻页 ----
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
    <div
      ref={carouselRef}
      className="mt-6 sm:mt-10 grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.8fr)] gap-4 sm:gap-6 lg:gap-8 items-start"
    >
      {/* ---- 左栏: 4 步 (图标 + 序号+标题一行 + 描述, 竖向) ---- */}
      <ol className="flex flex-col gap-1 md:gap-3.5">
        {steps.map((s, i) => {
          const isActive = i === activeIdx;
          return (
            <li key={s.title}>
              <button
                onClick={() => {
                  goTo(i);
                  scrollComponentToTopUnderHeader();
                }}
                aria-current={isActive ? "step" : undefined}
                className={cn(
                  "group w-full text-left flex items-center gap-3 sm:gap-3.5 py-1.5 sm:pt-3 sm:pb-2.5 px-3 sm:px-3.5 xl:-mx-3 rounded-xl transition-colors",
                  isActive
                    ? "bg-sky-100"
                    : "hover:bg-slate-100/80",
                )}
              >
                {/* 图标 (左, 小尺寸) */}
                <span
                  className={cn(
                    "w-8 h-8 sm:w-9.5 sm:h-9.5 rounded-md flex items-center justify-center flex-shrink-0 p-0.5",
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
                  <div className="flex items-baseline gap-1.5">
                    <span
                      className={cn(
                        "font-bold tracking-tighter tabular-nums leading-none transition-colors text-base flex-shrink-0",
                        isActive ? "text-slate-800" : "text-slate-400 group-hover:text-slate-500",
                      )}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span
                      className={cn(
                        "font-semibold text-base sm:text-[17px] transition-colors truncate",
                        isActive ? "text-slate-900" : "text-slate-500 group-hover:text-slate-600",
                      )}
                    >
                      {s.title}
                    </span>
                  </div>
                  <p
                    className={cn(
                        "hidden sm:block",
                        "text-[15px] leading-relaxed transition-colors",
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
                className="relative aspect-[16/10] bg-slate-50 overflow-hidden"
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
              /* panel — 占图片区 (aspect-[16/10] 跟图片区同高, carousel 切换不跳布局) */
              <div
                className="relative aspect-[16/10] bg-gradient-to-br from-slate-50/40 to-white p-4 sm:p-6 flex flex-col justify-center overflow-hidden"
                role="group"
                aria-roledescription="slide"
                aria-label={`${active.title} 链接面板`}
              >
                <div className="mb-3 flex items-center gap-2">
                  <span className="font-semibold text-[16px] sm:text-[17px] text-slate-800">
                    {current.panel.title}
                  </span>
                  {current.panel.subtitle && (
                    <>
                      <span className="text-[14px] sm:text-[15px] text-slate-500 ml-0.5">
                        {current.panel.subtitle}
                      </span>
                    </>
                  )}
                </div>
                <div
                  className={cn(
                    "grid gap-1 sm:gap-2",
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
                        "group relative block px-3.5 py-2 sm:p-3.5 rounded-xl border transition-all overflow-hidden",
                        l.primary
                          ? "bg-gradient-to-br from-sky-50 to-purple-50 border-blue-500/25 hover:border-blue-300 hover:shadow-lg hover:shadow-blue-500/10 hover:-translate-y-0.5 transition-all"
                          : "bg-white border-slate-200 hover:border-blue-300/90 hover:shadow-lg hover:shadow-blue-500/10 hover:-translate-y-0.5 transition-all",
                        l.wide && "sm:col-span-2",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold flex items-center gap-1.5 text-[15px] sm:text-[16px] text-slate-800">
                            <span className="group-hover:text-blue-500 transition-colors truncate">{l.label}</span>
                            {l.primary && (
                              <span className="text-[11px] sm:text-[12px] px-1.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 font-medium flex-shrink-0">
                                推荐
                              </span>
                            )}
                            {l.password && (
                              <span className="inline-flex items-center gap-1 text-[10px] sm:text-[12px] font-mono px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 flex-shrink-0">
                                <IconLock className="w-2.5 h-2.5" />
                                {l.password}
                              </span>
                            )}
                          </div>
                          {l.desc && (
                            <div className="hidden sm:flex text-[13px] sm:text-[14px] text-slate-500 mt-0.5 line-clamp-2">
                              {l.desc}
                            </div>
                          )}
                        </div>
                        <IconExternalLink className="w-4 h-4 text-slate-400 group-hover:text-sky-600 transition-colors flex-shrink-0 mt-0.5" />
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )
          ) : (
            /* step 无 content (空数组) — 占位 (aspect-[16/10] 跟图片/panel 同高, 不跳布局) */
            <div
              className="relative aspect-[16/10] flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100/60"
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
            className="px-3 py-2 sm:px-4 sm:py-3 bg-white border-t border-slate-200/80 min-h-[3rem]"
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
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-100 text-slate-600 text-[12px] sm:text-[14px] font-mono font-semibold flex items-center justify-center mt-0.5 tabular-nums border border-slate-200/60">
                    {String(contentIdx + 1).padStart(2, "0")}
                  </span>
                  <div className="flex-1 pt-0.5 text-[15px] sm:text-[16px]">{Children.toArray(text)}</div>
                </div>
              );
            })()}
          </div>

          {/* 翻页 footer: prev/next + 计数 + 边界提示 (手动 + 键盘) */}
          {hasContent && (
            <>
              <div
                className="flex items-center justify-between px-2 py-1 sm:px-3 sm:py-2 bg-white/70 border-t border-slate-200/80"
                role="group"
                aria-label="教程图翻页"
              >
                <button
                  onClick={() => {
                    prev();
                    scrollComponentToTopUnderHeader();
                  }}
                  disabled={prevDisabled}
                  aria-label="上一张教程图"
                  className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center transition-colors",
                    prevDisabled
                      ? "text-slate-300 cursor-not-allowed"
                      : "text-slate-500 hover:text-slate-600 hover:bg-slate-200/60",
                  )}
                >
                  <IconChevronLeft className="w-5 h-5" />
                </button>

                <span
                  className="text-[15px] sm:text-[16px] font-mono text-slate-400 tabular-nums"
                  aria-current="true"
                >
                  {contentIdx + 1} / {contents.length}
                </span>

                <button
                  onClick={() => {
                    next();
                    scrollComponentToTopUnderHeader();
                  }}
                  disabled={nextDisabled}
                  aria-label="下一张教程图"
                  className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center transition-colors",
                    nextDisabled
                      ? "text-slate-300 cursor-not-allowed"
                      : "text-slate-500 hover:text-slate-600 hover:bg-slate-200/60",
                  )}
                >
                  <IconChevronRight className="w-5 h-5" />
                </button>
              </div>
              {/* 边界提示 + 键盘提示 */}
              <div className="px-3 py-1 sm:py-1.5 text-[12px] sm:text-[13px] text-slate-400 text-center bg-white/40 border-t border-slate-100">
                左右按钮点击翻页
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
