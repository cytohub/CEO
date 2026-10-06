import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/common/bits";
import { CreateButton } from "@/components/common/create-button";
import { Meter, StatusPill } from "@/components/common/status";
import type { GoalStatus, GoalType } from "@/generated/prisma/enums";
import { daysBetween, formatDay } from "@/lib/dates";
import { GOAL_STATUS, GOAL_TYPES, pillarColorVar } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { getGoals, type GoalListItem } from "@/server/queries/goals";

export const metadata: Metadata = { title: "Goals" };

const TYPES: (GoalType | "ALL")[] = ["ALL", "COMPANY", "ANNUAL", "QUARTERLY", "CEO", "DEPARTMENT"];
const STATUSES: GoalStatus[] = ["ON_TRACK", "AT_RISK", "OFF_TRACK", "COMPLETED", "PAUSED"];

export default async function GoalsPage(props: { searchParams: Promise<{ type?: string; status?: string }> }) {
  const sp = await props.searchParams;
  const type = (TYPES as string[]).includes(sp.type ?? "") && sp.type !== "ALL" ? (sp.type as GoalType) : undefined;
  const status = (STATUSES as string[]).includes(sp.status ?? "") ? (sp.status as GoalStatus) : undefined;
  const { goals, pillars, today } = await getGoals(type);
  const visible = status ? goals.filter((g) => g.status === status) : goals;
  const counts = Object.fromEntries(STATUSES.map((s) => [s, goals.filter((g) => g.status === s).length])) as Record<GoalStatus, number>;

  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { type: sp.type, status: sp.status, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v && v !== "ALL") p.set(k, v);
    const s = p.toString();
    return s ? `/goals?${s}` : "/goals";
  };

  const groups = [
    ...pillars.map((p) => ({ pillar: p, goals: visible.filter((g) => g.pillarId === p.id) })),
    { pillar: null, goals: visible.filter((g) => !g.pillarId) },
  ].filter((g) => g.goals.length > 0);

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <PageHeader
        title="Goals"
        description="Company, annual, quarterly, CEO and department goals — mapped to strategic pillars, broken into milestones and tasks."
        actions={<CreateButton kind="goal" label="New goal" icon={<Plus />} />}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Goal types" className="flex flex-wrap gap-1">
          {TYPES.map((t) => {
            const active = (t === "ALL" && !type) || t === type;
            return (
              <Link
                key={t}
                href={qs({ type: t === "ALL" ? undefined : t })}
                aria-current={active ? "page" : undefined}
                className={cn("inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium", active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
              >
                {t === "ALL" ? "All goals" : GOAL_TYPES[t].plural}
              </Link>
            );
          })}
        </nav>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
          {STATUSES.map((s) => (
            <Link
              key={s}
              href={qs({ status: status === s ? undefined : s })}
              aria-pressed={status === s}
              className={cn("rounded-full transition-opacity", status && status !== s && "opacity-50 hover:opacity-100")}
            >
              <StatusPill tone={GOAL_STATUS[s].tone} label={`${GOAL_STATUS[s].label} ${counts[s]}`} className={cn(status === s && "border-foreground")} />
            </Link>
          ))}
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="panel">
          <EmptyState title="No goals here" description="Adjust the filters or create a goal." />
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(({ pillar, goals: list }) => {
            const avg = Math.round(list.reduce((s, g) => s + g.progress, 0) / list.length);
            return (
              <section key={pillar?.id ?? "none"} className="panel overflow-hidden" aria-label={pillar?.name ?? "No pillar"}>
                <div className="flex items-center gap-2.5 border-b border-hairline px-4 py-2.5">
                  <span className="size-2.5 rounded-[3px]" style={{ background: pillar ? pillarColorVar(pillar.color) : "var(--ink-3)" }} aria-hidden />
                  <h2 className="text-[13px] font-semibold">{pillar?.name ?? "No strategic pillar"}</h2>
                  <span className="text-2xs text-muted-foreground">
                    {list.length} goal{list.length === 1 ? "" : "s"} · avg {avg}%
                  </span>
                  {pillar?.description && <span className="ml-auto hidden truncate text-2xs text-muted-foreground lg:block">{pillar.description}</span>}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] text-[13px]">
                    <thead className="sr-only">
                      <tr>
                        <th>Goal</th>
                        <th>Status</th>
                        <th>Progress</th>
                        <th>Confidence</th>
                        <th>Owner</th>
                        <th>Target</th>
                        <th>Milestones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline">
                      {list.map((g) => (
                        <GoalRow key={g.id} goal={g} today={today} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GoalRow({ goal: g, today }: { goal: GoalListItem; today: Date }) {
  const s = GOAL_STATUS[g.status];
  const msDone = g.milestones.filter((m) => m.status === "COMPLETED").length;
  const msRisk = g.milestones.filter((m) => m.status === "AT_RISK" || m.status === "BLOCKED").length;
  const left = g.targetDate ? daysBetween(today, g.targetDate) : null;
  return (
    <tr className="group hover:bg-muted/40">
      <td className="py-2.5 pr-3 pl-4">
        <Link href={`/goals/${g.id}`} className="block">
          <span className="font-medium text-foreground group-hover:underline">{g.title}</span>
          <span className="mt-0.5 flex flex-wrap gap-x-2 text-2xs text-muted-foreground">
            <span>{GOAL_TYPES[g.type].label}</span>
            {g.period && <span>{g.period}</span>}
            {g.department && <span>{g.department}</span>}
            {g.parent && <span className="truncate">↳ {g.parent.title}</span>}
            {g._count.tasks > 0 && <span>{g._count.tasks} open tasks</span>}
          </span>
        </Link>
      </td>
      <td className="w-28 py-2.5 pr-3">
        <StatusPill tone={s.tone} label={s.label} />
      </td>
      <td className="w-44 py-2.5 pr-3">
        <div className="flex items-center gap-2">
          <Meter value={g.progress} tone={s.tone === "done" ? "good" : s.tone} className="flex-1" label={`${g.title} progress`} />
          <span className="w-9 text-right text-xs font-medium tabular">{g.progress}%</span>
        </div>
      </td>
      <td className="w-24 py-2.5 pr-3 text-xs text-muted-foreground tabular" title="Owner confidence the goal will be achieved on time">
        <span className={cn(g.confidence < 50 ? "text-critical-ink" : g.confidence < 65 ? "text-warning-ink" : "text-ink-2")}>{g.confidence}%</span> conf.
      </td>
      <td className="w-36 py-2.5 pr-3 text-xs text-ink-2">{g.owner ? (g.owner.isCeo ? "You" : g.owner.name) : "—"}</td>
      <td className="w-28 py-2.5 pr-3 text-xs tabular">
        <span className="text-ink-2">{formatDay(g.targetDate)}</span>
        {left !== null && g.status !== "COMPLETED" && <span className={cn("block text-2xs", left < 0 ? "text-critical-ink" : "text-muted-foreground")}>{left < 0 ? `${-left}d past` : `${left}d left`}</span>}
      </td>
      <td className="w-32 py-2.5 pr-4 text-xs text-muted-foreground tabular">
        {g.milestones.length ? (
          <>
            {msDone}/{g.milestones.length} milestones
            {msRisk > 0 && <span className="block text-2xs text-warning-ink">{msRisk} at risk</span>}
          </>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}
