"use client";

import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  Check,
  ChevronRight,
  Lock,
  MoreHorizontal,
  NotebookPen,
  Plus,
  RotateCcw,
  Sparkles,
  Target,
  UserPlus,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DueLabel, PersonName, PillarTag } from "@/components/common/bits";
import { PriorityBadge, StatusPill } from "@/components/common/status";
import { useAction } from "@/components/common/use-action";
import { useUI } from "@/components/shell/ui-context";
import { ScoreChip } from "@/components/tasks/score";
import type { Priority } from "@/generated/prisma/enums";
import { addDays, dayKey, startOfWeek } from "@/lib/dates";
import { PRIORITY, TASK_STATUS } from "@/lib/domain";
import { formatMinutes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { confirmTop5, moveInTop5, pinToTop5, regenerateTop5, removeFromTop5 } from "@/server/actions/dayplan";
import { completeTask, listPickerTasks, reopenTask, rescheduleTask, setTaskPriority } from "@/server/actions/tasks";
import type { TodayData } from "@/server/queries/today";

type Item = NonNullable<TodayData["plan"]>["priorities"][number];

const IMPORTANCE = ["Minimal", "Low", "Moderate", "Meaningful", "High", "Critical"];

function blockersOf(item: Item): string {
  const deps = item.task.dependsOn.filter((d) => d.status !== "DONE" && d.status !== "CANCELLED").map((d) => `Waiting on “${d.title}”`);
  return [item.task.blocker, ...deps].filter(Boolean).join(" · ");
}

function nextAction(item: Item): string {
  const t = item.task;
  const openDep = t.dependsOn.find((d) => d.status !== "DONE" && d.status !== "CANCELLED");
  if (t.status === "BLOCKED" && t.blocker) return `Unblock — ${t.blocker}`;
  if (openDep) return `Get “${openDep.title}” closed first`;
  if (t.decision) return `Make the call: ${t.decision.title}`;
  if (t.estimatedMinutes && t.estimatedMinutes <= 30) return `Do it now — ${formatMinutes(t.estimatedMinutes)}`;
  if (t.estimatedMinutes) return `Block ${formatMinutes(t.estimatedMinutes)} on your calendar today`;
  return "Define the first concrete step";
}

export function TopFive({ items, confirmedAt, today }: { items: Item[]; confirmedAt: Date | null; today: Date }) {
  const { pending, run } = useAction();
  const done = items.filter((i) => i.task.status === "DONE").length;
  const [expanded, setExpanded] = useState<string | null>(items.find((i) => i.task.status !== "DONE")?.taskId ?? null);

  return (
    <section className="panel overflow-hidden" aria-labelledby="top5-title">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-hairline px-4 py-3">
        <div className="flex items-center gap-2">
          <Target className="size-4 text-foreground" aria-hidden />
          <h2 id="top5-title" className="text-[16px] font-semibold tracking-tight">
            Today’s Top 5
          </h2>
          <span className="rounded bg-muted px-1.5 text-2xs font-medium text-muted-foreground tabular">
            {done}/{items.length} done
          </span>
        </div>
        {/* Until confirmed, the buttons say the same thing; drop the hint where it would wrap them. */}
        <p className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", !confirmedAt && "lg:max-2xl:hidden")}>
          {confirmedAt ? (
            <>
              <Lock className="size-3" aria-hidden /> Confirmed — CEO-owned list
            </>
          ) : (
            <>
              <Sparkles className="size-3 text-brain" aria-hidden /> Recommended by CytoHub Brain · review and confirm
            </>
          )}
        </p>
        <div className="flex items-center gap-1.5 max-sm:w-full max-sm:justify-end sm:ml-auto">
          <AddPriority disabled={items.length >= 5 && !!confirmedAt} />
          {!confirmedAt ? (
            <>
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => regenerateTop5())}>
                <RotateCcw /> Re-rank
              </Button>
              <Button size="sm" disabled={pending || items.length === 0} onClick={() => run(() => confirmTop5())}>
                <Check /> Confirm Top 5
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => regenerateTop5(), { success: "Unlocked — Brain re-ranked" })}>
              <RotateCcw /> Unlock & re-rank
            </Button>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="px-4 py-10 text-center text-[14px] text-muted-foreground">No priorities yet. Run the morning refresh to get today’s recommendations.</div>
      ) : (
        <ol className="divide-y divide-hairline">
          {items.map((item, idx) => (
            <PriorityRow
              key={item.taskId}
              item={item}
              index={idx}
              count={items.length}
              today={today}
              expanded={expanded === item.taskId}
              onToggle={() => setExpanded((e) => (e === item.taskId ? null : item.taskId))}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function PriorityRow({ item, index, count, today, expanded, onToggle }: { item: Item; index: number; count: number; today: Date; expanded: boolean; onToggle: () => void }) {
  const t = item.task;
  const { openEntity, openDelegate } = useUI();
  const { pending, run } = useAction();
  const done = t.status === "DONE";
  const status = TASK_STATUS[t.status];

  return (
    <li className={cn("group relative", done && "bg-surface-2/50")}>
      <div className="flex items-start gap-3 px-4 py-3 max-sm:flex-wrap">
        <button
          type="button"
          aria-label={done ? `Reopen ${t.title}` : `Complete ${t.title}`}
          disabled={pending}
          onClick={() => run(() => (done ? reopenTask(t.id) : completeTask(t.id)), { success: done ? "Reopened" : "Completed — nice." })}
          className={cn(
            "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
            done ? "border-good bg-good text-white" : "border-input hover:border-good hover:bg-good-soft",
          )}
        >
          {done ? <Check className="size-3" /> : <span className="font-mono text-[11px] font-semibold text-muted-foreground tabular group-hover:hidden">{index + 1}</span>}
          {!done && <Check className="hidden size-3 text-good-ink group-hover:block" aria-hidden />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <button type="button" onClick={onToggle} className="min-w-0 flex-1 text-left" aria-expanded={expanded}>
              <span className={cn("text-[15px] leading-snug font-medium text-foreground", done && "text-muted-foreground line-through")}>{t.title}</span>
            </button>
            <ScoreChip score={item.task.priorityScore} breakdown={item.breakdown} className="shrink-0" />
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <StatusPill tone={status.tone} label={status.label} />
            <PriorityBadge priority={t.priority} />
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="size-3" aria-hidden />
              <DueLabel date={t.dueDate} today={today} done={done} />
              {t.hardDeadline && <span className="text-serious-ink">· hard</span>}
            </span>
            <span className="tabular">{formatMinutes(t.estimatedMinutes)}</span>
            <PersonName person={t.owner} />
            {t.pillar && <PillarTag name={t.pillar.name} color={t.pillar.color} compact className="hidden sm:inline-flex" />}
            {item.source === "CEO" && <span className="text-2xs text-brand">Your pick</span>}
          </div>

          {!expanded && !done && (
            <p className="mt-1.5 line-clamp-1 text-xs text-ink-2">
              <span className="text-brain">Why: </span>
              {item.breakdown?.rationale ?? t.aiRecommendation}
            </p>
          )}

          {expanded && (
            <div className="mt-3 grid gap-3 rounded-lg border border-hairline bg-surface-2/60 p-3 text-[14px] sm:grid-cols-2">
              <Detail label="Why this matters" className="sm:col-span-2">
                <span className="text-foreground">{item.breakdown?.rationale ?? t.aiRecommendation ?? "—"}</span>
              </Detail>
              <Detail label="Strategic importance">
                {IMPORTANCE[t.strategicImpact]}
                {t.pillar && <span className="text-muted-foreground"> · {t.pillar.name}</span>}
              </Detail>
              <Detail label="Related goal">
                {t.goal ? (
                  <Link href={`/goals/${t.goal.id}`} className="hover:underline">
                    {t.goal.title}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Not linked</span>
                )}
                {t.milestone && <span className="block text-xs text-muted-foreground">→ {t.milestone.title}</span>}
              </Detail>
              <Detail label="Blockers">{blockersOf(item) || <span className="text-muted-foreground">None</span>}</Detail>
              <Detail label="Next action">
                <span className="font-medium text-foreground">{nextAction(item)}</span>
              </Detail>
              {t.delegationRecommended && t.suggestedDelegate && (
                <Detail label="Brain suggests" className="sm:col-span-2">
                  Delegate to <span className="font-medium">{t.suggestedDelegate.name}</span> — you are not uniquely required.
                </Detail>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5 max-sm:-mt-2 max-sm:w-full max-sm:justify-end sm:opacity-60 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
          {!done && (
            <>
              <Reschedule taskId={t.id} today={today} />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-sm" onClick={() => openDelegate(t.id)} aria-label="Delegate">
                    <UserPlus />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Delegate</TooltipContent>
              </Tooltip>
            </>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="More actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={() => openEntity("task", t.id)}>
                <NotebookPen /> Open details & notes
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Target /> Change priority
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup value={t.priority} onValueChange={(v) => run(() => setTaskPriority(t.id, v as Priority))}>
                    {(["P0", "P1", "P2", "P3"] as Priority[]).map((p) => (
                      <DropdownMenuRadioItem key={p} value={p}>
                        {p} · {PRIORITY[p].label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem disabled={index === 0} onSelect={() => run(() => moveInTop5(t.id, "up"), { success: false })}>
                <ArrowUp /> Move up
              </DropdownMenuItem>
              <DropdownMenuItem disabled={index === count - 1} onSelect={() => run(() => moveInTop5(t.id, "down"), { success: false })}>
                <ArrowDown /> Move down
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-2xs">Related information</DropdownMenuLabel>
              {t.goal && (
                <DropdownMenuItem asChild>
                  <Link href={`/goals/${t.goal.id}`}>
                    <ChevronRight /> Goal: {t.goal.title}
                  </Link>
                </DropdownMenuItem>
              )}
              {t.milestone && (
                <DropdownMenuItem onSelect={() => openEntity("milestone", t.milestone!.id)}>
                  <ChevronRight /> Milestone: {t.milestone.title}
                </DropdownMenuItem>
              )}
              {t.decision && (
                <DropdownMenuItem asChild>
                  <Link href={`/decisions/${t.decision.id}`}>
                    <ChevronRight /> Decision
                  </Link>
                </DropdownMenuItem>
              )}
              {t.company && (
                <DropdownMenuItem asChild>
                  <Link href={`/resources/companies/${t.company.id}`}>
                    <ChevronRight /> {t.company.name}
                  </Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => run(() => removeFromTop5(t.id))}>
                <X /> Remove from Top 5
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </li>
  );
}

function Detail({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="mb-0.5 text-2xs font-medium text-muted-foreground">{label}</div>
      <div className="text-ink-2">{children}</div>
    </div>
  );
}

function Reschedule({ taskId, today }: { taskId: string; today: Date }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(dayKey(addDays(today, 1)));
  const { pending, run } = useAction();
  const nextMonday = addDays(startOfWeek(today), 7);
  const go = async (d: string) => {
    const res = await run(() => rescheduleTask(taskId, d), { success: "Rescheduled" });
    if (res.ok) setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Reschedule">
              <CalendarClock />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Reschedule</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-60 p-2">
        <div className="grid gap-1">
          <Button variant="ghost" size="sm" className="justify-start" disabled={pending} onClick={() => go(dayKey(addDays(today, 1)))}>
            Tomorrow
          </Button>
          <Button variant="ghost" size="sm" className="justify-start" disabled={pending} onClick={() => go(dayKey(nextMonday))}>
            Next week (Mon)
          </Button>
          <div className="mt-1 flex gap-1.5 border-t border-border pt-2">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-7" aria-label="New due date" />
            <Button size="sm" disabled={pending || !date} onClick={() => go(date)}>
              Set
            </Button>
          </div>
          <p className="px-1 pt-1 text-2xs text-muted-foreground">Postponements are tracked — repeated slips are flagged by the Brain.</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function AddPriority({ disabled }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<{ id: string; title: string; subtitle: string }[] | null>(null);
  const { pending, run } = useAction();
  useEffect(() => {
    if (open && tasks === null) listPickerTasks().then(setTasks);
  }, [open, tasks]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" disabled={disabled}>
          <Plus /> Add
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-1">
        <div className="px-2 pt-1.5 pb-1 text-2xs font-medium text-muted-foreground">Add one of your tasks to today’s Top 5</div>
        <ul className="max-h-72 overflow-y-auto">
          {tasks === null && <li className="px-2 py-2 text-xs text-muted-foreground">Loading…</li>}
          {tasks?.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                disabled={pending}
                className="flex w-full flex-col rounded-md px-2 py-1.5 text-left hover:bg-muted"
                onClick={async () => {
                  const res = await run(() => pinToTop5(t.id));
                  if (res.ok) {
                    setOpen(false);
                    setTasks(null);
                  }
                }}
              >
                <span className="truncate text-[14px]">{t.title}</span>
                <span className="truncate text-2xs text-muted-foreground">{t.subtitle}</span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

