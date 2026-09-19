"use client";

/**
 * Home 页面外层的入场动画包装。
 *
 * 为什么单独抽出来：
 * app/page.tsx 是 Server Component（拿数据、拼 HTML），不能直接用 framer-motion
 * 的 <motion.div> —— Next.js 16 + 生产 prerender 会报 "Element type is invalid"。
 * 抽到 client component 后，Server Component 只负责结构，client 这层负责动画，
 * 兼顾 SSR 和入场动画。
 *
 * 简化: 不再做 lg/mobile 拆分 (用户最新要求 — 之前 isLg 拆分导致
 *   "刷新 on lg" 跟 "sm→lg 展开" 两条路径视觉不一样)
 *   - lg 刷新: SSR isLg=false → useEffect 改 true → framer-motion 改 initial/animate
 *     (无 y) → 已启动的动画从 {y:-40} 跳到 {y:0} 引发微小视觉差
 *   - sm→lg: SSR 是 mobile, 动画播完 → matchMedia 触发 isLg=true → framer-motion
 *     看到目标值没变 (y:0, opacity:1), 不重播
 *   - 现在统一 initial/animate: 两路径 SSR/hydrate/matchMedia 都看到同一个 transition
 *   - lg 也做 y:-40 → 0 入场 (0.6s 内播完, 用户感知弱, 不再叠加 status-card:
 *     status-card 在 SSR 有数据时 hasInitialData=true, 自己的 initial 没 y)
 */

import { motion } from "framer-motion";
import type { ReactNode } from "react";

export function HomeMotion({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -40 }}
      animate={{ opacity: 1, y: 0 }}
      // 注意: framer-motion v12 transition 顶层必须显式 type
      //   之前没 type 触发 TypeError: Cannot read properties of undefined (reading 'startTime')
      transition={{ type: "tween", duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="relative bg-gradient-to-b from-sky-50 via-white to-emerald-50/40"
    >
      {children}
    </motion.div>
  );
}