import { ArrowLeft, CalendarClock, FileText, Flag, Gavel, ListChecks, NotebookPen, Plus, Sparkles, Target } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DueLabel, KeyValue, PageHeader, Panel, PersonName, PillarTag, Sparkline } from "@/components/common/bits";
import { CreateButton } from "@/components/common/create-button";
import { Meter, StatusPill, TONE_TEXT } from "@/components/common/status";
import { EditGoalButton, GoalNoteForm, GoalQuickControls, GoalRisksEditor } from "@/components/goals/goal-controls";
import { ViewSourceButton } from "@/components/intelligence/view-source";
import { MeetingLink, MilestoneLink, TaskLink } from "@/components/tasks/task-link";
import { cn } from "@/lib/utils";
import { daysBetween, formatDateTime, formatDay } from "@/lib/dates";
import { DECISION_STATUS, GOAL_STATUS, GOAL_TYPES, INSIGHT_TYPES, MILESTONE_STATUS, MILESTONE_TYPES, RESOURCE_TYPES, TASK_STATUS } from "@/lib/domain";
import { formatMetric } from "@/lib/format";
import { getGoalDetail } from "@/server/queries/goals";
import { getProvenanceCounts } from "@/server/queries/provenance";
import { requirePage } from "@/server/security/session";

export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await props.params;
  const d = await getGoalDetail(id);
  return { title: d?.goal.title ?? "Goal" };
}

