import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/domain";
import { PRIORITY } from "@/lib/domain";
import type { Priority } from "@/generated/prisma/enums";

export const TONE_DOT: Record<Tone, string> = {
  good: "bg-good",
  warning: "bg-warning",
  serious: "bg-serious",
  critical: "bg-critical",
  neutral: "bg-ink-3",
  info: "bg-brand",
  brain: "bg-brain",
  done: "bg-good/50",
};

export const TONE_TEXT: Record<Tone, string> = {
  good: "text-good-ink",
  warning: "text-warning-ink",
  serious: "text-serious-ink",
  critical: "text-critical-ink",
  neutral: "text-muted-foreground",
  info: "text-brand",
  brain: "text-brain",
  done: "text-muted-foreground",
};

export const TONE_SOFT: Record<Tone, string> = {
  good: "bg-good-soft",
  warning: "bg-warning-soft",
  serious: "bg-serious-soft",
  critical: "bg-critical-soft",
  neutral: "bg-muted",
  info: "bg-brand-soft",
  brain: "bg-brain-soft",
  done: "bg-muted",
};

export function ToneDot({ tone, className }: { tone: Tone; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-1.5 shrink-0 rounded-full", TONE_DOT[tone], className)} />;
}

/** Status is never color-alone: a dot plus a text label. */
export function StatusPill({ tone, label, className }: { tone: Tone; label: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-2 text-2xs font-medium whitespace-nowrap text-ink-2",
        className,
      )}
    >
      <ToneDot tone={tone} />
      {label}
    </span>
  );
}

export function PriorityBadge({ priority, className }: { priority: Priority; className?: string }) {
  const meta = PRIORITY[priority];
  return (
    <span
      title={`${meta.short} · ${meta.label}`}
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded px-1.5 font-mono text-2xs font-semibold tabular",
        priority === "P0" && "bg-critical-soft text-critical-ink",
        priority === "P1" && "bg-serious-soft text-serious-ink",
        priority === "P2" && "bg-muted text-ink-2",
        priority === "P3" && "bg-muted text-muted-foreground",
        className,
      )}
    >
      {meta.short}
    </span>
  );
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-border bg-surface-2 px-1 font-sans text-[10px] font-medium text-muted-foreground",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export function Meter({
  value,
  tone = "info",
  className,
  label,
}: {
  value: number;
  tone?: Tone;
  className?: string;
  label?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={label}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-track", className)}
    >
      <div className={cn("h-full rounded-full transition-[width] duration-500", TONE_DOT[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}
