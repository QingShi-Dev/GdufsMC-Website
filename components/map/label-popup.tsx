/**
 * 地标详情卡片
 *
 * 桌面端 (isMobile=false):
 *  - 固定在地图左上角 (absolute left-3 top-3), w-72 sm:w-80 (320px)
 *  - 顶部 hero 图 + 名称/坐标/建设者 + 投入/产出 + 细节图缩略图 (1-3 张)
 *  - 细节图 caption 在缩略图下方
 *
 * 移动端 (isMobile=true):
 *  - 出现在地图下面 (fixed bottom-0), 全屏宽
 *  - 没有头图 (hero), 全部图都当细节图显示 (无 caption)
 *  - 展开前: name + description + 最多 3 张细节图 + "展开" 按钮
 *  - 展开后: 全部内容 (builder / inputs / outputs) + 全部细节图 (>3 张变横向滚动)
 *
 * 设计要点:
 *  - select-text 覆盖 map 容器 select-none 继承, 让 popup 内文字可选
 *  - popup.onMouseDown stopPropagation 兜底防止 React 18 合成事件偶发不生效
 *  - popup 不 onClick stopPropagation — 用户要求点 popup 内任意位置都关 popup
 *  - popup 内的图片 button + stopPropagation (commit 87b94b7) — 点图片打开 lightbox 不关 popup
 *
 * lightbox: 打开时不显示当前 popup 的 hero/详情标签, 只显示图片 (commit 9b09732)
 *  - title 从 hiResImages[currentIndex] URL 提取文件名 stem
 */
"use client";
/* eslint-disable @next/next/no-img-element -- 项目图标/PNG 缩略图用 /public 下资源, next/image 只优化位图不优化 SVG/动画 gif, 这里直接 <img> 更合适 */

import { useEffect, useState } from "react";
import { IconArrowRight } from "@tabler/icons-react";
import type {
  NewLabel,
  NewLabelProduct,
} from "@/lib/map/labels";
import { ImageLightbox } from "./image-lightbox";

export interface LabelPopupProps {
  label: NewLabel;
  onClose: () => void;
  /**
   * 覆盖默认 `top-3` — 用于外部挂载了其他元素 (e.g. 搜索框) 时下移避开
   * 例: 搜索开启时父组件传 `top-[70px]` 让 popup 落到搜索框下方
   *  - 桌面端用 (popup 在地图左上)
   *  - 移动端忽略 (popup 在底部)
   */
  topClassName?: string;
  /**
   * popup 根 div ref — 暴露给 parent (GuideMap) 让 map.onPointerDown 拦截
   *   - 用户要求: popup 内拖动 = 选中文字, 不能拖地图 (跟搜索框 input 同款)
   *   - parent 检查 popupRef.current?.contains(e.target), 命中就 return (不启动 drag)
   *   - 不传 ref 时 parent 用 document.querySelector fallback (跟 searchWrapper 同款双保险)
   */
  rootRef?: React.RefObject<HTMLDivElement | null>;
  /**
   * 全屏状态 — 控制 popup 宽度
   *   - false (非全屏): w-72 sm:w-80 (320px 固定)
   *   - true (全屏): w-[max(320px,min(25vw,420px))] viewport 25% 不超 420px 不低于 320px
   */
  isFullscreen?: boolean;
  /**
   * 移动端 — popup 走完全不同的 UI (bottom sheet 模式)
   *   - 桌面 (false): 左侧固定卡片, 有 hero 图, 详细字段全展开
   *   - 移动 (true): 底部 sheet, 没有 hero, 全部图当细节图, 展开前/后切换
   */
  isMobile?: boolean;
}

export function LabelPopup({
  label,
  onClose,
  topClassName,
  rootRef,
  isFullscreen,
  isMobile,
}: LabelPopupProps) {
  // 移动端走专属渲染分支 (bottom sheet 模式), 桌面端走原逻辑
  if (isMobile) {
    return (
      <MobilePopup
        label={label}
        onClose={onClose}
        rootRef={rootRef}
      />
    );
  }

  return (
    <DesktopPopup
      label={label}
      onClose={onClose}
      topClassName={topClassName}
      rootRef={rootRef}
      isFullscreen={isFullscreen}
    />
  );
}

/* ============================== Desktop ============================== */

