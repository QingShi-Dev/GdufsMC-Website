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

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    // 等 load 事件, 不抢首次渲染
    const onLoad = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((reg) => {
          if (process.env.NODE_ENV !== "production") {
            console.info("[SW] registered (dev):", reg.scope);
          }
        })
        .catch((err) => {
          // SW 注册失败不致命, 主流程照常工作
          console.warn("[SW] registration failed:", err);
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
