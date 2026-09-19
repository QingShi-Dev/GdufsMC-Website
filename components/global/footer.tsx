"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

/* -------------------- 石头分隔条（保持之前样式） -------------------- */

function StoneDivider() {
  return (
      <div
          aria-hidden="true"
          className="relative h-4 overflow-hidden"
          style={{
            background:
                "linear-gradient(180deg, #BDBDBD 0%, #9E9E9E 60%, #757575 100%)",
            boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.4), 0 2px 4px -2px rgba(0,0,0,0.15)",
          }}
      >
        <svg
            className="absolute inset-0 w-full h-full"
            preserveAspectRatio="none"
            viewBox="0 0 1200 16"
        >
          <defs>
            <pattern
                id="stoneDots"
                x="0"
                y="0"
                width="20"
                height="16"
                patternUnits="userSpaceOnUse"
            >
              <rect x="3" y="3" width="2" height="2" fill="#D5D5D5" opacity="0.75" />
              <rect x="10" y="6" width="2" height="2" fill="#9E9E9E" opacity="0.65" />
              <rect x="15" y="11" width="2" height="2" fill="#616161" opacity="0.6" />
              <rect x="6" y="12" width="1" height="1" fill="#757575" opacity="0.55" />
            </pattern>
          </defs>
          <rect x="0" y="0" width="1200" height="16" fill="url(#stoneDots)" />
          <rect x="0" y="0" width="1200" height="0.5" fill="#EEEEEE" opacity="0.7" />
          <rect x="0" y="15.5" width="1200" height="0.5" fill="#424242" opacity="0.5" />
        </svg>
      </div>
  );
}

/* -------------------- 类别标题（深灰，保持样式） -------------------- */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
      <h4
          className={cn(
              "text-[15px] sm:text-[16px] font-semibold uppercase tracking-[0.12em] mb-4",
              "text-slate-700",
          )}
      >
        {children}
      </h4>
  );
}

/* -------------------- 联系方式按钮 --------------------
 *
 * 双模式自适应:
 * - 桌面端 (md+): hover icon → 浮窗显示 (CSS only, 鼠标移走就关)
 * - 移动端 (<md): click icon → 弹 modal (触屏没 hover)
 *
 */

type QrType = "wechat" | "qq" | null;

const QR_CONFIG: Record<
  Exclude<QrType, null>,
  { title: string; subtitle: string; qrSrc: string; icon: string }
> = {
  wechat: {
    title: "微信",
    subtitle: "扫码加好友 / 加群",
    qrSrc: "/images/contact/微信联系方式.webp",
    icon: "/icons/global/微信图标.svg",
  },
  qq: {
    title: "QQ 群",
    subtitle: "扫码加入玩家群",
    qrSrc: "/images/contact/QQ联系方式.webp",
    icon: "/icons/global/QQ图标.svg",
  },
};

/** 二维码卡片 (桌面浮窗 + 移动 modal 共用) */
function QRCard({ type }: { type: Exclude<QrType, null> }) {
  const cfg = QR_CONFIG[type];
  return (
      <div>
        <div className="flex items-center gap-2 mb-1 justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cfg.icon} alt="" className="w-5 h-5" />
          <h3 className="text-[16px] font-bold text-slate-800">{cfg.title}</h3>
        </div>
        <p className="text-[12px] text-slate-500 mb-2 text-center">{cfg.subtitle}</p>
        <div className="bg-slate-50 rounded-lg p-2 flex items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
              src={cfg.qrSrc}
              alt={`${cfg.title}二维码`}
              className="w-full max-w-[200px] h-auto"
          />
        </div>
        <p className="md:hidden text-[12px] text-slate-400 mt-2 text-center">长按或截图后扫描</p>
      </div>
  );
}

/** 按钮: 桌面端 hover 浮窗 (纯 CSS), 移动端 click 弹 modal */
function ContactQRButton({
                            type,
                            onClick,
                          }: {
  type: Exclude<QrType, null>;
  onClick: () => void;
}) {
  const cfg = QR_CONFIG[type];
  return (
      <div className="relative group">
        <button
            type="button"
            onClick={onClick}
            aria-label={cfg.title}
            className={cn(
                "w-9 h-9 rounded-lg flex items-center justify-center",
                "bg-white/70 border border-slate-200/70",
                "hover:border-slate-300 hover:bg-white",
                "transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/50",
            )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cfg.icon} alt="" className="w-6 h-6 object-contain" />
          <span className="sr-only">{cfg.title}</span>
        </button>

        {/* 桌面端 hover 浮窗 (md+ 可见, 鼠标悬停才显示) */}
        <div
            className={cn(
                "hidden md:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-30",
                "transition-opacity duration-150",
                // hover 才显示
                "opacity-0 invisible group-hover:opacity-100 group-hover:visible",
                // 浮窗本身不抢 click
                "pointer-events-none",
            )}
        >
          <div className="bg-white rounded-xl p-3 shadow-xl border border-slate-200/60 w-56">
            <QRCard type={type} />
          </div>
        </div>
      </div>
  );
}

