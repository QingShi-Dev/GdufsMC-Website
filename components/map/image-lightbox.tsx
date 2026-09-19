"use client";
/* eslint-disable @next/next/no-img-element -- 项目图标用 /public 下的 SVG 文件, next/image 只优化位图不优化 SVG */

/**
 * 图片查看器 — 全屏 modal
 *  - 鼠标拖动平移, 滚轮缩放, 双指缩放 (跟 guide-map 同款交互)
 *  - 左右按钮 / 键盘方向键翻图, 缩略图列表点击直接跳
 *  - 右上关闭, 右下放大/还原/缩小, 左下其他图片缩略图
 *  - 离开页面 (依赖变化) 自动关
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/** 缩放范围 — 跟地图保持同款手感: 1× 默认, 最多 8× */
const MIN_K = 1;
const MAX_K = 8;
/** 滚轮缩放因子 — 一次滚轮一个步 (1.25×), 不再是微小 1.0025× */
const WHEEL_STEP = 1.25;

interface ImageLightboxProps {
  /**
   * 缩略图列表 (popup 用的低分辨率版) — 显示在底部缩略图条 + 当前主图缺省时的 fallback
   *  - 跟 `imagesFull` 长度一致, 按 index 一一对应
   */
  images: string[];
  /**
   * 大图列表 (高清原图) — 主图 / 翻图时实际显示的版本
   *  - 不传就 fallback 到 `images`
   *  - 一般是 popup 用 thumbs (省流量), lightbox 用 full (高清)
   */
  imagesFull?: string[];
  /** 打开时显示第几张 */
  initialIndex: number;
  onClose: () => void;
}

