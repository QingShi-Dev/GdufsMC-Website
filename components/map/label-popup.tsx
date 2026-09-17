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

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  NewLabel,
  NewLabelProduct,
} from "@/lib/map/labels";
import { ImageLightbox } from "./image-lightbox";
import { cn } from "@/lib/utils";

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
   * popup 顶部距离视口顶部的像素 — 跟 `topClassName` 配套, 用于算 max-h
   *   - 搜索开启: 70 (popup 落到搜索栏下方)
   *   - 搜索关闭: 16 (top-4 默认)
   *   - 默认 16
   *   - 用户要求: "popup 高度应该把开启搜索的情况计算进去"
   *     搜索开启时 popup 下移 70px, max-h 必须减少 70-16=54px, 否则溢出
   */
  topOffset?: number;
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
  topOffset,
  rootRef,
  isFullscreen,
  isMobile,
}: LabelPopupProps) {
  // 共享 popup 状态 (DesktopPopup / MobilePopup 都用):
  //   - images: 原图数组 (用于 lightbox)
  //   - imagesFull: 派生的高清版数组 (lightbox 用, thumbs → fulls 路径替换)
  //   - lightboxIndex: 当前打开的 lightbox 图片 index, null 表示关闭
  //   - heroImage / detailImages: 切分 (DesktopPopup 渲染 hero + thumbnails, MobilePopup 渲染全图)
  //   - hasHero / hasDetails: 是否有 hero / 细节图
  // 之前 Desktop 和 Mobile 各持一份 lightboxIndex state, 现在提到 LabelPopup 共享
  // 之前两处都计算 images / imagesFull, 现在 useMemo 在 hook 里避免重复算
  const popup = usePopupImages(label);

  // 移动端走专属渲染分支 (bottom sheet 模式), 桌面端走原逻辑
  if (isMobile) {
    return (
      <MobilePopup
        label={label}
        onClose={onClose}
        rootRef={rootRef}
        popup={popup}
      />
    );
  }

  return (
    <DesktopPopup
      label={label}
      onClose={onClose}
      topClassName={topClassName}
      topOffset={topOffset}
      rootRef={rootRef}
      isFullscreen={isFullscreen}
      popup={popup}
    />
  );
}

/* ============================== Shared hook ============================== */

/**
 * 共享的 popup 图片 + lightbox state hook
 * - DesktopPopup / MobilePopup 都用同一个 lightbox (同时只开一个)
 * - images 是只读的缩略图路径 (popup 显示), imagesFull 是派生的高清路径 (lightbox 显示)
 * - heroImage / detailImages / hasHero / hasDetails 让渲染分支不用重复 slice + check
 */
