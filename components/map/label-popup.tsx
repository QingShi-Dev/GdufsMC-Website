/**
 * 地标详情卡片 — 固定在地图左上角
 *
 * 激进改动 (2026-09-11):
 *  - 去掉 kind 分支 (region/building/machine), 改成"有什么字段显示什么"
 *  - images[0] 是 hero 图 (顶部大图), images[1..] 是细节图 (底部缩略图)
 *  - description / inputs / outputs 各自独立段, 没填就不显示
 *  - 一切都从数据决定, 没有硬编码的"建筑 vs 机器"分支
 *
 * 设计:
 *  - 不是 modal: 没有 backdrop, 不锁滚动, 跟地图共存
 *  - 位置: 地图容器内 absolute top-3 left-3
 *  - 关闭: 右上角 X / ESC / 点地图
 */
"use client";

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
   * 例: 搜索开启时父组件传 `top-[60px]` 让 popup 落到搜索框下方
   */
  topClassName?: string;
}

export function LabelPopup({ label, onClose, topClassName }: LabelPopupProps) {
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
  // 任一有内容就显示内容区 (有图 / 有描述 / 有产物)
  const hasAnyContent = hasHero || hasDetails || hasDescription || hasInputs || hasOutputs;

  // lightbox 状态 — null = 关, 数字 = 当前显示的图片索引 (在 allImages 中)
  //   注意: lightbox 显示 all images (hero + 细节), 而 detail thumbnails 只显示 detailImages
  //   所以点击细节图 0 → lightbox 显示第 1 张 (detailImages[0] = images[1])
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="lm-popup-name"
      className={cn(
        "absolute left-4 z-20",
        topClassName ?? "top-4",
        "w-72 sm:w-80 max-w-[calc(100%-24px)]",
        "bg-white border border-slate-200 rounded-lg",
        "shadow-2xl shadow-slate-900/20",
        "overflow-hidden",
        "animate-in fade-in slide-in-from-top-2 duration-200",
      )}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* (关闭按钮已删除 — 用户要求) */}

      {/* hero 图 — 容器用图片原始 aspect (2560/1361 ≈ 1.88) 适配,
          这样不管 popup 宽度 (288/320px), 图片都以原比例显示, 不会上下裁切 */}
      {hasHero && (
        <button
          type="button"
          onClick={() => setLightboxIndex(0)}
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
          {/* hover 遮罩 + "查看大图"图标 + 文字 (跟 detail 缩略图同款) */}
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

      {/* 名称 + 坐标 + 简介 */}
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
                {/* builder 名字按空格分成多个 span — 用户能控制 gap, 名字多时 flex-wrap 换行 */}
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

      {/* 产物区 — inputs / outputs 都各自一段, 有就显示 */}
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

      {/* 细节图缩略图 (images[1..]) — 有就显示 */}
      {hasDetails && (
        <div className="px-4.5 pb-4 mt-1">
          <ImageThumbnails
            images={detailImages}
            onOpenLightbox={(detailIdx) => {
              // detailIdx 是 detailImages 中的索引, 在 images 中偏移 1 (hero 占位)
              setLightboxIndex(detailIdx + 1);
            }}
          />
        </div>
      )}

      {/* 没任何内容时, 卡片只显示名称, 给点空白 (不至于太瘪) */}
      {!hasAnyContent && <div className="h-2" />}

      {/* 图片查看器 (lightbox) — 全屏 modal, ESC / 点遮罩关闭 */}
      {lightboxIndex !== null && (
        <ImageLightbox
          // 缩略图条用 thumbs (省流量, 本来 popup 也用同一份)
          images={images}
          // 主图用 full 高清版 (data 里存的是 thumbs/, 这里把 thumbs/ → full/ 派生大图)
          //   - 大图 q=95 webp, lightbox 放大 8× 也不糊
          //   - popup 仍然显示低分辨率的 thumbs
          imagesFull={images.map(toFullImagePath)}
          initialIndex={lightboxIndex}
          title={label.name}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}

/* ============================== Sub-views ============================== */

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
  // 剥 query / hash
  const base = filename.split(/[?#]/)[0] ?? "";
  // 剥扩展名 (.png / .webp / .jpg 等)
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
  /** 点击缩略图 → 打开 lightbox, 传回点击的索引 */
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
              onClick={() => {
                // src 在 slots 里的索引 = 在原 images 里的索引 (因为 slots = images 截取+占位)
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
              {/* hover 遮罩 + "查看大图"图标 + 文字 */}
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
            // 占位 slot — 没图时空 slot, 保持排版一致 (跟 2 张图一样的宽)
            <div
              key={i}
              className="flex-1 aspect-video rounded border border-dashed border-slate-200 bg-slate-50/30"
              aria-hidden="true"
            />
          ),
        )}
      </div>
      {/* 标注 (文件名 - 横杠后面) — "八角塔-材料展示馆.png" → "材料展示馆"
          没横杠的文件名 (e.g. "八角塔.png") 不显示标注
          占位 slot 的 caption 是空 (保持对齐) */}
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
  // icon 为空 / "null" 字符串 / undefined 时不渲染 img, 也不留 gap 占位
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
