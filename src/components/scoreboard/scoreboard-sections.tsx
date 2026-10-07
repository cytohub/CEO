import { ArrowUpRight, Cable, Sigma } from "lucide-react";
import Link from "next/link";
import { Panel } from "@/components/common/bits";
import { StatusPill } from "@/components/common/status";
import type { MetricCategory } from "@/generated/prisma/enums";
import { METRIC_CATEGORIES, METRIC_CATEGORY_ORDER } from "@/lib/domain";
import { cn } from "@/lib/utils";
import type { ScoreboardMetric, ScoreboardSource } from "@/server/queries/scoreboard";
import { HeadlineMetric, MetricTile } from "./metric-tile";

/**
 * Cells inside a panel: flex-wrap with hairline borders on every cell. The
 * negative margins tuck the outer borders under the panel edge, and cells in
 * a short last row stretch, so there are never empty holes in the grid.
 */
const CELL_GRID = "-mr-px -mb-px flex flex-wrap";
const CELL = "flex-1 border-r border-b border-hairline";

export function SourcesNote({ sources, derivedCount, manualCount }: { sources: ScoreboardSource[]; derivedCount: number; manualCount: number }) {
  return (
    <div className="panel flex flex-wrap items-start gap-x-4 gap-y-2 px-3.5 py-2.5">
      <Cable className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
      <div className="min-w-0 flex-1 basis-[280px]">
        <p className="text-xs text-ink-2">
          Built to connect to CytoHub’s real systems — finance, CRM and the lab’s ELN/LIMS. Today {derivedCount} metric{derivedCount === 1 ? " is" : "s are"} derived live from
          deals and cash, {manualCount} {manualCount === 1 ? "is" : "are"} recorded by hand, and the rest come from the sources below.
        </p>
        {sources.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Metric sources">
            {sources.map((s) => {
              const state = s.sample ? "sample data" : s.status === "CONNECTED" || s.status === "SYNCING" ? "connected" : s.status === "ERROR" ? "error" : "not connected";
              const tone = s.sample ? "info" : state === "connected" ? "good" : state === "error" ? "critical" : "neutral";
              return (
                <li key={s.key}>
                  <StatusPill tone={tone} label={`${s.name} · ${state}`} />
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <Link
        href="/settings"
        className="inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-medium text-brand hover:bg-brand-soft"
      >
        Brain sources
        <ArrowUpRight className="size-3" aria-hidden />
      </Link>
    </div>
  );
}

export function HeadlineStrip({ metrics, today }: { metrics: ScoreboardMetric[]; today: Date }) {
  if (metrics.length === 0) return null;
  return (
    <section aria-labelledby="headline-metrics" className="panel overflow-hidden">
      <h2 id="headline-metrics" className="sr-only">
        Headline metrics
      </h2>
      <div className={CELL_GRID}>
        {metrics.map((m) => (
          <HeadlineMetric key={m.id} metric={m} today={today} className={cn(CELL, "basis-[160px]")} />
        ))}
      </div>
    </section>
  );
}

const COMPOSITION_CATEGORIES = new Set<MetricCategory>(["PIPELINE", "FUNDRAISING"]);

export function MetricBoard({ metrics, today }: { metrics: ScoreboardMetric[]; today: Date }) {
  const groups = METRIC_CATEGORY_ORDER.map((category) => ({ category, items: metrics.filter((m) => m.category === category) })).filter((g) => g.items.length > 0);
  return (
    // Column count follows the available width (~360px per column), so every
    // breakpoint keeps tiles at a readable width instead of jumping density.
    <div className="columns-[26rem] gap-4">
      {groups.map(({ category, items }) => {
        const meta = METRIC_CATEGORIES[category];
        const id = `category-${category.toLowerCase()}`;
        return (
          <Panel
            key={category}
            id={id}
            title={meta.label}
            icon={meta.icon}
            count={items.length}
            className="mb-4 break-inside-avoid overflow-hidden"
            actions={
              COMPOSITION_CATEGORIES.has(category) ? (
                <a href="#pipeline-composition" className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
                  <Sigma className="size-3" aria-hidden />
                  Composition
                </a>
              ) : undefined
            }
          >
            <div className={CELL_GRID}>
              {items.map((m) => (
                <MetricTile key={m.id} metric={m} today={today} className={cn(CELL, "basis-[170px]")} />
              ))}
            </div>
          </Panel>
        );
      })}
    </div>
  );
}
