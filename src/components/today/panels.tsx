import { AlertTriangle, Compass, Gavel, Target } from "lucide-react";
import Link from "next/link";
import { EmptyState, Panel, PillarTag } from "@/components/common/bits";
import { Meter, StatusPill, TONE_DOT } from "@/components/common/status";
import { cn } from "@/lib/utils";
import { daysBetween, formatDay } from "@/lib/dates";
import { GOAL_STATUS, MILESTONE_STATUS } from "@/lib/domain";
import type { AttentionSummary } from "@/server/brain/attention";
import type { TodayData } from "@/server/queries/today";

export function DecisionsPanel({ decisions, today }: { decisions: TodayData["decisions"]; today: Date }) {
  return (
    <Panel id="decisions-needed" title="Decisions needed" icon={Gavel} count={decisions.length} href="/decisions">
      {decisions.length === 0 ? (
        <EmptyState compact title="No decisions waiting on you" />
      ) : (
        <ul className="divide-y divide-hairline">
          {decisions.map((d) => {
            const days = d.deadline ? daysBetween(today, d.deadline) : null;
            return (
              <li key={d.id}>
                <Link href={`/decisions/${d.id}`} className="block px-3.5 py-2.5 hover:bg-muted/50">
                  <div className="flex items-start gap-2">
                    <span className="line-clamp-2 flex-1 text-[13px] leading-snug font-medium">{d.title}</span>
                    {days !== null && (
                      <span className={cn("shrink-0 text-2xs font-medium tabular", days <= 1 ? "text-critical-ink" : days <= 3 ? "text-serious-ink" : "text-muted-foreground")}>
                        {days < 0 ? `${-days}d late` : days === 0 ? "Today" : `${days}d`}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-2xs text-muted-foreground">
                    <span>Impact {d.strategicImpact}/5</span>
                    <span>·</span>
                    <span>{d._count.options} options</span>
                    {d.goal && (
                      <>
                        <span>·</span>
                        <span className="truncate">{d.goal.title}</span>
                      </>
                    )}
                  </div>
                  {d.recommendation && <p className="mt-1 line-clamp-2 text-xs text-ink-2">→ {d.recommendation}</p>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function AtRiskPanel({ atRisk, today }: { atRisk: TodayData["atRisk"]; today: Date }) {
  const rows: { key: string; kind: string; title: string; detail: string; tone: "critical" | "warning" | "serious"; href: string }[] = [
    ...atRisk.riskyMilestones.map((m) => {
      const d = daysBetween(today, m.dueDate);
      return {
        key: `m-${m.id}`,
        kind: "Milestone",
        title: m.title,
        detail: `${d < 0 ? `${-d}d overdue` : `due ${formatDay(m.dueDate)}`} · ${m.progress}% · ${m.owner?.name ?? "—"}${m.blocker ? ` · ${m.blocker}` : ""}`,
        tone: (d < 0 || m.status === "BLOCKED" ? "critical" : "warning") as "critical" | "warning",
        href: `?milestone=${m.id}`,
      };
    }),
    ...atRisk.overdueTasks.map((t) => ({
      key: `t-${t.id}`,
      kind: "Overdue",
      title: t.title,
      detail: `${-daysBetween(today, t.dueDate!)}d overdue${t.postponeCount ? ` · postponed ${t.postponeCount}×` : ""}`,
      tone: "critical" as const,
      href: `?task=${t.id}`,
    })),
    ...atRisk.blockedTasks.map((t) => ({
      key: `b-${t.id}`,
      kind: "Blocked",
      title: t.title,
      detail: `${t.owner?.isCeo ? "You" : (t.owner?.name ?? "—")}${t.blocker ? ` · ${t.blocker}` : ""}`,
      tone: "serious" as const,
      href: `?task=${t.id}`,
    })),
    ...atRisk.riskyGoals.map((g) => ({
      key: `g-${g.id}`,
      kind: "Goal",
      title: g.title,
      detail: `${GOAL_STATUS[g.status].label} · ${g.progress}% · ${g.confidence}% confidence`,
      tone: (g.status === "OFF_TRACK" ? "critical" : "warning") as "critical" | "warning",
      href: `/goals/${g.id}`,
    })),
  ];
  return (
    <Panel id="at-risk" title="At risk, overdue & blocked" icon={AlertTriangle} count={rows.length} href="/milestones" hrefLabel="Milestones">
      {rows.length === 0 ? (
        <EmptyState compact title="Nothing at risk" description="Every milestone and priority is on track." />
      ) : (
        <ul className="divide-y divide-hairline">
          {rows.slice(0, 9).map((r) => (
            <li key={r.key}>
              <Link href={r.href} scroll={false} className="flex items-start gap-3 px-3.5 py-2 hover:bg-muted/50">
                <span className="mt-0.5 w-[72px] shrink-0">
                  <StatusPill tone={r.tone} label={r.kind} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-foreground">{r.title}</span>
                  <span className="block truncate text-2xs text-muted-foreground">{r.detail}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function GoalsPanel({ goals }: { goals: TodayData["goals"] }) {
  return (
    <Panel id="goal-progress" title="Goal progress" icon={Target} href="/goals">
      <ul className="divide-y divide-hairline">
        {goals.map((g) => {
          const status = GOAL_STATUS[g.status];
          return (
            <li key={g.id}>
              <Link href={`/goals/${g.id}`} className="block px-3.5 py-2 hover:bg-muted/50">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13px]">{g.title}</span>
                  <span className="text-xs font-medium tabular">{g.progress}%</span>
                </div>
                <Meter value={g.progress} tone={status.tone === "done" ? "good" : status.tone} className="mt-1.5" label={`${g.title} progress`} />
                <div className="mt-1 flex items-center gap-2 text-2xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <span className={cn("size-1.5 rounded-full", TONE_DOT[status.tone])} aria-hidden />
                    {status.label}
                  </span>
                  <span>·</span>
                  <span>{g.confidence}% confidence</span>
                  {g.pillar && <PillarTag name={g.pillar.name} color={g.pillar.color} compact className="ml-auto text-2xs" />}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/**
 * Actual vs recommended CEO attention as bullet bars: the bar is actual share
 * of time, the tick is the recommendation. Misalignment is flagged with a
 * label, never color alone.
 */
export function AttentionPanel({ attention, limit = 8 }: { attention: AttentionSummary; limit?: number }) {
  const areas = [...attention.areas]
    .filter((a) => a.actualPct > 0 || a.recommendedPct > 0)
    .sort((a, b) => Math.max(b.actualPct, b.recommendedPct) - Math.max(a.actualPct, a.recommendedPct))
    .slice(0, limit);
  const scaleMax = Math.max(10, ...areas.map((a) => Math.max(a.actualPct, a.recommendedPct))) * 1.1;
  return (
    <Panel id="attention" title="CEO attention allocation" icon={Compass} href="/performance" hrefLabel="Details">
      <div className="px-3.5 pt-2.5 pb-3">
        <div className="mb-2 flex items-center justify-between text-2xs text-muted-foreground">
          <span>Last {attention.windowDays} days · {attention.strategicPct}% strategic</span>
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-3 rounded-sm bg-brand" aria-hidden /> Actual
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-0.5 bg-foreground" aria-hidden /> Recommended
            </span>
          </span>
        </div>
        <ul className="space-y-2">
          {areas.map((a) => (
            <AttentionRow key={a.area} area={a} scaleMax={scaleMax} />
          ))}
        </ul>
        {attention.totalMinutes === 0 && <p className="py-3 text-center text-xs text-muted-foreground">Connect your calendar to measure where time goes.</p>}
      </div>
    </Panel>
  );
}

export function AttentionRow({ area: a, scaleMax }: { area: AttentionSummary["areas"][number]; scaleMax: number }) {
  return (
    <li title={`${a.label}: actual ${a.actualPct.toFixed(0)}% · recommended ${a.recommendedPct}%`}>
      <div className="mb-0.5 flex items-center gap-2 text-xs">
        <span className="min-w-0 flex-1 truncate text-ink-2">{a.label}</span>
        {a.flag && (
          <span className={cn("rounded px-1 text-2xs font-medium", a.flag === "under" ? "bg-warning-soft text-warning-ink" : "bg-serious-soft text-serious-ink")}>
            {a.flag === "under" ? "Under-invested" : "Over-invested"}
          </span>
        )}
        <span className="w-[74px] shrink-0 text-right text-2xs tabular">
          <span className="font-semibold text-foreground">{a.actualPct.toFixed(0)}%</span>
          <span className="text-muted-foreground"> / {a.recommendedPct}%</span>
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-track">
        <div className="absolute inset-y-0 left-0 rounded-full bg-brand" style={{ width: `${(a.actualPct / scaleMax) * 100}%` }} />
        <div className="absolute -top-0.5 h-3 w-0.5 rounded-full bg-foreground" style={{ left: `calc(${(a.recommendedPct / scaleMax) * 100}% - 1px)` }} aria-hidden />
      </div>
    </li>
  );
}

export function MilestoneStatusLabel({ status }: { status: keyof typeof MILESTONE_STATUS }) {
  return <StatusPill tone={MILESTONE_STATUS[status].tone} label={MILESTONE_STATUS[status].label} />;
}
