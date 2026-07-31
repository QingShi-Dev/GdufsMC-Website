"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconCircleCheckFilled,
  IconCircleXFilled,
  IconCopy,
  IconRefresh,
  IconUsers,
  IconBolt,
  IconChevronDown,
  IconAlertTriangle,
} from "@tabler/icons-react";
import { GROUP_META, type ServerStatus as ServerStatusT, type ServerGroup } from "@/lib/mc-status-constants";
import { cn } from "@/lib/utils";

const REFRESH_MS = 5_000;
const CACHE_KEY = "mc-status-cache-v1";
const CACHE_MAX_AGE_MS = 5 * 60 * 1000; // localStorage 缓存 5 分钟
const GROUP_ORDER: ServerGroup[] = ["survival", "create", "hemc", "bmc"];

// ---- 刷新按钮状态机时序 ----
// 点击 → 旋转 ROTATION_MS → 显示"已刷新" → 再等 SUCCESS_DISPLAY_MS → 回 idle
// 总锁定窗口 = ROTATION_MS + SUCCESS_DISPLAY_MS，期间按钮 disabled / cursor-default / 去 hover
const ROTATION_MS = 500;
const SUCCESS_DISPLAY_MS = 2_000;
const LOCKOUT_MS = ROTATION_MS + SUCCESS_DISPLAY_MS;

/** 响应式断点 hook（SSR 安全；用 useSyncExternalStore 避免 setState in effect 报错） */
function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
      (callback) => {
        if (typeof window === "undefined") return () => {};
        const mq = window.matchMedia(query);
        mq.addEventListener("change", callback);
        return () => mq.removeEventListener("change", callback);
      },
      () => (typeof window === "undefined" ? false : window.matchMedia(query).matches),
      () => false, // SSR 快照：默认桌面
  );
}

interface StatusResponse {
  servers: ServerStatusT[];
  fetchedAt: string;
}

/* localStorage 缓存读取（stable ref，保证 useSyncExternalStore 不触发额外渲染） */
let _lastRaw: string | null | undefined = undefined;
let _lastParsed: StatusResponse | null = null;

function getCachedSnapshot(): StatusResponse | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(CACHE_KEY);
  if (raw === _lastRaw) return _lastParsed;
  _lastRaw = raw;
  if (!raw) {
    _lastParsed = null;
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as { savedAt: number; data: StatusResponse };
    if (!parsed?.savedAt || !parsed.data) {
      _lastParsed = null;
      return null;
    }
    if (Date.now() - parsed.savedAt > CACHE_MAX_AGE_MS) {
      _lastParsed = null;
      return null;
    }
    _lastParsed = parsed.data;
    return _lastParsed;
  } catch {
    _lastParsed = null;
    return null;
  }
}

function writeLocalCache(data: StatusResponse) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ savedAt: Date.now(), data })
    );
    // 写完后清掉 snapshot 缓存，下一次 getSnapshot 才重新解析
    _lastRaw = undefined;
  } catch {
    /* quota or disabled — ignore */
  }
}

/**
 * 订阅缓存变更：
 * 1) 当前 tab 内写完缓存，writeLocalCache 主动 setLiveData，所以这里不需要 callback
 * 2) 跨 tab 同步：别的 tab 写完 localStorage 后，本 tab 通过 storage 事件感知
 *    此时 getSnapshot 会重新读，从而更新本地 cache 视图
 */