export function ImageLightbox({
  images,
  imagesFull,
  initialIndex,
  onClose,
}: ImageLightboxProps) {
  // 当前显示的图片索引
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  // 锁定 body 滚动 — 防止查看大图时鼠标滚轮穿透滚动到下面的地图
  //   - 保存原 overflow, unmount 时设回 (避免污染父组件状态)
  //   - lightbox 是 React Portal 渲染到 body 下, document.body 才是真正的滚动元素
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  // lightbox 叠加在地图全屏上 — 不退出再进入全屏
  //   - 用户反馈: 之前 lightbox 自己进 fullscreen, 打开时地图退出 fs, 关闭时地图恢复 fs
  //     → 两次 fullscreen API 切换闪烁
  //   - 修法: lightbox portal 到 fullscreen element (地图) 内, 而不是 body
  //     - lightbox 在 OS-level 全屏元素的 stacking context 内
  //     - fixed + z-[300] 自然覆盖在地图内容上, 不需要自己进 fullscreen
  //     - 关闭 lightbox 时地图保持 fullscreen (零切换闪烁)
  //   - 边界: 地图没 fullscreen 时, portal target 降级为 document.body (跟之前一样)
  //   - 为什么之前没这么做: 之前 fixed + z-index 不够覆盖 fullscreen element (跨 OS stacking context)
  //     现在 lightbox 在 fullscreen 元素内, 跟地图共享同一 stacking context, 跨级别问题没了
  // - portal target: fullscreen element (有) || document.body (无)
  //   - mount 时选定, render 时使用
  //   - 异步设置避免 SSR hydration 问题 (server render 时 document 没有, document.fullscreenElement 也没有)
  // lightbox 不 portal — 直接渲染在 React tree (LabelPopup 子元素)
//   - 之前 portal 到 document.body (commit 98404e9): 脱离 map container 的 containing block
//   - 现在 (用户反馈): 地图 fullscreen 时 portal target 方案不可靠
//     - puppeteer headless 里 fullscreenElement 是 fake DIV, React Portal 无法真正 append
//     - 真实浏览器也可能因浏览器内部机制出问题
//   - 替代方案: 不 portal, 渲染在 LabelPopup 内
//     - Lightbox 在 React tree 上是 LabelPopup 的子元素, LabelPopup 是 GuideMap 的子元素
//     - 地图进 fullscreen 时, LabelPopup + Lightbox 都在 fullscreen element 内 (OS-level 同一 stacking context)
//     - fixed + z-[300] 自然覆盖, 零切换闪烁
//   - 含 containing block: map 有 transition: transform 让 fixed 被 contained (commit 98404e9 解释)
//     - fullscreen 时浏览器重置 containing block, 问题自动消失
//   - SSR 时 useEffect 不跑, 第一次 render 直接 return null (避免 SSR 引用 document)
  // 容器 ref — 用于 setPointerCapture / 鼠标位置转换
  const containerRef = useRef<HTMLDivElement | null>(null);
  // 图片原始尺寸 (naturalWidth/Height) — 用于计算 fit 大小 + drag 边界
  const [imgNatural, setImgNatural] = useState<{ w: number; h: number } | null>(
    null,
  );
  // 容器尺寸 — 用于 drag 边界 clamp (容器尺寸随 viewport 变化, ResizeObserver 跟随)
  const [containerSize, setContainerSize] = useState<{
    w: number;
    h: number;
  } | null>(null);
  // 计算图片在容器里的"fit"大小 (k=1 时的大小) — CSS max-w-full max-h-full 的同款行为
  const fit = useMemo(() => {
    if (!imgNatural || !containerSize) return null;
    const cw = containerSize.w;
    const ch = containerSize.h;
    const aspect = imgNatural.w / imgNatural.h;
    // CSS max-w-full max-h-full: 取 width-limited 或 height-limited 哪个更小
    let fitW: number;
    if (aspect > cw / ch) {
      fitW = ch * aspect;
    } else {
      fitW = cw;
    }
    const fitH = fitW / aspect;
    return { fitW, fitH };
  }, [imgNatural, containerSize]);

  // 平移 + 缩放 (跟 guide-map 同款命名: tx/ty/k) + rAF 批处理 + clamp + reset — 抽到 hook
  const zoom = useLightboxZoom({ fit, containerSize });
  const { tx, ty, k, schedule, reset } = zoom;
  // 拖动引用: 起始坐标 + 起始时 tx/ty (drag 状态, 不放进 hook — 跟具体 pointer 事件绑)
  const dragRef = useRef<{
    x: number;
    y: number;
    tx: number;
    ty: number;
  } | null>(null);
  // portal target — 决定 lightbox 挂在 DOM 哪里
  //   - 地图 fullscreen 时: document.fullscreenElement (地图 div) — 跟地图同一 stacking context
  //     - lightbox z-[300] 在 fullscreen element 内最高, 压住 search wrapper z-[60] / popup z-20
  //     - 零切换闪烁 (fullscreen API 不需要重新进出)
  //   - 地图非 fullscreen 时: document.body — 脱离 map container 的 containing block
  //     - map 有 transition: transform 让 fixed 被 contained (commit 98404e9 解释)
  //     - portal 到 body 让 fixed 直接相对 viewport, z-[300] 跟 header (z-100) 比, 高者胜
  //     - 用户要求: "没全屏的情况下大图要在 header 上面" — portal 到 body 直接满足
  //   - 监听 fullscreenchange 让 portal target 跟随 (用户进/出全屏时 lightbox 跟着)
  //     - 接受 lightbox state 在 fullscreen 切换瞬间丢失 (tx/ty/k 重置) — 边缘场景, 妥协
  //   - SSR / first render: portalTarget = null, return null (避免 SSR 引用 document)
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const update = () => {
      const fs = document.fullscreenElement;
      // document.fullscreenElement 类型是 Element | null, portal 要 HTMLElement
      // - fullscreen 时实际是 HTMLElement (浏览器规范保证)
      // - fallback 到 document.body (HTMLBodyElement 是 HTMLElement)
      setPortalTarget((fs as HTMLElement | null) ?? document.body);
    };
    update();
    document.addEventListener("fullscreenchange", update);
    return () =>
      document.removeEventListener("fullscreenchange", update);
  }, []);

  // 主图优先用 imagesFull (高清), 没有就 fallback 到 images
  const hiResImages = imagesFull ?? images;
  const currentSrc = hiResImages[currentIndex] ?? images[currentIndex] ?? "";

  // 容器尺寸 ResizeObserver — 跟 guide-map 的 containerRect 同款
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setContainerSize({ w: r.width, h: r.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [portalTarget]);

  // 计算图片在容器里的"fit"大小 + zoom state machine 抽到 useLightboxZoom hook
//   - 上面已用 useMemo 算 fit, 这里 useLightboxZoom({ fit, containerSize }) 拿 tx/ty/k + schedule/reset

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
    reset();
    // 故意只依赖 currentIndex — 翻图时 reset
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex]);

  // imgNatural 变化时重新 clamp tx/ty (图片原始尺寸变化 → fit 大小变 → clamp 范围变)
  //   - 用 schedule 而非直接 setTx/setTy, 走 rAF 一致性
  //   - 翻图时 currentIndex useEffect 已经 reset 过, 这里不重置 (新图 naturalSize 加载后
  //     第一次 render 时 tx=ty=0 已经合法, 没必要再 clamp 一次)
  useEffect(() => {
    if (!imgNatural) return;
    schedule(tx, ty, k);
    // 故意依赖 imgNatural (img 加载完才触发), 避免 clampPan stale 闭包
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgNatural]);

  // ESC 关闭 / 方向键翻图
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // 阻止 LabelPopup 的 ESC listener 也触发 (popup 自己也有 window keydown listener)
        //   - LabelPopup 的 onKey 收到 ESC 会调 onClose 关掉 popup
        //   - 用户要求: 大图(lightbox)关闭时不关 popup, 只关 lightbox
        //   - popup listener 是 bubble phase 顺序触发, lightbox 后注册后触发, stopImmediatePropagation 来不及
        //   - 用 capture phase (true) 让 lightbox 先拦截, 同 phase 的 stopImmediatePropagation 生效
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      } else if (e.key === "ArrowRight" && images.length > 1) {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowLeft" && images.length > 1) {
        e.preventDefault();
        goPrev();
      }
    };
    // capture phase (true) 让 lightbox 先于 popup 的 bubble phase listener 触发
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, goNext, goPrev, images.length]);

  // rAF 卸载清理已搬到 useLightboxZoom hook 内部

  // 滚轮缩放 — 大步长 (1.25×), 一次操作明显放大/缩小
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      // 光标在容器里的相对位置 (中心为 0)
      const cursorX = e.clientX - rect.left - rect.width / 2;
      const cursorY = e.clientY - rect.top - rect.height / 2;
      // 一次滚轮 = 一个步长 (向上滚放大, 向下滚缩小)
      const factor = e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
      // 共享 zoomAtPoint: 保持光标 content 位置不变的 zoom 算法
      const next = zoomAtPoint(tx, ty, k, factor, cursorX, cursorY);
      if (!next) return;
      schedule(next.tx, next.ty, next.k);
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
    // portalTarget 也在 deps: portal target 从 null → body/fullscreen 变化时,
    // 旧 el (null) 的 effect bail 了, 新 portal commit 后 containerRef 才有值,
    // 加 portalTarget 让 effect 在 portal 切换时重新跑, 挂到新 el 上
  }, [k, tx, ty, schedule, portalTarget]);

  // 双指缩放 (移动端)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let pinchInitialDistance = 0;
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
      // **关键**: 双指 down 时第一个指已经触发 onPointerDown → dragRef 设置 + setPointerCapture,
      //   onPointerMove 用 dragRef 做 pan, 完全盖过 pinch zoom。
      // 立刻清 dragRef, onPointerMove 看到 null 提前 return → 双指缩放才真正生效
      // (用户最新要求: 查看大图界面双指缩放不被识别为拖动)
      dragRef.current = null;
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
      // 中心 = 两指中点
      const centerX = (t1.clientX + t2.clientX) / 2;
      const centerY = (t1.clientY + t2.clientY) / 2;
      const rect = el.getBoundingClientRect();
      const cursorX = centerX - rect.left - rect.width / 2;
      const cursorY = centerY - rect.top - rect.height / 2;
      // 共享 zoomAtPoint: 跟滚轮共用同一份 zoom 公式
      const next = zoomAtPoint(tx, ty, k, ratio, cursorX, cursorY);
      if (!next) return;
      schedule(next.tx, next.ty, next.k);
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
    // portalTarget 也在 deps: 同 wheel, portal 切换时重新挂监听
  }, [k, tx, ty, schedule, portalTarget]);

  // 鼠标拖动平移
  const onPointerDown = (e: React.PointerEvent) => {
    // 阻止 lightbox 内 pointerdown 冒泡到 map container (用户最新要求 #2)
    //   - lightbox 在 React tree 上是 LabelPopup → guide-map 的后代
    //   - React 18 event delegation: React pointer events 沿虚拟 tree 冒泡
    //   - 不 stopPropagation → map.onPointerDown 会触发, 即使有 dialog closest 兜底,
    //     React 合成 event 仍可能在某些边界 case 漏过去
    //   - 用户原话: "竖屏打开大图, 拖动会泄漏到手机端 popup"
    //     popup (label-popup) 在 lightbox 下层, 拖大图时 popup 也跟着移动 — 是因为
    //     map 的 pointer move 同时修改 tx/ty, lightbox 没有 stopPropagation 隔离
    e.stopPropagation();
    // 点按钮时不启动拖动 (按钮自己处理 click)
    const target = e.target as HTMLElement;
    if (target.closest("button")) return;
    // k=1 时图片刚好 fit 容器, 没东西可拖 — 禁止 drag (用户要求)
    if (k <= MIN_K) return;
    // 只在图片本身 (IMG) 上能拖 — 用户要求拖动区域 = 图片范围, 不是 container 周边
    //   - 之前 target 是容器内任何位置 (含 padding) 都可拖, 用户觉得超出图片范围
    //   - 现在只 IMG 元素触发拖动, container padding / minimap / 控件 都不触发
    if (target.tagName !== "IMG") return;
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

  // portal target 没就绪 (SSR / first render) → 不渲染 (避免 hydration mismatch)
  //   - portalTarget 在 useEffect 内设置, 第一帧 render 完 useEffect 跑 → setPortalTarget
  //   - 第二帧 portalTarget 有值, createPortal 渲染 lightbox
  //   - 1 frame (16ms) 延迟用户感知不到, 比 SSR hydration mismatch 强
  if (!portalTarget) return null;

  // lightbox 主体
  //   - portal target: fullscreenElement (有) || document.body (无)
  //   - z-[300] 在 portal target 的 stacking context 内最高:
  //     - 非 fullscreen (portal 到 body): z-300 > header z-100, 盖过 header ✓
  //     - fullscreen (portal 到 fullscreen element): z-300 > search wrapper z-[60], 盖过搜索栏 ✓
  //   - 没有 animate-in fade-in (用户反馈 fade-in 透明度过渡会让搜索栏短暂可见, 闪一下)
  const lightboxContent = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={
        hiResImages[currentIndex]
          ? `${hiResImages[currentIndex].split("/").pop()?.split(/[?#]/)[0]?.replace(/\.[^.]+$/, "") ?? "图片"} - 图片查看`
          : "图片查看"
      }
      // z-[300] 远超 header (z-100) 和 search wrapper (z-[60]), 确保在最上层
      // touchAction: "none" 让浏览器默认 pan/zoom 不干扰 lightbox 内的双指缩放/拖动
      //   阻止 iOS Safari edge swipe (左右边缘滑动) 触发 history.back/forward (用户要求 #5)
      //   阻止双指捏时浏览器想自己 pan 页面
      // overscroll-behavior: contain 阻止 lightbox 内滚动连带触发页面级导航/刷新
      //   (iOS Safari 边缘滑动返回手势, 用户要求 #5 "竖屏几乎无法用还会触发返回手势")
      className="fixed inset-0 z-[300] bg-slate-500/50 backdrop-blur-sm"
      style={{ touchAction: "none", overscrollBehavior: "contain" }}
      // 注意: 不再有 onClick 关闭 (用户要求: 只有右上角关闭按钮能关)
      //   - 之前点 backdrop (target === currentTarget) 也关, 用户觉得太容易误关
      //   - 现在只能点右上角关闭按钮关
      onClick={(e) => {
        // lightbox 内 click 不能冒泡到 map container 关 popup
        //   - React 18 event delegation: lightbox (React Portal body) 在 React tree 上仍是
        //     LabelPopup → map container 的后代, click 会沿虚拟 tree 冒泡到 map.onClick
        //   - stopPropagation 阻止 React 虚拟 tree 上的冒泡
        //   - 用户要求: 大图关闭时不关 popup, 任何 lightbox 内 click 都该被吸收
        e.stopPropagation();
      }}
      onWheel={(e) => {
        // 整个 dialog 上滚轮都 preventDefault, 避免:
        //   - 在 container padding 上滚轮: page scroll (lightbox wheel handler 只挂在 containerRef)
        //   - 在 backdrop 上滚轮: page scroll + map wheel handler (虽然有 dialog closest 兜底, 双保险)
        e.preventDefault();
      }}
    >
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div
          ref={containerRef}
          // 注意: 这里**不加** data-lightbox-control, 否则 onPointerDown 检查 closest 时
          // 会找到容器自己 (target.img → container), 永远 return early, drag 永远不启动
          className={cn(
            "relative pointer-events-auto select-none",
            // k = MIN_K (即未放大) 时图片铺满, 拖动无意义 → cursor default
            // k > MIN_K 时图片超出视图, 拖动有意义 → cursor grab
            k > MIN_K
              ? "cursor-grab active:cursor-grabbing"
              : "cursor-default",
            "w-[90vw] h-[90vh] max-w-[1400px] max-h-[900px]",
          )}
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
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth && img.naturalHeight) {
                setImgNatural({ w: img.naturalWidth, h: img.naturalHeight });
              }
            }}
            style={{
              transform: `translate(-50%, -50%) translate(${tx}px, ${ty}px) scale(${k})`,
              transformOrigin: "center center",
            }}
          />
        </div>
      </div>

      {/* 顶部标题 — 显示当前图片文件名 (含 - 横杠后面的细节说明)
          从 hiResImages[currentIndex] URL 提取 stem:
            "/images/maps/full/buildings/overworld/基地-仓库.webp" → "基地-仓库"
          用户要求: 大图标题显示图片名, 不是 label.name
            - "基地" → "基地-仓库" / "基地-内饰" (翻图时跟着切换)
            - 跨 label 也通用 (不耦合 label.name)
            - 翻图 (左/右) currentIndex 变化 → 自动重新提取 */}
      {hiResImages[currentIndex] && (() => {
        const filename =
          hiResImages[currentIndex].split("/").pop()?.split(/[?#]/)[0] ?? "";
        const stem = filename.replace(/\.[^.]+$/, "");
        return stem ? (
          <div className="absolute top-6 left-1/2 -translate-x-1/2 max-w-[80vw] px-6.5 py-2.5 rounded-full bg-white/90 text-slate-700 text-[16px] font-semibold backdrop-blur-md pointer-events-none whitespace-nowrap">
            {stem}
          </div>
        ) : null;
      })()}

      {/* 右上关闭 — 用户新加的图标, 无背景 */}
      <button
        type="button"
        onClick={onClose}
        data-lightbox-control
        aria-label="关闭"
        className="absolute top-8 right-4 sm:right-8 z-10 w-10 h-10 rounded-full border border-slate-200/90 text-white bg-white/90 hover:text-slate-200 hover:bg-slate-200 flex items-center justify-center transition-colors cursor-pointer"
      >
        <img src="/icons/map/tabs/关闭图标.svg" alt="" className="w-5.5 h-5.5" />
      </button>

      {/* 左右翻图 (只 >1 张时) — 用户新加的右侧箭头按钮, 无背景, 左箭头镜像 rotate */}
      {images.length > 1 && (
        <>
          <button
            type="button"
            onClick={goPrev}
            data-lightbox-control
            aria-label="上一张"
            className="absolute top-1/2 left-3 sm:left-6 -translate-y-1/2 rounded-lg z-10 w-9 h-12 border border-slate-200/90 text-white bg-white/90 hover:text-slate-200 hover:bg-slate-200 flex items-center justify-center transition-colors  cursor-pointer"
          >
            <img
              src="/icons/map/tabs/右侧箭头图标.svg"
              alt=""
              className="w-7 h-7 rotate-180"
            />
          </button>
          <button
            type="button"
            onClick={goNext}
            data-lightbox-control
            aria-label="下一张"
            className="absolute top-1/2 right-3 sm:right-6 -translate-y-1/2 rounded-lg z-10 w-9 h-12 border border-slate-200/90 text-white bg-white/90 hover:text-slate-200 hover:bg-slate-200 flex items-center justify-center transition-colors cursor-pointer"
          >
            <img
              src="/icons/map/tabs/右侧箭头图标.svg"
              alt=""
              className="w-7 h-7"
            />
          </button>
        </>
      )}

      {/* 右下缩放控制 — 跟 map 的 ZoomBtn 同款 (w-9 h-9 rounded-lg 边框) 但**无背景** (用户要求)
          用户要求: 删全屏按钮, 只留 放大 + 缩小; 操作一次就放大到图片能填满窗口 */}
      <div
        data-lightbox-control
        className="absolute bottom-8 right-5 sm:right-10 z-10 flex flex-col gap-1.5"
      >
        <button
          type="button"
          onClick={() => {
            const newK = Math.min(MAX_K, k * 1.5);
            schedule(tx, ty, newK);
          }}
          aria-label="放大"
          className="w-11 h-11 rounded-lg border border-slate-200/90 bg-white/90 text-slate-600 hover:text-slate-800 hover:bg-slate-200 flex items-center justify-center shadow-sm transition-colors disabled:opacity-30 cursor-pointer"
          disabled={k >= MAX_K}
        >
          <img src="/icons/map/tabs/放大图标.svg" alt="" className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={() => {
            const newK = Math.max(MIN_K, k / 1.5);
            schedule(tx, ty, newK);
          }}
          aria-label="缩小"
          className="w-11 h-11 rounded-lg border border-slate-200/90 bg-white/90 text-slate-600 hover:text-slate-800 hover:bg-slate-200 flex items-center justify-center shadow-sm transition-colors disabled:opacity-30 cursor-pointer disabled:cursor-default"
          disabled={k <= MIN_K}
        >
          <img src="/icons/map/tabs/缩小图标.svg" alt="" className="w-5 h-5" />
        </button>
      </div>

      {/* 左下缩略图列表 (其他图片)
              - 用户要求"如果显示不下, 也加没有滚动条的滚动栏"
              - max-w-[60vw] + shrink-0 缩略图 (w-16 h-16) 超过时溢出
              - overflow-x-auto 让溢出横向滚动
              - 隐藏滚动条 (复用 lightbox 同样的三件套) — 触屏滑动自然滚动, 不显示 scrollbar */}
      {images.length > 1 && (
        <div
          data-lightbox-control
          className="absolute bottom-6 left-5 sm:left-10 z-10 max-w-[60vw] flex gap-2 bg-slate-800/60 rounded-lg p-2 backdrop-blur-md overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
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
                    : "ring-transparent opacity-60 hover:opacity-100 cursor-pointer",
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
    </div>
  );

  return createPortal(lightboxContent, portalTarget);
}

/* ============================== Hooks / Helpers ============================== */

/**
 * 计算 "保持光标 content 位置不变" 的新 tx/ty/k
 * - 滚轮: factor = WHEEL_STEP / 1/WHEEL_STEP (1.25× or 0.8×)
 * - 双指: factor = ratio (currentDistance / initialDistance)
 * - k 越界 (== MIN_K 或 == MAX_K) 返回 null, 调用方不 schedule
 * - cursorX/Y 是相对容器中心的偏移 (调用方算好, 这里不依赖 DOM)
 * - 抽出来: 之前 wheel handler 和 touch handler 重复同一段 content-preserve 公式
 */
function zoomAtPoint(
  currentTx: number,
  currentTy: number,
  currentK: number,
  factor: number,
  cursorX: number,
  cursorY: number,
): { tx: number; ty: number; k: number } | null {
  const newK = Math.max(MIN_K, Math.min(MAX_K, currentK * factor));
  if (newK === currentK) return null;
  // 保持光标位置: cursor 下的 content 坐标不变
  //   contentX = (cursorX - tx) / k;  改 k 后新 tx = cursorX - contentX * newK
  const contentX = (cursorX - currentTx) / currentK;
  const contentY = (cursorY - currentTy) / currentK;
  return {
    tx: cursorX - contentX * newK,
    ty: cursorY - contentY * newK,
    k: newK,
  };
}

/**
 * 集中管理 lightbox 缩放/平移 state machine
 * - tx/ty/k 三元组 + rAF 批处理 (跟 guide-map 同款 schedule/commit)
 * - clampPan: k=1 时强制 tx=ty=0, k>1 时限制在图片边界内
 * - reset: 翻图时归零 (用户调用 reset())
 * - 内部维护 rafRef / pendingRef, 组件 unmount 自动 cancelAnimationFrame
 *
 * 输入 fit + containerSize 是 hook 外部计算好的 (useMemo), 跟 useLightboxZoom
 * 解耦 — fit 是图片 fit 容器大小, containerSize 是容器尺寸, hook 只用它们算 clamp.
 *
 * 返回 { tx, ty, k, schedule, reset }
 */
function useLightboxZoom(opts: {
  fit: { fitW: number; fitH: number } | null;
  containerSize: { w: number; h: number } | null;
}) {
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [k, setK] = useState(1);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<{ tx: number; ty: number; k: number } | null>(null);

  /** clamp tx/ty 让图片不拖出容器边界 */
  const clampPan = useCallback(
    (nextTx: number, nextTy: number, nextK: number): { tx: number; ty: number } => {
      // k=1 时图片刚好 fit 容器, tx/ty 必须 = 0
      if (nextK <= MIN_K || !opts.fit) return { tx: 0, ty: 0 };
      const cw = opts.containerSize?.w ?? 0;
      const ch = opts.containerSize?.h ?? 0;
      const maxX = Math.max(0, (opts.fit.fitW * nextK - cw) / 2);
      const maxY = Math.max(0, (opts.fit.fitH * nextK - ch) / 2);
      return {
        tx: Math.max(-maxX, Math.min(maxX, nextTx)),
        ty: Math.max(-maxY, Math.min(maxY, nextTy)),
      };
    },
    [opts.fit, opts.containerSize],
  );

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
      const clamped = clampPan(nextTx, nextTy, nextK);
      pendingRef.current = { tx: clamped.tx, ty: clamped.ty, k: nextK };
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(commit);
      }
    },
    [commit, clampPan],
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

  // 卸载清理 rAF
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  return { tx, ty, k, setTx, setTy, setK, schedule, reset };
}