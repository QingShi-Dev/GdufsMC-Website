/**
 * 极简 logger — 替换裸 console 调用
 *
 * 设计目标:
 * - dev 全开 (debug+); prod 只留 info/warn/error, 减噪
 * - 客户端 prod 强制剥掉 Error.stack, 避免泄漏内部文件路径和包结构
 * - 服务端保留完整 stack, 运维排查需要
 * - 通过 LOG_LEVEL 环境变量覆盖默认级别 (e.g. LOG_LEVEL=debug 调试时)
 *
 * 不引入 pino/winston 的理由: 项目规模不需要, 多 30KB bundle;
 * 真要接 Sentry/Logflare 之类的 APM, 改 emit() 一处即可。
 */

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<Level, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const isClient = typeof window !== "undefined";
const isProd = process.env.NODE_ENV === "production";

const envLevel = process.env.LOG_LEVEL as Level | undefined;
const MIN_LEVEL: Level =
  envLevel && envLevel in LEVEL_RANK
    ? envLevel
    : isProd
      ? "info"
      : "debug";

/** 把任意 value 压平成可打印形式; 客户端 prod 剥 stack */
function format(arg: unknown): unknown {
  if (arg instanceof Error) {
    // 客户端 + prod: 只留 message, 防 stack 暴露内部结构
    if (isClient && isProd) {
      return `${arg.name}: ${arg.message}`;
    }
    return arg.stack ? `${arg.message}\n${arg.stack}` : arg.message;
  }
  if (arg instanceof ErrorEvent) {
    // SW register 失败时常见, message 已经是脱敏后的用户可读文案
    return arg.message || "unknown error";
  }
  return arg;
}

function emit(level: Level, args: unknown[]): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[MIN_LEVEL]) return;

  const formatted = args.map(format);

  // 用 console 自身的级别方法, 让浏览器/Node 染色
  const method: "log" | "info" | "warn" | "error" =
    level === "debug" ? "log" : level;
  (console[method] as (...a: unknown[]) => void)(...formatted);
}

export const logger = {
  debug: (...args: unknown[]) => emit("debug", args),
  info: (...args: unknown[]) => emit("info", args),
  warn: (...args: unknown[]) => emit("warn", args),
  error: (...args: unknown[]) => emit("error", args),
};
