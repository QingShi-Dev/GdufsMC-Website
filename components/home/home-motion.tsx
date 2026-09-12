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
 * 之前整张页面只有一个外层动画（Hero 滑入），所以这个 wrapper 单纯承接动画；
 * 后续要拆更多动画/交互部分，独立的 client component 是更稳的边界。
 */

import { motion } from "framer-motion";
import type { ReactNode } from "react";

export function HomeMotion({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ y: -40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="relative bg-gradient-to-b from-sky-50 via-white to-emerald-50/40"
    >
      {children}
    </motion.div>
  );
}
