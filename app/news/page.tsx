import { getLatestNews, getNewsList } from "@/lib/news";
import { NewsHeroCarousel } from "./news-hero-carousel";
import { NewsList } from "./news-list";

/**
 * News 主页 — 顶部轮播图 + 下面列表
 * 布局:
 *   - hero: 5 张精选 news 大图轮播 (1 大 + 4 dot)
 *   - list: 全部 news 卡片, 最新在前
 *
 * 数据走 lib/news 抽象层, 后期接后台 0 改动
 */
export default async function NewsPage() {
  // server component 调抽象层, 后期换 fetch 不动这里
  const [carousel, list] = await Promise.all([getLatestNews(5), getNewsList()]);

  return (
    <div className="pt-24 pb-20 my-5 relative overflow-hidden">

      <div className="mx-auto max-w-6xl px-4 relative">

        {/* 顶部轮播图 — 5 张精选, 大图 + dot 指示器 */}
        <div className="mt-8">
          <NewsHeroCarousel items={carousel} />
        </div>

        {/* 全部 news 列表 */}
        <div className="mt-16">
          <div className="flex items-center gap-2 text-sm text-slate-600 mb-5">
            <span className="font-semibold text-slate-800">全部动态</span>
            <span className="text-slate-300">·</span>
            <span className="text-slate-500 text-xs">共 {list.length} 条</span>
          </div>
          <NewsList items={list} />
        </div>
      </div>
    </div>
  );
}
