"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
    motion,
    useAnimationControls,
    AnimatePresence,
} from "framer-motion";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
    { href: "/", label: "首页" },
    { href: "/map", label: "地图总览" },
    { href: "/news", label: "新闻动态" },
    { href: "/guide", label: "游玩指南" },
];

/* 史莱姆 svg */
function SlimeFace({ className = "" }: { className?: string }) {
    return (
        <svg viewBox="0 0 32 32" className={className}>
            <defs>
                <linearGradient id="slimeShell" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#bbf7d0" stopOpacity="0.65" />
                    <stop offset="100%" stopColor="#16a34a" stopOpacity="0.5" />
                </linearGradient>
                <linearGradient id="slimeCore" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#86efac" />
                    <stop offset="100%" stopColor="#15803d" />
                </linearGradient>
            </defs>
            {/* 外层半透壳 */}
            <rect x="2" y="3" width="28" height="27" rx="4" fill="url(#slimeShell)" stroke="#15803d" strokeWidth="1" />
            {/* 内部实心核心 */}
            <rect x="6" y="7" width="20" height="20" rx="2" fill="url(#slimeCore)" />
            {/* 核心高光 */}
            <ellipse cx="11" cy="10" rx="3" ry="1.5" fill="white" fillOpacity="0.55" />
            {/* 眼睛 - 6x6 方形 */}
            <rect x="7" y="12" width="6" height="6" rx="0.5" fill="#2d2d2d" />
            <rect x="19" y="12" width="6" height="6" rx="0.5" fill="#2d2d2d" />
            {/* 眼珠 - 左下角四分之一 3x3，纯黑 */}
            <rect x="7" y="15" width="3" height="3" fill="#000" />
            <rect x="19" y="15" width="3" height="3" fill="#000" />
            {/* 嘴 - 3x4，中间偏右 (x=17)，和眼睛空出 3px */}
            <rect x="16" y="21" width="3" height="3" fill="#2d2d2d" />
        </svg>
    );
}

