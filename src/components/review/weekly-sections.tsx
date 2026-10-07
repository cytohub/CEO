import { ArrowRight, Compass, Gavel, ListChecks, OctagonAlert, Target, TrendingUp, Trophy, UserRoundMinus, XCircle } from "lucide-react";
import Link from "next/link";
import { EmptyState, Panel, PillarTag } from "@/components/common/bits";
import { StatusPill } from "@/components/common/status";
import { ScoreChip } from "@/components/tasks/score";
import { AttentionRow } from "@/components/today/panels";
import { DECISION_STATUS, FOCUS_AREAS, GOAL_STATUS, GOAL_TYPES, MILESTONE_STATUS } from "@/lib/domain";
import { daysBetween, formatDay, relativeDay } from "@/lib/dates";
import { formatCurrency, formatMinutes, pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AttentionSummary } from "@/server/brain/attention";
import type { GoalMove, WeeklyReview } from "@/server/queries/reviews";
import { EntityLink, OpenTaskButton } from "./entity-link";
import { DeltaBar, DeltaLegend, DeltaText, ItemRows, LiveNote, SubSection, type RowItem } from "./review-bits";

const IMPACT = ["Minimal", "Low", "Moderate", "Meaningful", "High", "Critical"];

// ─── Wins ────────────────────────────────────────────────────────────────────

export function WinsPanel({ wins }: { wins: WeeklyReview["wins"] }) {
  const total = wins.completed.length + wins.milestones.length + wins.goalsUp.length + wins.dealsWon.length;
  const tasks: RowItem[] = wins.completed.map((t) => ({
    key: t.id,
    title: t.title,
    entity: { kind: "task", id: t.id },
    detail: (
      <>
        {t.highImpact && <span className="font-medium text-brand">High impact · </span>}
        {IMPACT[t.strategicImpact]} strategic impact{t.goal ? ` · ${t.goal.title}` : ""}
      </>
    ),
    meta: t.actualMinutes ? formatMinutes(t.actualMinutes) : undefined,
    score: t.score,
    muted: !t.highImpact,
  }));
  const other: RowItem[] = [
    ...wins.milestones.map<RowItem>((m) => ({
      key: `m-${m.id}`,
      title: m.title,
      entity: { kind: "milestone", id: m.id },
      tag: { tone: "good", label: "Milestone" },
      detail: [m.goal?.title, m.completedAt ? `reached ${formatDay(m.completedAt)}` : null].filter(Boolean).join(" · "),
    })),
    ...wins.dealsWon.map<RowItem>((d) => ({
      key: `d-${d.id}`,
      title: d.name,
      href: d.companyId ? `/resources/companies/${d.companyId}` : "/scoreboard",
      tag: { tone: "good", label: "Deal won" },
      detail: d.value ? formatCurrency(d.value) : undefined,
    })),
    ...wins.goalsUp.map<RowItem>((g) => ({
      key: `g-${g.id}`,
      title: g.title,
      href: `/goals/${g.id}`,
      tag: { tone: "info", label: "Goal up" },
      detail: `${g.from}% → ${g.to}% · ${GOAL_TYPES[g.type].label}`,
      meta: <DeltaText delta={g.delta} />,
    })),
  ];
  return (
    <Panel id="wins" title="Wins" icon={Trophy} count={total}>
      {total === 0 ? (
        <EmptyState compact title="No wins recorded yet" description="Completed priorities, milestones and goal progress land here." />
      ) : (
        <div className="divide-y divide-hairline">
          {tasks.length > 0 && (
            <SubSection title="Completed — highest impact first" count={tasks.length}>
              <ItemRows items={tasks} max={6} />
            </SubSection>
          )}
          {other.length > 0 && (
            <SubSection title="Milestones, deals & goals" count={other.length}>
              <ItemRows items={other} max={6} />
            </SubSection>
          )}
        </div>
      )}
    </Panel>
  );
}

// ─── Misses ──────────────────────────────────────────────────────────────────