function subscribeCache(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: StorageEvent) => {
    if (e.key === CACHE_KEY) callback();
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

function useServerStatuses() {
  // 同步从 localStorage 读取缓存，SSR 时为 null
  const cachedData = useSyncExternalStore(
      subscribeCache,
      getCachedSnapshot,
      () => null
  );

  // 实时拉取到的数据；fetch 完成前为 null，回退到 cached
  const [liveData, setLiveData] = useState<StatusResponse | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // AbortController ref：每次新 load 之前 abort 上一个，避免：
  //   1) 旧请求响应迟到覆盖新数据
  //   2) 路由切换 / 卸载后还在调 setState
  const inflightRef = useRef<AbortController | null>(null);
  // 顺序 ID 兜底：即便 abort 没能及时生效（已 resolve 之后再 abort），
  // 也能通过 ID 比对丢弃过期回调
  const seqRef = useRef(0);
  // 显式追踪"是否有人 setRefreshing(true) 过"，决定 finally 是否有必要清。
  // 之前依赖 `manual` 参数判断，会被 5s 定时器（非 manual）接管 manual 请求时
  // 漏掉清理 → 按钮永远转。改成 ref 跟踪更可靠。
  const refreshingOwnerRef = useRef(false);

  const load = useCallback(async (manual = false) => {
    inflightRef.current?.abort();
    const ac = new AbortController();
    inflightRef.current = ac;
    const mySeq = ++seqRef.current;

    if (manual) {
      setRefreshing(true);
      refreshingOwnerRef.current = true;
    }
    try {
      const res = await fetch("/api/server-status", {
        cache: "no-store",
        signal: ac.signal,
      });
      if (mySeq !== seqRef.current) return; // 已被新请求取代
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: StatusResponse = await res.json();
      if (mySeq !== seqRef.current) return; // 解析期间又被新请求取代
      setLiveData(json);
      writeLocalCache(json);
    } catch (e) {
      // 主动 abort 不报错；其他错误才打日志
      if (e instanceof DOMException && e.name === "AbortError") return;
      if (mySeq !== seqRef.current) return;
      console.error("status fetch failed", e);
    } finally {
      // 关键：清理由"当前 in-flight 的请求"负责，不管它是不是 manual。
      // 典型场景：manual 请求 in-flight → 5s interval 触发新请求 → abort 旧的
      //   → 旧的不清（被取代了）；新的非 manual 进来后自己是 current，
      //   它完成时统一清理，refreshing 才能正确归零。
      if (mySeq === seqRef.current && refreshingOwnerRef.current) {
        refreshingOwnerRef.current = false;
        setRefreshing(false);
      }
    }
  }, []);

  // 给上层 useEffect cleanup 用：路由切换或组件卸载时取消 in-flight
  const abort = useCallback(() => {
    inflightRef.current?.abort();
    inflightRef.current = null;
    // seqRef 自增让所有 in-flight 回调短路
    seqRef.current++;
  }, []);

  // ---- 自动刷新 interval 生命周期（之前在父组件 useEffect 里，现在搬进 hook） ----
  // 搬进来的原因：用户点击刷新时要"重置计时"（再过 5s 才轮询，不要立刻轮询），
  // 把 interval 的所有权放在 hook 里，bump 就能直接操作。
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStartedRef = useRef(false);

  const stopAutoRefresh = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    autoStartedRef.current = false;
  }, []);

  const startAutoRefresh = useCallback(() => {
    if (autoStartedRef.current) return; // 幂等：start 多次只起一个 interval
    autoStartedRef.current = true;
    // 首次启动：立刻拉一次（这个跟之前 useEffect 里 load() 等价）
    load().catch(() => { /* load 内部已处理错误 */ });
    intervalRef.current = setInterval(() => load(), REFRESH_MS);
  }, [load]);

  /**
   * 重置自动刷新计时器：清掉当前 interval，从此刻起重新等 5s。
   * 用于用户点击手动刷新后，避免下一秒就被自动轮询盖过去。
   */
  const bumpAutoRefresh = useCallback(() => {
    if (!autoStartedRef.current) return;
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
    }
    intervalRef.current = setInterval(() => load(), REFRESH_MS);
  }, [load]);

  // 优先用实时数据，没有时回退到 localStorage 缓存（首屏秒开）
  const data = liveData ?? cachedData;
  const loading = !data;
  return {
    data,
    loading,
    refreshing,
    refresh: () => load(true),
    load,
    abort,
    startAutoRefresh,
    stopAutoRefresh,
    bumpAutoRefresh,
  };
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  // 关键：把 setTimeout id 存到 ref，unmount 时清掉，避免 setState-on-unmounted
  // 同时支持连点时重置计时器
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    navigator.clipboard.writeText(text).then(
        () => {
          setCopied(true);
          timerRef.current = setTimeout(() => {
            setCopied(false);
            timerRef.current = null;
          }, 1200);
        },
        (err) => {
          // 剪贴板权限被拒 / 非 https 等情况
          console.error("clipboard write failed", err);
        },
    );
  };

  return (
      <button
          type="button"
          onClick={handleClick}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors"
          aria-label="复制地址"
      >
        <IconCopy className="w-2.5 h-2.5" />
        {copied ? "已复制" : text}
      </button>
  );
}

