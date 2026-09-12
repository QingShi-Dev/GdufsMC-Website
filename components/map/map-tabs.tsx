"use client";

/**
 * 地图类型切换 Tabs (复用于 /map 和 /new-guide-map)
 *
 * - 数据: 导览地图 (tour) + 群系地图 (block, 外部链接新标签页打开)
 * - 群系地图 tab 标题右侧带一段网址文字 (域名 + 短路径), 完整 URL 放 title tooltip
 * - 行为跟 /map 页完全一致 (URL 状态走 ?view=, 外部链接 window.open)
 *
 * 客户端组件: useRouter/useSearchParams 需要客户端渲染, 外层包 Suspense 兼容 SSG
 */

import { IconExternalLink } from "@tabler/icons-react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { cn } from "@/lib/utils";

type MapView = "block" | "tour";

/**
 * 群系地图 — 跳转到 minecraftsearch.com 的种子地图工具
 *  URL hash 携带种子号 / 平台 / 维度 / 中心坐标 / 缩放, 直接定位到目标区域
 *  新标签页打开 (noopener noreferrer 安全)
 */
const BIOME_MAP_URL =
  "https://minecraftsearch.com/zh-CN/%E5%B7%A5%E5%85%B7/%E7%A7%8D%E5%AD%90%E5%9C%B0%E5%9B%BE#seed=-5605024159182309615&platform=java_26.2&dimension=overworld&x=0&z=0&zoom=15";

/** Tab 标题旁显示的短 URL (只展示域名 + 路径, 完整 URL 放 title 属性) */
const BIOME_MAP_SHORT_URL = "由 minecraftsearch.com 提供";

interface TabDef {
  id: MapView;
  label: string;
  iconSrc: string;
  desc: string;
  /**
   * 设为 true 时, 点击不切 view, 而是新标签页打开 externalUrl
   *  (群系地图是外部工具, 本地没有对应视图)
   */
  external?: { url: string };
}

const TABS: TabDef[] = [
  {
    id: "tour",
    label: "导览地图",
    iconSrc: "/icons/map/导览地图图标.svg",
    desc: "展示三种维度的建设全貌，每一栋建筑尽在眼前",
  },
  {
    id: "block",
    label: "群系地图",
    iconSrc: "/icons/map/群系地图图标.svg",
    desc: "高效探查生物群系与结构，每一寸世界尽在掌握",
    external: { url: BIOME_MAP_URL },
  },
];

function parseView(raw: string | null): MapView {
  return raw === "block" ? "block" : "tour";
}

export function MapTabs() {
  // useSearchParams() 在 client component 里必须包 Suspense 才能正常 SSG
  return (
    <Suspense fallback={<div className="h-[80px]" />}>
      <MapViewTabsContent />
    </Suspense>
  );
}

function MapViewTabsContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = parseView(searchParams.get("view"));

  const switchTo = (next: MapView) => {
    // 外部链接: 新标签页打开, 不动本地 view
    const external = TABS.find((t) => t.id === next)?.external;
    if (external) {
      window.open(external.url, "_blank", "noopener,noreferrer");
      return;
    }
    if (next === view) return;
    const params = new URLSearchParams(searchParams.toString());
    if (next === "tour") {
      // tour 是 default, 不写到 URL
      params.delete("view");
    } else {
      params.set("view", next);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <section className="relative mb-4 sm:mb-8">
      <div
        role="tablist"
        aria-label="地图类型切换"
        className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 w-full"
      >
        {TABS.map((t) => {
          const active = view === t.id;
          const isExternal = !!t.external;
          return (
            <a
              key={t.id}
              aria-selected={active}
              onClick={() => switchTo(t.id)}
              className={cn(
                  "group text-left rounded-2xl border p-3 sm:px-7.5 sm:py-5.5",
                  "bg-white/70 backdrop-blur-sm border-slate-200/70 hover:border-blue-300/90 hover:shadow-lg hover:shadow-blue-500/10 hover:-translate-y-0.5 transition-all",
                active
                  ? "border-blue-300/90 cursor-default"
                  : "border-slate-200/70 cursor-pointer",
              )}
            >
              <div className="relative flex w-full items-center gap-4.5">
                <span
                    className={cn(
                        "inline-flex items-center justify-center w-8 h-8 rounded-lg overflow-hidden flex-shrink-0 transition-colors",
                        active ? "bg-blue-100" : "bg-slate-100 group-hover:bg-blue-100",
                    )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                      src={t.iconSrc}
                      alt=""
                      aria-hidden="true"
                      className="w-6 h-6 object-contain"
                  />
                </span>
                <div className="w-full">
                  <div className="flex items-center gap-2.5 min-w-0">
                <span
                    className={cn(
                        "text-[17px] font-bold tracking-tight flex-shrink-0",
                        active ? "text-slate-900" : "text-slate-700 group-hover:text-blue-500",
                    )}
                >
                  {t.label}
                </span>
                    {/* 群系地图 tab: 标题右边放网址文字 (短版, 完整 URL 走 title tooltip) */}
                    {t.id === "block" && (
                        <span
                            className="hidden sm:inline text-[14px] text-slate-500/80 font-mono truncate min-w-0 flex-1 ml-1"
                        >
                          {BIOME_MAP_SHORT_URL}
                        </span>
                    )}
                    {active && (
                        <span className="ml-auto flex-shrink-0 text-[14px] font-semibold uppercase tracking-wider text-blue-600/90 bg-blue-50 border border-blue-100 px-3 py-0.5 rounded-full">
                          当前
                        </span>
                    )}
                    {isExternal && (
                        <span
                            className={cn(
                                "ml-auto flex-shrink-0 inline-flex items-center gap-1 text-[14px] font-semibold px-3 py-0.5 rounded-full",
                                "text-slate-600 bg-slate-100 border border-slate-200/80 group-hover:text-blue-500",
                            )}
                        >
                        <IconExternalLink className="w-4 h-4" />
                        外链
                      </span>
                    )}
                  </div>
                  <p
                      className={cn(
                          "hidden sm:flex text-[15px] leading-relaxed",
                          active ? "text-slate-600" : "text-slate-500",
                      )}
                  >
                    {t.desc}
                  </p>
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
}

export default MapTabs;
