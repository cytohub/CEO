import { CheckCircle2, ChevronLeft, ChevronRight, CircleDashed, PenLine } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { StatusPill, TONE_DOT } from "@/components/common/status";
import { ScoreChip } from "@/components/tasks/score";
import type { Tone } from "@/lib/domain";
import { formatDay } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { EntityLink } from "./entity-link";

// ─── Period navigation & status ──────────────────────────────────────────────

export function PeriodNav({
  prevHref,
  nextHref,
  currentHref,
  prevLabel,
  nextLabel,
  currentLabel,
}: {
  prevHref: string;
  nextHref: string | null;
  currentHref: string | null;
  prevLabel: string;
  nextLabel: string;
  currentLabel: string;
}) {
  return (
    <nav className="flex items-center gap-1" aria-label="Review period">
      <Button asChild variant="outline" size="icon-sm">
        <Link href={prevHref} aria-label={prevLabel} title={prevLabel}>
          <ChevronLeft />
        </Link>
      </Button>
      {currentHref ? (
        <Button asChild variant="outline" size="sm">
          <Link href={currentHref}>{currentLabel}</Link>
        </Button>
      ) : (
        <Button variant="outline" size="sm" disabled aria-current="page">
          {currentLabel}
        </Button>
      )}
      {nextHref ? (
        <Button asChild variant="outline" size="icon-sm">
          <Link href={nextHref} aria-label={nextLabel} title={nextLabel}>
            <ChevronRight />
          </Link>
        </Button>
      ) : (
        <Button variant="outline" size="icon-sm" disabled aria-label={`${nextLabel} (not available yet)`}>
          <ChevronRight />
        </Button>
      )}
    </nav>
  );
}

export function ReviewStatus({ completedAt, hasDraft, isCurrent }: { completedAt: Date | null; hasDraft: boolean; isCurrent: boolean }) {
  if (completedAt) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-2xs font-medium text-good-ink">
        <CheckCircle2 className="size-3" aria-hidden /> Completed {formatDay(completedAt)}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-2xs font-medium text-ink-2">
      {hasDraft ? <PenLine className="size-3" aria-hidden /> : <CircleDashed className="size-3" aria-hidden />}
      {hasDraft ? "Draft reflection" : isCurrent ? "In progress" : "Not reviewed"}
    </span>
  );
}

// ─── Headline stats ──────────────────────────────────────────────────────────

export interface HeadlineStat {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  /** 0–100 meter under the value. */
  meter?: number | null;
  /** Optional target tick on the meter (0–100). */
  target?: number | null;
  title?: string;
}

/** Dense headline strip: one row of stats separated by hairlines. */
export function StatStrip({ stats, className }: { stats: HeadlineStat[]; className?: string }) {
  return (
    <dl className={cn("panel grid grid-cols-2 gap-px overflow-hidden bg-hairline sm:grid-cols-3", stats.length >= 5 && "lg:grid-cols-5", stats.length === 6 && "lg:grid-cols-6", className)}>
      {stats.map((s) => (
        <div key={s.label} className="min-w-0 bg-surface px-3.5 py-3" title={s.title}>
          <dt className="truncate text-2xs font-medium text-muted-foreground">{s.label}</dt>
          <dd className="mt-0.5 text-lg leading-tight font-semibold tracking-tight text-foreground tabular">{s.value}</dd>
          {s.meter !== undefined && s.meter !== null && (
            <div className="relative mt-1.5 h-1.5 rounded-full bg-track" aria-hidden>
              <div className="absolute inset-y-0 left-0 rounded-full bg-brand" style={{ width: `${Math.max(0, Math.min(100, s.meter))}%` }} />
              {s.target !== undefined && s.target !== null && (
                <div className="absolute -top-0.5 h-2.5 w-0.5 rounded-full bg-foreground" style={{ left: `calc(${Math.max(0, Math.min(100, s.target))}% - 1px)` }} />
              )}
            </div>
          )}
          {s.hint && <div className="mt-1 truncate text-2xs text-muted-foreground">{s.hint}</div>}
        </div>
      ))}
    </dl>
  );
}

// ─── Generic rows ────────────────────────────────────────────────────────────

export interface RowItem {
  key: string;
  title: string;
  detail?: React.ReactNode;
  tag?: { tone: Tone; label: string };
  meta?: React.ReactNode;
  score?: number;
  entity?: { kind: "task" | "milestone" | "meeting"; id: string };
  href?: string;
  muted?: boolean;
}

