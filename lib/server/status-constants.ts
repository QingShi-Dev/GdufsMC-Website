/**
 * 客户端和服务端共享的常量与类型。
 *
 * 为什么独立成文件：
 * lib/server/status.ts 会 import node:net（通过 ./ping），
 * 如果客户端组件从 status.ts 取常量，Turbopack 会把 node:net 拉进 client bundle 然后报错。
 * 把"无副作用、纯数据"的部分抽到这里，client 可以直接 import，server 端再 re-export。
 *
 * 文件内**禁止**引入任何 node:* / fs / child_process 等 server-only 模块。
 *
 * 服务器列表 / group meta 的真实数据源在 @/data/global/servers,
 * 这里只 re-export + 加少量 server-only 常量。
 */

import {
  GROUP_META,
  GROUP_ORDER,
} from "@/data/global/servers";
import type { ServerGroup, ServerEntry, GroupMeta } from "@/data/global/servers";

export { GROUP_META, GROUP_ORDER };
export type { ServerGroup, ServerEntry, GroupMeta };

/** MC 默认端口（之前是裸 25565，散在多处；改这里一处即可） */
export const DEFAULT_MC_PORT = 25565;

/** 单台服务器 ping 超时（ms），也是 API route 上限的关键参数 */
export const PING_TIMEOUT_MS = 2000;

/** queryAllServers 并发上限（保护本机 ephemeral port 和远端 RST 风暴） */
export const QUERY_CONCURRENCY = 6;

/**
 * 前端消费的状态形状。
 * 服务端 lib/server/status.ts 里同名接口是它的"权威定义"，这里再 re-declare 一遍
 * 是为了让客户端组件可以纯类型引用，不被强制拉进 server-only 模块的 import 链。
 *
 * 如果改了 status.ts 里的 ServerStatus，必须同步这里（单一数据源是前者）。
 */
export interface ServerStatus {
  key: string;
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