export function MissesPanel({ misses }: { misses: WeeklyReview["misses"] }) {
  const total = misses.missedTop5.length + misses.becameOverdue.length + misses.rescheduled.length;
  return (
    <Panel id="misses" title="Misses" icon={XCircle} count={total}>
      {total === 0 ? (
        <EmptyState compact title="Nothing slipped" description="Every Top 5 priority and commitment landed on time." />
      ) : (
        <div className="divide-y divide-hairline">
          {misses.missedTop5.length > 0 && (
            <SubSection title="Top 5 priorities not completed" count={misses.missedTop5.length}>
              <ItemRows
                max={5}
                items={misses.missedTop5.map((m) => ({
                  key: m.taskId,
                  title: m.title,
                  entity: { kind: "task", id: m.taskId },
                  detail: `In the Top 5 on ${pluralize(m.days, "day")} · not completed by the next day`,
                  score: m.score,
                }))}
              />
            </SubSection>
          )}
          {misses.becameOverdue.length > 0 && (
            <SubSection title="Became overdue" count={misses.becameOverdue.length}>
              <ItemRows
                max={5}
                items={misses.becameOverdue.map((t) => ({
                  key: t.id,
                  title: t.title,
                  entity: { kind: "task", id: t.id },
                  tag: t.completedAt ? { tone: "warning", label: "Late" } : { tone: "critical", label: "Overdue" },
                  detail: `Due ${formatDay(t.dueDate)}${t.completedAt ? ` · completed ${pluralize(t.lateDays, "day")} late` : ` · ${pluralize(t.lateDays, "day")} overdue`}${t.postponeCount ? ` · postponed ${t.postponeCount}×` : ""}`,
                }))}
                tagWidth="w-[68px]"
              />
            </SubSection>
          )}
          {misses.rescheduled.length > 0 && (
            <SubSection title="Commitments rescheduled" count={misses.rescheduled.length}>
              <ItemRows
                max={5}
                items={misses.rescheduled.map((r) => ({
                  key: r.taskId,
                  title: r.title,
                  entity: { kind: "task", id: r.taskId },
                  detail: (
                    <>
                      {r.from ? formatDay(new Date(`${r.from}T00:00:00Z`)) : "No date"} <ArrowRight className="inline size-3" aria-label="to" /> {r.to ? formatDay(new Date(`${r.to}T00:00:00Z`)) : "No date"}
                      {" · "}
                      {r.owner ? (r.owner.isCeo ? "You" : r.owner.name) : "Unassigned"}
                      {r.postponeCount >= 2 ? ` · postponed ${r.postponeCount}× in total` : ""}
                      {r.done ? " · since completed" : ""}
                    </>
                  ),
                  meta: r.times > 1 ? `${r.times}× this week` : undefined,
                }))}
              />
            </SubSection>
          )}
        </div>
      )}
    </Panel>
  );
}

// ─── Strategic progress ──────────────────────────────────────────────────────

export function GoalMoveRow({ g, showType = true, compact = false }: { g: GoalMove & { owner?: { name: string; isCeo: boolean } | null }; showType?: boolean; compact?: boolean }) {
  const status = GOAL_STATUS[g.status];
  if (compact) {
    const changes = g.statusChanges.map((c) => `${GOAL_STATUS[c.from]?.label ?? c.from} → ${GOAL_STATUS[c.to]?.label ?? c.to}`).join(", ");
    return (
      <li>
        <Link href={`/goals/${g.id}`} className="grid items-center gap-x-3 gap-y-1 px-3.5 py-1.5 hover:bg-muted/50 sm:grid-cols-[minmax(0,1fr)_84px_240px]">
          <span className="min-w-0 truncate text-[14px] text-foreground" title={g.title}>
            {g.title}
            {changes && <span className="ml-2 text-2xs text-ink-2">{changes}</span>}
          </span>
          <span className="hidden sm:block">
            <StatusPill tone={status.tone} label={status.label} />
          </span>
          <span className="flex items-center gap-2">
            <span className="sm:hidden">
              <StatusPill tone={status.tone} label={status.label} />
            </span>
            <span className="w-[74px] shrink-0 text-2xs text-muted-foreground tabular">
              {g.from}% <ArrowRight className="inline size-2.5" aria-label="to" /> <span className="font-semibold text-foreground">{g.to}%</span>
            </span>
            <DeltaBar from={g.from} to={g.to} label={g.title} className="min-w-12 flex-1" />
            <DeltaText delta={g.delta} unit="" className="w-8 shrink-0 text-right text-2xs" />
          </span>
        </Link>
      </li>
    );
  }
  return (
    <li>
      <Link href={`/goals/${g.id}`} className="grid gap-x-4 gap-y-1.5 px-3.5 py-2.5 hover:bg-muted/50 sm:grid-cols-[minmax(0,1fr)_200px]">
        <div className="min-w-0">
          <div className="truncate text-[14px] text-foreground" title={g.title}>
            {g.title}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
            <StatusPill tone={status.tone} label={status.label} />
            {showType && <span>{GOAL_TYPES[g.type].label}</span>}
            {g.pillar && <PillarTag name={g.pillar.name} color={g.pillar.color} compact className="text-2xs" />}
            {g.statusChanges.map((c, i) => (
              <span key={i} className="text-ink-2">
                {GOAL_STATUS[c.from]?.label ?? c.from} → {GOAL_STATUS[c.to]?.label ?? c.to}
              </span>
            ))}
          </div>
        </div>
        <div className="self-center">
          <div className="mb-1 flex items-baseline justify-between gap-2 text-2xs tabular">
            <span className="text-muted-foreground">
              {g.from}% <ArrowRight className="inline size-2.5" aria-label="to" /> <span className="font-semibold text-foreground">{g.to}%</span>
            </span>
            <DeltaText delta={g.delta} />
          </div>
          <DeltaBar from={g.from} to={g.to} label={g.title} />
        </div>
      </Link>
    </li>
  );
}

