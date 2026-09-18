/**
 * 小游戏积分榜数据访问层 — server-only
 *
 * 抽象层:
 * - getLeaderboard() 接口稳定
 * - 内部实现: 当前读 content/leaderboard/index.yml
 * - 后期换真实数据源 (fetch / 定时同步) 只改这一个文件
 *
 * 设计:
 * - 解析器用 js-yaml 而不是 gray-matter: leaderboard 是纯 YAML,
 *   灰 matter 会强制要求 --- 包裹 frontmatter, 但 Sveltia CMS 编辑
 *   files collection 时不会自动写 ---, 会让用户每次都要手动加
 * - js-yaml 直接 parse 整个文件, 容忍 --- 包裹也容忍没有, 一致行为
 * - 缓存: React cache() 包, 同一请求只读一次
 *
 * 客户端可见的类型见 ./types.ts
 */

import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { load as yamlLoad } from "js-yaml";
import { cache } from "react";
import type { LeaderboardData, LeaderboardEntry } from "./types";

// 重新导出类型, 让 `@/lib/leaderboard` 仍然是完整入口
export type { LeaderboardData, LeaderboardEntry, RankChange } from "./types";

const DATA_PATH = join(process.cwd(), "content", "leaderboard", "index.yml");

const DEFAULT_DATA: LeaderboardData = {
  title: "🏆 小游戏积分榜",
  subtitle: "数据加载中",
  entries: [],
};

/**
 * 读取 content/leaderboard/index.yml, 解析成结构化数据
 *
 * 错误处理:
 * - 文件不存在 → 返回默认空数据 (开发初次迁移 / 还没创建数据)
 * - 解析失败 (YAML 语法错误) → 返回默认空数据 + console.warn, 不让页面挂
 * - 必填字段缺失 → 自动填充默认值, 保证组件不会因为缺字段崩
 */
export const getLeaderboard = cache(async (): Promise<LeaderboardData> => {
  try {
    const raw = await readFile(DATA_PATH, "utf-8");
    const parsed = yamlLoad(raw);

    // 顶层必须是 object
    if (typeof parsed !== "object" || parsed === null) {
      console.warn("[leaderboard] 顶层不是 object");
      return DEFAULT_DATA;
    }
    const data = parsed as Record<string, unknown>;

    // 字段安全: 任何字段缺失都给个 fallback
    const title = typeof data.title === "string" ? data.title : DEFAULT_DATA.title;
    const subtitle =
      typeof data.subtitle === "string" ? data.subtitle : DEFAULT_DATA.subtitle;

    // entries 是数组, 每项基本字段要有
    const rawEntries = Array.isArray(data.entries) ? data.entries : [];
    const entries = rawEntries
      .map((e: unknown, i: number) => normalizeEntry(e, i))
      .filter((x): x is LeaderboardEntry => x !== null)
      // 按 rank 升序
      .sort((a, b) => a.rank - b.rank);

    return { title, subtitle, entries };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return DEFAULT_DATA;
    }
    console.warn("[leaderboard] 读取失败:", err);
    return DEFAULT_DATA;
  }
});

function normalizeEntry(e: unknown, index: number): LeaderboardEntry | null {
  if (typeof e !== "object" || e === null) return null;
  const obj = e as Record<string, unknown>;
  const rank = Number(obj.rank);
  const player = typeof obj.player === "string" ? obj.player.trim() : "";
  const score = Number(obj.score);
  const change =
    obj.change === "up" || obj.change === "down" || obj.change === "same"
      ? obj.change
      : "same";
  if (!player) return null;
  return {
    rank: Number.isFinite(rank) && rank > 0 ? rank : index + 1,
    score: Number.isFinite(score) ? score : 0,
    player,
    change,
  };
}