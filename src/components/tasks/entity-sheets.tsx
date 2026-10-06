"use client";

import { Check, Loader2, RefreshCcw, Sparkles } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Avatar, DueLabel, EmptyState, PersonName, PillarTag } from "@/components/common/bits";
import { PersonSelect, SimpleSelect } from "@/components/common/fields";
import { StatusPill } from "@/components/common/status";
import { useUI } from "@/components/shell/ui-context";
import type { MilestoneStatus } from "@/generated/prisma/enums";
import { dayKey, formatDateTime, formatTime, today as todayIn } from "@/lib/dates";
import { MEETING_TYPES, MILESTONE_STATUS, MILESTONE_TYPES, TASK_STATUS } from "@/lib/domain";
import { fetchMilestoneDetail, updateMilestone } from "@/server/actions/goals";
import { fetchMeetingDetail, prepareMeeting, type MeetingDetail } from "@/server/actions/meetings";
import type { PrepBrief } from "@/server/brain/prepare";
import type { MilestoneDetail } from "@/server/queries/milestones";
import { TaskSheet } from "./task-sheet";

/** URL-driven entity sheets, available on every page: ?task= ?milestone= ?meeting= */
export function EntitySheets() {
  const params = useSearchParams();
  const { closeEntity } = useUI();
  return (
    <>
      <TaskSheet taskId={params.get("task")} onClose={() => closeEntity("task")} />
      <MilestoneSheet milestoneId={params.get("milestone")} onClose={() => closeEntity("milestone")} />
      <MeetingSheet meetingId={params.get("meeting")} onClose={() => closeEntity("meeting")} />
    </>
  );
}

