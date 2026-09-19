import { cn } from "@/lib/utils";

export function SectionHeader({
  eyebrow,
  title,
  description,
  align = "left",
  className,
  theme = "dark",
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: "left" | "center";
  className?: string;
  theme?: "dark" | "light";
}) {
  const isLight = theme === "light";
  return (
    <div
      className={cn(
        align === "center" && "text-center",
        className
      )}
    >
      {eyebrow && (
        <div
          className={cn(
            "inline-flex items-center gap-1.5 text-xs font-semibold tracking-widest uppercase mb-3",
            isLight ? "text-brand-600" : "text-brand-300"
          )}
        >
          <span
            className={cn(
              "w-6 h-px",
              isLight
                ? "bg-gradient-to-r from-transparent to-brand-400"
                : "bg-gradient-to-r from-transparent to-brand-300"
            )}
          />
          {eyebrow}
        </div>
      )}
      <h2
        className={cn(
          "text-3xl sm:text-[38px] font-bold tracking-tight text-balance",
          isLight ? "text-slate-800" : "text-white"
        )}
      >
        {title}
      </h2>
      {description && (
        <p
          className={cn(
            "mt-3 sm:text-[18px] leading-relaxed text-balance",
            isLight ? "text-slate-600" : "text-white/55",
            align === "center" && "max-w-2xl mx-auto"
          )}
        >
          {description}
        </p>
      )}
    </div>
  );
}
