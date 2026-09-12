/**
 * 地标标签层 — 浮在 GuideMap 之上, 跟地图同容器
 *
 * 激进改动 (2026-09-11):
 *  - 去掉 kind 分类 (region/building/machine) 对弹窗/内容的控制
 *  - 弹窗由 popup?: true 显式控制, 或数据里有内容自动弹
 *  - visibleWhen: "transit" 的地标 (站名/珍珠站) 只在交通开启时显示,
 *    不依赖 labelsVisible — 开了交通就能看到站名
 *  - withLabels 上下文: 站名/珍珠在 labels+transit 同时开启时,
 *    用 withLabels.fontSize/offsetX/offsetY 覆盖, 避免跟其他标签重叠
 *
 * 设计要点:
 *  - HTML overlay, 文字大小恒定, 跨缩放永远可读可点
 *  - 每个地标一个 <button>, 键盘可达
 *  - 位置: toScreen(viewBoxX, viewBoxY) → CSS pixel
 *  - 统一白字 + 2px 黑描边
 *  - 跟 SVG g 的 transform transition 同步 (500ms ease-in-out)
 */
"use client";

import type {
  NewLabel,
  NewLabelFontSize,
  NewLabelWithLabelsOverride,
} from "@/lib/map/labels";

export interface MapLabelsProps {
  /** 当前维度的标签 (父组件按 worldId 过滤后传入) */
  labels: NewLabel[];
  /** 当前缩放 k */
  currentZoom: number;
  /** 跳视角时挂 CSS transition */
  isPanning: boolean;
  /** 标签总开关 — 只控制普通标签 (kind 不为 transit-only) */
  labelsVisible: boolean;
  /** 交通开关 — 控制 visibleWhen: "transit" 的标签 (站名/珍珠站) */
  transitVisible: boolean;
  /** viewBox (vbX, vbY) → 容器内 CSS 像素 (left, top) */
  toScreen: (vbX: number, vbY: number) => { x: number; y: number } | null;
  /** 点标签: 视角跳到该坐标 + 缩放到 targetZoom (百分比) */
  onPan: (worldX: number, worldZ: number, targetZoomPercent: number) => void;
  /** 点标签需要弹窗: 弹 popup, anchor 是屏幕坐标 (clientX/Y) */
  onSelect: (label: NewLabel, anchor: { x: number; y: number }) => void;
}

/**
 * 判断标签是否需要弹窗
 *  - popup: true → 总是弹
 *  - popup: false → 永不弹
 *  - popup: undefined → 有 images/description/inputs/outputs 任一就弹
 */
function shouldShowPopup(lb: NewLabel): boolean {
  if (lb.popup === true) return true;
  if (lb.popup === false) return false;
  const hasContent = !!(
    (lb.images && lb.images.length > 0) ||
    lb.description ||
    (lb.inputs && lb.inputs.length > 0) ||
    (lb.outputs && lb.outputs.length > 0)
  );
  return hasContent;
}

/**
 * 解析 withLabels 上下文: 站名/珍珠在 labels+transit 同时开时
 * 用 withLabels.fontSize/offsetX/offsetY 覆盖主字段
 */
function resolveWithLabels(
  lb: NewLabel,
  useWithLM: boolean,
): {
  fontSize: NewLabelFontSize | undefined;
  offsetX: number;
  offsetY: number;
} {
  const wlm: NewLabelWithLabelsOverride | undefined = useWithLM
    ? lb.withLabels
    : undefined;
  return {
    fontSize: (wlm?.fontSize ?? lb.fontSize) as NewLabelFontSize | undefined,
    offsetX: wlm?.offsetX ?? lb.offsetX ?? 0,
    offsetY: wlm?.offsetY ?? lb.offsetY ?? 0,
  };
}

