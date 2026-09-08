import { queryMCServer, extractMotd } from "./mc-ping";
import { DEFAULT_MC_PORT, PING_TIMEOUT_MS, QUERY_CONCURRENCY } from "./mc-status-constants";

export type ServerKey =
    | "survival-main"
    | "survival-backup"
    | "survival-campus"
    | "create-main"
    | "create-backup"
    | "create-campus"
    | "bmc"
    | "gh-mua"
    | "hemc";

export type ServerGroup = "survival" | "create" | "bmc" | "hemc";

export interface ServerTarget {
  key: ServerKey;
  group: ServerGroup;
  label: string;
  desc: string; // 版本说明
  host: string;
  port?: number;
  /** 是否仅校园网可访问（公网部署时该地址无法 ping 通） */
  campusOnly?: boolean;
  /** 是否停服调整中（前端展示红色"停服调整"标签） */
  maintenance?: boolean;
  /** 排序权重，小的在前 */
  order: number;
}

// 常量 (DEFAULT_MC_PORT / PING_TIMEOUT_MS / QUERY_CONCURRENCY) 来自 ./mc-status-constants
// 共享给客户端组件用——所以拆开，避免 client bundle 拉进 node:net

/**
 * 服务器地址（按群公告汇总）。
 * - 校园网地址公网 ping 不通，所以查询会超时，但展示上仍保留，方便校内同学对照。
 */
export const SERVER_TARGETS: ServerTarget[] = [
  // 群组服（原版 26.2）
  { key: "survival-campus", group: "survival", label: "群组服 校园网", desc: "", host: "mc.gdufscraft.top", port: DEFAULT_MC_PORT, campusOnly: true, order: 0 },
  { key: "survival-main", group: "survival", label: "群组服 公网主线", desc: "", host: "mc2.gdufscraft.top", port: DEFAULT_MC_PORT, order: 1 },
  { key: "survival-backup", group: "survival", label: "群组服 公网备线", desc: "", host: "mc3.gdufscraft.top", port: DEFAULT_MC_PORT, order: 2 },
  // 粤高联联合群组门户
  { key: "gh-mua", group: "hemc", label: "联合群组门户", desc: "- 1.21", host: "mc.ghm-mua.org", port: DEFAULT_MC_PORT, order: 0 },
  // 粤高联广州大学城复原项目
  { key: "hemc", group: "hemc", label: "大学城复原项目", desc: "- 1.20.1", host: "hemc.ghm-mua.org", port: DEFAULT_MC_PORT, order: 1 },
];

export interface ServerStatus {
  key: ServerKey;
  group: ServerGroup;
  label: string;
  desc: string;
  host: string;
  campusOnly: boolean;
  maintenance: boolean;
  order: number;
  online: boolean;
  latencyMs: number | null;
  version: string | null;
  motd: string | null;
  players: { online: number; max: number; sample: { name: string }[] } | null;
  error: string | null;
  checkedAt: string;
}

/**
 * 用 target 填充"骨架"字段，调用方只关心"差异部分"（online / latency / error / payload）。
 * 之前 3 条 return 路径各自重复 11 个字段，DRY 严重违反。
 */
function buildResult(
    target: ServerTarget,
    payload: {
      online: boolean;
      latencyMs: number | null;
      error?: string | null;
      version?: string | null;
      motd?: string | null;
      players?: ServerStatus["players"];
    },
    checkedAt: string,
): ServerStatus {
  return {
    key: target.key,
    group: target.group,
    label: target.label,
    desc: target.desc,
    host: target.host,
    campusOnly: target.campusOnly ?? false,
    maintenance: target.maintenance ?? false,
    order: target.order,
    online: payload.online,
    latencyMs: payload.latencyMs,
    version: payload.version ?? null,
    motd: payload.motd ?? null,
    players: payload.players ?? null,
    error: payload.error ?? null,
    checkedAt,
  };
}

export async function queryServer(target: ServerTarget): Promise<ServerStatus> {
  const checkedAt = new Date().toISOString();
  const start = Date.now();

  // 校园网地址在公网部署时一律返回"不可达"
  if (target.campusOnly) {
    return buildResult(
        target,
        { online: false, latencyMs: null, error: "仅校园网可访问" },
        checkedAt,
    );
  }

  try {
    const res = await queryMCServer(target.host, target.port ?? DEFAULT_MC_PORT, {
      timeoutMs: PING_TIMEOUT_MS,
      enableSRV: true,
    });
    const latencyMs = Date.now() - start;

    if (!res.online) {
      return buildResult(
          target,
          { online: false, latencyMs, error: res.error },
          checkedAt,
      );
    }

    const r = res.response;
    return buildResult(
        target,
        {
          online: true,
          latencyMs,
          version: r.version?.name ?? null,
          motd: extractMotd(r.description) || null,
          players: r.players
              ? {
                online: r.players.online ?? 0,
                max: r.players.max ?? 0,
                sample: (r.players.sample ?? []).map((p) => ({ name: p.name })),
              }
              : null,
        },
        checkedAt,
    );
  } catch (err) {
    const latencyMs = Date.now() - start;
    return buildResult(
        target,
        {
          online: false,
          latencyMs,
          error: err instanceof Error ? err.message : String(err),
        },
        checkedAt,
    );
  }
}

/**
 * 简易并发控制器：最多 N 个任务同时跑，O(N) 实现。
 * Node 内置 worker pool 太重、自己写一个 ~20 行就够。
 */
async function runWithConcurrency<T>(
    tasks: (() => Promise<T>)[],
    concurrency: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= tasks.length) return;
      results[i] = await tasks[i]!();
    }
  }
  const n = Math.min(concurrency, tasks.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

export async function queryAllServers(): Promise<ServerStatus[]> {
  // 受控并发查询；校园网地址在 queryServer 内部短路
  return runWithConcurrency(
      SERVER_TARGETS.map((t) => () => queryServer(t)),
      QUERY_CONCURRENCY,
  );
}
