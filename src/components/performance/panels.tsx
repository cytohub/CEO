import { AlarmClock, Compass, Gavel, Sparkles, Target } from "lucide-react";
import Link from "next/link";
import { EmptyState, Panel } from "@/components/common/bits";
import { StatusPill } from "@/components/common/status";
import { EntityLink } from "@/components/review/entity-link";
import { AttentionBlock } from "@/components/review/weekly-sections";
import { ScoreChip } from "@/components/tasks/score";
import { DECISION_STATUS, FOCUS_AREAS, GOAL_STATUS } from "@/lib/domain";
import { formatDay } from "@/lib/dates";
import { formatMinutes, pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PerformanceData } from "@/server/queries/performance";
import { StrategicSplit } from "./perf-bits";

/** Completed work ranked by CEO Priority Score × strategic impact, with the time it took. */
export function ImpactListPanel({ items, range }: { items: PerformanceData["impactList"]; range: number }) {
  const max = Math.max(1, ...items.map((i) => i.impact));
  return (
    <Panel id="most-impact" title="What generated the most impact" icon={Sparkles} count={items.length}>
      <p className="border-b border-hairline px-3.5 py-2 text-2xs text-muted-foreground">
        Completed in the last {range} days, ranked by CEO Priority Score × strategic impact. Time is what it actually took you.
      </p>
      {items.length === 0 ? (
        <EmptyState compact title="Nothing completed in this window" />
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[560px] text-left text-[14px]">
            <thead>
              <tr className="text-2xs text-muted-foreground">
                <th scope="col" className="w-8 px-3.5 py-1.5 font-medium">
                  <span className="sr-only">Rank</span>#
                </th>
                <th scope="col" className="py-1.5 font-medium">
                  Task
                </th>
                <th scope="col" className="w-12 py-1.5 text-center font-medium">
                  Score
                </th>
                <th scope="col" className="w-16 py-1.5 text-center font-medium">
                  Strategic
                </th>
                <th scope="col" className="w-36 py-1.5 font-medium">
                  Impact
                </th>
                <th scope="col" className="w-20 px-3.5 py-1.5 text-right font-medium">
                  Time
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline border-t border-hairline">
              {items.map((t, i) => (
                <tr key={t.id} className="hover:bg-muted/40">
                  <td className="px-3.5 py-2 align-top font-mono text-2xs text-muted-foreground tabular">{i + 1}</td>
                  <td className="max-w-0 py-2 pr-3">
                    <EntityLink kind="task" id={t.id} className="block truncate text-foreground hover:underline" title={t.title}>
                      {t.title}
                    </EntityLink>
                    <span className="block truncate text-2xs text-muted-foreground">
                      {FOCUS_AREAS[t.focusArea].label}
                      {t.goal ? ` · ${t.goal.title}` : ""}
                      {t.completedAt ? ` · ${formatDay(t.completedAt)}` : ""}
                    </span>
                  </td>
                  <td className="py-2 text-center">
                    <ScoreChip score={t.score} className="h-5 min-w-8 text-2xs" />
                  </td>
                  <td className="py-2 text-center text-xs text-ink-2 tabular">{t.strategicImpact}/5</td>
                  <td className="py-2 pr-2">
                    <div className="flex items-center gap-2" title={`Impact ${t.impact} = score ${t.score} × strategic ${t.strategicImpact}`}>
                      <div className="h-1.5 flex-1 rounded-full bg-track">
                        <div className="h-full rounded-full bg-brand" style={{ width: `${(t.impact / max) * 100}%` }} />
                      </div>
                      <span className="w-8 text-right text-2xs font-semibold tabular">{t.impact}</span>
                    </div>
                  </td>
                  <td className={cn("px-3.5 py-2 text-right text-xs tabular", t.actualMinutes ? "text-ink-2" : "text-muted-foreground")}>{t.actualMinutes ? formatMinutes(t.actualMinutes) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export function OverduePanel({ overdue }: { overdue: PerformanceData["overdue"] }) {
  return (
    <Panel id="overdue" title="Overdue priorities now" icon={AlarmClock} count={overdue.count} href="/tasks?view=overdue" hrefLabel="Tasks">
      {overdue.count === 0 ? (
        <EmptyState compact title="Nothing overdue" description="Every CEO commitment is on schedule." />
      ) : (
        <ul className="divide-y divide-hairline">
          {overdue.tasks.slice(0, 6).map((t) => (
            <li key={t.id}>
              <EntityLink kind="task" id={t.id} className="flex items-start gap-3 px-3.5 py-2 hover:bg-muted/50">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px]">{t.title}</span>
                  <span className="block truncate text-2xs text-muted-foreground">
                    <span className="font-medium text-critical-ink">{t.daysOverdue}d overdue</span>
                    {t.postponeCount ? ` · postponed ${t.postponeCount}×` : ""}
                    {t.delegationRecommended ? " · Brain suggests delegating" : ""}
                    {t.goal ? ` · ${t.goal.title}` : ""}
                  </span>
                </span>
                <ScoreChip score={t.priorityScore} className="h-5 min-w-8 shrink-0 text-2xs" />
              </EntityLink>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function PendingDecisionsPanel({ pending }: { pending: PerformanceData["decisions"]["pending"] }) {
  return (
    <Panel id="pending-decisions" title="Decisions waiting on you" icon={Gavel} count={pending.length} href="/decisions">
      {pending.length === 0 ? (
        <EmptyState compact title="No pending decisions" />
      ) : (
        <ul className="divide-y divide-hairline">
          {pending.slice(0, 6).map((d) => (
            <li key={d.id}>
              <Link href={`/decisions/${d.id}`} className="flex items-start gap-3 px-3.5 py-2 hover:bg-muted/50">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px]">{d.title}</span>
                  <span className="mt-0.5 flex items-center gap-2 text-2xs text-muted-foreground">
                    <StatusPill tone={DECISION_STATUS[d.status].tone} label={DECISION_STATUS[d.status].label} />
                    Impact {d.strategicImpact}/5
                  </span>
                </span>
                <span className={cn("shrink-0 text-2xs tabular", d.daysOpen >= 14 ? "font-medium text-serious-ink" : "text-muted-foreground")}>{d.daysOpen}d open</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function TimePanel({ attention, strategic, range }: { attention: PerformanceData["attention"]; strategic: PerformanceData["strategic"]; range: number }) {
  return (
    <Panel id="time-allocation" title="Time allocation" icon={Compass} href="/settings" hrefLabel="Targets">
      <div className="border-b border-hairline px-3.5 py-3">
        <div className="mb-2 text-2xs font-medium text-muted-foreground">Strategic vs operational · last {range} days</div>
        <StrategicSplit pct={strategic.pct} target={strategic.target} />
      </div>
      <div className="pt-2">
        <AttentionBlock attention={attention} limit={9} />
      </div>
    </Panel>
  );
}

export function GoalHealthPanel({ goals, milestones, range }: { goals: PerformanceData["goals"]; milestones: PerformanceData["milestones"]; range: number }) {
  const shown = goals.byStatus.filter((s) => s.count > 0);
  return (
    <Panel id="goal-health" title="Goal progress" icon={Target} href="/goals" hrefLabel="Goals">
      <div className="grid grid-cols-2 gap-px border-b border-hairline bg-hairline">
        <div className="bg-surface px-3.5 py-2.5">
          <div className="text-2xs text-muted-foreground">Average progress</div>
          <div className="text-lg font-semibold tabular">{goals.avg !== null ? `${goals.avg}%` : "—"}</div>
          <div className="text-2xs text-muted-foreground tabular">
            {goals.trend.delta !== null && goals.trend.delta !== 0 ? `${goals.trend.delta > 0 ? "+" : "−"}${Math.abs(goals.trend.delta)} pts in ${range}d` : `Unchanged in ${range}d`}
          </div>
        </div>
        <div className="bg-surface px-3.5 py-2.5">
          <div className="text-2xs text-muted-foreground">Milestones achieved</div>
          <div className="text-lg font-semibold tabular">{milestones.count}</div>
          <div className="text-2xs text-muted-foreground tabular">{milestones.trend.prev !== null ? `${milestones.trend.prev} in the prior ${range}d` : ""}</div>
        </div>
      </div>
      <div className="px-3.5 py-3">
        <div className="mb-1.5 text-2xs font-medium text-muted-foreground">{pluralize(goals.total, "goal")} by status</div>
        <ul className="space-y-1.5">
          {shown.map((s) => {
            const meta = GOAL_STATUS[s.status];
            return (
              <li key={s.status} className="flex items-center gap-2 text-xs" title={`${meta.label}: ${s.count}`}>
                <span className="w-[86px] shrink-0">
                  <StatusPill tone={meta.tone} label={meta.label} />
                </span>
                <div className="h-1.5 flex-1 rounded-full bg-track">
                  <div className="h-full rounded-full bg-brand" style={{ width: `${(s.count / Math.max(goals.total, 1)) * 100}%` }} />
                </div>
                <span className="w-6 text-right text-2xs font-semibold tabular">{s.count}</span>
              </li>
            );
          })}
        </ul>
      </div>
      {milestones.items.length > 0 && (
        <ul className="divide-y divide-hairline border-t border-hairline">
          {milestones.items.slice(0, 4).map((m) => (
            <li key={m.id}>
              <EntityLink kind="milestone" id={m.id} className="flex items-center gap-2 px-3.5 py-1.5 text-xs hover:bg-muted/50">
                <span className="min-w-0 flex-1 truncate">{m.title}</span>
                <span className="shrink-0 text-2xs text-muted-foreground tabular">{m.completedAt ? formatDay(m.completedAt) : ""}</span>
              </EntityLink>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
