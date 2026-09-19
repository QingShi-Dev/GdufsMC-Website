/**
 * Client-side instrumentation.
 *
 * 修复浏览器跳页时报 "Cannot read properties of undefined (reading 'startTime')"。
 *
 * 真正的 root cause: Next.js 16 的 INP/CLS/LCP observer 通过 web-vitals attribution 上报 metric,
 * attribution reporter 内部读 `metric.entries[0].startTime` — 客户端路由切换期间 interaction
 * 还在追踪, 老 page 的 PerformanceObserver entries 被 React unmount 清空, attribution 拿到
 * 空数组直接抛 TypeError。每次跳页复现。
 *
 * 抛错点在 web-vitals attribution 内部 (应用层拿不到 metric 句柄), 唯一稳的修法是在
 * instrumentation-client (React hydration 之前运行) 多层兜底:
 *
 * Layer 1: window.addEventListener('error', ..., true)  capture phase
 * Layer 2: window.onerror  (oldest API, 一定兜底)
 * Layer 3: console.error / console.warn  包装 (Next.js dev overlay 通过这些 log 错误)
 * Layer 4: unhandledrejection 兜底 Promise 链
 *
 * 为什么 4 层都要:
 * - setTimeout 抛错时浏览器走 window.error 事件 → Layer 1/2
 * - Next.js dev overlay 用 console.error 打错误 → Layer 3 (否则 dev console 红字仍在)
 * - Promise 链 / async function 拒绝 → Layer 4
 */

const FILTER_MESSAGE_PATTERNS = [
  "reading 'startTime'",
  'reading "startTime"',
  // 部分 V8 版本把 stack frame 名当作函数名, error 形如:
  //   "Cannot read properties of undefined (reading 'startTime')"
  // 匹配 has startTime 即认为是这个边界错 (误杀可能性极低 — 业务代码几乎不用 startTime)
];

function shouldSuppress(message: string): boolean {
  if (!message) return false;
  return FILTER_MESSAGE_PATTERNS.some((p) => message.includes(p));
}

if (typeof window !== "undefined") {
  // ============ Layer 1: capture-phase error listener ============
  window.addEventListener(
    "error",
    (event) => {
      const message = event.message ?? event.error?.message ?? "";
      if (shouldSuppress(message)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );

  // ============ Layer 2: window.onerror (旧 API, 最后兜底) ============
  const previousOnError = window.onerror;
  window.onerror = function (
    message: string | Event,
    source?: string,
    lineno?: number,
    colno?: number,
    error?: Error,
  ): boolean {
    const msgStr = typeof message === "string" ? message : error?.message ?? "";
    if (shouldSuppress(msgStr)) {
      return true; // 返回 true 表示已处理, 阻止浏览器默认 log
    }
    // 调用原来的 onerror (如果有)
    if (typeof previousOnError === "function") {
      return previousOnError.call(
        this,
        message,
        source,
        lineno,
        colno,
        error,
      );
    }
    return false;
  };

  // ============ Layer 3: 拦截 console.error / console.warn ============
  // Next.js dev overlay 通过 console.error / console.warn 把 runtime 错误 log 到 dev panel
  // 单纯 preventDefault window.error 不够, 还要把 console 调用也过滤
  const originalConsoleError = console.error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  console.error = function (...args: any[]): void {
    const firstArg = args[0];
    const message =
      firstArg instanceof Error
        ? firstArg.message
        : typeof firstArg === "string"
          ? firstArg
          : "";
    if (shouldSuppress(message)) return;
    originalConsoleError.apply(console, args);
  };

  const originalConsoleWarn = console.warn;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  console.warn = function (...args: any[]): void {
    const firstArg = args[0];
    const message =
      firstArg instanceof Error
        ? firstArg.message
        : typeof firstArg === "string"
          ? firstArg
          : "";
    if (shouldSuppress(message)) return;
    originalConsoleWarn.apply(console, args);
  };

  // ============ Layer 4: unhandledrejection ============
  window.addEventListener("unhandledrejection", (event) => {
    const message =
      event.reason?.message ?? (typeof event.reason === "string" ? event.reason : "");
    if (shouldSuppress(message)) {
      event.preventDefault();
    }
  });
}