function usePopupImages(label: NewLabel) {
  const images = useMemo(() => label.images ?? [], [label.images]);
  const imagesFull = useMemo(() => images.map(toFullImagePath), [images]);
  const heroImage = images[0];
  const detailImages = useMemo(() => images.slice(1), [images]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  return {
    images,
    imagesFull,
    heroImage,
    detailImages,
    hasHero: !!heroImage,
    hasDetails: detailImages.length > 0,
    lightboxIndex,
    setLightboxIndex,
  };
}

/* ============================== Desktop ============================== */

function DesktopPopup({
  label,
  onClose,
  topClassName,
  topOffset,
  rootRef,
  isFullscreen,
  popup,
}: {
  label: NewLabel;
  onClose: () => void;
  topClassName?: string;
  topOffset?: number;
  rootRef?: React.RefObject<HTMLDivElement | null>;
  isFullscreen?: boolean;
  popup: ReturnType<typeof usePopupImages>;
}) {
  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 切换不同 label 时: 滚到顶端
  //   - popup 容器 overflow-y-auto, 内容超出 max-h 时可滚动
  //   - 不同 label 内容高度不同 (hero 图/缩略图/builder/inputs/outputs),
  //     切 label 后保留旧 scrollTop 会让用户看到错位置
  //   - 用户要求: "当popup需要滚动的时候, 切换不同的label, 就把滚动拉回顶端"
  useEffect(() => {
    if (rootRef?.current) {
      rootRef.current.scrollTop = 0;
    }
  }, [label, rootRef]);

  // 从共享 state 解构
  const { images, imagesFull, heroImage, detailImages, hasHero, hasDetails, lightboxIndex, setLightboxIndex } = popup;
  const hasDescription = !!label.description;
  const hasInputs = !!label.inputs && label.inputs.length > 0;
  const hasOutputs = !!label.outputs && label.outputs.length > 0;
  const hasAnyContent = hasHero || hasDetails || hasDescription || hasInputs || hasOutputs;

  // max-h 计算: 视口高度 - popup top offset - 16px 安全边距
  //   - 搜索关闭 (topOffset=16): max-h = 100vh - 32px
  //   - 搜索开启 (topOffset=70): max-h = 100vh - 86px (用户要求"popup 高度应该把开启搜索的情况计算进去")
  //   - 用显式 className 字面量 (不用 template literal), 让 Tailwind JIT 静态扫描到完整字符串
  //   - 默认 topOffset=16 (没传 prop 时)
  const maxHClass =
    topOffset === 70
      ? "max-h-[calc(100vh-86px)]"
      : "max-h-[calc(100vh-32px)]";

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
          ? "w-[max(280px,min(25vw,360px))] max-w-[calc(100vw-24px)]"
          : "w-72 sm:w-[clamp(240px,calc(100vw-32px),280px)] lg:w-80 max-w-[calc(100%-24px)]",
        "bg-white border border-slate-200 rounded-lg",
        "shadow-2xl shadow-slate-900/20",
        // max-h 按屏幕高度限制 — 手机横屏 (300px 高度) 时不会溢出
        // 溢出时 overflow-y-auto + 隐藏滚动条,用户触屏滑动看全部内容
        maxHClass,
        "overflow-y-auto",
        "[&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]",
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
          imagesFull={imagesFull}
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
  popup,
}: {
  label: NewLabel;
  onClose: () => void;
  rootRef?: React.RefObject<HTMLDivElement | null>;
  popup: ReturnType<typeof usePopupImages>;
}) {
  // 从共享 state 解构 — images / imagesFull / lightboxIndex / setLightboxIndex
  const { images, imagesFull, lightboxIndex, setLightboxIndex } = popup;
  // 移动端没有 hero — 全部图当 detail 处理
  const hasDescription = !!label.description;
  const hasBuilder = !!label.builder;
  const hasInputs = !!label.inputs && label.inputs.length > 0;
  const hasOutputs = !!label.outputs && label.outputs.length > 0;
  const hasAnyExpandable = hasBuilder || hasInputs || hasOutputs;
  const hasAnyImage = images.length > 0;

  // 展开状态 — MobilePopup 专属 (DesktopPopup 不需要)
  const [expanded, setExpanded] = useState(false);
  // swipe 手势 ref — 用于 onTouchStart / onTouchMove
  const touchStartYRef = useRef<number | null>(null);

  // 切换不同 label 时: 滚到顶端
  //   - 跟 DesktopPopup 同款 — 用户要求"切 label 把滚动拉回顶端"
  //   - 移动端 bottom sheet 也 overflow-y-auto, 切 label 后保留 scrollTop 看到错位置
  //   - 放在 expanded state 声明后, label 变就重置 (不依赖 expanded)
  useEffect(() => {
    if (rootRef?.current) {
      rootRef.current.scrollTop = 0;
    }
  }, [label, rootRef]);

  // 锁定 body 滚动 — popup 打开期间页面不能滑
  //   - 跟 desktop 上关掉 lightbox 滚动穿透同款 (commit 986a6c4 用了相同模式)
  //   - 用 touch-action: none 在 popup 元素本身也能阻止页面滚动, 但 body 锁定是更稳的双保险
  //   - 保存 prev, unmount 时还原避免污染 (可能其他 modal 也用 body.overflow)
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // swipe 手势: 上滑 (deltaY < -threshold) → expand; 下滑 (deltaY > threshold) → collapse
  //   - 只在 popup 内容区域触发 (用户拖 popup 内容时, 不影响内嵌图片按钮的点击)
  //   - 阈值 60px 避免误触 (单次滑动不会很快触发)
  //   - touchcancel / touchend 后清状态
  const SWIPE_THRESHOLD = 60;
  const onSwipeTouchStart = (e: React.TouchEvent) => {
    touchStartYRef.current = e.touches[0]?.clientY ?? null;
  };
  const onSwipeTouchMove = (e: React.TouchEvent) => {
    const startY = touchStartYRef.current;
    if (startY === null) return;
    const curY = e.touches[0]?.clientY ?? startY;
    const deltaY = curY - startY;
    // 阈值 + 方向匹配才触发 (避免小抖动误触)
    if (deltaY < -SWIPE_THRESHOLD && !expanded && hasAnyExpandable) {
      setExpanded(true);
      touchStartYRef.current = null; // 重置避免连续触发
    } else if (deltaY > SWIPE_THRESHOLD && expanded) {
      setExpanded(false);
      touchStartYRef.current = null;
    }
  };
  const onSwipeTouchEnd = () => {
    touchStartYRef.current = null;
  };

  // 展开前: 只显示最多 3 张 (MobileImagesGrid 会补占位到 3 槽)
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
      //    - min(...): 横屏短屏 (300px) 时不被 90vh 撑到 270px, 限制为 calc(100vh-32px)
      //    - 90vh 在竖屏 800px 高度 = 720px OK; 横屏 300px 高度 → 270px, 但 capped at 268px
      //  - overflow-y-auto 让超长内容可滚动, 隐藏滚动条 (触屏不占视觉空间)
      //  - touchAction="pan-y" 让 popup 内部可滚 (overflow-y-auto), 但页面其他部分不滚
      //    (body.overflow=hidden 锁住页面滚动, touch 事件在 popup 内被消费)
      //  - 关闭按钮在 top bar (右上), 用户要求: 不依赖点击 popup 其它位置关
      className={cn(
        "fixed bottom-0 left-0 right-0 z-30",
        "bg-white border-t border-slate-200 rounded-t-xl",
        "shadow-[0_-10px_30px_-5px_rgb(0,0,0,0.15)]",
        "animate-in slide-in-from-bottom duration-300",
        expanded
          ? "max-h-[min(90vh,calc(100vh-32px))]"
          : "max-h-[min(50vh,calc(100vh-80px))]",
        "overflow-y-auto",
        "[&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]",
        "touch-pan-y select-text",
      )}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={onSwipeTouchStart}
      onTouchMove={onSwipeTouchMove}
      onTouchEnd={onSwipeTouchEnd}
      onTouchCancel={onSwipeTouchEnd}
    >
      {/* 顶部 sticky bar — name + 关闭按钮 */}
      <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-5 pt-4 flex flex-col items-start">
        <span
          id="lm-popup-name"
          className="min-w-0 text-[22px] font-semibold text-slate-700"
        >
          {label.name}
        </span>
        <div className="flex items-center pt-1 gap-1.5 text-[16px] text-slate-500">
          <span className="font-mono text-slate-700">
                  x={label.x} z={label.z}
                </span>
        </div>
        {hasDescription && (
            <span className="text-[16px] pt-0.5 text-slate-600">
              {label.description}
            </span>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          aria-label="关闭"
          className="absolute top-5 right-5 w-5.5 h-5.5 rounded-full flex items-center justify-center transition-colors"
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
        {hasAnyImage && (
          <MobileImagesGrid
            images={showImages}
            totalSlots={3}
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

        {/* 展开/收起按钮 — 有可展开内容才显示
            用户要求: 不用太刻意, 只用箭头 SVG (旋转得到 ↑↓)
            - collapsed 时箭头朝下 (▼ 暗示"上滑展开"或点开展开), expanded 时朝上 (▲)
            - 用 public/icons/map/tabs/右侧箭头按钮.svg, rotate 180 转换方向
            - 无背景, 简洁 */}
        {hasAnyExpandable && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            aria-label={expanded ? "收起" : "展开"}
            className="w-full py-2 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors"
          >
            <img
              src="/icons/map/tabs/右侧箭头按钮.svg"
              alt=""
              className={cn(
                "w-5 h-5 transition-transform",
                expanded ? "rotate-270" : "rotate-90",
              )}
            />
          </button>
        )}
      </div>

      {lightboxIndex !== null && (
        <ImageLightbox
          images={images}
          imagesFull={imagesFull}
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
  totalSlots,
  overflowScroll,
  onOpen,
}: {
  images: string[];
  /** 总槽位数 (默认 3) — 少于 totalSlots 时补占位元素, 让 grid 高度/视觉位置稳定
   *  - 用户要求: 展开前图片太大了 (单张占满), 用固定 3 槽补占位让单张只占 1/3 宽
   *  - 占位元素是看不见的占位 div (aria-hidden, transparent border + bg) */
  totalSlots?: number;
  overflowScroll: boolean;
  onOpen: (idx: number) => void;
}) {
  if (images.length === 0) return null;

  // overflow 模式: 横向滚动, 每张固定 70% 宽 (一次看一张多一点)
  if (overflowScroll) {
    return (
      <div>
        <div
          className="flex gap-2 overflow-x-auto pb-2 snap-x snap-mandatory"
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
              className="shrink-0 w-[70%] aspect-video rounded-lg overflow-hidden bg-white snap-center cursor-zoom-in"
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

  // 固定槽位 grid (默认 3 槽) — 少于 3 张图时补占位元素, 让单张图也只占 1/3 宽度
  //   - 用户要求: 展开前图片太大了 (单张 100% 宽), 现在固定 3 槽, 单张占 1/3
  //   - 占位元素 transparent border + bg, 不显示但保留布局
  //   - 高度统一 aspect-video, 不受图片数影响
  const slots = totalSlots ?? 3;
  const padded = Array.from({ length: slots }, (_, i) => images[i] ?? null);

  return (
    <div className="flex gap-1.5">
      {padded.map((src, i) =>
        src ? (
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
        ) : (
          <div
            key={i}
            // 占位槽: 看不见但占空间, 让单张图也能在 grid 里占 1/3 宽
            //   - 用透明 dashed border (跟 desktop ImageThumbnails 一致)
            //   - aspect-video 跟图片 button 同尺寸, layout 完全对齐
            //   - aria-hidden 不参与 a11y tree
            className="flex-1 aspect-video rounded-lg border border-dashed border-slate-200/60 bg-slate-50/30"
            aria-hidden="true"
          />
        ),
      )}
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