export default async function GoalPage(props: { params: Promise<{ id: string }> }) {
  const viewer = await requirePage("workspace.view", "/goals");
  const { id } = await props.params;
  const data = await getGoalDetail(id);
  if (!data) notFound();
  const sources = (await getProvenanceCounts(viewer, "GOAL", [id]))[id];
  const { goal, metrics, progressHistory, today, timezone } = data;
  const status = GOAL_STATUS[goal.status];
  const openTasks = goal.tasks.filter((t) => !["DONE", "CANCELLED"].includes(t.status));
  const doneTasks = goal.tasks.filter((t) => t.status === "DONE");
  const msDone = goal.milestones.filter((m) => m.status === "COMPLETED").length;
  const left = goal.targetDate ? daysBetween(today, goal.targetDate) : null;
  // Expected progress if work were linear from start to target.
  const expected =
    goal.startDate && goal.targetDate && goal.targetDate > goal.startDate
      ? Math.max(0, Math.min(100, Math.round((daysBetween(goal.startDate, today) / daysBetween(goal.startDate, goal.targetDate)) * 100)))
      : null;

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <PageHeader
        eyebrow={
          <Link href="/goals" className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="size-3" /> Goals
          </Link>
        }
        title={goal.title}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusPill tone={status.tone} label={status.label} />
            <span>{GOAL_TYPES[goal.type].label} goal</span>
            {goal.period && <span>{goal.period}</span>}
            {goal.pillar && <PillarTag name={goal.pillar.name} color={goal.pillar.color} />}
            {goal.parent && (
              <Link href={`/goals/${goal.parent.id}`} className="hover:underline">
                ↳ {goal.parent.title}
              </Link>
            )}
          </span>
        }
        actions={
          <>
            {sources && <ViewSourceButton targetType="GOAL" targetId={goal.id} count={sources.count} hidden={sources.hidden} variant="outline" />}
            <EditGoalButton goal={goal} />
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="min-w-0 space-y-4 xl:col-span-8">
          <section className="panel p-4">
            <div className="grid gap-4 sm:grid-cols-4">
              <div>
                <div className="text-2xs text-muted-foreground">Progress</div>
                <div className="mt-0.5 flex items-baseline gap-2">
                  <span className="text-2xl font-semibold tracking-tight">{goal.progress}%</span>
                  {expected !== null && goal.status !== "COMPLETED" && (
                    <span className={cn("text-2xs", goal.progress < expected - 10 ? TONE_TEXT.critical : "text-muted-foreground")}>{expected}% expected by now</span>
                  )}
                </div>
                <Meter value={goal.progress} tone={status.tone === "done" ? "good" : status.tone} className="mt-2" label="Progress" />
              </div>
              <div>
                <div className="text-2xs text-muted-foreground">Confidence</div>
                <div className={cn("mt-0.5 text-2xl font-semibold tracking-tight", goal.confidence < 50 && TONE_TEXT.critical)}>{goal.confidence}%</div>
                <div className="mt-1 text-2xs text-muted-foreground">Owner’s confidence of hitting the target</div>
              </div>
              <div>
                <div className="text-2xs text-muted-foreground">Target</div>
                <div className="mt-0.5 text-2xl font-semibold tracking-tight">{formatDay(goal.targetDate)}</div>
                {left !== null && <div className={cn("mt-1 text-2xs", left < 0 ? TONE_TEXT.critical : "text-muted-foreground")}>{left < 0 ? `${-left} days past target` : `${left} days left`}</div>}
              </div>
              <div>
                <div className="text-2xs text-muted-foreground">Execution</div>
                <div className="mt-0.5 text-2xl font-semibold tracking-tight">
                  {msDone}/{goal.milestones.length}
                </div>
                <div className="mt-1 text-2xs text-muted-foreground">
                  milestones · {openTasks.length} open / {doneTasks.length} done tasks
                </div>
              </div>
            </div>
            {progressHistory.length > 1 && (
              <div className="mt-4 flex items-center gap-3 border-t border-hairline pt-3 text-2xs text-muted-foreground">
                <span>Progress trend</span>
                <Sparkline values={progressHistory.map((p) => p.to)} width={180} height={24} />
                <span className="tabular">
                  {progressHistory[0].to}% → {progressHistory.at(-1)!.to}%
                </span>
              </div>
            )}
            <div className="mt-4 border-t border-hairline pt-4">
              <GoalQuickControls goal={goal} />
            </div>
          </section>

          {goal.description && (
            <section className="panel p-4">
              <h2 className="eyebrow mb-1.5">Description</h2>
              <p className="text-[15px] leading-relaxed text-ink-2">{goal.description}</p>
            </section>
          )}

          <Panel
            title="Milestones"
            icon={Flag}
            count={goal.milestones.length}
            actions={<CreateButton kind="milestone" label="Add" icon={<Plus />} variant="ghost" size="xs" defaults={{ goalId: goal.id }} />}
          >
            {goal.milestones.length === 0 ? (
              <p className="px-4 py-4 text-xs text-muted-foreground">No milestones yet — add the verifiable checkpoints that prove progress.</p>
            ) : (
              <ul className="divide-y divide-hairline">
                {goal.milestones.map((m) => {
                  const Icon = MILESTONE_TYPES[m.type].icon;
                  return (
                    <li key={m.id} className="flex items-center gap-3 px-4 py-2.5 text-[15px]">
                      <Icon className="size-3.5 shrink-0 text-ink-3" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <MilestoneLink id={m.id} title={m.title} className="block truncate font-medium" />
                        <span className="text-2xs text-muted-foreground">
                          {MILESTONE_TYPES[m.type].label} · {m.owner ? (m.owner.isCeo ? "You" : m.owner.name) : "Unassigned"}
                          {m.blocker && <span className={TONE_TEXT.critical}> · {m.blocker}</span>}
                        </span>
                      </div>
                      <div className="hidden w-28 items-center gap-2 sm:flex">
                        <Meter value={m.progress} tone={MILESTONE_STATUS[m.status].tone === "done" ? "good" : MILESTONE_STATUS[m.status].tone} label={`${m.title} progress`} />
                        <span className="w-8 text-right text-2xs tabular">{m.progress}%</span>
                      </div>
                      <StatusPill tone={MILESTONE_STATUS[m.status].tone} label={MILESTONE_STATUS[m.status].label} />
                      <span className="w-20 text-right text-xs">
                        <DueLabel date={m.dueDate} today={today} done={m.status === "COMPLETED"} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel
            title="Related tasks"
            icon={ListChecks}
            count={openTasks.length}
            actions={<CreateButton kind="task" label="Add" icon={<Plus />} variant="ghost" size="xs" defaults={{ goalId: goal.id }} />}
          >
            {goal.tasks.length === 0 ? (
              <p className="px-4 py-4 text-xs text-muted-foreground">No tasks linked to this goal.</p>
            ) : (
              <ul className="divide-y divide-hairline">
                {[...openTasks, ...doneTasks.slice(0, 5)].map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-4 py-2 text-[15px]">
                    <StatusPill tone={TASK_STATUS[t.status].tone} label={TASK_STATUS[t.status].label} />
                    <TaskLink id={t.id} title={t.title} className={cn("min-w-0 flex-1 truncate", t.status === "DONE" && "text-muted-foreground")} />
                    <span className="hidden text-xs text-muted-foreground sm:block">
                      <PersonName person={t.owner} />
                    </span>
                    <span className="w-20 text-right text-xs">
                      <DueLabel date={t.status === "DONE" ? t.completedAt : t.dueDate} today={today} done={t.status === "DONE"} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {goal.children.length > 0 && (
            <Panel title="Supporting goals" icon={Target} count={goal.children.length}>
              <ul className="divide-y divide-hairline">
                {goal.children.map((c) => (
                  <li key={c.id}>
                    <Link href={`/goals/${c.id}`} className="flex items-center gap-3 px-4 py-2 text-[15px] hover:bg-muted/40">
                      <span className="min-w-0 flex-1 truncate">{c.title}</span>
                      <span className="text-2xs text-muted-foreground">{GOAL_TYPES[c.type].label}</span>
                      <StatusPill tone={GOAL_STATUS[c.status].tone} label={GOAL_STATUS[c.status].label} />
                      <span className="w-10 text-right text-xs tabular">{c.progress}%</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel title="Recent activity" icon={CalendarClock}>
            <ol className="divide-y divide-hairline">
              {goal.activities.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-4 px-4 py-2 text-xs">
                  <span className="text-ink-2">{a.summary}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {a.actor !== "CEO" && `${a.actor} · `}
                    {formatDateTime(a.createdAt, timezone)}
                  </span>
                </li>
              ))}
              {goal.activities.length === 0 && <li className="px-4 py-3 text-xs text-muted-foreground">No activity yet.</li>}
            </ol>
          </Panel>
        </div>

        <aside className="min-w-0 space-y-4 xl:col-span-4">
          <section className="panel p-4">
            <h2 className="eyebrow mb-1">Details</h2>
            <dl className="divide-y divide-hairline">
              <KeyValue label="Owner">
                <PersonName person={goal.owner} />
              </KeyValue>
              <KeyValue label="Start">{formatDay(goal.startDate, true)}</KeyValue>
              <KeyValue label="Target">{formatDay(goal.targetDate, true)}</KeyValue>
              {goal.department && <KeyValue label="Department">{goal.department}</KeyValue>}
              <KeyValue label="Strategic pillar">{goal.pillar ? <PillarTag name={goal.pillar.name} color={goal.pillar.color} /> : "—"}</KeyValue>
            </dl>
          </section>

          {metrics.length > 0 && (
            <section className="panel p-4">
              <h2 className="eyebrow mb-2">Linked metrics</h2>
              <ul className="space-y-3">
                {metrics.map((m) => (
                  <li key={m.id} className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs text-muted-foreground">{m.name}</div>
                      <div className="text-[17px] font-semibold">
                        {formatMetric(m.current, m.unit)}
                        {m.target != null && <span className="ml-1 text-xs font-normal text-muted-foreground">/ {formatMetric(m.target, m.unit)}</span>}
                      </div>
                    </div>
                    <Sparkline values={m.series.map((p) => p.value)} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="panel p-4">
            <h2 className="eyebrow mb-2">Risks</h2>
            <GoalRisksEditor goalId={goal.id} risks={goal.risks} />
          </section>

          {goal.insights.length > 0 && (
            <Panel title="CytoHub Brain intelligence" icon={Sparkles}>
              <ul className="divide-y divide-hairline">
                {goal.insights.map((i) => {
                  const meta = INSIGHT_TYPES[i.type];
                  return (
                    <li key={i.id} className="flex gap-2.5 px-4 py-2 text-xs">
                      <meta.icon className={cn("mt-0.5 size-3.5 shrink-0", TONE_TEXT[meta.tone])} aria-hidden />
                      <div className="min-w-0">
                        <div className="text-ink-2">{i.title}</div>
                        <div className="text-2xs text-muted-foreground">
                          {meta.label} · {formatDay(i.createdAt)}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          )}

          <Panel title="Decisions" icon={Gavel} count={goal.decisions.length} actions={<CreateButton kind="decision" label="Add" icon={<Plus />} variant="ghost" size="xs" defaults={{ goalId: goal.id }} />}>
            {goal.decisions.length === 0 ? (
              <p className="px-4 py-3 text-xs text-muted-foreground">No decisions linked.</p>
            ) : (
              <ul className="divide-y divide-hairline">
                {goal.decisions.map((d) => (
                  <li key={d.id}>
                    <Link href={`/decisions/${d.id}`} className="block px-4 py-2 text-[15px] hover:bg-muted/40">
                      <span className="line-clamp-2">{d.title}</span>
                      <span className="text-2xs text-muted-foreground">{DECISION_STATUS[d.status].label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Resources" icon={FileText} count={goal.resources.length} actions={<CreateButton kind="resource" label="Add" icon={<Plus />} variant="ghost" size="xs" defaults={{ goalId: goal.id }} />}>
            {goal.resources.length === 0 ? (
              <p className="px-4 py-3 text-xs text-muted-foreground">No resources linked.</p>
            ) : (
              <ul className="divide-y divide-hairline">
                {goal.resources.map((r) => {
                  const Icon = RESOURCE_TYPES[r.type].icon;
                  return (
                    <li key={r.id}>
                      <a href={r.url ?? `/resources?resource=${r.id}`} target={r.url ? "_blank" : undefined} rel="noreferrer" className="flex items-center gap-2 px-4 py-2 text-[15px] hover:bg-muted/40">
                        <Icon className="size-3.5 shrink-0 text-ink-3" aria-hidden />
                        <span className="truncate">{r.title}</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          {goal.meetings.length > 0 && (
            <Panel title="Upcoming meetings" icon={CalendarClock}>
              <ul className="divide-y divide-hairline">
                {goal.meetings.map((m) => (
                  <li key={m.id} className="px-4 py-2 text-[15px]">
                    <MeetingLink id={m.id} title={m.title} className="block truncate" />
                    <span className="text-2xs text-muted-foreground">{formatDateTime(m.startsAt, timezone)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel title="Notes" icon={NotebookPen}>
            <div className="space-y-3 p-4">
              <GoalNoteForm goalId={goal.id} />
              {goal.notesText && <p className="text-xs text-ink-2">{goal.notesText}</p>}
              {goal.notes.map((n) => (
                <div key={n.id} className="rounded-md bg-surface-2 px-3 py-2 text-[15px]">
                  <p className="whitespace-pre-wrap">{n.body}</p>
                  <p className="mt-1 text-2xs text-muted-foreground">
                    {n.author} · {formatDateTime(n.createdAt, timezone)}
                  </p>
                </div>
              ))}
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