function QRModal({
                   type,
                   onClose,
                 }: {
  type: Exclude<QrType, null>;
  onClose: () => void;
}) {
  // ESC 键关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 锁定 body 滚动
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
      <div
          role="dialog"
          aria-modal="true"
          aria-label={`${QR_CONFIG[type].title}二维码`}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-500/50 backdrop-blur-sm"
          onClick={onClose}
      >
        <div
            className="relative bg-white rounded-2xl p-6 sm:p-8 max-w-sm w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}
        >
          <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <IconX className="w-5 h-5" />
          </button>
          <QRCard type={type} />
        </div>
      </div>
  );
}

function ContactSection() {
  // modal 状态 + 打开时的 pathname 一起存, 渲染时校验 pathname 是否还匹配
  //   - pathname 不匹配 → modal 不渲染 (切到其它页, modal 跟随关闭)
  //   - 不需要 useEffect 关闭 — pathname 变化 → render 时 modalState.pathname !== pathname → 不渲染
  //   - 避免 react-hooks/set-state-in-effect 规则 (route change 是 render 时判断, 不是 effect)
  //   - 用户最新要求: 切换页面时 footer 联系方式要关闭
  const [modalState, setModalState] = useState<
    { type: Exclude<QrType, null>; pathname: string } | null
  >(null);
  const pathname = usePathname();

  const closeMobileModal = useCallback(() => setModalState(null), []);

  const handleClick = (type: Exclude<QrType, null>) => {
    // 实时读 viewport: 移动端弹 modal, 桌面端 click 是 noop (hover 已控显隐)
    if (typeof window !== "undefined" && !window.matchMedia("(min-width: 768px)").matches) {
      // 记下当前 pathname, render 时用它判定 "是否还同一页"
      setModalState({ type, pathname });
    }
  };

  // modal 仅在 pathname 跟打开时一致时渲染 — 切页后 pathname 变化, modal 跟随关闭
  const activeModal = modalState && modalState.pathname === pathname ? modalState.type : null;

  return (
      <div className="flex items-center gap-2.5">
        <ContactQRButton type="wechat" onClick={() => handleClick("wechat")} />
        <ContactQRButton type="qq" onClick={() => handleClick("qq")} />
        {activeModal && <QRModal type={activeModal} onClose={closeMobileModal} />}
      </div>
  );
}

/* -------------------- 快速导航（保持样式） -------------------- */

const NAV_ITEMS = [
  { href: "/", label: "首页" },
  { href: "/map", label: "地图总览" },
  { href: "/news", label: "新闻动态" },
  { href: "/guide", label: "游玩指南" },
];

function QuickNav() {
  return (
      <div>
        <SectionTitle>快速导航</SectionTitle>
        <nav
            aria-label="页脚导航"
            className="flex flex-col gap-2.5 text-sm"
        >
          {NAV_ITEMS.map((item) => (
              <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                      "text-slate-600 hover:text-slate-900 transition-colors w-fit text-[15px] sm:text-[15px]",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/50 focus-visible:rounded",
                  )}
              >
                {item.label}
              </Link>
          ))}
        </nav>
      </div>
  );
}

/* -------------------- Logo + 简介（保持之前样式） -------------------- */

function LogoIntro() {
  return (
      <div>
        <Link href="/" className="inline-flex items-center gap-3 group">
          <div
              className={cn(
                  "w-11 h-11 rounded-xl p-1 flex items-center justify-center",
                  "bg-white/70 backdrop-blur-sm border border-slate-200/70 group-hover:border-emerald-300/90",
                  "group-hover:-translate-y-0.5 group-hover:shadow-lg group-hover:shadow-emerald-500/15",
                  "transition-all duration-200",
              )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- 本地小标识图，无需 next/image 优化 */}
            <img src="/icons/global/组织标识.jpg" className="w-full h-full object-fill rounded-xl" alt=""/>
          </div>
          <div>
            <div className="font-bold text-slate-700 text-[16px] sm:text-[18px] leading-tight group-hover:text-emerald-500 transition-colors">
              云城像素社
            </div>
            <div className="text-[10px] sm:text-[11px] text-slate-500 uppercase tracking-[0.2em] font-semibold mt-0.5 ml-0.5">
              GDUFS·MC
            </div>
          </div>
        </Link>
        <p className="text-[14px] sm:text-[16px] text-slate-600 max-w-sm leading-relaxed mt-3">
          广外人的 Minecraft 服务器。一砖一瓦，都是回忆。
        </p>
      </div>
  );
}

/* -------------------- 服务器地址 --------------------
 * 合并规则：纯生存 + 机械动力并到同一条线路（每个分组最多 2 个 host）
 * 删除：整合包 (bmc) 和 hemc 复原项目
 * 剩余 4 个分组：校园网 / 公网主线 / 公网备线 / 粤高联
 */

interface ServerEntry {
  host: string;
  version: string;
}

interface ServerGroup {
  line: string;
  bandwidth?: string;
  recommended?: boolean;
  servers: ServerEntry[];
}