export function HeaderNav() {
    const pathname = usePathname();
    const containerRef = useRef<HTMLDivElement>(null);
    const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);
    const bonkControls = useAnimationControls();
    const textControls = useAnimationControls();

    // 史莱姆状态
    const [slimeX, setSlimeX] = useState<number | null>(null); // null = 未定位，不渲染
    const [facingLeft, setFacingLeft] = useState(false); // true = scaleX(-1)
    const [noTransition, setNoTransition] = useState(false); // resize 期间关 CSS transition
    const [slimeKey, setSlimeKey] = useState(0); // mobile→desktop 时 +1 强制重 mount 触发 drop
    const [navAnimate, setNavAnimate] = useState({ y: -20, opacity: 0 }); // 桌面 nav 出现动画
    const [mobileOpen, setMobileOpen] = useState(false);
    // 爱心彩蛋（只在首页触发，多次点击的爱心序列共存）
    const [hearts, setHearts] = useState<{ id: number; offsetX: number }[]>([]);

    // Refs（跨 effect 同步 + 避免 stale closure）
    const prevPathname = useRef(pathname); // 跳过首次 mount 的 bonk/text 动画
    const prevActiveIndex = useRef(0); // 记录方向用于 flip
    const isDesktopNav = useRef<boolean | null>(null); // 桌面端状态机
    const isMobileToDesktop = useRef(false); // mobile→desktop 切换中：阻止 ResizeObserver 干扰
    const isNavSwitching = useRef(false); // nav 切换中：阻止 ResizeObserver 关 CSS transition
    const switchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // 锁的 timer，避免多次 lock 累积
    const activeIndexRef = useRef(0); // 始终保持最新 activeIndex，给 matchMedia 的 setTimeout 回调用
    const heartIdRef = useRef(0); // 爱心递增 id
    const lastHeartClickRef = useRef(0); // 上次爱心点击时间戳（控制 0.3s 最小间隔）
    const heartTimersRef = useRef<Set<number>>(new Set()); // 所有 active 的爱心 setInterval id（Set 避免 push-after-unmount 泄漏）
    const triggerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // matchMedia 触发 setTimeout(0) 的 id，必须 cleanup

    /** 用户点 nav 链接瞬间同步加锁（早于 React commit，比 useEffect 早得多） */
    const lockNavSwitching = () => {
        isNavSwitching.current = true;
        if (switchTimerRef.current) clearTimeout(switchTimerRef.current);
        switchTimerRef.current = setTimeout(() => {
            isNavSwitching.current = false;
            switchTimerRef.current = null;
        }, 1000);
    };

    /** 生成一个爱心（x 在 logo 文字中心 ±30px 随机） */
    const spawnHeart = () => {
        const offsetX = (Math.random() - 0.5) * 60; // -30 ~ +30
        const id = heartIdRef.current++;
        setHearts((prev) => [...prev, { id, offsetX }]);
    };
    /** 爱心动画完成后从 state 移除 */
    const removeHeart = (id: number) => {
        setHearts((prev) => prev.filter((h) => h.id !== id));
    };

    /**
     * 点击 logo：触发爱心彩蛋（仅在首页）
     * - 多次点击的爱心序列共存（不清空第一次的）
     * - 1s 内重复点击无效（只续 nav 切换锁，不出新的爱心）
     */
    const handleLogoClick = () => {
        lockNavSwitching();
        if (pathname !== "/") return; // 只在首页触发
        const now = Date.now();
        const elapsed = now - lastHeartClickRef.current;
        // 1s 内重复点击无效
        if (elapsed < 1000) return;
        lastHeartClickRef.current = now;
        // 立即开始本轮序列
        spawnHeart();
        let count = 1;
        const intervalId = window.setInterval(() => {
            if (count >= 6) {
                window.clearInterval(intervalId);
                heartTimersRef.current.delete(intervalId);
                return;
            }
            spawnHeart();
            count++;
        }, 250);
        heartTimersRef.current.add(intervalId);
    };

    // 卸载时清掉所有爱心 timer
    // 用 Set 而不是 array：cleanup 时复制 array 引用，unmount 后 push 的 id 永远不会清（泄漏）
    // Set 在 unmount 时直接 forEach 读当前内容，clear() 清空，add 永远是 O(1)
    useEffect(() => {
        const timers = heartTimersRef.current;
        return () => {
            timers.forEach((t) => window.clearTimeout(t));
            timers.clear();
        };
    }, []);

    // document 级别的事件委托：捕获所有内部 <a href="/..."> 点击，自动加 nav 切换锁
    // 这样 hero、footer、feature 等页面里那些不在 HeaderNav 里的 Link 跳转时
    // 也能挡住 ResizeObserver，不让史莱姆横向过渡失效
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            const target = e.target as HTMLElement | null;
            if (!target) return;
            const link = target.closest("a[href]") as HTMLAnchorElement | null;
            if (!link) return;
            const href = link.getAttribute("href");
            if (!href) return;
            // 内部路由：以 "/" 开头但不是 "//"（外链）或 "javascript:" 等
            if (href.startsWith("/") && !href.startsWith("//")) {
                lockNavSwitching();
            }
        };
        document.addEventListener("click", handler);
        return () => document.removeEventListener("click", handler);
    }, []);

    const activeIndex = useMemo(() => {
        const i = NAV_ITEMS.findIndex((item) =>
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)
        );
        return i === -1 ? 0 : i;
    }, [pathname]);

    // nav item 的 ref 回调工厂：
    // - mount 时一次性创建 NAV_ITEMS.length 个稳定函数（i 用 closure 捕获）
    // - React 19 下 ref 是普通 prop，函数引用稳定就不会每 render 重 attach
    // - 避免每次 render 重建 inline ref 函数导致的 cleanup + setup 抖动
    // - NAV_ITEMS 是 const，依赖 [] 安全
    const itemRefSetters = useMemo(
        () =>
            NAV_ITEMS.map(
                (_, i) => (el: HTMLAnchorElement | null) => {
                    itemRefs.current[i] = el;
                }
            ),
        []
    );

    /** 计算当前 active nav item 在容器中的中心 x（DOM 测量） */
    const computeSlimeX = () => {
        const el = itemRefs.current[activeIndexRef.current];
        const container = containerRef.current;
        if (!el || !container) return null;
        const elRect = el.getBoundingClientRect();
        const cRect = container.getBoundingClientRect();
        return elRect.left - cRect.left + elRect.width / 2;
    };

    // activeIndex 变化时：先同步 ref，再定位史莱姆
    // 用 queueMicrotask 包住 setSlimeX，让它脱离 effect 同步路径
    // （react-hooks/set-state-in-effect 规则会放过异步触发的 setState）
    useEffect(() => {
        activeIndexRef.current = activeIndex;
        // 锁已经在 onClick 里同步设了（早于这个 effect），这里不需要再设
        queueMicrotask(() => {
            const x = computeSlimeX();
            if (x !== null) setSlimeX(x);
        });
    }, [activeIndex]);

    // 容器尺寸变化：resize 期间关 CSS transition 让史莱姆瞬移
    // 独立 effect，不依赖 activeIndex —— nav 切换时不再重建 ResizeObserver
    useEffect(() => {
        let resizeTimer: ReturnType<typeof setTimeout> | null = null;
        // ResizeObserver 在 observe() 后会立刻 fire 一次（拿初始尺寸），这次不算用户 resize
        // 跳过它，否则 noTransition 会被置 true 150ms，期间用户点 nav 切页，史莱姆横向过渡就被压住
        let isInitialFire = true;
        const ro = new ResizeObserver(() => {
            if (isInitialFire) {
                isInitialFire = false;
                return;
            }
            // mobile→desktop 切换中，matchMedia 监听器会负责定位，这里跳过避免在错位置闪现
            if (isMobileToDesktop.current) return;
            // nav 切换中：只更新 slimeX，不关 CSS transition（让横向过渡能播）
            // 某些 nav item 切换会触发 header 容器的微小 resize（active 文字宽度差、text-shadow 等）
            if (isNavSwitching.current) {
                requestAnimationFrame(() => {
                    const x = computeSlimeX();
                    if (x !== null) setSlimeX(x);
                });
                return;
            }
            // rAF 批量，避免 resize 高频事件每次都 setState
            requestAnimationFrame(() => {
                const x = computeSlimeX();
                if (x !== null) setSlimeX(x);
            });
            // resize 期间：关 CSS transition，让史莱姆瞬移到目标位置（不滞后滑动）
            setNoTransition(true);
            if (resizeTimer) clearTimeout(resizeTimer);
            // 停止 resize 150ms 后恢复 transition，下次切 nav 还能平滑滑动
            resizeTimer = setTimeout(() => setNoTransition(false), 150);
        });
        if (containerRef.current) ro.observe(containerRef.current);
        return () => {
            ro.disconnect();
            if (resizeTimer) clearTimeout(resizeTimer);
        };
    }, []);

    // pathname 变化时触发 bonk + text 动画 + 调整朝向
    useEffect(() => {
        if (prevPathname.current === pathname) return; // 首次 mount / 刷新跳过
        if (activeIndex > prevActiveIndex.current) {
            setFacingLeft(false);
        } else if (activeIndex < prevActiveIndex.current) {
            setFacingLeft(true);
        }
        prevActiveIndex.current = activeIndex;
        prevPathname.current = pathname;
        bonkControls
            .start({
                scale: [1, 0.85, 1.18, 1],
                y: [0, -12, 0, 0],
                // 注意: framer-motion v12 controls.start 的 transition 也必须显式 type
                transition: { type: "tween", duration: 0.5, ease: "easeOut" },
            })
            .catch(() => {});
        textControls
            .start({
                y: [0, -5, 1, 0],
                scale: [1, 1.06, 0.98, 1],
                transition: { type: "tween", duration: 0.5, ease: "easeOut" },
            })
            .catch(() => {});
    }, [pathname, activeIndex, bonkControls, textControls]);

    // 桌面 nav 出现时的降落动画（首次 mount + mobile→desktop）
    // 用 state 驱动 motion.nav（不用 controls）—— controls 初始为空会卡在 initial
    useEffect(() => {
        const mq = window.matchMedia("(min-width: 768px)"); // md breakpoint
        const triggerDesktopEnter = () => {
            isMobileToDesktop.current = true; // 锁住 ResizeObserver
            setNavAnimate({ y: 0, opacity: 1 });
            setSlimeX(null); // 先隐藏，避免在默认位置闪现
            // 清理前一个未触发的 timer（如果用户连续 resize 到桌面端，旧的 0ms timer 还在排队）
            if (triggerTimerRef.current) clearTimeout(triggerTimerRef.current);
            // setTimeout(0) 等一帧让 DOM 更新（nav 切到可见），再测 x 重 mount 史莱姆
            triggerTimerRef.current = setTimeout(() => {
                triggerTimerRef.current = null;
                const newX = computeSlimeX();
                if (newX !== null) setSlimeX(newX);
                setSlimeKey((k) => k + 1); // 强制中间 motion.div 重 mount，触发 drop 动画
                isMobileToDesktop.current = false; // 解锁
            }, 0);
        };
        const onChange = () => {
            const isDesktop = mq.matches;
            if (isDesktopNav.current === null) {
                // 首次 mount：根据当前是否桌面端决定是否触发降落
                isDesktopNav.current = isDesktop;
                if (isDesktop) triggerDesktopEnter();
            } else if (isDesktop && !isDesktopNav.current) {
                // 从移动端 resize 到桌面端：触发降落
                isDesktopNav.current = true;
                triggerDesktopEnter();
            } else {
                isDesktopNav.current = isDesktop;
            }
        };
        mq.addEventListener("change", onChange);
        onChange(); // mount 时主动跑一次（处理 SSR/hydration 时 mq 已切到桌面端的情况）
        return () => {
            isMobileToDesktop.current = false;
            // 必须 cleanup：组件 unmount 时如果 triggerTimer 还在排队（0ms 那个 setTimeout），
            // 不清的话会跑出 setState + 写 ref.current，ref 指向已卸载 fiber 就出诡异 bug
            if (triggerTimerRef.current) {
                clearTimeout(triggerTimerRef.current);
                triggerTimerRef.current = null;
            }
            mq.removeEventListener("change", onChange);
        };
    }, []);

    return (
        <header className="fixed top-0 inset-x-0 z-100 bg-white/55">
            <div
                ref={containerRef}
                className="relative w-full"
                style={{
                    background:
                        "linear-gradient(180deg, rgba(186, 240, 253, 0.7) 0%, rgba(224, 242, 254, 0.45) 100%)",
                    backdropFilter: "blur(14px) saturate(180%)",
                    WebkitBackdropFilter: "blur(14px) saturate(180%)",
                    borderBottom: "1px solid rgba(255, 255, 255, 0.2)",
                    boxShadow: "0 4px 24px -6px rgba(0, 0, 0, 0.08)",
                }}
            >
                <div className="mx-auto max-w-7xl px-6 py-3 flex items-center justify-between">
                    <Link
                        href="/"
                        onClick={handleLogoClick}
                        className="relative flex flex-col cursor-pointer z-10 group select-none"
                        aria-label="云城像素社 - 返回首页"
                    >
                        <div className="font-bold text-slate-700 text-[20px] md:text-[21px] tracking-tight leading-none pt-2">
                            云城像素社
                        </div>
                        <div className="text-[10px] md:text-[11px] text-slate-500 text-center uppercase tracking-[0.2em] font-semibold mt-0.5">
                            GDUFS·MC
                        </div>

                        {/* 爱心彩蛋：只在首页触发 */}
                        <AnimatePresence>
                            {hearts.map((h) => (
                                <motion.img
                                    key={h.id}
                                    src="/icons/global/爱心图标.webp"
                                    alt=""
                                    initial={{ y: 0, opacity: 0, scale: 0.5, x: h.offsetX }}
                                    animate={{ y: -55, opacity: [0, 1, 1, 0], scale: 1 }}
                                    // 注意: framer-motion v12 transition 必须有顶层 type, opacity 是 keyframes [0,1,1,0]
                                    transition={{ type: "tween", duration: 1, ease: "easeOut", times: [0, 0.2, 0.7, 1] }}
                                    onAnimationComplete={() => removeHeart(h.id)}
                                    className="absolute w-5 h-5 pointer-events-none select-none"
                                    style={{ left: "50%", bottom: 0 }}
                                />
                            ))}
                        </AnimatePresence>
                    </Link>

                    <motion.nav
                        className="hidden md:flex items-center gap-1 relative z-10"
                        initial={{ y: -20, opacity: 0 }}
                        animate={navAnimate}
                        // 注意: framer-motion v12 transition 必须有顶层 type
                        transition={{ type: "tween", duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                    >
                        {NAV_ITEMS.map((item, i) => {
                            const active = i === activeIndex;
                            return (
                                <Link
                                    key={item.href}
                                    ref={itemRefSetters[i]}
                                    href={item.href}
                                    onClick={lockNavSwitching}
                                    className={cn(
                                        "relative px-4 py-2 text-lg font-semibold rounded-lg transition-colors",
                                        active
                                            ? "text-emerald-500 text-shadow-3xs"
                                            : "text-slate-700 text-shadow-2xs hover:text-slate-800 hover:bg-white/40"
                                    )}
                                >
                                    {active ? (
                                        <motion.span className="inline-block" animate={textControls}>
                                            {item.label}
                                        </motion.span>
                                    ) : (
                                        <span>{item.label}</span>
                                    )}
                                </Link>
                            );
                        })}
                    </motion.nav>

                    <div className="md:hidden flex items-center gap-1.5">
            <span className="text-lg font-semibold pt-0.5 text-slate-700">
              {NAV_ITEMS[activeIndex]?.label ?? "首页"}
            </span>
                        <button
                            type="button"
                            onClick={() => setMobileOpen((v) => !v)}
                            className="p-2 rounded-lg hover:bg-white/40"
                            aria-label="菜单"
                        >
                            <div className="w-5 h-0.5 bg-slate-700 mb-1.5" />
                            <div className="w-5 h-0.5 bg-slate-700 mb-1.5" />
                            <div className="w-5 h-0.5 bg-slate-700" />
                        </button>
                    </div>
                </div>

                {/* 史莱姆：四层结构，职责严格分离
            1. 最外层普通 div：x 定位（CSS transition，无 overshoot）
            2. 中间 motion.div：drop 动画（y + opacity，从屏幕外竖直降下）
            3. 内层 motion.div：bonk 动画（scale + y 弹跳）
            4. 最内层普通 div：朝向翻转（facingLeft 时 scaleX(-1)） */}
                {slimeX !== null && (
                    <div
                        className="absolute pointer-events-none z-10 hidden md:block"
                        style={{
                            bottom: 10,
                            left: 0,
                            width: 24,
                            height: 24,
                            marginLeft: -12,
                            transform: `translateX(${slimeX}px)`,
                            // resize 期间 noTransition=true → 史莱姆瞬移（不滞后滑动）
                            // 正常切 nav 时 transition 开 → 平滑滑动
                            transition: noTransition
                                ? "none"
                                : "transform 0.45s cubic-bezier(0.22, 1, 0.36, 1)",
                            willChange: "transform",
                        }}
                    >
                        <motion.div
                            key={slimeKey}
                            initial={{ y: -200, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ type: "spring", stiffness: 180, damping: 18, mass: 0.8 }}
                            style={{ width: 24, height: 24 }}
                        >
                            <motion.div className="w-full h-full" animate={bonkControls}>
                                <motion.div
                                    className="w-full h-full"
                                    animate={{ scaleX: facingLeft ? -1 : 1 }}
                                    // 注意: framer-motion v12 transition 必须有顶层 type
                                    transition={{ type: "tween", duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                                >
                                    <SlimeFace className="w-full h-full drop-shadow-md" />
                                </motion.div>
                            </motion.div>
                        </motion.div>
                    </div>
                )}

                {/* 草方块底边 */}
                <div className="relative h-3 overflow-hidden">
                    <svg
                        className="absolute inset-0 w-full h-full"
                        preserveAspectRatio="none"
                        viewBox="0 0 1200 16"
                    >
                        <defs>
                            <linearGradient id="grassTop" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#7CCD7C" />
                                <stop offset="100%" stopColor="#4CAF50" />
                            </linearGradient>
                            <linearGradient id="dirtBottom" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#A0723D" />
                                <stop offset="100%" stopColor="#6D4C2A" />
                            </linearGradient>
                        </defs>
                        {/* 草地 */}
                        <rect x="0" y="0" width="1200" height="16" fill="url(#grassTop)" />
                        {/* 草地浅色斑点纹理 */}
                        {Array.from({ length: 50 }).map((_, i) => {
                            const x = i * 24;
                            const y = (i * 7) % 5;
                            return (
                                <rect
                                    key={`grass-${i}`}
                                    x={x}
                                    y={y}
                                    width="3"
                                    height="2"
                                    fill="#A5D6A7"
                                    opacity="0.7"
                                />
                            );
                        })}
                        {/* 小黄花（q 版可爱细节） */}
                        {Array.from({ length: 6 }).map((_, i) => {
                            const x = 100 + i * 200;
                            const y = 2;
                            return (
                                <g key={`flower-${i}`}>
                                    <rect x={x} y={y} width="1" height="1" fill="#FFEB3B" />
                                    <rect x={x + 1} y={y - 1} width="1" height="1" fill="#FFEB3B" />
                                    <rect x={x + 2} y={y} width="1" height="1" fill="#FFEB3B" />
                                    <rect x={x + 1} y={y + 1} width="1" height="1" fill="#FFEB3B" />
                                    <rect x={x + 1} y={y} width="1" height="1" fill="#FBC02D" />
                                </g>
                            );
                        })}
                        {/* 草地顶亮线 */}
                        <rect x="0" y="0" width="1200" height="0.5" fill="#C8E6C9" opacity="0.6" />
                    </svg>
                </div>

                {/* Mobile menu */}
                <AnimatePresence>
                    {mobileOpen && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            // 用户最新要求 #2: 手机端 header 点击跳转页面后直接消失, 不做过渡动画
                            //   - 之前 exit 默认 framer-motion duration 0.3s, 跳转后 menu 渐出 fade-out
                            //   - 用户要 "直接消失" — exit duration 0 立即 unmount
                            //   - 点 X 关闭 menu 同样直接消失 (用户原话包含跳转, 没明确点 X 行为, 统一处理最简)
                            //   - framer-motion v12 exit 类型是 TargetAndTransition,
                            //     transition 必须嵌套在 transition 子键里 (顶层 spread 不能加 duration)
                            //   - exit transition 也必须有顶层 type 否则 framer-motion v12 抛 startTime
                            exit={{ height: 0, opacity: 0, transition: { type: "tween", duration: 0 } }}
                            className="md:hidden border-t border-white/20 bg-white/80 backdrop-blur-md overflow-hidden"
                        >
                            <ul className="flex flex-col p-2 max-w-7xl mx-auto">
                                {NAV_ITEMS.map((item, i) => (
                                    <li key={item.href}>
                                        <Link
                                            href={item.href}
                                            onClick={() => {
                                                lockNavSwitching();
                                                setMobileOpen(false);
                                            }}
                                            className={cn(
                                                "block px-4 py-3 rounded-lg text-base font-semibold",
                                                i === activeIndex
                                                    ? "text-emerald-500 text-shadow-2xs bg-emerald-100/70"
                                                    : "text-slate-700 text-shadow-2xs hover:bg-slate-100"
                                            )}
                                        >
                                            {item.label}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </header>
    );
}
