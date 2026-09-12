"use client";

/**
 * Service Worker 注册
 * - 挂载时 (window load 之后) 注册 /sw.js
 * - 失败降级: SW 不可用就什么都不做, 不影响主功能
 *
 * dev 模式默认注册 (SW 只缓存 /images/maps/*, 不碰 HMR bundle, 无冲突)
 * - 如果 dev HMR 被卡, 浏览器 DevTools → Application → SW → Unregister 即可
 */

import { useEffect } from "react";
import { logger } from "@/lib/logger";

export function SwRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    // 等 load 事件, 不抢首次渲染
    const onLoad = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((reg) => {
          // dev 才看, prod 用 logger.debug 默认隐藏
          logger.debug("[SW] registered", { scope: reg.scope });
        })
        .catch((err) => {
          // SW 注册失败不致命, 主流程照常工作
          logger.warn("[SW] registration failed", err);
        });
    };

    if (document.readyState === "complete") {
      onLoad();
    } else {
      window.addEventListener("load", onLoad, { once: true });
      return () => window.removeEventListener("load", onLoad);
    }
  }, []);

  return null;
}
