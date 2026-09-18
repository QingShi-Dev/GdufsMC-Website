/**
 * 小游戏积分榜卡片 — 放在新闻列表右侧
 *
 * 设计:
 * - sticky top-24 让榜单跟随滚动, 看长新闻时也能看到
 * - 前 3 名高亮 (背景色 + 奖牌 emoji)
 * - 涨/跌/平 用不同颜色 + 箭头图标
 * - "查看完整榜单" 链接预留 (后端接入后接 to)
 *
 * 数据:
 * - 接收 LeaderboardData, 默认从 @/data/leaderboard 导入
 * - 调用方也可以传别的 data (例如未来多榜单切换)
 */

import { IconArrowUpRight, IconArrowDownRight, IconMinus } from "@tabler/icons-react";
import type { LeaderboardData } from "@/lib/leaderboard/types";

const RANK_STYLE: Record<number, string> = {
  1: "bg-amber-50 border-amber-200/80",
  2: "bg-slate-50 border-slate-200/80",
  3: "bg-orange-50/60 border-orange-200/60",
};

const RANK_BADGE: Record<number, { filename: string; alt: string }> = {
  1: { filename: "金牌图标.svg", alt: "金牌" },
  2: { filename: "银牌图标.svg", alt: "银牌" },
  3: { filename: "铜牌图标.svg", alt: "铜牌" },
};

function ChangeIndicator({ change }: { change: "up" | "down" | "same" }) {
  if (change === "up") {
    return <IconArrowUpRight className="w-4.5 h-4.5 text-rose-500" aria-label="上升" />;
  }
  if (change === "down") {
    return <IconArrowDownRight className="w-4.5 h-4.5 text-emerald-600" aria-label="下降" />;
  }
  return <IconMinus className="w-4.5 h-4.5 text-slate-400" aria-label="持平" />;
}

export function Leaderboard({ data }: { data?: LeaderboardData }) {
  // 实际数据从默认导入拿 (这样调用方不传也能跑)
  // 这里 data? 表示可选 — 默认值在调用方决定, 组件只负责渲染
  if (!data || data.entries.length === 0) return null;

  return (
    <aside
      className="lg:sticky lg:top-24 self-start"
      aria-label={data.title}
    >
      <div className="rounded-2xl bg-white border border-slate-200/80 shadow-sm shadow-slate-900/[0.04] overflow-hidden">
        {/* 头部 */}
        <div className="p-4 sm:p-5 pb-3 sm:pb-3.5 border-b border-slate-100">
          <h3 className="text-[17px] font-bold text-slate-900">{data.title}</h3>
          <p className="text-[12px] text-slate-500 mt-1">{data.subtitle}</p>
        </div>

        {/* 列表 */}
        <ol className="divide-y divide-slate-100">
          {data.entries.slice(0, 8).map((entry) => {
            const isTop3 = entry.rank <= 3;
            return (
              <li
                key={`${entry.rank}-${entry.player}`}
                className={
                  isTop3
                    ? `flex items-center gap-3.5 px-4.5 sm:px-5 py-3 sm:py-3.5 border-l-2 ${RANK_STYLE[entry.rank] ?? ""}`
                    : "flex items-center gap-3.5 px-4.5 sm:px-5 py-3 sm:py-3.5 border-l-2 border-transparent"
                }
              >
                {/* 名次 */}
                <span
                  className={
                    isTop3
                      ? "w-8 flex items-center justify-center shrink-0"
                      : "w-8 text-center text-[17px] font-mono tabular-nums text-slate-500 shrink-0"
                  }
                  aria-label={`第 ${entry.rank} 名`}
                >
                  {(() => {
                    const badge = RANK_BADGE[entry.rank];
                    return badge ? (
                      // eslint-disable-next-line @next/next/no-img-element -- 本地图标
                      <img
                        src={`/icons/news/${encodeURIComponent(badge.filename)}`}
                        alt={badge.alt}
                        className="w-8 h-8 object-contain"
                      />
                    ) : (
                      entry.rank
                    );
                  })()}
                </span>

                {/* 玩家 + 分数 */}
                <div className="flex-1 min-w-0">
                  <div className="text-[17px] font-semibold text-slate-800 truncate">
                    {entry.player}
                  </div>
                  <div className="flex text-center text-[13px] text-slate-700 font-mono tabular-nums">
                    {entry.score.toLocaleString()} 胜
                  </div>
                </div>

                {/* 变化 */}
                <ChangeIndicator change={entry.change} />
              </li>
            );
          })}
        </ol>
      </div>
    </aside>
  );
}