export function MapLabels({
  labels,
  currentZoom,
  isPanning,
  toScreen,
  labelsVisible,
  transitVisible,
  onPan,
  onSelect,
}: MapLabelsProps) {
  // withLabels 上下文: 当标签 + 交通同时开启时, 站名/珍珠的 font/offset 走不同配置
  const withLabels = labelsVisible && transitVisible;
  // 关键: 所有 label 永远渲染, 用 visibility: hidden 控制显隐
  //   - 这样 CSS transition 有起点可以插值, 出现时不会闪现
  //   - k 跨过 minZoom 或 visibleWhen 改变时, 立即显隐, 位置已经插值好
  const currentZoomPercent = currentZoom * 100;

  return (
    <div
      className="absolute inset-0 pointer-events-none z-10"
      aria-label="地标"
    >
      {labels.map((lb) => {
        // 可见性过滤:
        //  - 站名/珍珠 (visibleWhen: "transit") 只看 transitVisible, 不要求 labelsVisible
        //  - 普通地标 (visibleWhen: "always" 或未填) 只看 labelsVisible
        if (lb.visibleWhen === "transit") {
          if (!transitVisible) return null;
        } else {
          if (!labelsVisible) return null;
        }
        const pos = toScreen(lb.x, lb.z);
        if (!pos) return null;
        // 解析 withLabels 上下文
        const resolved = resolveWithLabels(lb, withLabels);

        // fontSize 解析 + 显隐区间合一
        let fontSizePx: string | undefined;
        let sizeClass = "text-xs sm:text-sm";
        let inRange = true;
        const fontSizeConfig = resolved.fontSize;
        if (fontSizeConfig !== undefined) {
          if (typeof fontSizeConfig === "number") {
            fontSizePx = `${fontSizeConfig}px`;
          } else {
            const {
              min,
              max,
              mid,
              midZoom,
              minZoom = 0,
              maxZoom = 1600,
            } = fontSizeConfig;
            inRange =
              minZoom <= currentZoomPercent &&
              currentZoomPercent <= maxZoom;
            if (maxZoom <= minZoom) {
              fontSizePx = `${max}px`;
            } else {
              let size: number;
              if (
                midZoom !== undefined &&
                midZoom > minZoom &&
                midZoom < maxZoom
              ) {
                const midSize = mid ?? (min + max) / 2;
                if (currentZoomPercent <= midZoom) {
                  const t1 = Math.max(
                    0,
                    Math.min(
                      1,
                      (currentZoomPercent - minZoom) / (midZoom - minZoom),
                    ),
                  );
                  size = min + (midSize - min) * t1;
                } else {
                  const t2 = Math.max(
                    0,
                    Math.min(
                      1,
                      (currentZoomPercent - midZoom) / (maxZoom - midZoom),
                    ),
                  );
                  size = midSize + (max - midSize) * t2;
                }
              } else {
                const t = Math.max(
                  0,
                  Math.min(
                    1,
                    (currentZoomPercent - minZoom) / (maxZoom - minZoom),
                  ),
                );
                size = min + (max - min) * t;
              }
              fontSizePx = `${size}px`;
            }
          }
          sizeClass = "";
        }
        return (
          <button
            key={lb.id}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              // 点击行为:
              //   - 总是 pan/zoom 到 targetZoom (没填就保持当前)
              //   - shouldShowPopup → 弹 popup
              onPan(lb.x, lb.z, lb.targetZoom ?? currentZoomPercent);
              if (shouldShowPopup(lb)) {
                onSelect(lb, { x: e.clientX, y: e.clientY });
              }
            }}
            className={cn(
              "absolute",
              inRange ? "pointer-events-auto" : "pointer-events-none",
              "-translate-x-1/2 -translate-y-1/2",
              "px-1 py-0.5",
              sizeClass,
              "font-semibold whitespace-nowrap",
              "select-none cursor-pointer",
              "text-white [-webkit-text-stroke:2px_black] [paint-order:stroke] hover:text-sky-300",
            )}
            style={{
              left: pos.x + resolved.offsetX,
              top: pos.y + resolved.offsetY,
              fontSize: fontSizePx,
              visibility: inRange ? "visible" : "hidden",
              transition: isPanning
                ? "left 500ms cubic-bezier(0.4, 0, 0.2, 1), top 500ms cubic-bezier(0.4, 0, 0.2, 1), font-size 500ms cubic-bezier(0.4, 0, 0.2, 1)"
                : undefined,
            }}
            data-label-id={lb.id}
          >
            {lb.name}
          </button>
        );
      })}
    </div>
  );
}

function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