const SERVER_GROUPS: ServerGroup[] = [
  {
    line: "校园网",
    bandwidth: "无限带宽",
    recommended: true,
    servers: [
      { host: "mc.gdufscraft.top", version: "26.2 原版" },
    ],
  },
  {
    line: "公网主线",
    bandwidth: "24M",
    recommended: true,
    servers: [
      { host: "mc2.gdufscraft.top", version: "26.2 原版" },
    ],
  },
  {
    line: "公网备线",
    bandwidth: "3M",
    servers: [
      { host: "mc3.gdufscraft.top", version: "26.2 原版" },
    ],
  },
  {
    line: "粤高联",
    bandwidth: "联合服务器",
    servers: [
      { host: "mc.ghmmua.net", version: "联合门户群组" },
    ],
  },
];

function ServerGroupCard({
                           line,
                           bandwidth,
                           recommended,
                           servers,
                         }: ServerGroup) {
  return (
      <li
          className={cn(
              "flex flex-col justify-center",
              "rounded-lg px-3.5 sm:px-4 py-3 sm:py-3.5 transition-colors",
              "bg-white/60 border border-slate-200/60",
              "hover:border-slate-300/80 hover:bg-white/80",
          )}
      >
        <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className={cn("text-[12px] sm:text-[14px] font-semibold uppercase tracking-wider", recommended ? "text-emerald-600" : "text-slate-600")}>
          {line}
          {bandwidth && (
              <span
                  className={cn(
                      "ml-1.5 font-normal", "normal-case tracking-normal",
                      recommended ? "text-emerald-600/70" : "text-slate-500"
                  )}
              >
              {bandwidth}
            </span>
          )}
        </span>
          {recommended && (
              <span className="flex items-center text-center gap-1 text-[12px] sm:text-[12px] text-emerald-600 font-medium">
                <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-emerald-500 animate-pulse" />
                推荐
              </span>
          )}
        </div>
        <div className="space-y-1.5">
          {servers.map((s) => (
              <div key={s.host}>
                <div className="flex font-mono text-[13px] sm:text-[14px] text-slate-800 justify-between">
                  <span className="truncate">{s.host}</span>
                  <span className="text-[11px] sm:text-[13px] text-slate-600 flex-shrink-0">
                      {s.version}
                  </span>
                </div>
              </div>
          ))}
        </div>
      </li>
  );
}

function ServerList() {
  return (
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        {SERVER_GROUPS.map((g) => (
            <ServerGroupCard key={g.line} {...g} />
        ))}
      </ul>
  );
}

/* -------------------- 主组件 --------------------
 *
 * 桌面（md+）：
 *   ┌─────────────────────────┬──────────────────────┐
 *   │ Logo + 简介              │  快速导航              │
 *   │ 联系方式                  │                       │
 *   ├─────────────────────────┴──────────────────────┤
 *   │ 服务器地址（4 张卡片，1 行）                            │
 *   └────────────────────────────────────────────────────┘
 *              © 2026 GdufsCraft (居中)
 *
 * 移动端（单列）：
 *   快速导航 → 服务器地址 → Logo + 简介 → 联系方式 → ©
 */
export function Footer() {
  const year = new Date().getFullYear();

  return (
      <footer className="relative bg-white cursor-default">
        <StoneDivider />

        <div
            className={cn(
                "bg-gradient-to-b from-slate-100 via-slate-200 to-slate-300/60 px-1.5 sm:px-0",
            )}
        >
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-10 pb-5 sm:pt-12 sm:pb-6">
            {/* 桌面 Row 1：LogoIntro+Contact (左) | QuickNav (右) */}
            <div className="hidden md:grid md:grid-cols-2 md:gap-8 md:items-start md:mb-8">
              <div className="flex flex-col gap-6.5">
                <LogoIntro />
                <ContactSection />
              </div>
              <QuickNav />
            </div>

            {/* 移动端：QuickNav 置顶 */}
            <div className="md:hidden">
              <QuickNav />
            </div>

            {/* 服务器地址（桌面 Row 2 / 移动端中间） */}
            <div className="mt-8 md:mt-0">
              <SectionTitle>服务器地址 · MUA验证</SectionTitle>
              <ServerList />
            </div>

            {/* 移动端：LogoIntro 放在 servers 下面、联系方式上面（按需求） */}
            <div className="md:hidden mt-8 pt-6">
              <LogoIntro />
            </div>

            {/* 移动端：联系方式在 LogoIntro 下面 */}
            <div className="md:hidden mt-6">
              <ContactSection />
            </div>

            {/* 版权居中*/}
            <div
                className={cn(
                    "mt-6 sm:mt-8 pt-4 border-t border-slate-200/60",
                    "text-center text-xs sm:text-[13px] text-slate-500",
                )}
            >
            <span className="font-semibold text-slate-600">
              © {year} GdufsMC
            </span>
              <span className="mx-1.5 text-slate-300">·</span>
              <span>Powered by Next.js</span>
            </div>
          </div>
        </div>
      </footer>
  );
}
