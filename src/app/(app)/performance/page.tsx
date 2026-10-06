import { AlarmClock, CheckCheck, Compass, Flag, Gauge, Handshake, Info, Timer, UsersRound } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/common/bits";
import { GoalHealthPanel, ImpactListPanel, OverduePanel, PendingDecisionsPanel, TimePanel } from "@/components/performance/panels";
import { CommitmentBar, KpiTile, PrivateBadge, RangeToggle, StrategicSplit, Top5Bars, TrendChip } from "@/components/performance/perf-bits";
import { formatDay } from "@/lib/dates";
import { pluralize } from "@/lib/format";
import { getPerformance, resolveRange } from "@/server/queries/performance";
import { requirePage } from "@/server/security/session";

export const metadata: Metadata = { title: "CEO Performance" };

const unitless = (n: number) => `${Math.round(n * 10) / 10}`;

export default async function PerformancePage(props: { searchParams: Promise<{ range?: string }> }) {
  await requirePage("performance.view", "/performance");
  const sp = await props.searchParams;
  const range = resolveRange(sp.range);
  const d = await getPerformance(range);
  const { top5, highImpact, commitments, overdue, delegation, decisions, strategic, milestones } = d;
  const judged = top5.done + top5.missed;
  const oldestPending = decisions.pending[0];

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <PageHeader
        className="pb-1"
        eyebrow={`Last ${range} days · ${formatDay(d.window.start)} – ${formatDay(d.window.end)}`}
        title={
          <span className="flex items-center gap-2">
            CEO Performance <PrivateBadge />
          </span>
        }
        description="Are the right things moving — and is your time going where CytoHub needs it?"
        actions={<RangeToggle range={range} />}
      />

      <p className="flex items-start gap-2 rounded-lg border border-hairline bg-surface-2/60 px-3.5 py-2.5 text-xs text-ink-2">
        <Info className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden />
        <span>
          <span className="font-medium text-foreground">Impact, not busyness.</span> No task counts or hours-worked scores here: these measures track whether your top priorities, commitments and
          decisions moved, how much you delegated, and whether your time matched your strategy. Trends compare with the {range} days before.
        </span>
      </p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          label="Top priorities completed"
          icon={CheckCheck}
          value={top5.rate === null ? "—" : `${top5.rate}%`}
          sub={judged ? `${top5.done} of ${judged} daily Top 5 priorities${top5.pending ? ` · ${top5.pending} in play` : ""}` : "No Top 5 history in this window"}
          trend={<TrendChip trend={top5.trend} unit=" pts" range={range} />}
          title="A Top 5 priority counts as completed when it is done by the end of the following day"
        >
          <Top5Bars days={top5.days} />
        </KpiTile>

        <KpiTile
          label="High-impact tasks completed"
          icon={Flag}
          value={highImpact.count}
          sub={`of ${pluralize(highImpact.completed, "completed task")} · strategic impact ≥ 4/5 or score ≥ 60`}
          trend={<TrendChip trend={highImpact.trend} range={range} />}
          title="Strategic impact ≥ 4/5 or CEO Priority Score ≥ 60"
        >
          {highImpact.timeShare !== null && (
            <div title={`High-impact work: ${highImpact.timeShare}% of the time spent on completed tasks`}>
              <div className="mb-1 flex justify-between text-2xs text-muted-foreground tabular">
                <span>Share of task time on high-impact work</span>
                <span className="font-semibold text-foreground">{highImpact.timeShare}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-track" aria-hidden>
                <div className="h-full rounded-full bg-brand" style={{ width: `${highImpact.timeShare}%` }} />
              </div>
            </div>
          )}
        </KpiTile>

        <KpiTile
          label="Commitments kept"
          icon={Handshake}
          value={commitments.rate === null ? "—" : `${commitments.rate}%`}
          sub={
            commitments.judged
              ? `${commitments.kept} of ${commitments.judged} external commitments on or before the due date`
              : `No hard deadlines or email/meeting commitments came due · ${commitments.upcoming} due in the next 14 days`
          }
          trend={<TrendChip trend={commitments.trend} unit=" pts" range={range} />}
          title="Tasks with a hard deadline, or captured from email or meetings, due in this window"
        >
          <CommitmentBar kept={commitments.kept} late={commitments.late} overdue={commitments.overdue} />
        </KpiTile>

        <KpiTile
          label="Overdue priorities now"
          icon={AlarmClock}
          value={<span className={overdue.count ? "text-critical-ink" : undefined}>{overdue.count}</span>}
          sub={overdue.count ? `Oldest ${Math.max(...overdue.tasks.map((t) => t.daysOverdue))}d overdue · ${overdue.tasks.filter((t) => t.postponeCount >= 2).length} repeatedly postponed` : "Nothing you own is overdue"}
          trend={<span className="text-2xs text-muted-foreground">Live — as of today</span>}
        >
          {overdue.tasks[0] && <div className="truncate text-2xs text-ink-2">Top: {overdue.tasks[0].title}</div>}
        </KpiTile>

        <KpiTile
          label="Delegation rate"
          icon={UsersRound}
          value={delegation.rate === null ? "—" : `${delegation.rate}%`}
          sub={`${delegation.delegated} delegated of ${delegation.delegated + delegation.ownedNew} new tasks you owned`}
          trend={<TrendChip trend={delegation.trend} unit=" pts" range={range} />}
          title="Share of new CEO-owned work that was delegated in this window"
        >
          <div className="text-2xs text-muted-foreground tabular">
            {delegation.completed ? (
              <>
                <span className="font-semibold text-foreground">{delegation.onTime}</span> of {pluralize(delegation.completed, "delegation")} completed on time ·{" "}
              </>
            ) : (
              "No delegations completed yet · "
            )}
            {delegation.active} active
          </div>
        </KpiTile>

        <KpiTile
          label="Decision speed"
          icon={Timer}
          value={decisions.median === null ? "—" : `${unitless(decisions.median)}d`}
          sub={`Median raised → decided · ${pluralize(decisions.decided, "decision")} made`}
          trend={<TrendChip trend={decisions.trend} unit="d" lowerIsBetter words={["faster", "slower"]} range={range} format={unitless} />}
        >
          <div className="text-2xs text-muted-foreground">
            {decisions.pending.length ? (
              <>
                <span className="font-semibold text-foreground tabular">{decisions.pending.length}</span> pending · oldest {oldestPending?.daysOpen}d open
              </>
            ) : (
              "No decisions pending"
            )}
          </div>
        </KpiTile>

        <KpiTile
          label="Time on strategic work"
          icon={Compass}
          value={strategic.pct === null ? "—" : `${strategic.pct}%`}
          sub={`Recommended ${strategic.target}% · ${Math.round(d.attention.totalMinutes / 60)}h tracked`}
          trend={<TrendChip trend={strategic.trend} unit=" pts" range={range} />}
        >
          <StrategicSplit pct={strategic.pct} target={strategic.target} />
        </KpiTile>

        <KpiTile
          label="Milestones achieved"
          icon={Gauge}
          value={milestones.count}
          sub={milestones.items[0] ? `Latest: ${milestones.items[0].title}` : "None in this window"}
          trend={<TrendChip trend={milestones.trend} range={range} />}
        >
          <div className="text-2xs text-muted-foreground tabular">
            Goals average <span className="font-semibold text-foreground">{d.goals.avg ?? "—"}%</span>
            {d.goals.trend.delta ? ` (${d.goals.trend.delta > 0 ? "+" : "−"}${Math.abs(d.goals.trend.delta)} pts)` : ""}
          </div>
        </KpiTile>
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="min-w-0 space-y-4 xl:col-span-8">
          <ImpactListPanel items={d.impactList} range={range} />
          <div className="grid gap-4 lg:grid-cols-2">
            <OverduePanel overdue={overdue} />
            <PendingDecisionsPanel pending={decisions.pending} />
          </div>
        </div>
        <div className="min-w-0 space-y-4 xl:col-span-4">
          <TimePanel attention={d.attention} strategic={strategic} range={range} />
          <GoalHealthPanel goals={d.goals} milestones={milestones} range={range} />
        </div>
      </div>
    </div>
  );
}