function RowBody({ item, tagWidth }: { item: RowItem; tagWidth?: string }) {
  return (
    <>
      {item.tag && (
        <span className={cn("mt-px shrink-0", tagWidth ?? "w-[84px]")}>
          <StatusPill tone={item.tag.tone} label={item.tag.label} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[13px]", item.muted ? "text-muted-foreground" : "text-foreground")} title={item.title}>
          {item.title}
        </span>
        {item.detail && <span className="block truncate text-2xs text-muted-foreground">{item.detail}</span>}
      </span>
      {item.meta && <span className="shrink-0 pt-px text-right text-2xs text-muted-foreground tabular">{item.meta}</span>}
      {item.score !== undefined && <ScoreChip score={item.score} className="h-5 min-w-8 shrink-0 text-2xs" />}
    </>
  );
}

const rowClass = "flex items-start gap-3 px-3.5 py-2";

export function ItemRows({ items, empty, max, tagWidth, className }: { items: RowItem[]; empty?: string; max?: number; tagWidth?: string; className?: string }) {
  if (items.length === 0) {
    return empty ? <p className="px-3.5 py-3 text-xs text-muted-foreground">{empty}</p> : null;
  }
  const shown = max ? items.slice(0, max) : items;
  return (
    <ul className={cn("divide-y divide-hairline", className)}>
      {shown.map((item) => (
        <li key={item.key}>
          {item.entity ? (
            <EntityLink kind={item.entity.kind} id={item.entity.id} className={cn(rowClass, "hover:bg-muted/50")}>
              <RowBody item={item} tagWidth={tagWidth} />
            </EntityLink>
          ) : item.href ? (
            <Link href={item.href} className={cn(rowClass, "hover:bg-muted/50")}>
              <RowBody item={item} tagWidth={tagWidth} />
            </Link>
          ) : (
            <div className={rowClass}>
              <RowBody item={item} tagWidth={tagWidth} />
            </div>
          )}
        </li>
      ))}
      {max && items.length > max && <li className="px-3.5 py-1.5 text-2xs text-muted-foreground">+{items.length - max} more</li>}
    </ul>
  );
}

/** A labelled group inside a panel. */
export function SubSection({ title, count, children, className, aside }: { title: string; count?: number; children: React.ReactNode; className?: string; aside?: React.ReactNode }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-center gap-2 px-3.5 pt-2.5 pb-1">
        <h3 className="eyebrow">{title}</h3>
        {count !== undefined && <span className="text-2xs text-muted-foreground tabular">{count}</span>}
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      {children}
    </div>
  );
}

// ─── Small charts ────────────────────────────────────────────────────────────

/**
 * Progress delta on a 0–100 track: the start position as a light bar, the gain
 * as a solid bar beside it (2px surface gap), a loss as an outlined segment.
 */
export function DeltaBar({ from, to, label, className }: { from: number; to: number; label: string; className?: string }) {
  const lo = Math.max(0, Math.min(from, to));
  const hi = Math.min(100, Math.max(from, to));
  const up = to >= from;
  return (
    <div className={cn("relative h-1.5 rounded-full bg-track", className)} role="img" aria-label={`${label}: ${from}% to ${to}%`} title={`${label}: ${from}% → ${to}%`}>
      {lo > 0 && <div className="absolute inset-y-0 left-0 rounded-full bg-brand/35" style={{ width: `${lo}%` }} />}
      {hi > lo &&
        (up ? (
          <div className="absolute inset-y-0 rounded-r-full bg-brand ring-2 ring-surface" style={{ left: `${lo}%`, width: `${hi - lo}%` }} />
        ) : (
          <div className="absolute inset-y-0 rounded-r-full border border-dashed border-ink-3" style={{ left: `${lo}%`, width: `${hi - lo}%` }} />
        ))}
    </div>
  );
}

export function DeltaLegend({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-3 text-2xs text-muted-foreground", className)}>
      <span className="flex items-center gap-1">
        <span className="h-1.5 w-3 rounded-sm bg-brand/35" aria-hidden /> Start
      </span>
      <span className="flex items-center gap-1">
        <span className="h-1.5 w-3 rounded-sm bg-brand" aria-hidden /> Gained
      </span>
      <span className="flex items-center gap-1">
        <span className="h-1.5 w-3 rounded-sm border border-dashed border-ink-3" aria-hidden /> Lost
      </span>
    </span>
  );
}

export function DeltaText({ delta, unit = "pts", className }: { delta: number; unit?: string; className?: string }) {
  if (delta === 0) return <span className={cn("text-muted-foreground tabular", className)}>±0</span>;
  return (
    <span className={cn("font-medium tabular", delta > 0 ? "text-good-ink" : "text-critical-ink", className)}>
      {delta > 0 ? "+" : "−"}
      {Math.abs(delta)}
      {unit ? ` ${unit}` : ""}
    </span>
  );
}

export function Dot({ tone }: { tone: Tone }) {
  return <span aria-hidden className={cn("inline-block size-1.5 shrink-0 rounded-full", TONE_DOT[tone])} />;
}

/** Footnote for sections that always reflect the live state of the company. */
export function LiveNote({ show }: { show: boolean }) {
  if (!show) return null;
  return <span className="text-2xs text-muted-foreground">Live — as of today</span>;
}