function GroupSection({
                        group,
                        servers,
                        loading = false,
                        isMobile = false,
                      }: {
  group: ServerGroup;
  servers: ServerStatusT[];
  loading?: boolean;
  isMobile?: boolean;
}) {
  // 派生 state：userOverride=null 时用默认，用户的显式选择会一直保留
  // 默认：移动端全部展开，桌面端只有 BMC 折叠（HEMC 不再默认折叠）
  const [userOverride, setUserOverride] = useState<boolean | null>(null);
  const defaultOpen = isMobile ? true : group !== "bmc";
  const open = userOverride ?? defaultOpen;
  const meta = GROUP_META[group];
  const anyOnline = servers.some((s) => s.online);
  const allCampus = servers.every((s) => s.campusOnly);

  return (
      <div className="rounded-xl bg-white/50 border border-slate-200/70 overflow-hidden">
        <button
            type="button"
            onClick={() => setUserOverride(!open)}
            aria-expanded={open}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-white/70 transition-colors"
        >
          <div className="flex items-center gap-2 min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element -- 4 个本地静态小 SVG，无需 next/image 优化 */}
            <img
                src={meta.svg}
                alt=""
                aria-hidden="true"
                className="w-5 h-5 flex-shrink-0"
            />
            <span className="text-xs font-semibold text-slate-800 truncate">{meta.label}</span>
          </div>
          <div className="flex items-center gap-1.5">
          <span
              className={cn(
                  "w-1.5 h-1.5 rounded-full",
                  allCampus
                      ? "bg-slate-300"
                      : anyOnline
                          ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                          : "bg-red-500"
              )}
          />
            <span
                className="text-[9px] px-1.5 py-px rounded bg-slate-100 text-slate-500 font-mono tracking-tight"
                title={meta.needMUA ? "需 MUA 联合群组验证" : "无需 MUA 验证"}
            >
              {meta.needMUA ? "MUA 验证" : "无需验证"}
            </span>
            <IconChevronDown
                className={cn("w-3.5 h-3.5 text-slate-400 transition-transform", open && "rotate-180")}
            />
          </div>
        </button>

        <AnimatePresence initial={false}>
          {open && (
              <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
              >
                <div className="p-2 pt-1 space-y-1.5">
                  {servers.length > 0 ? (
                      servers.map((s) => <ServerRow key={s.key} s={s} />)
                  ) : (
                      <div className="px-2.5 py-2 rounded-lg bg-slate-50/70 border border-dashed border-slate-200 text-[10px] text-slate-400 text-center">
                        {loading ? "检查中..." : "暂无数据"}
                      </div>
                  )}
                </div>
              </motion.div>
          )}
        </AnimatePresence>
      </div>
  );
}

function ServerRow({ s }: { s: ServerStatusT }) {
  if (s.campusOnly) {
    return (
        <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-emerald-50/80 border border-dashed border-emerald-300/70">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-emerald-900">{s.label}</span>
              <span className="text-[9px] px-1 py-px rounded bg-emerald-200 text-emerald-800 border border-emerald-300">仅校内</span>
            </div>
            <div className="font-mono text-[10px] text-emerald-700/80 mt-0.5">{s.host}</div>
          </div>
          <CopyButton text={s.host} />
        </div>
    );
  }

  return (
      <div
          className={cn(
              "px-2.5 py-2 rounded-lg transition-colors border",
              s.online
                  ? "bg-white/60 border-slate-200/70"
                  : "bg-red-50/70 border-red-200/70"
          )}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
            <span
                className={cn(
                    "w-1.5 h-1.5 rounded-full flex-shrink-0",
                    s.online ? "bg-emerald-500 animate-pulse" : "bg-red-500"
                )}
            />
              <span className="text-xs font-medium text-slate-800 truncate">{s.label}</span>
              {s.maintenance && (
                  <span className="text-[9px] px-1 py-px rounded bg-red-100 text-red-700 border border-red-300/70 font-medium">
                  停服调整
                </span>
              )}
            </div>
            <div className="font-mono text-[10px] text-slate-500 mt-0.5 truncate">{s.host}</div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {s.online ? (
                <>
              <span className="flex items-center gap-0.5 text-[10px] text-slate-600 font-mono">
                <IconUsers className="w-2.5 h-2.5" />
                {s.players?.online ?? 0}
                <span className="text-slate-400">/{s.players?.max ?? 0}</span>
              </span>
                  <span className="flex items-center gap-0.5 text-[10px] text-slate-600 font-mono">
                <IconBolt className="w-2.5 h-2.5" />
                    {s.latencyMs}
              </span>
                </>
            ) : null}
            <CopyButton text={s.host} />
          </div>
        </div>
      </div>
  );
}

