"use client";

/**
 * 文字区外链 pill — 紧凑 inline 链接, 跟 CopyHost 视觉一致
 * - 浅色底 + 同色文字 + 同色边框
 * - hover 底色加深 + 边框加深, 文字不变白 (柔和过渡, 适合长文字流)
 * - 内嵌 IconExternalLink (新窗口打开提示)
 * - 4 色调, 默认 sky 适合外链; emerald 推荐链接; amber 提取码; slate 中性
 */

import { IconExternalLink } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

export type InlineLinkAccent = "sky" | "emerald" | "amber" | "slate";

export interface InlineLinkProps {
  href: string;
  /** 显示文字 */
  label: string;
  /** 强调色 (默认 sky) */
  accent?: InlineLinkAccent;
  className?: string;
}

const ACCENT_STYLES: Record<InlineLinkAccent, string> = {
  sky: "bg-sky-50 text-sky-700 border-sky-200/80 hover:bg-sky-100 hover:text-sky-800 hover:border-sky-300",
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200/80 hover:bg-emerald-100 hover:text-emerald-800 hover:border-emerald-300",
  amber: "bg-amber-50 text-amber-700 border-amber-200/80 hover:bg-amber-100 hover:text-amber-800 hover:border-amber-300",
  slate: "bg-slate-50 text-slate-700 border-slate-200/80 hover:bg-slate-100 hover:text-slate-800 hover:border-slate-300",
} as const;

export function InlineLink({ href, label, accent = "sky", className }: InlineLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex items-center gap-1 align-middle",
        "px-1.5 py-0.5 rounded-md",
        "text-[12px] font-medium",
        "border transition-colors no-underline whitespace-nowrap",
        ACCENT_STYLES[accent],
        className,
      )}
    >
      <span>{label}</span>
      <IconExternalLink className="w-3 h-3 opacity-60" stroke={2} />
    </a>
  );
}
