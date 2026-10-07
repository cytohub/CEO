"use client";

import { useUI } from "@/components/shell/ui-context";
import { DueLabel, EmptyState, PersonName, PillarTag } from "@/components/common/bits";
import { Meter, StatusPill, TONE_DOT } from "@/components/common/status";
import type { MilestoneStatus } from "@/generated/prisma/enums";
import { addDays, daysBetween, formatDay, quarterKey, startOfMonth, startOfQuarter } from "@/lib/dates";
import { MILESTONE_STATUS, MILESTONE_TYPES } from "@/lib/domain";
import { cn } from "@/lib/utils";
import type { MilestoneRow } from "@/server/queries/milestones";

export type MilestoneView = "timeline" | "quarter" | "goal" | "status";

function toneOf(m: MilestoneRow, today: Date) {
  const overdue = m.status !== "COMPLETED" && m.status !== "MISSED" && m.dueDate < today;
  return overdue ? "critical" : MILESTONE_STATUS[m.status].tone;
}

export function MilestoneViews({ view, milestones, today }: { view: MilestoneView; milestones: MilestoneRow[]; today: Date }) {
  if (milestones.length === 0) return <div className="panel"><EmptyState title="No milestones match" description="Clear the highlight filter or create a milestone." /></div>;
  if (view === "quarter") return <QuarterView milestones={milestones} today={today} />;
  if (view === "goal") return <GoalView milestones={milestones} today={today} />;
  if (view === "status") return <StatusView milestones={milestones} today={today} />;
  return <TimelineView milestones={milestones} today={today} />;
}

function Card({ m, today, compact }: { m: MilestoneRow; today: Date; compact?: boolean }) {
  const { openEntity } = useUI();
  const Icon = MILESTONE_TYPES[m.type].icon;
  const tone = toneOf(m, today);
  return (
    <button type="button" onClick={() => openEntity("milestone", m.id)} className="w-full rounded-lg border border-border bg-surface p-3 text-left transition-colors hover:border-input hover:bg-muted/40">
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden />
        <span className="line-clamp-2 flex-1 text-[15px] leading-snug font-medium">{m.title}</span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Meter value={m.progress} tone={tone === "done" ? "good" : tone} label={`${m.title} progress`} />
        <span className="w-8 text-right text-2xs tabular">{m.progress}%</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
        <StatusPill tone={tone} label={tone === "critical" && m.status !== "BLOCKED" && m.status !== "MISSED" ? "Overdue" : MILESTONE_STATUS[m.status].label} />
        <DueLabel date={m.dueDate} today={today} done={m.status === "COMPLETED"} />
        {!compact && m.owner && <PersonName person={m.owner} />}
      </div>
      {!compact && m.blocker && m.status !== "COMPLETED" && <p className="mt-1.5 line-clamp-2 text-2xs text-critical-ink">{m.blocker}</p>}
    </button>
  );
}

