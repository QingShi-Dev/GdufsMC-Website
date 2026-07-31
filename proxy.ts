import { NextRequest, NextResponse } from "next/server";

/**
 * Rate limit for /api/server-status
 *
 * 设计:
 * - 固定窗口 (10s 滑窗简化为 reset-at), 同 IP 30 req / 10s
 * - 内存 LRU 上限 10000 entries, 防止单实例内存无限增长
 * - Edge runtime (Next.js proxy 默认), IP 来自 x-forwarded-for / x-real-ip
 *   公网部署在 Vercel/Cloudflare 等反代后面, 这俩 header 一定被注入
 * - 仅匹配 /api/server-status (matcher), 其他路由零开销
 *
 * Next.js 16: 中间件文件从 `middleware.ts` 改名为 `proxy.ts`,
 * 函数名也要从 `middleware` 改成 `proxy` (或 default export)。
 *
 * 升级路径 (多实例 / 严格 SLA):
 * - 进程内 Map 只能管单实例; 部署到 serverless 多 region 时, 每 region 各管各的
 *   (实际是更宽松, 不是更严, 一般够用)
 * - 真要全局精确限流, 换 Upstash Ratelimit / Redis 计数器
 */

const WINDOW_MS = 10_000;
const MAX_REQUESTS_PER_WINDOW = 30;
const MAX_BUCKETS = 10_000; // 内存上限; 超出按插入顺序丢一半

type Bucket = { count: number; resetAt: number; /** 插入顺序, 给 LRU 淘汰用 */ seq: number };

// 全局 Map: 注意 proxy 在 serverless 环境下每个实例独立,
// 这是设计上接受的 — 多实例下实际是更宽松的限流, 不影响可用性
const buckets = new Map<string, Bucket>();
let seqCounter = 0;

function getClientIp(req: NextRequest): string {
  // 优先取首个 x-forwarded-for (CDN/反代会追加)
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  // 兜底 (本机直连 dev 场景)
  return "anon";
}

function pruneIfNeeded() {
  if (buckets.size <= MAX_BUCKETS) return;

  // 优先清过期 bucket
  const now = Date.now();
  for (const [k, v] of buckets) {
    if (v.resetAt < now) buckets.delete(k);
  }
  // 还多就按 seq 淘汰最早一半 (LRU 简化版)
  if (buckets.size > MAX_BUCKETS) {
    const sorted = [...buckets.entries()].sort((a, b) => a[1].seq - b[1].seq);
    const dropCount = sorted.length - Math.floor(MAX_BUCKETS / 2);
    for (let i = 0; i < dropCount; i++) {
      const entry = sorted[i];
      if (entry) buckets.delete(entry[0]);
    }
  }
}

export function proxy(req: NextRequest) {
  const ip = getClientIp(req);
  const now = Date.now();

  let bucket = buckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 1, resetAt: now + WINDOW_MS, seq: seqCounter++ };
    buckets.set(ip, bucket);
  } else {
    bucket.count++;
  }

  // 每 ~100 次请求做一次剪枝, 避免每次都遍历
  if (seqCounter % 100 === 0) pruneIfNeeded();

  if (bucket.count > MAX_REQUESTS_PER_WINDOW) {
    const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    return new NextResponse(
      JSON.stringify({ error: "Too Many Requests" }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(retryAfterSec),
          "X-RateLimit-Limit": String(MAX_REQUESTS_PER_WINDOW),
          "X-RateLimit-Remaining": "0",
        },
      },
    );
  }

  const res = NextResponse.next();
  // 把剩余配额通过 header 暴露给上游, 方便客户端做退避
  res.headers.set(
    "X-RateLimit-Remaining",
    String(Math.max(0, MAX_REQUESTS_PER_WINDOW - bucket.count)),
  );
  return res;
}

export const config = {
  // 只匹配 /api/server-status, 其他路由零开销
  matcher: "/api/server-status",
};
