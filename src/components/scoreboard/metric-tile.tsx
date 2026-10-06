"use client";

import { ArrowUpRight, Clock3, Info, MoreHorizontal, PenLine, Plug, Sigma, Target, Unplug } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Meter } from "@/components/common/status";
import { useLookups } from "@/components/shell/ui-context";
import { formatDateTime, formatDay } from "@/lib/dates";
import { METRIC_CATEGORIES } from "@/lib/domain";
import { cn } from "@/lib/utils";
import type { MetricSourceKind, ScoreboardMetric } from "@/server/queries/scoreboard";
import { EditTargetDialog, RecordValueDialog } from "./metric-dialogs";
import { displayName, formatMetricValue, metricDelta, targetInfo, updatedLabel } from "./metric-format";
import { TrendSparkline } from "./trend-sparkline";

const SOURCE_ICON: Record<MetricSourceKind, typeof Plug> = {
  manual: PenLine,
  derived: Sigma,
  sample: Plug,
  connected: Plug,
  not_connected: Unplug,
  unknown: Info,
};

/** Metrics whose composition is listed in the pipeline table below the scoreboard. */
const COMPOSITION_SOURCES = new Set([
  "derived:pipeline.weighted",
  "derived:pipeline.total",
  "derived:pipeline.count",
  "derived:fundraising.committed",
  "derived:fundraising.weighted",
  "derived:fundraising.active",
]);

export function DeltaLabel({ metric, className }: { metric: ScoreboardMetric; className?: string }) {
  const delta = metricDelta(metric);
  if (!delta) return <span className={cn("text-2xs text-muted-foreground", className)}>No prior value</span>;
  const glyph = delta.dir === "up" ? "↑" : delta.dir === "down" ? "↓" : "→";
  const tone = delta.favorable === null ? "text-muted-foreground" : delta.favorable ? "text-good-ink" : "text-critical-ink";
  return (
    <span className={cn("inline-flex min-w-0 items-baseline gap-1 text-2xs", className)} title={delta.description}>
      <span className={cn("font-semibold whitespace-nowrap tabular", tone)}>
        <span aria-hidden>{glyph} </span>
        {delta.text}
      </span>
      {delta.vs && <span className="truncate text-muted-foreground">vs {formatDay(delta.vs)}</span>}
      <span className="sr-only">{delta.favorable === null ? "" : delta.favorable ? "(favorable)" : "(unfavorable)"}</span>
    </span>
  );
}

export function TargetLine({ metric, today, className }: { metric: ScoreboardMetric; today: Date; className?: string }) {
  const t = targetInfo(metric, today);
  if (!t) return <div className={cn("text-2xs text-muted-foreground", className)}>No target set</div>;
  return (
    <div className={cn("min-w-0", className)} title={t.description}>
      <div className="flex items-baseline justify-between gap-2 text-2xs">
        <span className="truncate text-muted-foreground">{t.label}</span>
        <span className={cn("shrink-0 font-medium tabular", t.met ? "text-good-ink" : "text-ink-2")}>{t.status}</span>
      </div>
      {t.progress !== null && <Meter value={t.progress} tone="info" className="mt-1 h-1" label={`${displayName(metric.name)}: ${t.progress}% of target`} />}
    </div>
  );
}

function SourceLine({ metric }: { metric: ScoreboardMetric }) {
  const Icon = SOURCE_ICON[metric.source.kind];
  const manualOverride = metric.source.kind !== "manual" && !metric.derived && metric.latestPointSource === "manual";
  return (
    <div className="flex items-start gap-1.5 text-2xs text-muted-foreground">
      <Icon className="mt-0.5 size-3 shrink-0 text-ink-3" aria-hidden />
      <span className="line-clamp-2 min-w-0 flex-1" title={metric.source.detail}>
        <span className="sr-only">Source: </span>
        {metric.source.label}
        {manualOverride && <span className="text-ink-2"> · latest entered manually</span>}
      </span>
    </div>
  );
}

/** Right end of the sparkline axis: how fresh the latest value is. */
function Freshness({ metric, today }: { metric: ScoreboardMetric; today: Date }) {
  const { timezone } = useLookups();
  const latest = metric.series.at(-1);
  if (metric.derived) {
    return (
      <span className="inline-flex items-center gap-1 text-ink-2" title="Computed live from workspace data">
        <span className="size-1.5 rounded-full bg-good" aria-hidden />
        Live
      </span>
    );
  }
  if (!latest) return <span>No data</span>;
  const title = `Latest value is for ${formatDay(latest.date, true)}${metric.updatedAt ? ` · entered ${formatDateTime(metric.updatedAt, timezone)}` : ""}`;
  return (
    <span className="inline-flex items-center gap-1" title={title}>
      <Clock3 className="size-3 text-ink-3" aria-hidden />
      <span className="sr-only">Updated </span>
      {formatDay(latest.date)} · {updatedLabel(latest.date, today)}
    </span>
  );
}