function TimelineView({ milestones, today }: { milestones: MilestoneRow[]; today: Date }) {
  const { openEntity } = useUI();
  const start = startOfMonth(addDays(today, -45));
  const lastDue = milestones.reduce((d, m) => (m.dueDate > d ? m.dueDate : d), addDays(today, 60));
  const end = startOfMonth(addDays(lastDue, 40));
  const span = Math.max(1, daysBetween(start, end));
  const pos = (d: Date) => `${(Math.max(0, Math.min(span, daysBetween(start, d))) / span) * 100}%`;
  const months: Date[] = [];
  for (let d = start; d < end; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) months.push(d);

  // Group rows by goal, ordered by the goal's earliest milestone.
  const groups = new Map<string, { title: string; items: MilestoneRow[] }>();
  for (const m of [...milestones].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())) {
    const key = m.goal?.id ?? "none";
    if (!groups.has(key)) groups.set(key, { title: m.goal?.title ?? "No goal", items: [] });
    groups.get(key)!.items.push(m);
  }

  return (
    <div className="panel overflow-x-auto">
      <div className="min-w-[960px]">
        <div className="grid grid-cols-[300px_1fr] border-b border-hairline">
          <div className="px-4 py-2 text-2xs font-medium text-muted-foreground">Milestone</div>
          <div className="relative h-8">
            {months.map((mo) => (
              <div key={mo.toISOString()} className="absolute top-0 bottom-0 border-l border-hairline pl-1.5 text-2xs leading-8 text-muted-foreground" style={{ left: pos(mo) }}>
                {mo.toLocaleString("en-US", { month: "short", timeZone: "UTC" })}
              </div>
            ))}
          </div>
        </div>
        {[...groups.values()].map((g) => (
          <div key={g.title}>
            <div className="border-b border-hairline bg-surface-2/60 px-4 py-1.5 text-2xs font-semibold text-ink-2">{g.title}</div>
            {g.items.map((m) => {
              const tone = toneOf(m, today);
              const barStart = m.createdAt > start ? m.createdAt : start;
              const left = (Math.max(0, daysBetween(start, barStart)) / span) * 100;
              const width = Math.max(0.5, (daysBetween(barStart, m.dueDate) / span) * 100);
              return (
                <div key={m.id} className="group grid grid-cols-[300px_1fr] border-b border-hairline last:border-b-0 hover:bg-muted/30">
                  <button type="button" onClick={() => openEntity("milestone", m.id)} className="flex min-w-0 items-center gap-2 px-4 py-2 text-left">
                    <span className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[tone])} aria-hidden />
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] group-hover:underline">{m.title}</span>
                      <span className="block truncate text-2xs text-muted-foreground">
                        {tone === "critical" && m.status !== "BLOCKED" ? "Overdue" : MILESTONE_STATUS[m.status].label} · {formatDay(m.dueDate)} · {m.progress}%
                      </span>
                    </span>
                  </button>
                  <div className="relative h-11">
                    {months.map((mo) => (
                      <div key={mo.toISOString()} className="absolute top-0 bottom-0 border-l border-hairline" style={{ left: pos(mo) }} aria-hidden />
                    ))}
                    <div className="absolute top-0 bottom-0 w-px bg-brand" style={{ left: pos(today) }} aria-hidden />
                    {width > 0 && (
                      <div className="absolute top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-track" style={{ left: `${left}%`, width: `${width}%` }} aria-hidden>
                        <div className={cn("h-full rounded-full opacity-60", TONE_DOT[tone === "done" ? "good" : tone])} style={{ width: `${m.progress}%` }} />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => openEntity("milestone", m.id)}
                      title={`${m.title} — ${MILESTONE_STATUS[m.status].label}, due ${formatDay(m.dueDate, true)}, ${m.progress}%`}
                      aria-label={`${m.title}, due ${formatDay(m.dueDate, true)}`}
                      className={cn("absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] ring-2 ring-surface", TONE_DOT[tone])}
                      style={{ left: pos(m.dueDate) }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        <div className="flex items-center gap-4 px-4 py-2 text-2xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-px bg-brand" aria-hidden /> Today
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rotate-45 rounded-[1px] bg-ink-3" aria-hidden /> Due date (color = status)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-6 rounded-full bg-track" aria-hidden /> Created → due, filled by progress
          </span>
        </div>
      </div>
    </div>
  );
}

function QuarterView({ milestones, today }: { milestones: MilestoneRow[]; today: Date }) {
  const q0 = startOfQuarter(today);
  const quarters = [-1, 0, 1, 2].map((i) => startOfQuarter(new Date(Date.UTC(q0.getUTCFullYear(), q0.getUTCMonth() + i * 3, 1))));
  const keyOf = (d: Date) => quarterKey(d);
  const keys = quarters.map(keyOf);
  const later = milestones.filter((m) => !keys.includes(keyOf(m.dueDate)) && m.dueDate > quarters[3]);
  const earlier = milestones.filter((m) => !keys.includes(keyOf(m.dueDate)) && m.dueDate < quarters[0]);
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {quarters.map((q, i) => {
        const items = [...milestones.filter((m) => keyOf(m.dueDate) === keys[i]), ...(i === 0 ? earlier : []), ...(i === 3 ? later : [])].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
        const done = items.filter((m) => m.status === "COMPLETED").length;
        return (
          <section key={keys[i]} className={cn("rounded-lg border border-border bg-surface-2/40 p-2", i === 1 && "border-brand/40 bg-brand-soft/30")} aria-label={keys[i]}>
            <div className="flex items-baseline justify-between px-1.5 pt-1 pb-2">
              <h2 className="text-[15px] font-semibold">
                {keys[i].replace("-", " ")}
                {i === 1 && <span className="ml-1.5 text-2xs font-medium text-brand">Current</span>}
              </h2>
              <span className="text-2xs text-muted-foreground tabular">
                {done}/{items.length} done
              </span>
            </div>
            <div className="space-y-2">
              {items.map((m) => (
                <Card key={m.id} m={m} today={today} compact />
              ))}
              {items.length === 0 && <p className="px-1.5 py-6 text-center text-2xs text-muted-foreground">No milestones</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function GoalView({ milestones, today }: { milestones: MilestoneRow[]; today: Date }) {
  const groups = new Map<string, { goal: MilestoneRow["goal"]; pillar: MilestoneRow["pillar"]; items: MilestoneRow[] }>();
  for (const m of milestones) {
    const key = m.goal?.id ?? "none";
    if (!groups.has(key)) groups.set(key, { goal: m.goal, pillar: m.pillar, items: [] });
    groups.get(key)!.items.push(m);
  }
  return (
    <div className="space-y-3">
      {[...groups.values()].map((g) => {
        const done = g.items.filter((m) => m.status === "COMPLETED").length;
        return (
          <section key={g.goal?.id ?? "none"} className="panel">
            <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-2.5">
              <a href={g.goal ? `/goals/${g.goal.id}` : "#"} className="text-[15px] font-semibold hover:underline">
                {g.goal?.title ?? "No goal"}
              </a>
              {g.pillar && <PillarTag name={g.pillar.name} color={g.pillar.color} />}
              <span className="ml-auto text-2xs text-muted-foreground tabular">
                {done}/{g.items.length} achieved
              </span>
            </div>
            <div className="grid gap-2 p-2 sm:grid-cols-2 xl:grid-cols-4">
              {g.items.map((m) => (
                <Card key={m.id} m={m} today={today} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

const STATUS_COLUMNS: MilestoneStatus[] = ["PLANNED", "IN_PROGRESS", "AT_RISK", "BLOCKED", "COMPLETED"];

function StatusView({ milestones, today }: { milestones: MilestoneRow[]; today: Date }) {
  return (
    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
      {STATUS_COLUMNS.map((s) => {
        const items = milestones.filter((m) => m.status === s || (s === "COMPLETED" && m.status === "MISSED")).sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
        return (
          <section key={s} className="rounded-lg border border-border bg-surface-2/40 p-2" aria-label={MILESTONE_STATUS[s].label}>
            <div className="flex items-center justify-between px-1.5 pt-1 pb-2">
              <StatusPill tone={MILESTONE_STATUS[s].tone} label={MILESTONE_STATUS[s].label} />
              <span className="text-2xs text-muted-foreground tabular">{items.length}</span>
            </div>
            <div className="space-y-2">
              {items.map((m) => (
                <Card key={m.id} m={m} today={today} />
              ))}
              {items.length === 0 && <p className="px-1.5 py-6 text-center text-2xs text-muted-foreground">Empty</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}