export function ServerStatusCard() {
  const pathname = usePathname();
  const {
    data,
    loading,
    refresh,
    abort,
    startAutoRefresh,
    stopAutoRefresh,
    bumpAutoRefresh,
  } = useServerStatuses();
  const isMobile = useMediaQuery("(max-width: 1023px)");

  // 一进入页面就启动自动刷新（首次 fetch + 5s 轮询），路由变化时重启
  useEffect(() => {
    startAutoRefresh();
    return () => {
      stopAutoRefresh();
      // 路由切换 / 卸载时取消 in-flight 请求，避免 setState on unmounted
      abort();
    };
  }, [pathname, startAutoRefresh, stopAutoRefresh, abort]);

  // ---- 刷新按钮的 LOCKOUT_MS 状态机 ----
  // idle → click → spinning (ROTATION_MS) → success (SUCCESS_DISPLAY_MS) → idle
  // 期间按钮 disabled + cursor-default + 去 hover，徽章绝对定位在按钮左侧
  type RefreshPhase = "idle" | "spinning" | "success";
  const [phase, setPhase] = useState<RefreshPhase>("idle");
  // 每次成功点击 +1，用于驱动旋转角度（target = clickCount * 360）
  // 用累加而不是 key 切换，避免 framer-motion 在非旋转期被强行 remount
  const [clickCount, setClickCount] = useState(0);
  // 两个阶段的 setTimeout id 存到 ref，unmount/路由切换时统一清掉
  const t1Ref = useRef<ReturnType<typeof setTimeout> | null>(null);
  const t2Ref = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (t1Ref.current !== null) clearTimeout(t1Ref.current);
      if (t2Ref.current !== null) clearTimeout(t2Ref.current);
    };
  }, []);

  const handleRefresh = () => {
    if (phase !== "idle") return; // 锁定窗口内二次点击直接拦
    setPhase("spinning");
    setClickCount((c) => c + 1);
    refresh();      // 触发 fetch（in-flight 控制由 hook 负责）
    bumpAutoRefresh(); // 5s 自动轮询重置成"从现在起 5s"

    // 清掉可能残留的旧 timer（理论上不会发生，防御性）
    if (t1Ref.current !== null) clearTimeout(t1Ref.current);
    if (t2Ref.current !== null) clearTimeout(t2Ref.current);

    t1Ref.current = setTimeout(() => {
      setPhase("success");
      t1Ref.current = null;
    }, ROTATION_MS);

    t2Ref.current = setTimeout(() => {
      setPhase("idle");
      t2Ref.current = null;
    }, LOCKOUT_MS);
  };

  const phaseLocked = phase !== "idle"; // 锁定窗口

  const grouped = useMemo(() => {
    // 始终返回完整结构，缺数据时给空数组（渲染"检查中..."）
    const map: Record<ServerGroup, ServerStatusT[]> = {
      survival: [],
      create: [],
      bmc: [],
      hemc: [],
    };
    if (data) {
      for (const s of data.servers) map[s.group].push(s);
      for (const k of GROUP_ORDER) {
        map[k].sort((a, b) => a.order - b.order);
      }
    }
    return map;
  }, [data]);

  const onlineCount = data?.servers.filter((s) => s.online).length ?? 0;

  // 有缓存数据时不延迟入场动画（让"首屏有缓存就秒出"更明显）；
  // 注意：useSyncExternalStore 在客户端首次 render 就能拿到 localStorage 缓存，
  // 所以 cachedData 通常在第一帧就非空——hasInitialData 在大多数二次访问场景为 true。
  const hasInitialData = !!data;

  return (
      <motion.div
          layout
          initial={
            hasInitialData
                ? { opacity: 0, scale: 0.92 }
                : { opacity: 0, scale: 0.92, y: 12 }
          }
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{
            type: "spring",
            stiffness: 220,
            damping: 22,
            mass: 0.8,
            delay: hasInitialData ? 0 : 0.15,
            // 刷新时的高度变化用平滑 ease（不要 spring 弹跳）
            layout: { duration: 0.4, ease: [0.22, 1, 0.36, 1] },
          }}
          className="relative w-full max-w-xl mx-auto"
      >
        <div className="bg-white/60 backdrop-blur-xl border border-white/40 rounded-2xl p-4 sm:p-5 shadow-2xl shadow-slate-900/10">
          {/* header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="relative">
                {onlineCount > 0 ? (
                    <IconCircleCheckFilled className="w-4.5 h-4.5 text-emerald-400" />
                ) : (
                    <IconCircleXFilled className="w-4.5 h-4.5 text-red-400" />
                )}
              </div>
              <div>
                <div className="text-sm font-semibold flex items-center gap-2 text-slate-800">
                  实时状态
                </div>
                <div className="text-[11px] text-slate-500">
                  {loading
                      ? "正在查询…"
                      : `${onlineCount}条公网线路 正常运行`}
                </div>
              </div>
            </div>
            <div className="relative flex items-center">
              {/* "已刷新" 绿框徽章：绝对定位在按钮左侧，不挤动按钮位置 */}
              <AnimatePresence>
                {phase === "success" && (
                    <motion.div
                        key="refresh-success"
                        // y: "-50%" + top-1/2 让徽章相对父容器垂直居中（跟按钮中线对齐），
                        // 避免徽章贴在父容器顶端、跟居中的按钮错开 4px 导致文字看起来"往上飘"。
                        // 必须用 framer-motion 的 y 而非 Tailwind 的 -translate-y-1/2，
                        // 否则后者会被 motion 的 transform: scale 覆盖掉。
                        initial={{ opacity: 0, x: 8, y: "-50%", scale: 0.6 }}
                        animate={{ opacity: 1, x: 0, y: "-50%", scale: 1 }}
                        exit={{ opacity: 0, x: 4, y: "-50%", scale: 0.85 }}
                        transition={{
                          // 出现用 spring 带轻微 overshoot → "啪"一下弹出，存在感强
                          // 消失用更柔的 easeOut，时长比出现短
                          default: { type: "spring", stiffness: 420, damping: 22, mass: 0.7 },
                          opacity: { duration: 0.16, ease: "easeOut" },
                        }}
                        className="absolute right-full mr-1.5 top-1/2 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-50 border border-emerald-300/70 text-emerald-700 text-[10px] font-medium whitespace-nowrap shadow-sm shadow-emerald-500/10"
                        role="status"
                        aria-live="polite"
                    >
                      <IconCircleCheckFilled className="w-2.5 h-2.5 flex-shrink-0" />
                      已刷新
                    </motion.div>
                )}
              </AnimatePresence>
              <button
                  type="button"
                  onClick={handleRefresh}
                  disabled={phaseLocked}
                  aria-label="刷新状态"
                  aria-busy={phase === "spinning"}
                  className={cn(
                      "p-1.5 rounded-lg transition-colors",
                      // 锁定窗口内：去 hover、cursor 默认、略微变灰暗示不可点
                      phaseLocked
                          ? "text-slate-400 cursor-default"
                          : "text-slate-500 hover:bg-slate-100 hover:text-slate-700 cursor-pointer",
                  )}
              >
                {/*
                  ROTATION_MS 单次旋转：用 framer-motion 控制，target = clickCount * 360
                  （视觉上每圈 360° 等价于 0°，但每次点击 target 都在变，framer-motion
                  会自动从上一帧值动画到新值，时长恒为 ROTATION_MS linear）。
                  进入 success/idle 后 target 不再变化，旋转停在末位。
                */}
                <motion.span
                    className="inline-flex"
                    animate={{ rotate: clickCount * 360 }}
                    transition={{ duration: ROTATION_MS / 1000, ease: "linear" }}
                >
                  <IconRefresh className="w-4 h-4" />
                </motion.span>
              </button>
            </div>
          </div>

          {/* groups - 始终渲染结构（无骨架） */}
          <div className="space-y-2">
            {GROUP_ORDER.map((g) => (
                <GroupSection key={g} group={g} servers={grouped[g]} loading={loading} isMobile={isMobile} />
            ))}
          </div>

          {/* tip */}
          <div className="mt-3 pt-3 border-t border-slate-200/70 flex items-start gap-1.5 text-[10px] text-slate-500">
            <IconAlertTriangle className="w-3 h-3 mt-px flex-shrink-0 text-slate-500" />
            <span>校园网地址外网不可达；推荐优先用 24M 公网主线，3M 备线仅作应急。</span>
          </div>
        </div>
      </motion.div>
  );
}