function DesktopPopup({
  label,
  onClose,
  topClassName,
  rootRef,
  isFullscreen,
}: {
  label: NewLabel;
  onClose: () => void;
  topClassName?: string;
  rootRef?: React.RefObject<HTMLDivElement | null>;
  isFullscreen?: boolean;
}) {
  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 切分图片: 第一张是 hero, 剩下是细节
  const images = label.images ?? [];
  const heroImage = images[0];
  const detailImages = images.slice(1);
  const hasHero = !!heroImage;
  const hasDetails = detailImages.length > 0;
  const hasDescription = !!label.description;
  const hasInputs = !!label.inputs && label.inputs.length > 0;
  const hasOutputs = !!label.outputs && label.outputs.length > 0;
  const hasAnyContent = hasHero || hasDetails || hasDescription || hasInputs || hasOutputs;

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby="lm-popup-name"
      className={cn(
        "absolute left-4 z-20",
        topClassName ?? "top-4",
        isFullscreen
          ? "w-[max(320px,min(25vw,420px))] max-w-[calc(100vw-24px)]"
          : "w-72 sm:w-80 max-w-[calc(100%-24px)]",
        "bg-white border border-slate-200 rounded-lg",
        "shadow-2xl shadow-slate-900/20",
        "overflow-hidden",
        "animate-in fade-in slide-in-from-top-2 duration-200",
        "select-text",
      )}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {hasHero && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setLightboxIndex(0);
          }}
          className="group relative w-full aspect-[2560/1361] overflow-hidden bg-slate-100 cursor-zoom-in block"
        >
          <img
            src={heroImage}
            alt=""
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
          <div className="absolute inset-0 bg-slate-900/0 group-hover:bg-slate-800/50 transition-colors flex items-center justify-center gap-1.5">
            <img
              src="/icons/map/tabs/查看图片图标.svg"
              alt=""
              className="w-5 h-5 opacity-0 group-hover:opacity-90 transition-opacity"
            />
            <span className="text-[13px] font-medium text-white opacity-0 group-hover:opacity-100 transition-opacity">
              查看大图
            </span>
          </div>
        </button>
      )}

      <div className="px-4.5 pt-5.5 pb-5 space-y-1.5">
        <span
          id="lm-popup-name"
          className="text-[23px] font-normal text-slate-800 leading-tight"
        >
          {label.name}
        </span>
        {hasDescription && (
          <p className="text-[15px] mt-1.5 leading-snug text-slate-600">
            {label.description}
          </p>
        )}
        <div className="mt-3 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[14px] text-slate-600">
            <span className="text-[13px] uppercase w-8 shrink-0 text-slate-600">
              坐标
            </span>
            <span className="font-mono">
              x={label.x} z={label.z}
            </span>
          </div>
          {label.builder && (
              <div className="flex  items-center gap-1.5 pt-1">
                <span className="text-[13px] uppercase w-11 shrink-0 text-slate-600">
                  建设者
                </span>
                <span className="text-[13px] leading-snug text-slate-600 font-medium flex-1 min-w-0 flex flex-wrap gap-x-1.5">
                  {label.builder
                    .split(/\s+/)
                    .filter((name) => name.length > 0)
                    .map((name, i) => (
                      <span key={i}>{name}</span>
                    ))}
                </span>
              </div>
          )}
        </div>
      </div>

      {(hasInputs || hasOutputs) && (
        <div className="flex flex-col px-4.5 pb-5.5 gap-1 space-y-1">
          {hasInputs && (
            <ProductRow label="投入" products={label.inputs!} tone="sky" />
          )}
          {hasOutputs && (
            <ProductRow label="产出" products={label.outputs!} tone="emerald" />
          )}
        </div>
      )}

      {hasDetails && (
        <div className="px-4.5 pb-4 mt-1">
          <ImageThumbnails
            images={detailImages}
            onOpenLightbox={(detailIdx) => {
              setLightboxIndex(detailIdx + 1);
            }}
          />
        </div>
      )}

      {!hasAnyContent && <div className="h-2" />}

      {lightboxIndex !== null && (
        <ImageLightbox
          images={images}
          imagesFull={images.map(toFullImagePath)}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}

/* ============================== Mobile ============================== */

/**
 * 移动端 popup — bottom sheet 风格
 *
 * 结构:
 *  - 顶部 sticky bar: name + 关闭按钮
 *  - collapsed body: description + 最多 3 张细节图 (grid) + "展开" 按钮
 *  - expanded body (展开后追加): builder + inputs + outputs + 全部细节图
 *    - 细节图 > 3 张: 横向滚动栏 (隐藏滚动条)
 *
 * 高度策略:
 *  - collapsed: 屏幕高度的 50% (max-h-[50vh])
 *  - expanded: 屏幕高度的 90% (max-h-[90vh])
 *  - 两个状态都用 bottom 0 定位, 滑入动画
 *
 * 注意点:
 *  - 没有 hero 图: 用户要求"全部显示为细节图" (没有"头图"概念)
 *  - 不显示 caption: 移动端空间宝贵, 隐藏细节图下方的 - 横杠标注
 *  - popup 内容点击不关 popup (跟桌面端一致): 用户要在 popup 内操作
 *  - 关闭按钮只在 top bar, 不依赖点击 popup 其它位置关闭
 *    (用户要求: 移动端点击 label 出现在地图下面, 关闭走 X 按钮)
 */
function MobilePopup({
  label,
  onClose,
  rootRef,
}: {
  label: NewLabel;
  onClose: () => void;
  rootRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const images = label.images ?? [];
  // 移动端没有 hero — 全部图当 detail 处理
  const hasDescription = !!label.description;
  const hasBuilder = !!label.builder;
  const hasInputs = !!label.inputs && label.inputs.length > 0;
  const hasOutputs = !!label.outputs && label.outputs.length > 0;
  const hasAnyExpandable = hasBuilder || hasInputs || hasOutputs;
  const hasAnyImage = images.length > 0;

  // 展开状态
  const [expanded, setExpanded] = useState(false);
  // 细节图 lightbox (跟桌面端共用 ImageLightbox)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // 展开前: 只显示最多 3 张
  // 展开后: 显示全部
  const collapsedImages = images.slice(0, 3);
  const expandedImages = images;
  const overflowImages = expanded && images.length > 3;
  const showImages = expanded ? expandedImages : collapsedImages;

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby="lm-popup-name"
      // 移动端: fixed bottom-0 全屏宽 (覆盖地图但地图还在 popup 上面仍可见)
      //  - max-h 控制 sheet 高度 (collapsed 50vh / expanded 90vh)
      //  - overflow-y-auto 让超长内容可滚动
      //  - 不显示完整字段时不强制高度, 让内容自然撑开 (但仍底部对齐)
      //  - 关闭按钮在 top bar (右上), 用户要求: 不依赖点击 popup 其它位置关
      className={cn(
        "fixed bottom-0 left-0 right-0 z-30",
        "bg-white border-t border-slate-200 rounded-t-2xl",
        "shadow-[0_-10px_30px_-5px_rgb(0,0,0,0.15)]",
        "animate-in slide-in-from-bottom duration-300",
        expanded ? "max-h-[90vh]" : "max-h-[50vh]",
        "overflow-y-auto",
        "select-text",
      )}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* 顶部 sticky bar — name + 关闭按钮 */}
      <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-4 py-3 flex items-center gap-3">
        <span
          id="lm-popup-name"
          className="flex-1 min-w-0 text-[18px] font-semibold text-slate-800 truncate"
        >
          {label.name}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          aria-label="关闭"
          className="shrink-0 w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M1 1L13 13M1 13L13 1"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <div className="px-4 py-4 space-y-4">
        {hasDescription && (
          <p className="text-[14px] leading-relaxed text-slate-600">
            {label.description}
          </p>
        )}

        {hasAnyImage && (
          <MobileImagesGrid
            images={showImages}
            overflowScroll={overflowImages}
            onOpen={(idx) => {
              // idx 是 showImages 里的索引, 跟原始 images 同序
              setLightboxIndex(idx);
            }}
          />
        )}

        {/* 展开后追加: 建设者 + 投入 + 产出 */}
        {expanded && (
          <div className="space-y-3 pt-2 border-t border-slate-100">
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-[13px] text-slate-500">
                <span className="uppercase w-11 shrink-0">坐标</span>
                <span className="font-mono text-slate-700">
                  x={label.x} z={label.z}
                </span>
              </div>
              {hasBuilder && (
                <div className="flex items-center gap-1.5 text-[13px]">
                  <span className="uppercase w-11 shrink-0 text-slate-500">
                    建设者
                  </span>
                  <span className="font-medium text-slate-700 flex-1 min-w-0 flex flex-wrap gap-x-1.5">
                    {label.builder!
                      .split(/\s+/)
                      .filter((name) => name.length > 0)
                      .map((name, i) => (
                        <span key={i}>{name}</span>
                      ))}
                  </span>
                </div>
              )}
            </div>

            {hasInputs && (
              <ProductRow label="投入" products={label.inputs!} tone="sky" />
            )}
            {hasOutputs && (
              <ProductRow label="产出" products={label.outputs!} tone="emerald" />
            )}
          </div>
        )}

        {/* 展开/收起按钮 — 有可展开内容才显示 */}
        {hasAnyExpandable && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            className="w-full py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-[13px] font-medium text-slate-700 flex items-center justify-center gap-1.5 transition-colors"
          >
            <IconArrowRight
              size={14}
              className={cn(
                "transition-transform",
                expanded ? "-rotate-90" : "rotate-90",
              )}
            />
            {expanded ? "收起" : "展开"}
          </button>
        )}
      </div>

      {lightboxIndex !== null && (
        <ImageLightbox
          images={images}
          imagesFull={images.map(toFullImagePath)}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}

/**
 * 移动端细节图 grid:
 *  - 1 张: 单独占满 (full width, 限高 aspect-video)
 *  - 2-3 张: 横向 grid (每张 1/n 宽)
 *  - > 3 张 (展开模式): 横向滚动栏, 隐藏滚动条, 每张固定宽
 */
function MobileImagesGrid({
  images,
  overflowScroll,
  onOpen,
}: {
  images: string[];
  overflowScroll: boolean;
  onOpen: (idx: number) => void;
}) {
  if (images.length === 0) return null;

  // overflow 模式: 横向滚动, 每张固定 70% 宽 (一次看一张多一点)
  if (overflowScroll) {
    return (
      <div className="-mx-5">
        <div
          className="flex gap-2 overflow-x-auto px-5 pb-2 snap-x snap-mandatory"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          {images.map((src, i) => (
            <button
              key={i}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpen(i);
              }}
              className="shrink-0 w-[70%] aspect-video rounded-lg overflow-hidden bg-slate-100 snap-center cursor-zoom-in"
            >
              <img
                src={src}
                alt=""
                loading="lazy"
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            </button>
          ))}
        </div>
      </div>
    );
  }

  // 标准 grid: 1 张大图 / 2-3 张 grid
  if (images.length === 1) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpen(0);
        }}
        className="group relative block w-full aspect-video rounded-lg overflow-hidden bg-slate-100 cursor-zoom-in"
      >
        <img
          src={images[0]}
          alt=""
          loading="lazy"
          className="w-full h-full object-cover"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
        <div className="absolute inset-0 bg-slate-900/0 group-hover:bg-slate-800/50 transition-colors flex items-center justify-center">
          <span className="text-[12px] font-medium text-white opacity-0 group-hover:opacity-100 transition-opacity">
            查看大图
          </span>
        </div>
      </button>
    );
  }

  // 2-3 张: 等宽 flex
  return (
    <div className="flex gap-1.5">
      {images.map((src, i) => (
        <button
          key={i}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(i);
          }}
          className="group relative flex-1 aspect-video rounded-lg overflow-hidden bg-slate-100 cursor-zoom-in"
        >
          <img
            src={src}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
          <div className="absolute inset-0 bg-slate-900/0 group-hover:bg-slate-800/50 transition-colors flex items-center justify-center">
            <span className="text-[11px] font-medium text-white opacity-0 group-hover:opacity-100 transition-opacity">
              查看大图
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}

/* ============================== Shared utils ============================== */

/**
 * 把 thumbs 路径派生 full 路径 (用于 lightbox 高清大图)
 *   - "/images/maps/thumbs/buildings/overworld/八角塔.webp"
 *   - → "/images/maps/full/buildings/overworld/八角塔.webp"
 *  - 只替换第一个 "/thumbs/" 段, 避免重复处理
 *  - 如果路径里没有 /thumbs/ 段 (e.g. 直接传 full), 原样返回
 */
function toFullImagePath(thumbPath: string): string {
  return thumbPath.replace("/thumbs/", "/full/");
}

/**
 * 从图片路径提取"-横杠后面"的标注 — "labels/foo-材料展示馆.png" → "材料展示馆"
 *  - 没横杠 (e.g. "八角塔.png") 返回 null, 调用方不显示
 *  - 多横杠 (e.g. "八角塔-材料-内饰.png") → 取首个横杠之后整段 "材料-内饰"
 *  - URL 末尾可能带 query (?v=xxx) — 先剥掉再处理
 */
function parseCaption(src: string): string | null {
  const filename = src.split("/").pop() ?? "";
  const base = filename.split(/[?#]/)[0] ?? "";
  const stem = base.replace(/\.[^.]+$/, "");
  const dashIdx = stem.indexOf("-");
  if (dashIdx < 0 || dashIdx === stem.length - 1) return null;
  return stem.slice(dashIdx + 1);
}

function ImageThumbnails({
  images,
  onOpenLightbox,
}: {
  images: string[];
  onOpenLightbox: (index: number) => void;
}) {
  // slot 数量: 最少 2 (1 张图也占 2 个 slot, 旁边加占位), 最多 3
  //   - 0 张: 不渲染 (父组件 hasDetails 判断)
  //   - 1 张: [图, 占位] — 1 张图不要占画面太多, 跟 2 张图一样宽
  //   - 2 张: [图, 图]
  //   - 3+ 张: [图, 图, 图 + "+N more"]
  const totalSlots = Math.min(3, Math.max(2, images.length));
  const slots = Array.from({ length: totalSlots }, (_, i) => images[i] ?? null);
  const more = Math.max(0, images.length - totalSlots);
  return (
    <div>
      <div className="flex gap-1">
        {slots.map((src, i) =>
          src ? (
            <button
              key={i}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenLightbox(i);
              }}
              className="group relative flex-1 aspect-video rounded overflow-hidden bg-slate-100 ring-1 ring-slate-200 cursor-zoom-in"
            >
              <img
                src={src}
                alt=""
                className="w-full h-full object-cover"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-slate-900/0 group-hover:bg-slate-800/50 transition-colors flex items-center justify-center gap-1.5">
                <img
                  src="/icons/map/tabs/查看图片图标.svg"
                  alt=""
                  className="w-4 h-4 opacity-0 group-hover:opacity-90 transition-opacity"
                />
                <span className="text-[11px] font-medium text-white opacity-0 group-hover:opacity-100 transition-opacity">
                  查看大图
                </span>
              </div>
              {i === totalSlots - 1 && more > 0 && (
                <div className="absolute inset-0 bg-slate-900/60 flex items-center justify-center text-[10px] font-semibold text-white pointer-events-none">
                  +{more}
                </div>
              )}
            </button>
          ) : (
            <div
              key={i}
              className="flex-1 aspect-video rounded border border-dashed border-slate-200 bg-slate-50/30"
              aria-hidden="true"
            />
          ),
        )}
      </div>
      <div className="flex gap-1 mt-1">
        {slots.map((src, i) => {
          const caption = src ? parseCaption(src) : null;
          return (
            <div
              key={i}
              className="flex-1 text-center text-[10px] text-slate-500 leading-tight truncate"
            >
              {caption ?? ""}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProductRow({
  label,
  products,
  tone,
}: {
  label: string;
  products: NewLabelProduct[];
  tone: "sky" | "emerald";
}) {
  return (
    <div className="flex items-start gap-1.5">
      <span
        className={cn(
          "text-[13px] font-medium uppercase pt-0.5 w-7 shrink-0",
          tone === "sky" ? "text-sky-600" : "text-emerald-600",
        )}
      >
        {label}
      </span>
      <div className="flex flex-wrap gap-1 flex-1 min-w-0">
        {products.length === 0 ? (
          <span className="text-[13px] text-slate-400">—</span>
        ) : (
          products.map((p) => <ProductPill key={p.label} product={p} tone={tone} />)
        )}
      </div>
    </div>
  );
}

function ProductPill({
  product,
  tone,
}: {
  product: NewLabelProduct;
  tone: "sky" | "emerald";
}) {
  const toneClass =
    tone === "sky"
      ? "bg-sky-50 text-sky-700 ring-sky-200/90"
      : "bg-emerald-50 text-emerald-700 ring-emerald-200/90";
  const rawIcon = product.icon?.trim();
  const showIcon = !!rawIcon && rawIcon !== "null";
  return (
    <span
      className={cn(
        "inline-flex items-center text-center px-1.5 py-0.5 rounded text-[12px] font-medium ring-1",
        showIcon && "gap-1",
        toneClass,
      )}
    >
      {showIcon && (
        <img
          src={rawIcon}
          alt=""
          className="w-3.5 h-3.5 object-contain shrink-0"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      )}
      <span>{product.label}</span>
    </span>
  );
}

function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}