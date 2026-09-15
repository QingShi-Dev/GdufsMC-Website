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

import { useEffect } from "react";
import {
  IconX,
  IconArrowRight,
} from "@tabler/icons-react";
import type {
  NewLabel,
  NewLabelProduct,
} from "@/lib/map/labels";

export interface LabelPopupProps {
  label: NewLabel;
  onClose: () => void;
}

export function LabelPopup({ label, onClose }: LabelPopupProps) {
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

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="lm-popup-name"
      className={cn(
        "absolute top-3 left-3 z-20",
        "w-72 sm:w-80 max-w-[calc(100%-24px)]",
        "bg-white border border-slate-200 rounded-lg",
        "shadow-2xl shadow-slate-900/20",
        "overflow-hidden",
        "animate-in fade-in slide-in-from-top-2 duration-200",
      )}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* 关闭按钮 */}
      <button
        type="button"
        onClick={onClose}
        aria-label="关闭"
        className="absolute top-1.5 right-1.5 z-10 w-7 h-7 rounded-full bg-slate-100/80 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition-colors"
      >
        <IconX size={14} />
      </button>

      {/* hero 图 — 容器用图片原始 aspect (2560/1361 ≈ 1.88) 适配,
          这样不管 popup 宽度 (288/320px), 图片都以原比例显示, 不会上下裁切 */}
      {hasHero && (
        <div className="w-full aspect-[2560/1361] overflow-hidden bg-slate-100">
          <img
            src={heroImage}
            alt=""
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        </div>
      )}

      {/* 名称 + 坐标 + 简介 */}
      <div className="p-3 space-y-1.5">
        <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
          <span className="font-mono">
            x={label.x} z={label.z}
          </span>
        </div>
        <h3
          id="lm-popup-name"
          className="text-sm font-semibold text-slate-800 leading-tight pr-6"
        >
          {label.name}
        </h3>
        {hasDescription && (
          <p className="text-[11px] leading-snug text-slate-500 line-clamp-2">
            {label.description}
          </p>
        )}
        {label.builder && (
          <div className="flex items-start gap-1.5 pt-0.5">
            <span className="text-[10px] font-semibold uppercase pt-0.5 w-5 shrink-0 text-slate-500">
              建设
            </span>
            <span className="text-[11px] leading-snug text-slate-600 flex-1 min-w-0 truncate">
              {label.builder}
            </span>
          </div>
        )}
      </div>

      {/* 产物区 — inputs / outputs 都各自一段, 有就显示 */}
      {(hasInputs || hasOutputs) && (
        <div className="px-3 pb-2 space-y-1">
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
        <div className="px-3 pb-3">
          <ImageThumbnails images={detailImages} />
        </div>
      )}

      {/* 没任何内容时, 卡片只显示名称, 给点空白 (不至于太瘪) */}
      {!hasAnyContent && <div className="h-2" />}
    </div>
  );
}

/* ============================== Sub-views ============================== */

function ImageThumbnails({ images }: { images: string[] }) {
  const show = images.slice(0, 3);
  const more = images.length - show.length;
  return (
    <div>
      <div className="flex gap-1">
        {show.map((src, i) => (
          <div
            key={i}
            className="relative flex-1 aspect-video rounded overflow-hidden bg-slate-100 ring-1 ring-slate-200"
          >
            <img
              src={src}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
            />
            {i === show.length - 1 && more > 0 && (
              <div className="absolute inset-0 bg-slate-900/60 flex items-center justify-center text-[10px] font-semibold text-white">
                +{more}
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="mt-1 text-[10px] text-slate-400">
        {images.length} 张细节图
      </p>
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
          "text-[10px] font-semibold uppercase pt-0.5 w-5 shrink-0",
          tone === "sky" ? "text-sky-600" : "text-emerald-600",
        )}
      >
        {label}
      </span>
      <div className="flex flex-wrap gap-1 flex-1 min-w-0">
        {products.length === 0 ? (
          <span className="text-[10px] text-slate-400">—</span>
        ) : (
          products.map((p) => <ProductPill key={p.icon} product={p} tone={tone} />)
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
      ? "bg-sky-50 text-sky-700 ring-sky-200"
      : "bg-emerald-50 text-emerald-700 ring-emerald-200";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ring-1",
        toneClass,
      )}
    >
      <img
        src={product.icon}
        alt=""
        className="w-3 h-3 object-contain shrink-0"
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
      />
      <span className="truncate">{product.label}</span>
    </span>
  );
}

function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
