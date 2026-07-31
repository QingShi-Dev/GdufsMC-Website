import { NextResponse } from "next/server";
import { queryAllServers, type ServerStatus } from "@/lib/mc-status";

// 实时数据：路由本身不缓存
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

interface CacheEntry {
  servers: ServerStatus[];
  fetchedAt: string;
  /** 真实查询完成的时刻 (ms) */
  fetchedAtMs: number;
}

/** TTL：在这个时间内直接返回新数据；超过就返回旧数据并后台刷新 */
const CACHE_TTL_MS = 5_000;
/** 旧数据可接受的最大寿命（防止后台刷新一直失败导致永远返回旧数据） */
const CACHE_STALE_MS = 60_000;

// 模块级单例缓存
let cache: CacheEntry | null = null;
let inflight: Promise<void> | null = null;

async function refresh(): Promise<void> {
  // 防止并发触发
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const servers = await queryAllServers();
      cache = {
        servers,
        fetchedAt: new Date().toISOString(),
        fetchedAtMs: Date.now(),
      };
    } catch (err) {
      // 查询失败不要清空旧缓存；记下错误方便排查
      console.error("[server-status] refresh failed:", err);
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export async function GET() {
  const now = Date.now();

  // 首次访问：同步等待结果（页面初次进入只能这样）
  if (!cache) {
    await refresh();
  } else {
    const age = now - cache.fetchedAtMs;
    if (age >= CACHE_TTL_MS) {
      // 超过 TTL：立即返回旧数据，后台异步刷新
      // 但如果旧数据实在太老了（> STALE_MS），就同步等新数据
      if (age < CACHE_STALE_MS) {
        // fire-and-forget
        void refresh();
      } else {
        await refresh();
      }
    }
  }

  // 兜底：极端情况下（首次访问 + refresh 整体失败）cache 仍可能为 null
  // 此时返回 503 让前端可以走自己的错误分支，不要崩
  if (!cache) {
    return NextResponse.json(
        { error: "status unavailable", servers: [], fetchedAt: new Date().toISOString() },
        { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
      {
        servers: cache.servers,
        fetchedAt: cache.fetchedAt,
      },
      {
        headers: {
          // 对外的 Cache-Control 告诉浏览器/CDN 不要缓存本响应；
          // 服务端进程内的 cache（cache / inflight）跟这个不是一回事，是给同进程内
          // 5s 内的高频轮询去重用的——两个层级，故意分开。
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "X-Cache-Age-Ms": String(Date.now() - cache.fetchedAtMs),
        },
      }
  );
}
