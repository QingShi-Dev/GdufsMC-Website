"use client";

/**
 * CopyHost — 可复制 IP pill
 * - 整个作为按钮: host + 复制 icon 一体
 * - 默认 slate 中性, 复制后变 emerald + IconCheck (1.2s 反馈)
 * - 视觉跟 InlineLink 一致 (border + 浅底 + hover 加深)
 *
 * 鲁棒性:
 * - timer id 存 ref, unmount 时 cleanup clearTimeout (避免 setState on unmounted)
 * - 连点时先 clearTimeout 旧 timer, 再设新的 (避免反馈中段被旧 timer 提前清回)
 * - clipboard 失败 console.error (简单 fallback, 不做 textarea hack)
 */

import { useEffect, useRef, useState } from "react";
import { IconCopy, IconCheck } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

const FEEDBACK_MS = 1200;

export function CopyHost({ host }: { host: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // unmount 时清掉未跑的 timer, 避免 setState on unmounted 警告
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const handleClick = () => {
    // 连点互斥: 旧 timer 还在跑就先清掉, 避免反馈中段被旧 timer 提前清回
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    navigator.clipboard?.writeText(host).then(
      () => {
        setCopied(true);
        timerRef.current = setTimeout(() => {
          setCopied(false);
          timerRef.current = null;
        }, FEEDBACK_MS);
      },
      (err) => {
        // 剪贴板权限被拒 / 非 https 等情况, 不做 textarea fallback
        // (移动端 Safari 用户多, 反馈更直接, 让用户手动复制)
        console.error("clipboard write failed", err);
      },
    );
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "inline-flex items-center gap-1.5 align-middle",
        "px-1.5 py-0.5 rounded-md",
        "font-mono text-[12px] font-medium",
        "border transition-colors tabular-nums",
        copied
          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
          : "bg-slate-50 text-slate-700 border-slate-200/80 hover:bg-slate-100 hover:text-slate-800 hover:border-slate-300",
      )}
      aria-label={copied ? "已复制" : `复制 ${host}`}
    >
      <span>{host}</span>
      {copied ? (
        <IconCheck className="w-3 h-3" stroke={2.5} />
      ) : (
        <IconCopy className="w-3 h-3 opacity-60" stroke={2} />
      )}
    </button>
  );
}
