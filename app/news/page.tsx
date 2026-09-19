import { getLatestNews, getNewsList } from "@/lib/news";
import { getLeaderboard } from "@/lib/leaderboard";
import { HeroCarousel } from "@/components/news/hero-carousel";
import { NewsList } from "@/components/news/list";
import { Leaderboard } from "@/components/news/leaderboard";

/**
 * News 主页 — 顶部轮播图 + 下面 (列表 + 右侧榜单)
 * 布局:
 *   - hero: 5 张精选 news 大图轮播 (1 大 + 4 dot)
 *   - 下方: flex/grid 二栏
 *     - 主栏 (flex-1): NewsList — 最新 1 条 featured + 后续 3 列 grid
 *     - 侧栏 (lg:w-72): 小游戏积分榜 (sticky 跟随滚动)
 *
 * 数据走 lib/news + lib/leaderboard 抽象层, 后期换后台 0 改动
 */
export default async function NewsPage() {
  // server component 调抽象层, 后期换 fetch 不动这里
  const [carousel, list, leaderboard] = await Promise.all([
    getLatestNews(5),
    getNewsList(),
    getLeaderboard(),
  ]);

  return (
    <div className="pt-16 sm:pt-18 pb-12 sm:pb-20 mt-5 sm:my-5 relative overflow-hidden cursor-default">

      <div className="mx-auto max-w-6xl px-4 relative">

        {/* 顶部轮播图 — 5 张精选, 大图 + dot 指示器 */}
        <div className="mt-8 px-0.5 sm:px-0">
          <HeroCarousel items={carousel} />
        </div>

        {/* 下半部分: 主栏 (动态列表) + 侧栏 (积分榜) */}
        <div className="mt-11 flex flex-col lg:flex-row gap-8">
          <div className="sm:hidden lg:w-72 lg:shrink-0 px-1 sm:px-0">
            <Leaderboard data={leaderboard} />
          </div>
          {/* 主栏: 全部动态 */}
          <div className="flex-1 min-w-0 px-2 sm:px-0">
            <div className="flex items-center gap-1.5 text-sm text-slate-600 mb-5">
              <span className="text-[19px] font-semibold text-slate-800">全部动态</span>
              <span className="text-[17px] text-slate-500 ml-1.5">共 {list.length} 条</span>
            </div>
            <NewsList items={list} />
          </div>

          {/* 侧栏: 小游戏积分榜 (lg 以上显示, sticky 跟随滚动) */}
          <div className="hidden sm:block lg:w-72 lg:shrink-0">
            <Leaderboard data={leaderboard} />
          </div>
        </div>
      </div>
    </div>
  );
}