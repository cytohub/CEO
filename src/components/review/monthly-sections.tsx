import { CircleDollarSign, Compass, Flag, Gavel, Landmark, Lightbulb, Milestone as MilestoneIcon, ShieldAlert, Siren, Target, Trophy } from "lucide-react";
import Link from "next/link";
import { EmptyState, Panel, Sparkline } from "@/components/common/bits";
import { ScoreChip } from "@/components/tasks/score";
import type { GoalType } from "@/generated/prisma/enums";
import { GOAL_STATUS, GOAL_TYPES, MILESTONE_STATUS } from "@/lib/domain";
import { formatDay, formatDateTime, relativeDay } from "@/lib/dates";
import { formatCurrency, formatMetric, pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AttentionSummary } from "@/server/brain/attention";
import type { MetricProgress, MonthlyReview } from "@/server/queries/reviews";
import { EntityLink } from "./entity-link";
import { DeltaLegend, ItemRows, SubSection, type RowItem } from "./review-bits";
import { AttentionBlock, GoalMoveRow } from "./weekly-sections";

// ─── Goals ───────────────────────────────────────────────────────────────────

export function GoalProgressPanel({ goals }: { goals: MonthlyReview["goals"] }) {
  const types = (["COMPANY", "ANNUAL", "QUARTERLY", "CEO"] as GoalType[]).filter((t) => goals.some((g) => g.type === t));
  return (
    <Panel id="goal-progress" title="Goal progress — start of month vs now" icon={Target} count={goals.length} href="/goals" hrefLabel="Goals" actions={<DeltaLegend className="mr-2 hidden sm:flex" />}>
      <div className="divide-y divide-hairline">
        {types.map((t) => {
          const rows = goals.filter((g) => g.type === t);
          return (
            <SubSection key={t} title={GOAL_TYPES[t].plural} count={rows.length}>
              <ul className="divide-y divide-hairline">
                {rows.map((g) => (
                  <GoalMoveRow key={g.id} g={g} showType={false} compact />
                ))}
              </ul>
            </SubSection>
          );
        })}
      </div>
    </Panel>
  );
}

// ─── Milestones ──────────────────────────────────────────────────────────────

export function MilestoneProgressPanel({ milestones, today, nextLabel }: { milestones: MonthlyReview["milestones"]; today: Date; nextLabel: string }) {
  const cols: { title: string; items: RowItem[]; empty: string }[] = [
    {
      title: "Completed",
      empty: "No milestones reached.",
      items: milestones.completed.map((m) => ({
        key: m.id,
        title: m.title,
        entity: { kind: "milestone", id: m.id },
        detail: m.completedAt ? `Reached ${formatDay(m.completedAt)} · ${m.lateDays > 0 ? `${m.lateDays}d after due date` : "on time"}` : undefined,
      })),
    },
    {
      title: "Missed",
      empty: "Nothing missed.",
      items: milestones.missed.map((m) => ({
        key: m.id,
        title: m.title,
        entity: { kind: "milestone", id: m.id },
        detail: `Due ${formatDay(m.dueDate)} · ${MILESTONE_STATUS[m.status].label} · ${m.progress}%${m.blocker ? ` · ${m.blocker}` : ""}`,
      })),
    },
    {
      title: nextLabel,
      empty: "Nothing due.",
      items: milestones.next.map((m) => ({
        key: m.id,
        title: m.title,
        entity: { kind: "milestone", id: m.id },
        detail: `${relativeDay(m.dueDate, today, false)} · ${MILESTONE_STATUS[m.status].label} · ${m.progress}%`,
      })),
    },
  ];
  return (
    <Panel id="milestone-progress" title="Milestone progress" icon={MilestoneIcon} href="/milestones" hrefLabel="Milestones">
      <div className="grid divide-y divide-hairline md:grid-cols-3 md:divide-x md:divide-y-0">
        {cols.map((c) => (
          <SubSection key={c.title} title={c.title} count={c.items.length}>
            <ItemRows items={c.items} empty={c.empty} max={5} />
          </SubSection>
        ))}
      </div>
    </Panel>
  );
}

// ─── Revenue & fundraising ───────────────────────────────────────────────────

