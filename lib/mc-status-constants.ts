/**
 * 客户端和服务端共享的常量与类型。
 *
 * 为什么独立成文件：
 * lib/mc-status.ts 会 import node:net（通过 mc-ping），
 * 如果客户端组件从 mc-status.ts 取常量，Turbopack 会把 node:net 拉进 client bundle 然后报错。
 * 把"无副作用、纯数据"的部分抽到这里，client 可以直接 import，server 端再 re-export。
 *
 * 文件内**禁止**引入任何 node:* / fs / child_process 等 server-only 模块。
 */

export type ServerGroup = "survival" | "create" | "bmc" | "hemc";

/**
 * 前端消费的状态形状。
 * 服务端 lib/mc-status.ts 里同名接口是它的"权威定义"，这里再 re-declare 一遍
 * 是为了让客户端组件可以纯类型引用，不被强制拉进 server-only 模块的 import 链。
 *
 * 如果改了 mc-status.ts 里的 ServerStatus，必须同步这里（单一数据源是前者）。
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

/** MC 默认端口（之前是裸 25565，散在多处；改这里一处即可） */
export const DEFAULT_MC_PORT = 25565;

/** 单台服务器 ping 超时（ms），也是 API route 上限的关键参数 */
export const PING_TIMEOUT_MS = 2000;

/** queryAllServers 并发上限（保护本机 ephemeral port 和远端 RST 风暴） */
export const QUERY_CONCURRENCY = 6;

/**
 * 单个分组的 UI 元数据（label + 图标 + 业务策略）。
 * 之前在 component 里 hardcode，改组名要改两个文件——挪到这里做单一来源。
 */
export interface GroupMeta {
  label: string;
  svg: string;
  /** 是否需要 MUA 联合群组验证（除 BMC 外都需） */
  needMUA: boolean;
}

export const GROUP_META: Record<ServerGroup, GroupMeta> = {
  survival: { label: "纯净生存 · 原版 1.21.8", svg: "/icons/home/生存服图标.svg", needMUA: true },
  create: { label: "创造 · 机械动力航空学 · 1.21.1-NeoForge", svg: "/icons/home//航空学图标.svg", needMUA: true },
  bmc: { label: "整合包生存 · BetterMC5", svg: "/icons/home//整合包图标.svg", needMUA: false },
  hemc: { label: "粤高联 · 联合服务器", svg: "/icons/home//粤高联图标.svg", needMUA: true },
};
