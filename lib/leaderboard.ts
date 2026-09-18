/**
 * News 抽象层入口 — 真正的实现在 ./leaderboard/index.ts
 *
 * 为什么有这个文件:
 * - Next.js + TS bundler 模式下, "./leaderboard" 解析为 "./leaderboard.ts" 优先于 "./leaderboard/index.ts"
 * - 所有调用方都用 `@/lib/leaderboard` 导入, 必须有一个 .ts 才能解析成功
 *
 * 修改规则:
 * - 不要在这个文件里写实现
 * - 抽象层改动都去 ./leaderboard/index.ts
 */

export { getLeaderboard } from "./leaderboard/index";
export type { LeaderboardData, LeaderboardEntry, RankChange } from "./leaderboard/types";