function SheetSkeleton() {
  return (
    <div className="space-y-3 p-5">
      <SheetHeader className="p-0">
        <SheetTitle className="sr-only">Loading</SheetTitle>
        <SheetDescription className="sr-only">Loading details</SheetDescription>
      </SheetHeader>
      <Skeleton className="h-5 w-28" />
      <Skeleton className="h-7 w-3/4" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

function MilestoneSheet({ milestoneId, onClose }: { milestoneId: string | null; onClose: () => void }) {
  const { lookups, openEntity, openCreate } = useUI();
  const [m, setM] = useState<MilestoneDetail | null>(null);
  const [progress, setProgress] = useState(0);
  const load = useCallback(async (id: string) => {
    const d = await fetchMilestoneDetail(id);
    setM(d);
    if (d) setProgress(d.progress);
  }, []);
  useEffect(() => {
    setM(null);
    if (milestoneId) load(milestoneId);
  }, [milestoneId, load]);

  async function save(patch: Parameters<typeof updateMilestone>[1]) {
    if (!m) return;
    const res = await updateMilestone(m.id, patch);
    if (res.ok) toast.success(res.message ?? "Saved");
    else toast.error(res.error);
    await load(m.id);
  }
  const today = todayIn(lookups.timezone);
  const TypeIcon = m ? MILESTONE_TYPES[m.type].icon : null;

  return (
    <Sheet open={Boolean(milestoneId)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[560px]">
        {!m ? (
          <SheetSkeleton />
        ) : (
          <>
            <SheetHeader className="gap-2 border-b border-border p-5 pr-12">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone={MILESTONE_STATUS[m.status].tone} label={MILESTONE_STATUS[m.status].label} />
                {TypeIcon && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <TypeIcon className="size-3.5" aria-hidden /> {MILESTONE_TYPES[m.type].label}
                  </span>
                )}
              </div>
              <SheetTitle className="text-lg leading-snug">{m.title}</SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-2 text-xs">
                {m.pillar && <PillarTag name={m.pillar.name} color={m.pillar.color} />}
                {m.goal && (
                  <Link href={`/goals/${m.goal.id}`} className="hover:underline">
                    {m.goal.title}
                  </Link>
                )}
              </SheetDescription>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {m.status !== "COMPLETED" && (
                  <Button size="sm" onClick={() => save({ status: "COMPLETED" })}>
                    <Check /> Mark achieved
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => openCreate("task", { milestoneId: m.id, goalId: m.goalId ?? undefined })}>
                  Add task
                </Button>
              </div>
            </SheetHeader>
            <div className="space-y-6 p-5">
              <section className="grid grid-cols-2 gap-4">
                <div>
                  <div className="mb-1 text-2xs font-medium text-muted-foreground">Status</div>
                  <SimpleSelect
                    size="sm"
                    value={m.status}
                    onChange={(v) => v && save({ status: v as MilestoneStatus })}
                    options={(Object.keys(MILESTONE_STATUS) as MilestoneStatus[]).map((s) => ({ value: s, label: MILESTONE_STATUS[s].label }))}
                  />
                </div>
                <div>
                  <div className="mb-1 text-2xs font-medium text-muted-foreground">Owner</div>
                  <PersonSelect size="sm" value={m.ownerId} onChange={(v) => save({ ownerId: v })} teamOnly />
                </div>
                <div>
                  <div className="mb-1 text-2xs font-medium text-muted-foreground">Due date</div>
                  <Input type="date" className="h-7" key={m.dueDate.toISOString()} defaultValue={dayKey(m.dueDate)} onBlur={(e) => e.target.value && e.target.value !== dayKey(m.dueDate) && save({ dueDate: e.target.value })} aria-label="Due date" />
                  <div className="mt-1 text-2xs">
                    <DueLabel date={m.dueDate} today={today} done={m.status === "COMPLETED"} />
                  </div>
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-2xs font-medium text-muted-foreground">
                    <span>Progress</span>
                    <span className="tabular">{progress}%</span>
                  </div>
                  <Slider value={[progress]} max={100} step={5} onValueChange={([v]) => setProgress(v)} onValueCommit={([v]) => save({ progress: v })} aria-label="Progress" className="mt-2" />
                </div>
              </section>
              {m.successMetric && (
                <section>
                  <h3 className="eyebrow mb-1">Success criterion</h3>
                  <p className="text-[13px]">{m.successMetric}</p>
                </section>
              )}
              <section>
                <h3 className="eyebrow mb-1">Blocker</h3>
                <Input key={m.blocker ?? "none"} defaultValue={m.blocker ?? ""} placeholder="Nothing blocking" onBlur={(e) => (e.target.value || null) !== m.blocker && save({ blocker: e.target.value || null })} />
              </section>
              <section>
                <h3 className="eyebrow mb-2">Tasks ({m.tasks.length})</h3>
                {m.tasks.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No tasks linked yet.</p>
                ) : (
                  <ul className="divide-y divide-hairline rounded-lg border border-border">
                    {m.tasks.map((t) => (
                      <li key={t.id}>
                        <button type="button" onClick={() => openEntity("task", t.id)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-[13px] hover:bg-muted/60">
                          <StatusPill tone={TASK_STATUS[t.status].tone} label={TASK_STATUS[t.status].label} />
                          <span className="min-w-0 flex-1 truncate">{t.title}</span>
                          <PersonName person={t.owner} className="text-xs text-muted-foreground" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              {m.resources.length > 0 && (
                <section>
                  <h3 className="eyebrow mb-2">Resources</h3>
                  <ul className="space-y-1 text-[13px]">
                    {m.resources.map((r) => (
                      <li key={r.id}>
                        <a href={r.url ?? `/resources?resource=${r.id}`} target={r.url ? "_blank" : undefined} rel="noreferrer" className="hover:underline">
                          {r.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <section>
                <h3 className="eyebrow mb-2">Recent activity</h3>
                <ul className="space-y-1.5 text-xs">
                  {m.activities.map((a) => (
                    <li key={a.id} className="flex justify-between gap-3">
                      <span className="text-ink-2">{a.summary}</span>
                      <span className="shrink-0 text-muted-foreground">{formatDateTime(a.createdAt, lookups.timezone)}</span>
                    </li>
                  ))}
                  {m.activities.length === 0 && <li className="text-muted-foreground">No activity yet.</li>}
                </ul>
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function MeetingSheet({ meetingId, onClose }: { meetingId: string | null; onClose: () => void }) {
  const { lookups } = useUI();
  const [m, setM] = useState<MeetingDetail | null>(null);
  const [preparing, setPreparing] = useState(false);

  const prepare = useCallback(async (id: string) => {
    setPreparing(true);
    const res = await prepareMeeting(id);
    setPreparing(false);
    if (res.ok) {
      setM((cur) => (cur ? { ...cur, prepBrief: res.data, preparedAt: new Date() } : cur));
    } else toast.error(res.error);
  }, []);

  useEffect(() => {
    setM(null);
    if (!meetingId) return;
    fetchMeetingDetail(meetingId).then((d) => {
      setM(d);
      // Prepare Me on open when no brief exists yet.
      if (d && !d.prepBrief) prepare(d.id);
    });
  }, [meetingId, prepare]);

  const tz = lookups.timezone;
  const b = m?.prepBrief;

  return (
    <Sheet open={Boolean(meetingId)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[640px]">
        {!m ? (
          <SheetSkeleton />
        ) : (
          <>
            <SheetHeader className="gap-2 border-b border-border p-5 pr-12">
              <div className="flex items-center gap-2 text-xs text-brain">
                <Sparkles className="size-3.5" aria-hidden /> Prepare Me
              </div>
              <SheetTitle className="text-lg leading-snug">{m.title}</SheetTitle>
              <SheetDescription className="text-xs">
                {formatDateTime(m.startsAt, tz)}–{formatTime(m.endsAt, tz)} · {MEETING_TYPES[m.type as keyof typeof MEETING_TYPES]?.label}
                {m.location && ` · ${m.location}`}
                {m.company && (
                  <>
                    {" · "}
                    <Link href={`/resources/companies/${m.company.id}`} className="hover:underline">
                      {m.company.name}
                    </Link>
                  </>
                )}
              </SheetDescription>
              <div className="mt-1 flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => prepare(m.id)} disabled={preparing}>
                  {preparing ? <Loader2 className="animate-spin" /> : <RefreshCcw />} {b ? "Regenerate" : "Prepare"}
                </Button>
                {b && (
                  <span className="text-2xs text-muted-foreground">
                    {b.engine === "claude" ? "Written by Chief of Staff (Claude)" : "Assembled by CytoHub Brain rules"} · {formatDateTime(new Date(b.generatedAt), tz)}
                  </span>
                )}
              </div>
            </SheetHeader>
            <div className="space-y-6 p-5">
              {!b ? (
                preparing ? (
                  <div className="space-y-3" aria-busy>
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" /> Gathering context, history and open issues from CytoHub Brain…
                    </p>
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-28 w-full" />
                  </div>
                ) : (
                  <EmptyState title="No brief yet" description="Generate a brief to see context, talking points and risks." />
                )
              ) : (
                <PrepBriefView brief={b} />
              )}
              <section>
                <h3 className="eyebrow mb-2">Attendees</h3>
                <ul className="flex flex-wrap gap-1.5">
                  {m.attendees.map((a) => (
                    <li key={a.id}>
                      <Link href={a.isCeo ? "#" : `/resources/people/${a.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-border py-0.5 pr-2 pl-0.5 text-xs hover:bg-muted">
                        <Avatar name={a.name} ceo={a.isCeo} />
                        {a.isCeo ? "You" : a.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function BriefList({ title, items, ordered }: { title: string; items: string[]; ordered?: boolean }) {
  if (!items.length) return null;
  const List = ordered ? "ol" : "ul";
  return (
    <section>
      <h3 className="eyebrow mb-2">{title}</h3>
      <List className={ordered ? "list-decimal space-y-1.5 pl-5 text-[13px]" : "space-y-1.5 text-[13px]"}>
        {items.map((t, i) => (
          <li key={i} className={ordered ? "pl-1" : "flex gap-2"}>
            {!ordered && <span className="mt-2 size-1 shrink-0 rounded-full bg-ink-3" aria-hidden />}
            <span>{t}</span>
          </li>
        ))}
      </List>
    </section>
  );
}

export function PrepBriefView({ brief }: { brief: PrepBrief }) {
  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-brain/20 bg-brain-soft/60 p-3.5">
        <h3 className="mb-1 text-xs font-medium text-brain">Context</h3>
        <p className="text-[13px] leading-relaxed">{brief.context}</p>
        <p className="mt-2 text-[13px]">
          <span className="font-medium">Desired outcome: </span>
          {brief.desiredOutcome}
        </p>
      </section>
      <BriefList title="Objectives" items={brief.objectives} />
      <BriefList title="Recommended talking points" items={brief.talkingPoints} ordered />
      <BriefList title="Questions to ask" items={brief.questions} />
      {brief.openIssues.length > 0 && (
        <section>
          <h3 className="eyebrow mb-2">Open issues</h3>
          <ul className="divide-y divide-hairline rounded-lg border border-border text-[13px]">
            {brief.openIssues.map((o, i) => (
              <li key={i} className="flex items-center gap-3 px-3 py-2">
                <span className="w-28 shrink-0 text-2xs text-muted-foreground">{o.kind}</span>
                {o.href ? (
                  <Link href={o.href} className="min-w-0 flex-1 truncate hover:underline">
                    {o.title}
                  </Link>
                ) : (
                  <span className="min-w-0 flex-1 truncate">{o.title}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <BriefList title="Risks" items={brief.risks} />
      {brief.participants.length > 0 && (
        <section>
          <h3 className="eyebrow mb-2">Participants</h3>
          <ul className="space-y-2 text-[13px]">
            {brief.participants.map((p) => (
              <li key={p.name} className="flex gap-3">
                <Avatar name={p.name} className="mt-0.5" />
                <div className="min-w-0">
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {p.role}
                    {p.lastContact && ` · last contact ${p.lastContact}`}
                  </div>
                  {p.note && <div className="mt-0.5 text-xs text-ink-2">{p.note}</div>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {brief.history.length > 0 && (
        <section>
          <h3 className="eyebrow mb-2">History</h3>
          <ol className="relative space-y-2.5 border-l border-border pl-4">
            {brief.history.map((h, i) => (
              <li key={i} className="text-[13px]">
                <span className="absolute -left-[3px] mt-1.5 size-1.5 rounded-full bg-ink-3" aria-hidden />
                <div className="flex gap-2">
                  <span className="w-20 shrink-0 text-2xs text-muted-foreground tabular">{h.date}</span>
                  <div className="min-w-0">
                    <div>{h.title}</div>
                    {h.detail && <div className="mt-0.5 text-xs text-muted-foreground">{h.detail}</div>}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
      <BriefList title="Next actions" items={brief.nextActions} />
    </div>
  );
}
