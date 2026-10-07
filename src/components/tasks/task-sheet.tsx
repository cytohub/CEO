"use client";

import {
  ArrowRight,
  Check,
  CircleDashed,
  ExternalLink,
  Link2,
  Loader2,
  MessageSquarePlus,
  Pin,
  PinOff,
  RotateCcw,
  Sparkles,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, PillarTag } from "@/components/common/bits";
import { CompanySelect, FocusAreaSelect, GoalSelect, MilestoneSelect, PersonSelect, PrioritySelect, RatingInput, SimpleSelect } from "@/components/common/fields";
import { StatusPill, TONE_TEXT } from "@/components/common/status";
import { TaskSourceSection } from "@/components/intelligence/task-source";
import { useUI } from "@/components/shell/ui-context";
import type { TaskStatus } from "@/generated/prisma/enums";
import { dayKey, daysBetween, formatDateTime, formatDay, timeAgo, today as todayIn } from "@/lib/dates";
import { DELEGATION_STATUS, INSIGHT_TYPES, RESOURCE_TYPES, SOURCES, TASK_STATUS } from "@/lib/domain";
import { formatMinutes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { pinToTop5, removeFromTop5 } from "@/server/actions/dayplan";
import { addTaskNote, completeTask, fetchTaskDetail, updateTask, type UpdateTaskInput } from "@/server/actions/tasks";
import { FACTOR_META } from "@/server/brain/scoring";
import type { TaskDetail } from "@/server/queries/tasks";
import { ScoreBreakdownView, ScoreChip } from "./score";

export function TaskSheet({ taskId, onClose }: { taskId: string | null; onClose: () => void }) {
  const { lookups, openDelegate } = useUI();
  // Loaded detail is keyed by id so a stale task never shows for a new one.
  const [state, setState] = useState<{ id: string; task: TaskDetail | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const task = state && state.id === taskId ? state.task : null;
  const loading = Boolean(taskId) && state?.id !== taskId;

  const load = useCallback(async (id: string) => {
    const t = await fetchTaskDetail(id);
    setState({ id, task: t });
  }, []);

  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    fetchTaskDetail(taskId).then((t) => {
      if (!cancelled) setState({ id: taskId, task: t });
    });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  async function save(patch: UpdateTaskInput, silent = false) {
    if (!task) return;
    setBusy(true);
    const res = await updateTask(task.id, patch);
    setBusy(false);
    if (!res.ok) toast.error(res.error);
    else if (!silent) toast.success("Saved");
    await load(task.id);
  }

  async function act(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    if (!task) return;
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (res.ok) toast.success(res.message ?? "Done");
    else toast.error(res.error ?? "Something went wrong");
    await load(task.id);
  }

  const today = todayIn(lookups.timezone);
  const done = task?.status === "DONE";

  return (
    <Sheet open={Boolean(taskId)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[600px]">
        {loading || !task ? (
          <div className="space-y-3 p-5">
            <SheetHeader className="p-0">
              <SheetTitle className="sr-only">Loading task</SheetTitle>
              <SheetDescription className="sr-only">Loading task details</SheetDescription>
            </SheetHeader>
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-7 w-4/5" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : (
          <>
            <SheetHeader className="gap-2 border-b border-border p-5 pr-12">
              <div className="flex flex-wrap items-center gap-2">
                <ScoreChip score={task.priorityScore} breakdown={task.breakdown} />
                <StatusPill tone={TASK_STATUS[task.status].tone} label={TASK_STATUS[task.status].label} />
                {task.inTop5 && <StatusPill tone="brain" label="Today’s Top 5" />}
                {task.hardDeadline && <StatusPill tone="serious" label="Hard deadline" />}
                {busy && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Saving" />}
              </div>
              <SheetTitle asChild>
                <InlineTitle value={task.title} onSave={(title) => save({ title }, true)} />
              </SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                {task.pillar && <PillarTag name={task.pillar.name} color={task.pillar.color} />}
                {task.goal && (
                  <Link href={`/goals/${task.goal.id}`} className="text-muted-foreground hover:text-foreground hover:underline">
                    {task.goal.title}
                  </Link>
                )}
                {task.milestone && (
                  <>
                    <ArrowRight className="size-3 text-ink-3" aria-hidden />
                    <span className="text-muted-foreground">{task.milestone.title}</span>
                  </>
                )}
              </SheetDescription>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {done ? (
                  <Button size="sm" variant="outline" onClick={() => save({ status: "TODO" })}>
                    <RotateCcw /> Reopen
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => act(() => completeTask(task.id))}>
                    <Check /> Complete
                  </Button>
                )}
                {!done && (
                  <Button size="sm" variant="outline" onClick={() => openDelegate(task.id)}>
                    <UserPlus /> Delegate
                  </Button>
                )}
                {!done && (
                  <Button size="sm" variant="outline" onClick={() => act(() => (task.inTop5 ? removeFromTop5(task.id) : pinToTop5(task.id)))}>
                    {task.inTop5 ? <PinOff /> : <Pin />} {task.inTop5 ? "Remove from Top 5" : "Add to Top 5"}
                  </Button>
                )}
                <div className="ml-auto w-[150px]">
                  <PrioritySelect size="sm" value={task.priority} onChange={(p) => save({ priority: p })} />
                </div>
              </div>
            </SheetHeader>

            <div className="space-y-6 p-5">
              {(task.aiRecommendation || task.breakdown) && (
                <section className="rounded-lg border border-brain/20 bg-brain-soft/60 p-3.5">
                  <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-brain">
                    <Sparkles className="size-3.5" aria-hidden /> Why this matters
                  </div>
                  <p className="text-[15px] leading-relaxed text-foreground">{task.aiRecommendation ?? task.breakdown?.rationale}</p>
                  {task.suggestedDelegate && task.delegationRecommended && (
                    <p className="mt-2 text-xs text-ink-2">
                      Suggested owner: <span className="font-medium">{task.suggestedDelegate.name}</span>
                    </p>
                  )}
                  {task.breakdown && (
                    <details className="group mt-3">
                      <summary className="cursor-pointer list-none text-2xs font-medium text-muted-foreground hover:text-foreground">
                        <span className="group-open:hidden">Show score breakdown</span>
                        <span className="hidden group-open:inline">Hide score breakdown</span>
                      </summary>
                      <ScoreBreakdownView breakdown={task.breakdown} className="mt-2 rounded-md bg-surface p-3" />
                    </details>
                  )}
                </section>
              )}

              <TaskSourceSection taskId={task.id} confidence={task.extractionConfidence} />

              <section>
                <h3 className="eyebrow mb-2">Details</h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <LabeledControl label="Status">
                    <SimpleSelect
                      size="sm"
                      value={task.status}
                      onChange={(v) => v && save({ status: v as TaskStatus })}
                      options={(Object.keys(TASK_STATUS) as TaskStatus[]).map((s) => ({ value: s, label: TASK_STATUS[s].label }))}
                    />
                  </LabeledControl>
                  <LabeledControl label="Owner">
                    <PersonSelect size="sm" value={task.ownerId} onChange={(v) => save({ ownerId: v })} teamOnly />
                  </LabeledControl>
                  <LabeledControl label="Due date">
                    <div className="flex items-center gap-2">
                      <Input
                        type="date"
                        className="h-7"
                        defaultValue={task.dueDate ? dayKey(task.dueDate) : ""}
                        key={task.dueDate?.toISOString() ?? "none"}
                        onBlur={(e) => {
                          const v = e.target.value || null;
                          const cur = task.dueDate ? dayKey(task.dueDate) : null;
                          if (v !== cur) save({ dueDate: v });
                        }}
                        aria-label="Due date"
                      />
                    </div>
                    {task.dueDate && !done && (
                      <p className={cn("mt-1 text-2xs", daysBetween(today, task.dueDate) < 0 ? TONE_TEXT.critical : "text-muted-foreground")}>
                        {daysBetween(today, task.dueDate) < 0 ? `${-daysBetween(today, task.dueDate)} days overdue` : `In ${daysBetween(today, task.dueDate)} days`}
                        {task.postponeCount > 0 && ` · postponed ${task.postponeCount}×`}
                      </p>
                    )}
                  </LabeledControl>
                  <LabeledControl label="Focus area">
                    <FocusAreaSelect size="sm" value={task.focusArea} onChange={(v) => save({ focusArea: v })} />
                  </LabeledControl>
                  <LabeledControl label="Goal">
                    <GoalSelect size="sm" value={task.goalId} onChange={(v) => save({ goalId: v })} />
                  </LabeledControl>
                  <LabeledControl label="Milestone">
                    <MilestoneSelect size="sm" value={task.milestoneId} onChange={(v) => save({ milestoneId: v })} goalId={task.goalId} />
                  </LabeledControl>
                  <LabeledControl label="Company">
                    <CompanySelect size="sm" value={task.companyId} onChange={(v) => save({ companyId: v })} />
                  </LabeledControl>
                  <LabeledControl label="Effort">
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        step={15}
                        className="h-7"
                        defaultValue={task.estimatedMinutes ?? ""}
                        key={`est-${task.estimatedMinutes}`}
                        onBlur={(e) => {
                          const v = e.target.value ? Number(e.target.value) : null;
                          if (v !== task.estimatedMinutes) save({ estimatedMinutes: v }, true);
                        }}
                        aria-label="Estimated minutes"
                        placeholder="Est."
                      />
                      <Input
                        type="number"
                        min={0}
                        step={15}
                        className="h-7"
                        defaultValue={task.actualMinutes ?? ""}
                        key={`act-${task.actualMinutes}`}
                        onBlur={(e) => {
                          const v = e.target.value ? Number(e.target.value) : null;
                          if (v !== task.actualMinutes) save({ actualMinutes: v }, true);
                        }}
                        aria-label="Actual minutes"
                        placeholder="Actual"
                      />
                    </div>
                    <p className="mt-1 text-2xs text-muted-foreground">
                      {formatMinutes(task.estimatedMinutes)} est · {formatMinutes(task.actualMinutes)} actual
                    </p>
                  </LabeledControl>
                  <label className="col-span-2 flex items-center gap-2 text-xs text-ink-2">
                    <Switch checked={task.hardDeadline} onCheckedChange={(v) => save({ hardDeadline: v })} /> Hard external deadline
                  </label>
                </div>
              </section>

              <section>
                <h3 className="eyebrow mb-2">Description</h3>
                <Textarea
                  rows={3}
                  defaultValue={task.description ?? ""}
                  key={`desc-${task.updatedAt.toISOString()}`}
                  placeholder="Add context or a definition of done…"
                  onBlur={(e) => {
                    if ((e.target.value || null) !== task.description) save({ description: e.target.value || null }, true);
                  }}
                />
              </section>

              <section>
                <h3 className="eyebrow mb-2">Blocker</h3>
                <Input
                  defaultValue={task.blocker ?? ""}
                  key={`blk-${task.updatedAt.toISOString()}`}
                  placeholder="Nothing blocking"
                  onBlur={(e) => {
                    if ((e.target.value || null) !== task.blocker) save({ blocker: e.target.value || null }, true);
                  }}
                />
              </section>

              <details className="rounded-lg border border-border">
                <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-ink-2">Priority Score inputs</summary>
                <div className="grid gap-2 border-t border-border p-3">
                  {(
                    [
                      ["strategicImpact", "strategic"],
                      ["revenueImpact", "revenue"],
                      ["fundraisingImpact", "fundraising"],
                      ["customerImpact", "customer"],
                      ["scientificImpact", "scientific"],
                      ["riskLevel", "risk"],
                      ["ceoUniqueness", "uniqueness"],
                      ["opportunityCost", "opportunity"],
                    ] as const
                  ).map(([field, factor]) => (
                    <RatingInput key={field} label={FACTOR_META[factor].label} value={task[field]} onChange={(v) => save({ [field]: v }, true)} />
                  ))}
                </div>
              </details>

              {task.delegation && (
                <section>
                  <h3 className="eyebrow mb-2">Delegation</h3>
                  <div className="rounded-lg border border-border p-3 text-[15px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <Avatar name={task.delegation.delegate.name} />
                        {task.delegation.delegate.name}
                      </span>
                      <StatusPill tone={DELEGATION_STATUS[task.delegation.status].tone} label={DELEGATION_STATUS[task.delegation.status].label} />
                    </div>
                    {task.delegation.expectations && <p className="mt-2 text-xs text-muted-foreground">{task.delegation.expectations}</p>}
                    <p className="mt-2 text-xs text-ink-2">
                      Last update {timeAgo(task.delegation.lastUpdateAt ?? task.delegation.delegatedAt)}
                      {task.delegation.lastUpdateNote && ` — “${task.delegation.lastUpdateNote}”`}
                    </p>
                    <Link href="/delegation" className="mt-2 inline-flex items-center gap-1 text-xs text-brand hover:underline">
                      Open Delegation Center <ArrowRight className="size-3" />
                    </Link>
                  </div>
                </section>
              )}

              {(task.dependsOn.length > 0 || task.blocks.length > 0) && (
                <section>
                  <h3 className="eyebrow mb-2">Dependencies</h3>
                  <ul className="space-y-1 text-[15px]">
                    {task.dependsOn.map((d) => (
                      <li key={d.id} className="flex items-center gap-2">
                        <CircleDashed className="size-3.5 text-ink-3" aria-hidden />
                        <span className="text-muted-foreground">Waiting on</span>
                        <Link href={`?task=${d.id}`} className="truncate hover:underline">
                          {d.title}
                        </Link>
                        <StatusPill tone={TASK_STATUS[d.status].tone} label={TASK_STATUS[d.status].label} className="ml-auto" />
                      </li>
                    ))}
                    {task.blocks.map((d) => (
                      <li key={d.id} className="flex items-center gap-2">
                        <Link2 className="size-3.5 text-ink-3" aria-hidden />
                        <span className="text-muted-foreground">Unblocks</span>
                        <Link href={`?task=${d.id}`} className="truncate hover:underline">
                          {d.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <RelatedSection task={task} />

              <NotesSection task={task} onAdded={() => load(task.id)} />

              <section>
                <h3 className="eyebrow mb-2">Activity</h3>
                <ol className="relative space-y-2 border-l border-border pl-4">
                  {task.activities.map((a) => (
                    <li key={a.id} className="text-xs">
                      <span className="absolute -left-[3px] mt-1.5 size-1.5 rounded-full bg-ink-3" aria-hidden />
                      <span className="text-ink-2">{a.summary}</span>
                      <span className="ml-2 text-muted-foreground">
                        {a.actor !== "CEO" && `${a.actor} · `}
                        {formatDateTime(a.createdAt, lookups.timezone)}
                      </span>
                    </li>
                  ))}
                  <li className="text-xs text-muted-foreground">
                    <span className="absolute -left-[3px] mt-1.5 size-1.5 rounded-full bg-border" aria-hidden />
                    Created {formatDay(task.createdAt, true)} · source: {SOURCES[task.source].label}
                  </li>
                </ol>
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function LabeledControl({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-2xs font-medium text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function InlineTitle({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  return (
    <textarea
      defaultValue={value}
      key={value}
      rows={1}
      aria-label="Task title"
      className="field-sizing-content w-full resize-none rounded-md bg-transparent text-lg leading-snug font-semibold tracking-tight text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
      onBlur={(e) => {
        const v = e.target.value.trim();
        if (v && v !== value) onSave(v);
      }}
    />
  );
}

function RelatedSection({ task }: { task: TaskDetail }) {
  const has = task.people.length || task.resources.length || task.decision || task.company || task.meeting || task.insights.length;
  if (!has) return null;
  return (
    <section>
      <h3 className="eyebrow mb-2">Related information</h3>
      <div className="grid gap-3 text-[15px]">
        {task.decision && (
          <Link href={`/decisions/${task.decision.id}`} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 hover:bg-muted">
            <span className="text-muted-foreground">Decision</span>
            <span className="truncate">{task.decision.title}</span>
            <ExternalLink className="ml-auto size-3.5 text-ink-3" aria-hidden />
          </Link>
        )}
        {task.company && (
          <Link href={`/resources/companies/${task.company.id}`} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 hover:bg-muted">
            <span className="text-muted-foreground">Company</span>
            <span className="truncate">{task.company.name}</span>
            <ExternalLink className="ml-auto size-3.5 text-ink-3" aria-hidden />
          </Link>
        )}
        {task.people.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {task.people.map((p) => (
              <Link key={p.id} href={`/resources/people/${p.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-border py-0.5 pr-2 pl-0.5 text-xs hover:bg-muted">
                <Avatar name={p.name} />
                {p.name}
              </Link>
            ))}
          </div>
        )}
        {task.resources.length > 0 && (
          <ul className="space-y-1">
            {task.resources.map((r) => {
              const Icon = RESOURCE_TYPES[r.type].icon;
              return (
                <li key={r.id}>
                  <a href={r.url ?? `/resources?resource=${r.id}`} target={r.url ? "_blank" : undefined} rel="noreferrer" className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted">
                    <Icon className="size-3.5 text-ink-3" aria-hidden />
                    <span className="truncate">{r.title}</span>
                    <span className="ml-auto text-2xs text-muted-foreground">{RESOURCE_TYPES[r.type].label}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
        {task.insights.length > 0 && (
          <ul className="space-y-1">
            {task.insights.map((i) => {
              const meta = INSIGHT_TYPES[i.type];
              return (
                <li key={i.id} className="flex items-center gap-2 text-xs">
                  <meta.icon className={cn("size-3.5", TONE_TEXT[meta.tone])} aria-hidden />
                  <span className="truncate text-ink-2">{i.title}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function NotesSection({ task, onAdded }: { task: TaskDetail; onAdded: () => void }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const { lookups } = useUI();
  return (
    <section>
      <h3 className="eyebrow mb-2">Notes</h3>
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!text.trim()) return;
          setSaving(true);
          const res = await addTaskNote(task.id, text);
          setSaving(false);
          if (res.ok) {
            setText("");
            onAdded();
          } else toast.error(res.error);
        }}
      >
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note…" aria-label="New note" />
        <Button type="submit" size="sm" variant="outline" disabled={saving || !text.trim()}>
          <MessageSquarePlus /> Add
        </Button>
      </form>
      {task.notes.length > 0 && (
        <ul className="mt-3 space-y-2">
          {task.notes.map((n) => (
            <li key={n.id} className="rounded-md bg-surface-2 px-3 py-2 text-[15px]">
              <p className="whitespace-pre-wrap text-foreground">{n.body}</p>
              <p className="mt-1 text-2xs text-muted-foreground">
                {n.author} · {formatDateTime(n.createdAt, lookups.timezone)}
              </p>
            </li>
          ))}
        </ul>
      )}
      {task.notesText && <p className="mt-2 text-xs text-muted-foreground">{task.notesText}</p>}
    </section>
  );
}
