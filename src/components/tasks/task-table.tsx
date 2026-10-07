"use client";

import { ArrowDownUp, Check, Search, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DueLabel, EmptyState, PersonName, PillarTag } from "@/components/common/bits";
import { SimpleSelect } from "@/components/common/fields";
import { PriorityBadge, StatusPill } from "@/components/common/status";
import { useAction } from "@/components/common/use-action";
import { useLookups, useUI } from "@/components/shell/ui-context";
import type { FocusArea } from "@/generated/prisma/enums";
import { DELEGATION_STATUS, FOCUS_AREA_ORDER, FOCUS_AREAS, PRIORITY, TASK_STATUS } from "@/lib/domain";
import { formatMinutes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { completeTask } from "@/server/actions/tasks";
import type { TaskRow } from "@/server/queries/tasks";
import { ScoreChip } from "./score";

type SortKey = "score" | "due" | "priority" | "title" | "created" | "completed";

const PRIORITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 } as const;

export function TaskTable({
  tasks,
  today,
  top5,
  view,
  defaultSort = "score",
  filters = true,
}: {
  tasks: TaskRow[];
  today: Date;
  top5: string[];
  view: string;
  defaultSort?: SortKey;
  /** Hide the in-table filters when the page provides its own (sorting stays). */
  filters?: boolean;
}) {
  const { pillars, goals } = useLookups();
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState<string | null>(null);
  const [pillar, setPillar] = useState<string | null>(null);
  const [goal, setGoal] = useState<string | null>(null);
  const [priority, setPriority] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>(defaultSort);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = tasks.filter(
      (t) =>
        (!needle ||
          t.title.toLowerCase().includes(needle) ||
          t.description?.toLowerCase().includes(needle) ||
          t.goal?.title.toLowerCase().includes(needle) ||
          t.company?.name.toLowerCase().includes(needle) ||
          t.tags.some((g) => g.includes(needle))) &&
        (!focus || t.focusArea === focus) &&
        (!pillar || t.pillarId === pillar) &&
        (!goal || t.goalId === goal) &&
        (!priority || t.priority === priority),
    );
    const cmp: Record<SortKey, (a: TaskRow, b: TaskRow) => number> = {
      score: (a, b) => b.priorityScore - a.priorityScore,
      due: (a, b) => (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity),
      priority: (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.priorityScore - a.priorityScore,
      title: (a, b) => a.title.localeCompare(b.title),
      created: (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      completed: (a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0),
    };
    return [...list].sort(cmp[sort]);
  }, [tasks, q, focus, pillar, goal, priority, sort]);

  const activeFilters = [focus, pillar, goal, priority].filter(Boolean).length;

  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline p-2.5">
        {filters && (
          <>
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter tasks…" className="h-8 pl-8" aria-label="Filter tasks" />
        </div>
        <div className="w-[150px]">
          <SimpleSelect size="sm" value={priority} onChange={setPriority} allowNone noneLabel="Any priority" placeholder="Priority" ariaLabel="Priority filter" options={(["P0", "P1", "P2", "P3"] as const).map((p) => ({ value: p, label: `${p} · ${PRIORITY[p].label}` }))} />
        </div>
        <div className="w-[160px]">
          <SimpleSelect size="sm" value={focus} onChange={setFocus} allowNone noneLabel="Any function" placeholder="Function" ariaLabel="Function filter" options={FOCUS_AREA_ORDER.map((f: FocusArea) => ({ value: f, label: FOCUS_AREAS[f].label }))} />
        </div>
        <div className="w-[180px]">
          <SimpleSelect size="sm" value={pillar} onChange={setPillar} allowNone noneLabel="Any pillar" placeholder="Pillar" ariaLabel="Pillar filter" options={pillars.map((p) => ({ value: p.id, label: p.name }))} />
        </div>
        <div className="w-[200px]">
          <SimpleSelect size="sm" value={goal} onChange={setGoal} allowNone noneLabel="Any goal" placeholder="Goal" ariaLabel="Goal filter" options={goals.map((g) => ({ value: g.id, label: g.title }))} />
        </div>
          </>
        )}
        <div className={cn("flex items-center gap-1.5", !filters && "ml-auto")}>
          <ArrowDownUp className="size-3.5 text-muted-foreground" aria-hidden />
          <div className="w-[140px]">
            <SimpleSelect
              size="sm"
              value={sort}
              onChange={(v) => v && setSort(v as SortKey)}
              ariaLabel="Sort"
              options={[
                { value: "score", label: "Priority score" },
                { value: "due", label: "Due date" },
                { value: "priority", label: "Priority" },
                { value: "created", label: "Newest" },
                { value: "completed", label: "Completed" },
                { value: "title", label: "Title" },
              ]}
            />
          </div>
        </div>
        {activeFilters > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFocus(null);
              setPillar(null);
              setGoal(null);
              setPriority(null);
            }}
          >
            Clear {activeFilters}
          </Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Check} title={tasks.length ? "No tasks match these filters" : emptyTitle(view)} description={tasks.length ? "Try clearing a filter." : emptyHint(view)} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-[14px]">
            <thead>
              <tr className="border-b border-hairline text-left text-2xs font-medium text-muted-foreground">
                <th className="w-10 py-2 pl-3" />
                <th className="py-2 pr-3 font-medium">Task</th>
                <th className="w-14 py-2 pr-3 font-medium">Score</th>
                <th className="w-28 py-2 pr-3 font-medium">Status</th>
                <th className="w-24 py-2 pr-3 font-medium">{view === "completed" ? "Completed" : view === "history" ? "Date" : "Due"}</th>
                <th className="w-40 py-2 pr-3 font-medium">Owner</th>
                <th className="w-16 py-2 pr-3 text-right font-medium">Effort</th>
                <th className="w-10 py-2 pr-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {filtered.map((t) => (
                <Row key={t.id} task={t} today={today} inTop5={top5.includes(t.id)} completedView={view === "completed" || (view === "history" && t.status === "DONE")} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="border-t border-hairline px-3 py-2 text-2xs text-muted-foreground tabular">
        {filtered.length} of {tasks.length} tasks
      </div>
    </div>
  );
}

