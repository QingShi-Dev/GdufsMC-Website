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
 * 桌面 lg 端取消 y 位移过渡 (用户最新要求 #1):
 *   - lg 端 hero 和 status-card 在同一列 (grid-cols-[1.1fr_1fr])
 *   - HomeMotion 的 y: -40 → 0 跟 status-card 自己的 motion y: 12 → 0 叠加
 *   - 视觉错位, 用户要取消
 *   - mobile (<lg): hero 和 status-card 堆叠 (order), y 入场感 OK, 保留
 *   - SSR (isLg 默认 false): mobile 行为 (有 y), 桌面 hydrate 后 useEffect 改 isLg=true
 *     → 重新计算 initial/animate, 但 framer-motion 已启动动画, 桌面端短时可能看到 0.x 秒 y
 *     动画 → 接受 (用户感知弱, 0.6s 内播完, 比 SSR/hydrate 一致性问题简单)
 */

import { motion } from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";

export function HomeMotion({ children }: { children: ReactNode }) {
  // SSR 默认 false (mobile 行为), hydrate 后 useEffect 用 matchMedia 立即同步
  const [isLg, setIsLg] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)"); // lg breakpoint (Tailwind lg = 1024px)
    const handler = (e: MediaQueryListEvent | MediaQueryList) => setIsLg(e.matches);
    handler(mq); // 立即同步当前 viewport (避免 1 帧 flicker)
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return (
    <motion.div
      // lg 端: 只 opacity 渐入 (无 y 位移, 跟 status-card y: 12 → 0 不叠加错位)
      // mobile: opacity + y -40 → 0 入场感
      initial={isLg ? { opacity: 0 } : { opacity: 0, y: -40 }}
      animate={isLg ? { opacity: 1 } : { opacity: 1, y: 0 }}
      // 注意: framer-motion v12 transition 顶层必须显式 type
      //   之前没 type 触发 TypeError: Cannot read properties of undefined (reading 'startTime')
      transition={{ type: "tween", duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="relative bg-gradient-to-b from-sky-50 via-white to-emerald-50/40"
    >
      {children}
    </motion.div>
  );
}