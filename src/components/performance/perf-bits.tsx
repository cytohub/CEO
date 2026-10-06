import { ArrowDownRight, ArrowUpRight, Lock, Minus, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatDay } from "@/lib/dates";
import type { PerformanceRange, Trend } from "@/server/queries/performance";
import type { Top5Day } from "@/server/queries/reviews";

export function PrivateBadge() {
  return (
    <span className="inline-flex h-5 items-center gap-1 rounded-full border border-border bg-surface-2 px-2 text-2xs font-medium text-ink-2" title="Only visible to you">
      <Lock className="size-3" aria-hidden /> Private
    </span>
  );
}

export function RangeToggle({ range }: { range: PerformanceRange }) {
  const opts: { value: PerformanceRange; label: string }[] = [
    { value: 30, label: "30 days" },
    { value: 90, label: "90 days" },
  ];
  return (
    <nav aria-label="Time window" className="inline-flex h-7 items-center rounded-lg border border-border bg-surface p-0.5">
      {opts.map((o) => (
        <Link
          key={o.value}
          href={o.value === 30 ? "/performance" : `/performance?range=${o.value}`}
          aria-current={range === o.value ? "page" : undefined}
          className={cn(
            "inline-flex h-full items-center rounded-md px-2.5 text-xs font-medium transition-colors",
            range === o.value ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Change vs the previous window. Direction is carried by the arrow and sign;
 * color only reinforces whether the change is an improvement.
 */
export function TrendChip({
  trend,
  unit = "",
  lowerIsBetter = false,
  words,
  range,
  format = (n: number) => `${n}`,
}: {
  trend: Trend;
  unit?: string;
  lowerIsBetter?: boolean;
  /** Labels for [improved, worsened], e.g. ["faster", "slower"]. */
  words?: [string, string];
  range: number;
  format?: (n: number) => string;
}) {
  const vs = `vs prior ${range}d`;
  if (trend.delta === null) {
    return <span className="text-2xs text-muted-foreground">{trend.value === null ? "No data yet" : `No data for prior ${range}d`}</span>;
  }
  if (trend.delta === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground" title={`Unchanged ${vs}`}>
        <Minus className="size-3" aria-hidden /> No change {vs}
      </span>
    );
  }
  const up = trend.delta > 0;
  const better = lowerIsBetter ? !up : up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  const amount = `${format(Math.abs(trend.delta))}${unit}`;
  return (
    <span
      className="inline-flex items-center gap-1 text-2xs text-muted-foreground"
      title={`${trend.prev !== null ? format(trend.prev) : "—"}${unit} → ${trend.value !== null ? format(trend.value) : "—"}${unit} (${better ? "improved" : "worse"})`}
    >
      <span className={cn("inline-flex items-center gap-0.5 font-medium tabular", better ? "text-good-ink" : "text-critical-ink")}>
        <Icon className="size-3" aria-hidden />
        {words ? `${amount} ${better ? words[0] : words[1]}` : `${up ? "+" : "−"}${amount}`}
      </span>
      <span>{vs}</span>
      <span className="sr-only">({better ? "improved" : "worse"})</span>
    </span>
  );
}

export function KpiTile({
  label,
  icon: Icon,
  value,
  sub,
  trend,
  children,
  title,
  className,
}: {
  label: string;
  icon?: LucideIcon;
  value: React.ReactNode;
  sub?: React.ReactNode;
  trend?: React.ReactNode;
  children?: React.ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <section className={cn("panel flex min-w-0 flex-col px-3.5 py-3", className)} title={title} aria-label={label}>
      <h2 className="flex items-center gap-1.5 text-2xs font-medium text-muted-foreground">
        {Icon && <Icon className="size-3.5 text-ink-3" aria-hidden />}
        {label}
      </h2>
      <div className="mt-1 text-[22px] leading-tight font-semibold tracking-tight text-foreground tabular">{value}</div>
      {sub && <div className="mt-0.5 text-2xs text-muted-foreground">{sub}</div>}
      {trend && <div className="mt-1">{trend}</div>}
      {children && <div className="mt-auto pt-3">{children}</div>}
    </section>
  );
}

/** Daily Top 5 completion: one column per planned day, single hue on a track. */
export function Top5Bars({ days }: { days: Top5Day[] }) {
  if (days.length === 0) return <p className="text-2xs text-muted-foreground">No Top 5 planned in this window.</p>;
  const shown = days.slice(-45);
  return (
    <div>
      <div
        className="flex h-10 items-end gap-0.5"
        role="img"
        aria-label={`Daily Top 5 completion: ${shown.map((d) => `${formatDay(d.date)} ${d.done} of ${d.total}`).join(", ")}`}
      >
        {shown.map((d) => (
          <div
            key={d.date.toISOString()}
            className="relative h-full max-w-4 min-w-1 flex-1 rounded-t-[3px] bg-track"
            title={`${formatDay(d.date)}: ${d.done} of ${d.total} completed${d.pending ? ` · ${d.pending} still in play` : ""}`}
          >
            <div className="absolute inset-x-0 bottom-0 rounded-t-[3px] bg-brand" style={{ height: `${(d.done / Math.max(d.total, 1)) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-2xs text-muted-foreground tabular">
        <span>{formatDay(shown[0].date)}</span>
        <span>Completed of 5, per day</span>
        <span>{formatDay(shown[shown.length - 1].date)}</span>
      </div>
    </div>
  );
}

/** Strategic vs operational share of CEO time as one stacked bar with a target tick. */
export function StrategicSplit({ pct, target }: { pct: number | null; target: number }) {
  if (pct === null) return <p className="text-2xs text-muted-foreground">No time tracked in this window.</p>;
  const ops = 100 - pct;
  return (
    <div>
      <div className="relative">
        <div className="flex h-2.5 gap-0.5" role="img" aria-label={`Strategic ${pct}%, operational ${ops}%, recommended strategic ${target}%`}>
          {pct > 0 && <div className="h-full rounded-l-full bg-brand" style={{ width: `${pct}%` }} title={`Strategic work: ${pct}%`} />}
          {ops > 0 && <div className="h-full flex-1 rounded-r-full bg-ink-3/45" title={`Operational work: ${ops}%`} />}
        </div>
        <div className="absolute -top-1 h-[18px] w-0.5 rounded-full bg-foreground" style={{ left: `calc(${target}% - 1px)` }} title={`Recommended strategic share: ${target}%`} aria-hidden />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground tabular">
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-3 rounded-sm bg-brand" aria-hidden /> Strategic <span className="font-semibold text-foreground">{pct}%</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-3 rounded-sm bg-ink-3/45" aria-hidden /> Operational <span className="font-semibold text-foreground">{ops}%</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-0.5 bg-foreground" aria-hidden /> Recommended {target}%
        </span>
      </div>
    </div>
  );
}

/** Commitments outcome: kept / late / still overdue, as a status-colored stacked bar with a labelled legend. */
export function CommitmentBar({ kept, late, overdue }: { kept: number; late: number; overdue: number }) {
  const total = kept + late + overdue;
  if (!total) return null;
  const segs = [
    { key: "kept", label: "Kept", n: kept, cls: "bg-good" },
    { key: "late", label: "Late", n: late, cls: "bg-warning" },
    { key: "overdue", label: "Overdue", n: overdue, cls: "bg-critical" },
  ].filter((s) => s.n > 0);
  return (
    <div>
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={segs.map((s) => `${s.label} ${s.n}`).join(", ")}>
        {segs.map((s) => (
          <div key={s.key} className={cn("h-full", s.cls)} style={{ width: `${(s.n / total) * 100}%` }} title={`${s.label}: ${s.n}`} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-muted-foreground tabular">
        <span className="flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-good" aria-hidden /> Kept <span className="font-semibold text-foreground">{kept}</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-warning" aria-hidden /> Late <span className="font-semibold text-foreground">{late}</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-critical" aria-hidden /> Overdue <span className="font-semibold text-foreground">{overdue}</span>
        </span>
      </div>
    </div>
  );
}