function Row({ task: t, today, inTop5, completedView }: { task: TaskRow; today: Date; inTop5: boolean; completedView: boolean }) {
  const { openEntity, openDelegate } = useUI();
  const { pending, run } = useAction();
  const done = t.status === "DONE";
  return (
    <tr className="group hover:bg-muted/40">
      <td className="py-2 pl-3 align-top">
        <button
          type="button"
          disabled={pending || done}
          onClick={() => run(() => completeTask(t.id), { success: "Completed" })}
          aria-label={done ? "Completed" : `Complete ${t.title}`}
          className={cn("mt-0.5 flex size-4 items-center justify-center rounded-full border", done ? "border-good bg-good text-white" : "border-input hover:border-good hover:bg-good-soft")}
        >
          {done && <Check className="size-2.5" />}
        </button>
      </td>
      <td className="py-2 pr-3 align-top">
        <button type="button" onClick={() => openEntity("task", t.id)} className="block w-full text-left">
          <span className={cn("font-medium text-foreground group-hover:underline", done && "text-muted-foreground")}>{t.title}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-2xs text-muted-foreground">
            <PriorityBadge priority={t.priority} className="h-4" />
            {inTop5 && <span className="font-medium text-brain">Today’s Top 5</span>}
            {t.pillar && <PillarTag name={t.pillar.name} color={t.pillar.color} compact className="text-2xs" />}
            {t.goal && <span className="max-w-[220px] truncate">{t.goal.title}</span>}
            {t.company && <span>{t.company.name}</span>}
            <span>{FOCUS_AREAS[t.focusArea].label}</span>
            {t.postponeCount >= 2 && <span className="text-serious-ink">postponed {t.postponeCount}×</span>}
            {t.blocker && <span className="max-w-[260px] truncate text-critical-ink">Blocked: {t.blocker}</span>}
            {t.delegationRecommended && t.suggestedDelegate && <span className="text-brain">Delegate → {t.suggestedDelegate.name}</span>}
          </span>
        </button>
      </td>
      <td className="py-2 pr-3 align-top">
        <ScoreChip score={t.priorityScore} />
      </td>
      <td className="py-2 pr-3 align-top">
        {t.delegation ? (
          <StatusPill tone={DELEGATION_STATUS[t.delegation.status].tone} label={DELEGATION_STATUS[t.delegation.status].label} />
        ) : (
          <StatusPill tone={TASK_STATUS[t.status].tone} label={TASK_STATUS[t.status].label} />
        )}
      </td>
      <td className="py-2 pr-3 align-top text-xs">
        {completedView ? <DueLabel date={t.completedAt} today={today} done /> : <DueLabel date={t.dueDate} today={today} done={done} />}
      </td>
      <td className="py-2 pr-3 align-top text-xs">
        <PersonName person={t.owner} />
      </td>
      <td className="py-2 pr-3 text-right align-top text-xs text-muted-foreground tabular">
        {t.actualMinutes && done ? (
          <span title={`Estimated ${formatMinutes(t.estimatedMinutes)}`} className={cn(t.estimatedMinutes && t.actualMinutes > t.estimatedMinutes * 2 && "text-serious-ink")}>
            {formatMinutes(t.actualMinutes)}
          </span>
        ) : (
          formatMinutes(t.estimatedMinutes)
        )}
      </td>
      <td className="py-1.5 pr-3 align-top">
        {!done && !t.delegation && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-xs" onClick={() => openDelegate(t.id)} aria-label={`Delegate ${t.title}`} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
                <UserPlus />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delegate</TooltipContent>
          </Tooltip>
        )}
      </td>
    </tr>
  );
}

function emptyTitle(view: string) {
  return (
    {
      today: "Nothing due today",
      upcoming: "Nothing scheduled in the next 30 days",
      overdue: "No overdue tasks",
      waiting: "Nothing waiting or blocked",
      delegated: "Nothing delegated",
      someday: "No someday ideas",
      completed: "Nothing completed in the last 30 days",
    } as Record<string, string>
  )[view] ?? "No tasks";
}

function emptyHint(view: string) {
  return view === "overdue" ? "Every commitment is on time." : "Press C to create a task.";
}
