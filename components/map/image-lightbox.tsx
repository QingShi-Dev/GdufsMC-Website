"use client";
/* eslint-disable @next/next/no-img-element -- 项目图标用 /public 下的 SVG 文件, next/image 只优化位图不优化 SVG */

/**
 * 图片查看器 — 全屏 modal
 *  - 鼠标拖动平移, 滚轮缩放, 双指缩放 (跟 guide-map 同款交互)
 *  - 左右按钮 / 键盘方向键翻图, 缩略图列表点击直接跳
 *  - 右上关闭, 右下放大/还原/缩小, 左下其他图片缩略图
 *  - 离开页面 (依赖变化) 自动关
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/** 缩放范围 — 跟地图保持同款手感: 1× 默认, 最多 8× */
const MIN_K = 1;
const MAX_K = 8;
/** 滚轮缩放因子 */
const WHEEL_DELTA = 0.0025;

interface ImageLightboxProps {
  images: string[];
  /** 打开时显示第几张 */
  initialIndex: number;
  /** 顶部标题 (一般是建筑名), 可选 */
  title?: string;
  onClose: () => void;
}

export function ImageLightbox({
  images,
  initialIndex,
  title,
  onClose,
}: ImageLightboxProps) {
  // 当前显示的图片索引
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  // 平移 + 缩放 (跟 guide-map 同款命名: tx/ty/k)
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [k, setK] = useState(1);
  // rAF 批处理, 避免拖动/滚轮期间多次 setState 触发 render
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<{ tx: number; ty: number; k: number } | null>(null);
  // 拖动引用: 起始坐标 + 起始时 tx/ty
  const dragRef = useRef<{
    x: number;
    y: number;
    tx: number;
    ty: number;
  } | null>(null);
  // 容器 ref — 用于 setPointerCapture / 鼠标位置转换
  const containerRef = useRef<HTMLDivElement | null>(null);

  const currentSrc = images[currentIndex] ?? "";

  // rAF 提交 (跟 guide-map 同款)
  const commit = useCallback(() => {
    rafRef.current = null;
    const p = pendingRef.current;
    if (!p) return;
    pendingRef.current = null;
    setTx(p.tx);
    setTy(p.ty);
    setK(p.k);
  }, []);
  const schedule = useCallback(
    (nextTx: number, nextTy: number, nextK: number) => {
      pendingRef.current = { tx: nextTx, ty: nextTy, k: nextK };
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(commit);
      }
    },
    [commit],
  );

  /** 重置 (还原) */
  const reset = useCallback(() => {
    if (rafRef.current !== null) {
 cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingRef.current = null;
    setTx(0);
    setTy(0);
    setK(1);
  }, []);

  /** 翻图 — 切换 currentIndex, 重置缩放/平移 */
  const goTo = useCallback(
    (idx: number) => {
      const clamped = ((idx % images.length) + images.length) % images.length;
      setCurrentIndex(clamped);
      reset();
    },
    [images.length, reset],
  );
  const goNext = useCallback(() => goTo(currentIndex + 1), [currentIndex, goTo]);
  const goPrev = useCallback(() => goTo(currentIndex - 1), [currentIndex, goTo]);

  // 切换图片时重置 (缩放/平移归零)
  //   - 这是 state 派生用例 (currentIndex 变 → tx/ty/k 重置), 不可避免 setState
  //   - 用 useEffect 跟踪 currentIndex 变化, 触发频率低 (用户主动翻图)
  //   - 不用 React key 会丢失组件内部状态, 用 useEffect 是合适的方式
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reset();
    // 故意只依赖 currentIndex — 翻图时 reset
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex]);

  // ESC 关闭 / 方向键翻图
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight" && images.length > 1) {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowLeft" && images.length > 1) {
        e.preventDefault();
        goPrev();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, goNext, goPrev, images.length]);

  // 卸载清理 rAF
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  // 滚轮缩放 (中心保持光标位置)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      // 光标在容器里的相对位置 (中心为 0)
      const cursorX = e.clientX - rect.left - rect.width / 2;
      const cursorY = e.clientY - rect.top - rect.height / 2;
      const curK = k;
      const curTx = tx;
      const curTy = ty;
      const newK = Math.max(
        MIN_K,
        Math.min(MAX_K, curK * (1 - e.deltaY * WHEEL_DELTA)),
      );
      if (newK === curK) return;
      // 保持光标位置不变: 让光标下的 content 坐标不动
      //   contentX = (cursorX - tx) / k; 改 k 后新 tx = cursorX - contentX * newK
      const contentX = (cursorX - curTx) / curK;
      const contentY = (cursorY - curTy) / curK;
      const nextTx = cursorX - contentX * newK;
      const nextTy = cursorY - contentY * newK;
      schedule(nextTx, nextTy, newK);
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [k, tx, ty, schedule]);

  // 双指缩放 (移动端)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let pinchInitialDistance = 0;
    let pinchInitialK = 1;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      if (!t1 || !t2) return;
      e.preventDefault();
      pinchInitialDistance = Math.hypot(
        t2.clientX - t1.clientX,
        t2.clientY - t1.clientY,
      );
      pinchInitialK = k;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || pinchInitialDistance === 0) return;
      e.preventDefault();
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      if (!t1 || !t2) return;
      const currentDistance = Math.hypot(
        t2.clientX - t1.clientX,
        t2.clientY - t1.clientY,
      );
      const ratio = currentDistance / pinchInitialDistance;
      const newK = Math.max(
        MIN_K,
        Math.min(MAX_K, pinchInitialK * ratio),
      );
      // 中心 = 两指中点
      const centerX = (t1.clientX + t2.clientX) / 2;
      const centerY = (t1.clientY + t2.clientY) / 2;
      const rect = el.getBoundingClientRect();
      const cursorX = centerX - rect.left - rect.width / 2;
      const cursorY = centerY - rect.top - rect.height / 2;
      const contentX = (cursorX - tx) / k;
      const contentY = (cursorY - ty) / k;
      const nextTx = cursorX - contentX * newK;
      const nextTy = cursorY - contentY * newK;
      schedule(nextTx, nextTy, newK);
    };
    const onTouchEnd = () => {
      if (pinchInitialDistance !== 0) pinchInitialDistance = 0;
    };
    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [k, tx, ty, schedule]);

  // 鼠标拖动平移
  const onPointerDown = (e: React.PointerEvent) => {
    // 点按钮时不启动拖动 (按钮自己处理 click)
    //   - 注意: 容器本身不带 data-lightbox-control, 否则 target.closest 会命中容器自己
    //     drag 永远 return early
    const target = e.target as HTMLElement;
    if (target.closest("button")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      tx,
      ty,
    };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    schedule(dragRef.current.tx + dx, dragRef.current.ty + dy, k);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  // 用 createPortal 渲染到 document.body
  //   - 之前 lightbox 在 map container 内, map container 有 transition: transform
  //     让 position: fixed 被 contained, z-index 跟 header (z-100) 比较时
  //     不是 sibling 比较, 而是跟 map container 的 z-index 比较 — header 浮在上面
  //   - Portal 让 lightbox 直接成为 body 的子元素, 脱离 ancestor 的 containing block,
  //     z-index 跟 header 平级比较, 高者胜
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title ?? "图片查看"}
      // z-[300] 远超 header (z-100) 和 search wrapper (z-[60]), 确保在最上层
      className="fixed inset-0 z-[300] bg-slate-500/50 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        // 点遮罩空白处关; 点图片 / 控件不关
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div
          ref={containerRef}
          // 注意: 这里**不加** data-lightbox-control, 否则 onPointerDown 检查 closest 时
          // 会找到容器自己 (target.img → container), 永远 return early, drag 永远不启动
          className="relative pointer-events-auto select-none cursor-grab active:cursor-grabbing w-[90vw] h-[90vh] max-w-[1400px] max-h-[900px]"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {/* 图片: 用 transform 平移 + 缩放 */}
          <img
            src={currentSrc}
            alt=""
            className="absolute left-1/2 top-1/2 max-w-full max-h-full select-none"
            draggable={false}
            style={{
              transform: `translate(-50%, -50%) translate(${tx}px, ${ty}px) scale(${k})`,
              transformOrigin: "center center",
            }}
          />
        </div>
      </div>

      {/* 顶部标题 */}
      {title && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full bg-slate-900/60 text-white text-[13px] font-medium backdrop-blur-md pointer-events-none">
          {title}
        </div>
      )}

      {/* 右上关闭 */}
      <button
        type="button"
        onClick={onClose}
        data-lightbox-control
        aria-label="关闭"
        className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-slate-900/60 hover:bg-slate-900/80 text-white flex items-center justify-center transition-colors backdrop-blur-md"
      >
        <img src="/icons/map/tabs/隐藏搜索图标.svg" alt="" className="w-5 h-5 invert" />
      </button>

      {/* 左右翻图 (只 >1 张时) */}
      {images.length > 1 && (
        <>
          <button
            type="button"
            onClick={goPrev}
            data-lightbox-control
            aria-label="上一张"
            className="absolute top-1/2 left-4 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-slate-900/60 hover:bg-slate-900/80 text-white flex items-center justify-center transition-colors backdrop-blur-md"
          >
            <img src="/icons/map/tabs/隐藏搜索图标.svg" alt="" className="w-5 h-5 invert rotate-180" />
          </button>
          <button
            type="button"
            onClick={goNext}
            data-lightbox-control
            aria-label="下一张"
            className="absolute top-1/2 right-4 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-slate-900/60 hover:bg-slate-900/80 text-white flex items-center justify-center transition-colors backdrop-blur-md"
          >
            <img src="/icons/map/tabs/隐藏搜索图标.svg" alt="" className="w-5 h-5 invert" />
          </button>
        </>
      )}

      {/* 右下缩放控制 — 跟 map 的 ZoomBtn 同款 (w-9 h-9 rounded-lg bg-white/60 border ...)
          用户要求: 删全屏按钮, 只留 放大 + 缩小 (跟 map 一样, 但去掉全屏) */}
      <div
        data-lightbox-control
        className="absolute bottom-3 right-3 z-10 flex flex-col gap-1.5"
      >
        <button
          type="button"
          onClick={() => {
            const newK = Math.min(MAX_K, k * 1.3);
            schedule(tx, ty, newK);
          }}
          aria-label="放大"
          className="w-9 h-9 rounded-lg bg-white/60 border border-slate-200/80 text-slate-600 hover:text-slate-800 hover:bg-slate-50 flex items-center justify-center shadow-sm transition-colors disabled:opacity-30"
          disabled={k >= MAX_K}
        >
          <img src="/icons/map/tabs/放大图标.svg" alt="" className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => {
            const newK = Math.max(MIN_K, k / 1.3);
            schedule(tx, ty, newK);
          }}
          aria-label="缩小"
          className="w-9 h-9 rounded-lg bg-white/60 border border-slate-200/80 text-slate-600 hover:text-slate-800 hover:bg-slate-50 flex items-center justify-center shadow-sm transition-colors disabled:opacity-30"
          disabled={k <= MIN_K}
        >
          <img src="/icons/map/tabs/缩小图标.svg" alt="" className="w-4 h-4" />
        </button>
      </div>

      {/* 左下缩略图列表 (其他图片) */}
      {images.length > 1 && (
        <div
          data-lightbox-control
          className="absolute bottom-4 left-4 z-10 max-w-[60vw] flex gap-2 bg-slate-900/60 rounded-lg p-2 backdrop-blur-md"
        >
          {images.map((src, i) => {
            const active = i === currentIndex;
            return (
              <button
                key={i}
                type="button"
                onClick={() => goTo(i)}
                aria-label={`第 ${i + 1} 张`}
                className={cn(
                  "shrink-0 w-16 h-16 rounded overflow-hidden ring-2 transition-all",
                  active
                    ? "ring-white opacity-100"
                    : "ring-transparent opacity-60 hover:opacity-100",
                )}
              >
                <img
                  src={src}
                  alt=""
                  className="w-full h-full object-cover"
                  draggable={false}
                />
              </button>
            );
          })}
        </div>
      )}
    </div>,
    document.body,
  );
}