function MetricMenu({ metric, onRecord, onTarget }: { metric: ScoreboardMetric; onRecord: () => void; onTarget: () => void }) {
  const name = displayName(metric.name);
  return (
    // Non-modal so the dialogs it opens own focus and pointer events cleanly.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" className="-mt-0.5 -mr-1 text-ink-3" aria-label={`Actions for ${name}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {metric.derived ? (
          <DropdownMenuLabel className="text-2xs font-normal text-muted-foreground">
            Read-only — computes from live data
            {metric.source.label.startsWith("Derived: ") ? `: ${metric.source.label.slice(9)}` : ""}.
          </DropdownMenuLabel>
        ) : (
          <DropdownMenuItem onSelect={onRecord}>
            <PenLine /> Record value…
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={onTarget}>
          <Target /> {metric.target === null ? "Set target…" : "Edit target…"}
        </DropdownMenuItem>
        {(COMPOSITION_SOURCES.has(metric.sourceKey) || metric.goal) && <DropdownMenuSeparator />}
        {COMPOSITION_SOURCES.has(metric.sourceKey) && (
          <DropdownMenuItem asChild>
            <a href="#pipeline-composition">
              <Sigma /> View composition
            </a>
          </DropdownMenuItem>
        )}
        {metric.goal && (
          <DropdownMenuItem asChild>
            <Link href={`/goals/${metric.goal.id}`}>
              <ArrowUpRight /> <span className="truncate">Goal: {metric.goal.title}</span>
            </Link>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function useMetricDialogs(metric: ScoreboardMetric, today: Date) {
  const [dialog, setDialog] = useState<"record" | "target" | null>(null);
  const dialogs = (
    <>
      {!metric.derived && <RecordValueDialog metric={metric} today={today} open={dialog === "record"} onOpenChange={(o) => setDialog(o ? "record" : null)} />}
      <EditTargetDialog metric={metric} open={dialog === "target"} onOpenChange={(o) => setDialog(o ? "target" : null)} />
    </>
  );
  const menu = <MetricMenu metric={metric} onRecord={() => setDialog("record")} onTarget={() => setDialog("target")} />;
  return { menu, dialogs };
}

/** A dense stat tile: name, value, delta, trend, target and source. */
export function MetricTile({ metric, today, className }: { metric: ScoreboardMetric; today: Date; className?: string }) {
  const { menu, dialogs } = useMetricDialogs(metric, today);
  const name = displayName(metric.name);
  const headingId = `metric-${metric.key}-name`;
  return (
    <article id={`metric-${metric.key}`} aria-labelledby={headingId} className={cn("flex min-w-0 scroll-mt-24 flex-col gap-2.5 bg-surface p-3.5 target:bg-brand-soft/40", className)}>
      <div className="flex items-start gap-2">
        <h3 id={headingId} className="line-clamp-2 min-w-0 flex-1 text-xs leading-snug font-medium text-ink-2" title={metric.description ?? undefined}>
          {name}
        </h3>
        {menu}
      </div>
      <div className="-mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-xl leading-tight font-semibold tracking-tight text-foreground">{formatMetricValue(metric.current, metric.unit)}</span>
        <DeltaLabel metric={metric} />
      </div>
      {metric.latestNote && (
        <p className="-mt-1 line-clamp-1 text-2xs text-ink-2" title={metric.latestNote}>
          <span className="text-muted-foreground">Note: </span>
          {metric.latestNote}
        </p>
      )}
      <TrendSparkline points={metric.series.slice(-12)} unit={metric.unit} label={name} height={28} endLabel={<Freshness metric={metric} today={today} />} />
      <TargetLine metric={metric} today={today} />
      <SourceLine metric={metric} />
      {dialogs}
    </article>
  );
}

/** Larger headline KPI for the top strip. */
export function HeadlineMetric({ metric, today, className }: { metric: ScoreboardMetric; today: Date; className?: string }) {
  const { menu, dialogs } = useMetricDialogs(metric, today);
  const name = displayName(metric.name);
  const Icon = METRIC_CATEGORIES[metric.category].icon;
  return (
    <div className={cn("flex min-w-0 flex-col gap-2.5 p-4", className)}>
      <div className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1 text-xs font-medium text-ink-2">
          <a href={`#metric-${metric.key}`} className="inline-flex max-w-full items-center gap-1.5 rounded-sm hover:text-foreground">
            <Icon className="size-3.5 shrink-0 text-ink-3" aria-hidden />
            <span className="truncate">{name}</span>
          </a>
        </h3>
        {menu}
      </div>
      <div>
        <div className="text-[28px] leading-none font-semibold tracking-tight text-foreground">{formatMetricValue(metric.current, metric.unit)}</div>
        <DeltaLabel metric={metric} className="mt-1.5" />
      </div>
      <TrendSparkline points={metric.series.slice(-12)} unit={metric.unit} label={name} height={36} endLabel={<Freshness metric={metric} today={today} />} />
      <TargetLine metric={metric} today={today} />
      {dialogs}
    </div>
  );
}
