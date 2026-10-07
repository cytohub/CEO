import { ArrowLeft, Clock3, History, ListRestart, RefreshCcw, Search, Sparkles, Trophy, XCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Panel } from "@/components/common/bits";
import { HistoryFilters } from "@/components/tasks/history-filters";
import { TaskTable } from "@/components/tasks/task-table";
import { TaskLink } from "@/components/tasks/task-link";
import { Button } from "@/components/ui/button";
import type { FocusArea, Priority, TaskStatus } from "@/generated/prisma/enums";
import { formatDay } from "@/lib/dates";
import { FOCUS_AREAS, TASK_STATUS } from "@/lib/domain";
import { formatMinutes } from "@/lib/format";
import { getHistoryInsights, searchTaskHistory, type HistoryFilters as Filters } from "@/server/queries/history";
import { requirePage } from "@/server/security/session";

export const metadata: Metadata = { title: "Task history" };

type SP = Record<string, string | undefined>;

export default async function TaskHistoryPage(props: { searchParams: Promise<SP> }) {
  await requirePage("workspace.view", "/tasks/history");
  const sp = await props.searchParams;
  const filters: Filters = {
    q: sp.q,
    from: sp.from,
    to: sp.to,
    status: (sp.status as TaskStatus | "ANY" | undefined) ?? "ANY",
    priority: sp.priority as Priority | undefined,
    goal: sp.goal,
    milestone: sp.milestone,
    pillar: sp.pillar,
    focus: sp.focus as FocusArea | undefined,
    person: sp.person,
    scope: sp.scope === "everyone" ? "everyone" : "mine",
  };
  const [{ tasks, today }, ins] = await Promise.all([searchTaskHistory(filters), getHistoryInsights()]);

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <PageHeader
        eyebrow={
          <Link href="/tasks" className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="size-3" /> Tasks
          </Link>
        }
        title="Task history"
        description="Everything you’ve worked on, searchable — and the patterns in it. History feeds CytoHub Brain, so tomorrow’s recommendations get smarter."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Panel title="What did I work on last week?" icon={History} count={ins.lastWeek.length}>
          <TaskList
            items={ins.lastWeek.slice(0, 6).map((t) => ({ id: t.id, title: t.title, meta: `${FOCUS_AREAS[t.focusArea].label} · ${formatMinutes(t.actualMinutes)}` }))}
            empty="Nothing completed last week."
          />
        </Panel>
        <Panel title="What did I accomplish this month?" icon={Trophy} count={ins.thisMonth.length}>
          <TaskList
            items={ins.thisMonth.slice(0, 6).map((t) => ({ id: t.id, title: t.title, meta: `Score ${Math.round(t.priorityScore)} · ${formatDay(t.completedAt)}` }))}
            empty="Nothing completed yet this month."
            footer={`${formatMinutes(ins.minutesThisMonth)} of tracked effort`}
          />
        </Panel>
        <Panel title="Which work generated the highest impact?" icon={Sparkles}>
          <TaskList items={ins.highestImpact.map((t) => ({ id: t.id, title: t.title, meta: `Strategic impact ${t.strategicImpact}/5 · score ${Math.round(t.priorityScore)}` }))} empty="No completed work yet." />
        </Panel>
        <Panel title="What repeatedly gets postponed?" icon={RefreshCcw} count={ins.postponed.length}>
          <TaskList
            items={ins.postponed.map((t) => ({ id: t.id, title: t.title, meta: `Postponed ${t.postponeCount}× · ${TASK_STATUS[t.status].label}`, warn: true }))}
            empty="Nothing keeps slipping."
            footer="Decide on each: do it this week, delegate it, or drop it."
          />
        </Panel>
        <Panel title="What consumes disproportionate CEO time?" icon={Clock3}>
          <TaskList
            items={ins.sinks.map((t) => ({
              id: t.id,
              title: t.title,
              meta: `${formatMinutes(t.actualMinutes)} actual vs ${formatMinutes(t.estimatedMinutes)} est${t.lowImpact ? " · low leverage" : ""}`,
              warn: true,
            }))}
            empty="No time sinks in the last 60 days."
          />
        </Panel>
        <Panel title="Commitments made but not kept" icon={XCircle} count={ins.broken.length}>
          <TaskList
            items={ins.broken.map((t) => ({ id: t.id, title: t.title, meta: t.status === "CANCELLED" ? "Cancelled — never completed" : `Overdue since ${formatDay(t.dueDate)}`, warn: true }))}
            empty="Every commitment kept."
          />
        </Panel>
        <Panel title="What priorities changed?" icon={ListRestart} className="md:col-span-2 xl:col-span-3">
          {ins.priorityChanges.length === 0 ? (
            <p className="px-3.5 py-4 text-xs text-muted-foreground">No priority changes in the last 30 days.</p>
          ) : (
            <ul className="grid divide-y divide-hairline md:grid-cols-2 md:divide-y-0">
              {ins.priorityChanges.map((a) => (
                <li key={a.id} className="flex min-w-0 items-center gap-3 border-hairline px-3.5 py-2 text-[15px] md:border-b">
                  <span className="w-16 shrink-0 text-2xs text-muted-foreground tabular">{formatDay(a.createdAt)}</span>
                  {a.task ? <TaskLink id={a.task.id} title={a.task.title} className="min-w-0 flex-1 truncate" /> : <span className="flex-1">—</span>}
                  <span className="max-w-[45%] shrink-0 truncate text-xs text-ink-2">{a.summary.replace(/^Added .*/, "Added to Top 5").replace(/^Removed .*/, "Removed from Top 5")}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <section aria-labelledby="db-title" className="space-y-3 pt-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="db-title" className="flex items-center gap-2 text-[17px] font-semibold tracking-tight">
            <Search className="size-4 text-ink-3" aria-hidden /> Historical task database
          </h2>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/tasks/history">Reset filters</Link>
          </Button>
        </div>
        <HistoryFilters initial={filters} />
        <TaskTable tasks={tasks} today={today} top5={[]} view="history" defaultSort="completed" filters={false} />
      </section>
    </div>
  );
}

function TaskList({ items, empty, footer }: { items: { id: string; title: string; meta: string; warn?: boolean }[]; empty: string; footer?: string }) {
  if (items.length === 0) return <p className="px-3.5 py-4 text-xs text-muted-foreground">{empty}</p>;
  return (
    <div>
      <ul className="divide-y divide-hairline">
        {items.map((i) => (
          <li key={i.id} className="px-3.5 py-2">
            <TaskLink id={i.id} title={i.title} className="block truncate text-[15px]" />
            <span className={i.warn ? "text-2xs text-serious-ink" : "text-2xs text-muted-foreground"}>{i.meta}</span>
          </li>
        ))}
      </ul>
      {footer && <p className="border-t border-hairline px-3.5 py-2 text-2xs text-muted-foreground">{footer}</p>}
    </div>
  );
}
