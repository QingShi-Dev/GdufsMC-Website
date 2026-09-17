/**
 * 小游戏积分榜 — mock 数据
 *
 * 数据来源待定 (方案 B/C 之后再接实时数据), 现阶段用静态数据 demo
 *
 * 字段:
 * - rank: 1-based 名次, 前 3 名高亮 (🥇🥈🥉)
 * - player: 玩家名 (MC 用户名)
 * - score: 积分 (number, 越大越好)
 * - change: 相对昨日变化, ↑N / ↓N / — (持平)
 */

export interface LeaderboardEntry {
  rank: number;
  player: string;
  score: number;
  /** "↑ 3" / "↓ 1" / "—" */
  change: "up" | "down" | "same";
}

export interface LeaderboardData {
  /** 榜单标题, 用于卡片头部 */
  title: string;
  /** 副标题, 例如 "更新于 2026-09-18 06:00" */
  subtitle: string;
  /** 榜单条目, 已按 rank 升序 */
  entries: LeaderboardEntry[];
}

export const LEADERBOARD: LeaderboardData = {
  title: "🏆 周末小游戏积分榜",
  subtitle: "示例数据 · 接入后端后会替换为实时榜单",
  entries: [
    { rank: 1, player: "Steve_MC", score: 2840, change: "up" },
    { rank: 2, player: "Alex_awa", score: 2655, change: "down" },
    { rank: 3, player: "NotchFan", score: 2480, change: "same" },
    { rank: 4, player: "Pixel_兔兔", score: 2210, change: "up" },
    { rank: 5, player: "红石工程师", score: 1980, change: "down" },
    { rank: 6, player: "末影龙杀手", score: 1750, change: "up" },
    { rank: 7, player: "Creeper_gg", score: 1620, change: "same" },
    { rank: 8, player: "下界之星", score: 1490, change: "down" },
  ],
};