/**
 * 小游戏积分榜 — 客户端可见的类型
 *
 * 为什么单独拆出来:
 * - lib/leaderboard/index.ts 是 server-only, 含 gray-matter / node:fs
 * - 客户端组件 (NewsList / Leaderboard) 要用 LeaderboardEntry 类型
 * - 不能从 server-only 文件 import 类型, 否则触发 server-only 报错
 */

export type RankChange = "up" | "down" | "same";

export interface LeaderboardEntry {
  /** 1-based 名次, 前 3 名高亮 (🥇🥈🥉) */
  rank: number;
  /** MC 用户名 */
  player: string;
  /** 积分 (number, 越大越好) */
  score: number;
  /** 相对昨日变化 */
  change: RankChange;
}

export interface LeaderboardData {
  /** 卡片头部标题 */
  title: string;
  /** 副标题 (例如"更新于 2026-09-18 06:00") */
  subtitle: string;
  /** 榜单条目, 已按 rank 升序 */
  entries: LeaderboardEntry[];
}