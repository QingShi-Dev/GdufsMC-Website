"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { IconHammer } from "@tabler/icons-react";
import { Suspense } from "react";
import { cn } from "@/lib/utils";
import { GuideMap } from "@/components/guide-map";

type MapView = "block" | "tour";

interface TabDef {
  id: MapView;
  label: string;
  iconSrc: string;
  desc: string;
  disabled?: boolean;
  badge?: { text: string; icon: typeof IconHammer };
}

const TABS: TabDef[] = [
  {
    id: "tour",
    label: "导览地图",
    iconSrc: "/icons/map/导览地图图标.svg",
    desc: "展示三种维度建设全貌，每一栋建筑与机器尽在眼前",
  },
  {
    id: "block",
    label: "群系地图",
    iconSrc: "/icons/map/群系地图图标.svg",
    desc: "准确率超高的群系和结构搜素，自由探索每一寸世界",
    disabled: true,
    badge: { text: "开发中", icon: IconHammer },
  },
];

function parseView(raw: string | null): MapView {
  return raw === "block" ? "block" : "tour";
}

export default function MapPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = parseView(searchParams.get("view"));

  const switchTo = (next: MapView) => {
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
    <div className="pt-28 sm:pt-32 pb-12 sm:pb-16 px-4 sm:px-6 lg:px-8 relative overflow-hidden">

      {/* 顶部: 地图类型选择器 (inline, 之前是 MapViewTabs 独立组件) */}
      <section className="relative max-w-7xl mx-auto mb-6 sm:mb-8">
        <div
          role="tablist"
          aria-label="地图类型切换"
          className="grid grid-cols-1 sm:grid-cols-2 gap-3"
        >
          {TABS.map((t) => {
            const active = view === t.id;
            const disabled = !!t.disabled;
            const showBadge = disabled && !!t.badge;
            const BadgeIcon = showBadge ? t.badge!.icon : null;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                disabled={disabled}
                onClick={() => switchTo(t.id)}
                title={
                  disabled
                    ? `${t.label} — ${t.badge?.text ?? "暂不可用"}`
                    : t.desc
                }
                className={cn(
                  "text-left rounded-2xl border p-4 sm:p-5 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60",
                  active
                    ? "bg-white border-sky-200/80 shadow-md shadow-sky-500/10"
                    : "bg-white/55 border-white/60 hover:bg-white/85 hover:border-slate-200/70",
                  disabled &&
                    "opacity-60 cursor-not-allowed hover:bg-white/55 hover:border-white/60",
                )}
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className={cn(
                      "inline-flex items-center justify-center w-8 h-8 rounded-lg overflow-hidden",
                      active
                        ? "bg-sky-100"
                        : disabled
                          ? "bg-slate-100/60"
                          : "bg-slate-100/80",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={t.iconSrc}
                      alt=""
                      aria-hidden="true"
                      className={cn(
                        "w-6 h-6 object-contain",
                        disabled && "grayscale",
                      )}
                    />
                  </span>
                  <span
                    className={cn(
                      "text-base sm:text-lg font-bold tracking-tight",
                      active
                        ? "text-slate-900"
                        : disabled
                          ? "text-slate-500"
                          : "text-slate-700",
                    )}
                  >
                    {t.label}
                  </span>
                  {active && (
                    <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-sky-700 bg-sky-50 border border-sky-100 px-2 py-0.5 rounded-full">
                      当前
                    </span>
                  )}
                  {showBadge && BadgeIcon && (
                    <span
                      className={cn(
                        "ml-auto inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full",
                        "text-amber-800 bg-amber-50 border border-amber-200/80",
                      )}
                    >
                      <BadgeIcon className="w-3 h-3" />
                      {t.badge!.text}
                    </span>
                  )}
                </div>
                <p
                  className={cn(
                    "mt-1.5 text-xs sm:text-sm leading-relaxed",
                    active
                      ? "text-slate-600"
                      : disabled
                        ? "text-slate-400"
                        : "text-slate-500",
                  )}
                >
                  {t.desc}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      {/* 主体: 选中的地图 */}
      <section className="relative max-w-7xl mx-auto md:mb-4">
        {view === "tour" ? (
          <Suspense fallback={<div className="h-[400px]" />}>
            <GuideMap />
          </Suspense>
        ) : (
          <Suspense fallback={<div className="h-[400px]" />}>
          </Suspense>
        )}
      </section>
    </div>
  );
}