export function StrategicProgressPanel({ goals }: { goals: GoalMove[] }) {
  return (
    <Panel id="strategic-progress" title="Strategic progress" icon={TrendingUp} count={goals.length} href="/goals" hrefLabel="Goals" actions={goals.length > 0 ? <DeltaLegend className="mr-2 hidden sm:flex" /> : undefined}>
      {goals.length === 0 ? (
        <EmptyState compact title="No goal updates this week" description="Goals move when progress or status is updated." />
      ) : (
        <ul className="divide-y divide-hairline">
          {goals.map((g) => (
            <GoalMoveRow key={g.id} g={g} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ─── Bottlenecks ─────────────────────────────────────────────────────────────

export function BottlenecksPanel({ b, today, live }: { b: WeeklyReview["bottlenecks"]; today: Date; live: boolean }) {
  const who = (o: { name: string; isCeo: boolean } | null) => (o ? (o.isCeo ? "You" : o.name) : "Unassigned");
  const items: RowItem[] = [
    ...b.postponed.map<RowItem>((t) => ({
      key: `p-${t.id}`,
      title: t.title,
      entity: { kind: "task", id: t.id },
      tag: { tone: "serious", label: `Postponed ${t.postponeCount}×` },
      detail: `${who(t.owner)}${t.dueDate ? ` · due ${relativeDay(t.dueDate, today)}` : ""} · do, delegate or drop`,
    })),
    ...b.blockedTasks.map<RowItem>((t) => ({
      key: `b-${t.id}`,
      title: t.title,
      entity: { kind: "task", id: t.id },
      tag: { tone: "critical", label: "Blocked" },
      detail: `${who(t.owner)}${t.blocker ? ` · ${t.blocker}` : ""}`,
    })),
    ...b.blockedMilestones.map<RowItem>((m) => ({
      key: `m-${m.id}`,
      title: m.title,
      entity: { kind: "milestone", id: m.id },
      tag: { tone: MILESTONE_STATUS[m.status].tone, label: "Milestone" },
      detail: `${m.blocker} · due ${formatDay(m.dueDate)}`,
    })),
    ...b.followUps.map<RowItem>((d) => ({
      key: `d-${d.id}`,
      title: d.task.title,
      entity: { kind: "task", id: d.task.id },
      tag: { tone: "warning", label: "Follow up" },
      detail: `Delegated to ${d.delegate.name}${d.dueDate ? ` · due ${relativeDay(d.dueDate, today)}` : ""}`,
    })),
    ...b.waitingDecisions.map<RowItem>((d) => ({
      key: `w-${d.id}`,
      title: d.title,
      href: `/decisions/${d.id}`,
      tag: { tone: "neutral", label: "Needs info" },
      detail: d.waitingOn ? `Waiting on ${d.waitingOn}` : "Waiting for information",
    })),
  ];
  return (
    <Panel id="bottlenecks" title="Bottlenecks" icon={OctagonAlert} count={items.length} actions={<LiveNote show={live} />}>
      {items.length === 0 ? (
        <EmptyState compact title="No bottlenecks" description="Nothing is repeatedly slipping, blocked or waiting." />
      ) : (
        <ItemRows items={items} max={10} tagWidth="w-[104px]" />
      )}
    </Panel>
  );
}

// ─── Decisions ───────────────────────────────────────────────────────────────

export function DecisionsReviewPanel({ decisions, title = "Decisions" }: { decisions: WeeklyReview["decisions"]; title?: string }) {
  return (
    <Panel id="decisions" title={title} icon={Gavel} count={decisions.made.length} href="/decisions">
      <div className="divide-y divide-hairline">
        <SubSection title="Made" count={decisions.made.length}>
          {decisions.made.length === 0 ? (
            <p className="px-3.5 pb-3 text-xs text-muted-foreground">No decisions recorded in this period.</p>
          ) : (
            <ul className="divide-y divide-hairline">
              {decisions.made.map((d) => (
                <li key={d.id}>
                  <Link href={`/decisions/${d.id}`} className="block px-3.5 py-2 hover:bg-muted/50">
                    <div className="flex items-start gap-2">
                      <span className="line-clamp-2 flex-1 text-[14px] leading-snug">{d.title}</span>
                      <span className="shrink-0 text-2xs text-muted-foreground tabular">Impact {d.strategicImpact}/5</span>
                    </div>
                    {d.finalDecision && <p className="mt-0.5 line-clamp-2 text-xs text-ink-2">→ {d.finalDecision}</p>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SubSection>
        <SubSection title="Still pending" count={decisions.pending.length}>
          <ItemRows
            empty="No open decisions."
            max={5}
            tagWidth="w-[112px]"
            items={decisions.pending.map((d) => ({
              key: d.id,
              title: d.title,
              href: `/decisions/${d.id}`,
              tag: { tone: DECISION_STATUS[d.status].tone, label: DECISION_STATUS[d.status].label },
              detail: `Impact ${d.strategicImpact}/5${d.deadline ? ` · deadline ${formatDay(d.deadline)}` : ""}`,
              meta: <span className={cn(d.daysOpen >= 14 ? "font-medium text-serious-ink" : "")}>{d.daysOpen}d open</span>,
            }))}
          />
        </SubSection>
      </div>
    </Panel>
  );
}

// ─── Delegation & attention ──────────────────────────────────────────────────

export function AttentionBlock({ attention, emptyHint, limit = 8 }: { attention: AttentionSummary; emptyHint?: string; limit?: number }) {
  const all = [...attention.areas]
    .filter((a) => a.actualPct > 0 || a.recommendedPct > 0)
    .sort((a, b) => Math.max(b.actualPct, b.recommendedPct) - Math.max(a.actualPct, a.recommendedPct));
  // Keep flagged areas visible even when they fall outside the top rows.
  const areas = [...all.slice(0, limit), ...all.slice(limit).filter((a) => a.flag)];
  const rest = all.slice(limit).filter((a) => !a.flag);
  const scaleMax = Math.max(10, ...areas.map((a) => Math.max(a.actualPct, a.recommendedPct))) * 1.1;
  if (attention.totalMinutes === 0) {
    return <p className="px-3.5 py-4 text-xs text-muted-foreground">{emptyHint ?? "No time recorded for this period yet."}</p>;
  }
  return (
    <div className="px-3.5 pt-1 pb-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-2xs text-muted-foreground">
        <span className="tabular">
          {formatMinutes(attention.totalMinutes)} tracked · {attention.strategicPct}% strategic
        </span>
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
      {rest.length > 0 && (
        <p className="mt-2 text-2xs text-muted-foreground tabular" title={rest.map((a) => `${a.label} ${a.actualPct.toFixed(0)}% / ${a.recommendedPct}%`).join(" · ")}>
          +{rest.length} smaller areas within range: {rest.map((a) => a.label).join(", ")}
        </p>
      )}
    </div>
  );
}

export function DelegationPanel({ delegation, today }: { delegation: WeeklyReview["delegation"]; today: Date }) {
  const { recommendations, timeSinks, attention } = delegation;
  const misaligned = attention.misaligned.slice(0, 2);
  return (
    <Panel id="delegation" title="Delegation — what to stop doing personally" icon={UserRoundMinus} count={recommendations.length + timeSinks.length} href="/delegation" hrefLabel="Delegation">
      <div className="grid lg:grid-cols-2 lg:divide-x lg:divide-hairline">
        <div className="min-w-0 divide-y divide-hairline">
          <SubSection title="Hand off" count={recommendations.length}>
            <ItemRows
              empty="The Brain has no delegation recommendations."
              max={5}
              items={recommendations.map((t) => ({
                key: t.id,
                title: t.title,
                entity: { kind: "task", id: t.id },
                detail: (
                  <>
                    {t.suggestedDelegate ? (
                      <>
                        → <span className="font-medium text-ink-2">{t.suggestedDelegate.name}</span>
                      </>
                    ) : (
                      "No suggested owner yet"
                    )}
                    {` · uniqueness ${t.ceoUniqueness}/5`}
                    {t.estimatedMinutes ? ` · frees ${formatMinutes(t.estimatedMinutes)}` : ""}
                    {t.dueDate ? ` · due ${relativeDay(t.dueDate, today)}` : ""}
                  </>
                ),
              }))}
            />
          </SubSection>
          <SubSection title="Time sinks this period" count={timeSinks.length}>
            <ItemRows
              empty="No low-leverage work took more than an hour."
              max={5}
              items={timeSinks.map((t) => ({
                key: t.id,
                title: t.title,
                entity: { kind: "task", id: t.id },
                detail: `${FOCUS_AREAS[t.focusArea].label} · strategic ${t.strategicImpact}/5 · uniqueness ${t.ceoUniqueness}/5`,
                meta: <span className="font-medium text-foreground">{formatMinutes(t.actualMinutes)}</span>,
              }))}
            />
          </SubSection>
        </div>
        <div className="min-w-0 border-t border-hairline lg:border-t-0">
          <SubSection title="Time allocation vs recommended">
            <AttentionBlock attention={attention} />
            {misaligned.length > 0 && (
              <p className="border-t border-hairline px-3.5 py-2 text-2xs text-ink-2">
                <Compass className="mr-1 inline size-3 text-ink-3" aria-hidden />
                {misaligned
                  .map((a) => `${a.label} ${a.flag === "over" ? "over" : "under"} by ${Math.abs(a.gap).toFixed(0)} pts`)
                  .join(" · ")}
              </p>
            )}
          </SubSection>
        </div>
      </div>
    </Panel>
  );
}

// ─── Next week ───────────────────────────────────────────────────────────────

export function NextWeekPanel({ tasks, today, weekLabel, basedOnToday }: { tasks: WeeklyReview["nextWeek"]; today: Date; weekLabel: string; basedOnToday: boolean }) {
  return (
    <Panel id="next-week" title="Next week — top five priorities" icon={Target} count={tasks.length} href="/tasks" hrefLabel="Tasks">
      <p className="border-b border-hairline px-3.5 py-2 text-2xs text-muted-foreground">
        {weekLabel} · highest CEO Priority Score, due-soon first, max two per goal{basedOnToday ? " · based on open work today" : ""}
      </p>
      {tasks.length === 0 ? (
        <EmptyState compact icon={ListChecks} title="No open CEO priorities" />
      ) : (
        <ol className="divide-y divide-hairline">
          {tasks.map((t, i) => {
            const overdue = t.dueDate ? daysBetween(today, t.dueDate) < 0 : false;
            return (
              <li key={t.id} className="flex items-start gap-3 px-3.5 py-2.5">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border font-mono text-[11px] font-semibold text-muted-foreground tabular">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2">
                    <EntityLink kind="task" id={t.id} className="min-w-0 flex-1 text-[14px] leading-snug font-medium text-foreground hover:underline">
                      {t.title}
                    </EntityLink>
                    <ScoreChip score={t.priorityScore} className="h-5 min-w-8 shrink-0 text-2xs" />
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-2xs text-muted-foreground">
                    <span className={cn("tabular", overdue && "font-medium text-critical-ink")}>{t.dueDate ? `Due ${relativeDay(t.dueDate, today)}` : "No date"}</span>
                    {t.hardDeadline && <span className="text-serious-ink">Hard deadline</span>}
                    {t.status === "BLOCKED" && <span className="text-critical-ink">Blocked</span>}
                    {t.goal && <span className="truncate">{t.goal.title}</span>}
                  </div>
                  {t.aiRecommendation && (
                    <p className="mt-1 line-clamp-2 text-xs text-ink-2">
                      <span className="text-brain">Why: </span>
                      {t.aiRecommendation}
                    </p>
                  )}
                </div>
                <OpenTaskButton taskId={t.id} label="Plan" className="-mr-1.5 shrink-0" />
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