function MetricRow({ m, label }: { m: MetricProgress; label?: string }) {
  const up = m.change !== null && m.change > 0;
  const down = m.change !== null && m.change < 0;
  return (
    <li className="flex items-center gap-3 px-3.5 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs text-ink-2">{label ?? m.name}</div>
        <div className="mt-0.5 flex items-baseline gap-1.5 tabular">
          <span className="text-2xs text-muted-foreground">{formatMetric(m.start, m.unit)} →</span>
          <span className="text-[16px] font-semibold tracking-tight text-foreground">{formatMetric(m.end, m.unit)}</span>
          {m.change !== null && (
            <span className={cn("text-2xs font-medium", up ? "text-good-ink" : down ? "text-critical-ink" : "text-muted-foreground")}>
              {m.change === 0 ? "±0" : `${up ? "+" : "−"}${formatMetric(Math.abs(m.change), m.unit)}`}
            </span>
          )}
        </div>
        {m.target !== null && m.end !== null && (
          <div className="mt-0.5 text-2xs text-muted-foreground tabular">
            Target {formatMetric(m.target, m.unit)} · {Math.round((m.end / m.target) * 100)}%
          </div>
        )}
      </div>
      <Sparkline values={m.series} width={88} height={26} />
    </li>
  );
}

export function RevenuePanel({ revenue }: { revenue: MetricProgress[] }) {
  return (
    <Panel id="revenue" title="Revenue progress" icon={CircleDollarSign} href="/scoreboard" hrefLabel="Scoreboard">
      {revenue.length === 0 ? (
        <EmptyState compact title="No revenue metrics recorded" />
      ) : (
        <ul className="divide-y divide-hairline">
          {revenue.map((m) => (
            <MetricRow key={m.key} m={m} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function FundraisingPanel({ f, timezone, periodPast }: { f: MonthlyReview["fundraising"]; timezone: string; periodPast: boolean }) {
  const maxValue = Math.max(1, ...f.stages.map((s) => s.value));
  return (
    <Panel id="fundraising" title="Fundraising progress" icon={Landmark} href="/scoreboard" hrefLabel="Scoreboard">
      <ul className="divide-y divide-hairline">{f.committed && <MetricRow m={f.committed} label="Round committed" />}</ul>
      <SubSection title={periodPast ? "Investor pipeline by stage · today" : "Investor pipeline by stage"} count={f.openCount} className="border-t border-hairline" aside={<span className="text-2xs text-muted-foreground tabular">{formatCurrency(f.openValue)} open</span>}>
        {f.stages.length === 0 ? (
          <p className="px-3.5 pb-3 text-xs text-muted-foreground">No open investor conversations.</p>
        ) : (
          <ul className="space-y-2 px-3.5 pt-1 pb-3">
            {f.stages.map((s) => (
              <li key={s.stage} title={`${s.stage}: ${pluralize(s.count, "investor")} · ${formatCurrency(s.value)} — ${s.deals.join(", ")}`}>
                <div className="mb-0.5 flex items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate text-ink-2">
                    {s.stage} <span className="text-muted-foreground">· {s.deals.join(", ")}</span>
                  </span>
                  <span className="shrink-0 text-2xs font-semibold tabular">{formatCurrency(s.value)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-track">
                  <div className="h-full rounded-full bg-brand" style={{ width: `${(s.value / maxValue) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </SubSection>
      <SubSection title="Investor meetings held" count={f.meetings.length} className="border-t border-hairline">
        <ItemRows
          empty="No investor meetings this month."
          max={4}
          items={f.meetings.map((m) => ({
            key: m.id,
            title: m.title,
            entity: { kind: "meeting", id: m.id },
            detail: [m.company?.name, formatDateTime(m.startsAt, timezone)].filter(Boolean).join(" · "),
          }))}
        />
      </SubSection>
    </Panel>
  );
}

// ─── Wins, problems, decisions ───────────────────────────────────────────────

export function StrategicWinsPanel({ wins }: { wins: MonthlyReview["wins"] }) {
  const items: RowItem[] = [
    ...wins.milestones.map<RowItem>((m) => ({
      key: `m-${m.id}`,
      title: m.title,
      entity: { kind: "milestone", id: m.id },
      tag: { tone: "good", label: "Milestone" },
      detail: [m.goal?.title, m.completedAt ? `reached ${formatDay(m.completedAt)}` : null].filter(Boolean).join(" · "),
    })),
    ...wins.deals.map<RowItem>((d) => ({
      key: `d-${d.id}`,
      title: d.name,
      href: d.companyId ? `/resources/companies/${d.companyId}` : "/scoreboard",
      tag: { tone: "good", label: "Deal won" },
      detail: d.value ? `${formatCurrency(d.value)} · ${d.type === "FUNDRAISING" ? "Fundraising" : d.type === "SALES" ? "Sales" : "Partnership"}` : undefined,
    })),
    ...wins.completed.map<RowItem>((t) => ({
      key: `t-${t.id}`,
      title: t.title,
      entity: { kind: "task", id: t.id },
      tag: { tone: "info", label: "Delivered" },
      detail: `Strategic impact ${t.strategicImpact}/5${t.goal ? ` · ${t.goal.title}` : ""}`,
      score: t.score,
    })),
  ];
  return (
    <Panel id="strategic-wins" title="Strategic wins" icon={Trophy} count={items.length}>
      {items.length === 0 && wins.decisions === 0 ? (
        <EmptyState compact title="No strategic wins recorded" />
      ) : (
        <>
          <ItemRows items={items} max={8} />
          {wins.decisions > 0 && (
            <Link href="#decisions" className="block border-t border-hairline px-3.5 py-2 text-2xs text-muted-foreground hover:text-foreground">
              + {pluralize(wins.decisions, "decision")} made — see most impactful decisions
            </Link>
          )}
        </>
      )}
    </Panel>
  );
}

export function ProblemsPanel({ problems }: { problems: MonthlyReview["problems"] }) {
  const items: RowItem[] = [
    ...problems.risks.map<RowItem>((i) => ({
      key: `i-${i.id}`,
      title: i.title,
      href: "/brain",
      tag: { tone: i.importance >= 5 ? "critical" : "serious", label: `Risk ${i.importance}/5` },
      detail: i.recommendation ?? i.summary ?? undefined,
    })),
    ...problems.offTrack.map<RowItem>((g) => ({
      key: `g-${g.id}`,
      title: g.title,
      href: `/goals/${g.id}`,
      tag: { tone: GOAL_STATUS[g.status].tone, label: g.status === "OFF_TRACK" ? "Off track" : GOAL_STATUS[g.status].label },
      detail: `${g.to}% · ${g.confidence}% confidence${g.statusChanges.length ? ` · ${g.statusChanges.map((c) => `${GOAL_STATUS[c.from]?.label ?? c.from} → ${GOAL_STATUS[c.to]?.label ?? c.to}`).join(", ")}` : ""}`,
    })),
    ...problems.missed.map<RowItem>((m) => ({
      key: `m-${m.id}`,
      title: m.title,
      entity: { kind: "milestone", id: m.id },
      tag: { tone: "critical", label: "Missed" },
      detail: `Due ${formatDay(m.dueDate)} · ${m.progress}%${m.blocker ? ` · ${m.blocker}` : ""}`,
    })),
  ];
  return (
    <Panel id="problems" title="Major problems" icon={Siren} count={items.length}>
      {items.length === 0 ? <EmptyState compact title="No major problems recorded" /> : <ItemRows items={items} max={8} tagWidth="w-[78px]" />}
    </Panel>
  );
}

export function ImpactfulDecisionsPanel({ decisions, timezone }: { decisions: MonthlyReview["decisions"]; timezone: string }) {
  return (
    <Panel id="decisions" title="Most impactful decisions" icon={Gavel} count={decisions.length} href="/decisions">
      {decisions.length === 0 ? (
        <EmptyState compact title="No decisions made this month" />
      ) : (
        <ul className="divide-y divide-hairline">
          {decisions.slice(0, 6).map((d) => {
            const days = d.decidedAt ? Math.max(0, Math.round((d.decidedAt.getTime() - d.raisedAt.getTime()) / 86_400_000)) : null;
            return (
              <li key={d.id}>
                <Link href={`/decisions/${d.id}`} className="block px-3.5 py-2 hover:bg-muted/50">
                  <div className="flex items-start gap-2">
                    <span className="line-clamp-2 flex-1 text-[14px] leading-snug">{d.title}</span>
                    <span className="shrink-0 rounded bg-muted px-1.5 text-2xs font-medium text-ink-2 tabular" title="Strategic impact">
                      {d.strategicImpact}/5
                    </span>
                  </div>
                  {d.finalDecision && <p className="mt-0.5 line-clamp-2 text-xs text-ink-2">→ {d.finalDecision}</p>}
                  <p className="mt-0.5 text-2xs text-muted-foreground tabular">
                    Decided {formatDateTime(d.decidedAt, timezone)}
                    {days !== null && ` · ${days}d from raised to decided`}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function InsightPanel({ id, title, kind, insights, extra, empty }: { id: string; title: string; kind: "opportunity" | "risk"; insights: { id: string; title: string; summary: string | null; importance: number; recommendation: string | null }[]; extra?: RowItem[]; empty: string }) {
  const items: RowItem[] = [
    ...insights.map<RowItem>((i) => ({
      key: i.id,
      title: i.title,
      href: "/brain",
      tag: kind === "opportunity" ? { tone: "good", label: `Value ${i.importance}/5` } : { tone: i.importance >= 4 ? "serious" : "warning", label: `Risk ${i.importance}/5` },
      detail: i.recommendation ?? i.summary ?? undefined,
    })),
    ...(extra ?? []),
  ];
  return (
    <Panel id={id} title={title} icon={kind === "opportunity" ? Lightbulb : ShieldAlert} count={items.length} href="/brain" hrefLabel="Brain">
      {items.length === 0 ? <EmptyState compact title={empty} /> : <ItemRows items={items} max={6} tagWidth="w-[78px]" />}
    </Panel>
  );
}

export function riskMilestoneItems(ms: MonthlyReview["risks"]["milestones"], today: Date): RowItem[] {
  return ms.map((m) => ({
    key: `m-${m.id}`,
    title: m.title,
    entity: { kind: "milestone", id: m.id },
    tag: { tone: MILESTONE_STATUS[m.status].tone, label: MILESTONE_STATUS[m.status].label },
    detail: `Due ${relativeDay(m.dueDate, today, false)} · ${m.progress}%${m.blocker ? ` · ${m.blocker}` : ""}`,
  }));
}

// ─── Time & next month ───────────────────────────────────────────────────────

export function TimeAllocationPanel({ attention, title = "CEO time allocation" }: { attention: AttentionSummary; title?: string }) {
  const misaligned = attention.misaligned.slice(0, 3);
  return (
    <Panel id="time" title={title} icon={Compass} href="/performance" hrefLabel="Performance">
      <div className="pt-2">
        <AttentionBlock attention={attention} />
      </div>
      {misaligned.length > 0 && (
        <p className="border-t border-hairline px-3.5 py-2 text-2xs text-ink-2">
          {misaligned.map((a) => `${a.label} ${a.flag === "over" ? "over" : "under"} by ${Math.abs(a.gap).toFixed(0)} pts`).join(" · ")}
        </p>
      )}
    </Panel>
  );
}

export function NextMonthPanel({ next, today, label }: { next: MonthlyReview["nextMonth"]; today: Date; label: string }) {
  return (
    <Panel id="next-month" title={`Priorities for ${label}`} icon={Flag}>
      <div className="divide-y divide-hairline">
        <SubSection title="Goals to rescue" count={next.goals.length}>
          <ItemRows
            empty="No goals at risk."
            items={next.goals.map((g) => ({
              key: g.id,
              title: g.title,
              href: `/goals/${g.id}`,
              tag: { tone: GOAL_STATUS[g.status].tone, label: GOAL_STATUS[g.status].label },
              detail: `${g.to}% · ${g.confidence}% confidence`,
            }))}
            tagWidth="w-[72px]"
          />
        </SubSection>
        <SubSection title="Highest-impact work" count={next.tasks.length}>
          {next.tasks.length === 0 ? (
            <p className="px-3.5 pb-3 text-xs text-muted-foreground">No open CEO priorities.</p>
          ) : (
            <ul className="divide-y divide-hairline">
              {next.tasks.map((t) => (
                <li key={t.id}>
                  <EntityLink kind="task" id={t.id} className="flex items-start gap-3 px-3.5 py-2 hover:bg-muted/50">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] text-foreground">{t.title}</span>
                      <span className="block truncate text-2xs text-muted-foreground">
                        {t.dueDate ? `Due ${relativeDay(t.dueDate, today)}` : "No date"}
                        {t.goal ? ` · ${t.goal.title}` : ""}
                      </span>
                    </span>
                    <ScoreChip score={t.priorityScore} className="h-5 min-w-8 shrink-0 text-2xs" />
                  </EntityLink>
                </li>
              ))}
            </ul>
          )}
        </SubSection>
        <SubSection title="Upcoming milestones" count={next.milestones.length}>
          <ItemRows
            empty="No milestones due."
            items={next.milestones.map((m) => ({
              key: m.id,
              title: m.title,
              entity: { kind: "milestone", id: m.id },
              tag: { tone: MILESTONE_STATUS[m.status].tone, label: MILESTONE_STATUS[m.status].label },
              detail: `Due ${formatDay(m.dueDate)} · ${m.progress}% · ${m.owner ? (m.owner.isCeo ? "You" : m.owner.name) : "Unassigned"}`,
            }))}
            tagWidth="w-[84px]"
          />
        </SubSection>
      </div>
    </Panel>
  );
}
