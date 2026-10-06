"use client";

import { AlertTriangle, Check, ChevronRight, Loader2, Lock, NotebookPen, RefreshCcw, Sparkles, Target } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, DueLabel, EmptyState, PersonName, PillarTag } from "@/components/common/bits";
import { PersonSelect, SimpleSelect } from "@/components/common/fields";
import { StatusPill } from "@/components/common/status";
import { useUI } from "@/components/shell/ui-context";
import type { MilestoneStatus } from "@/generated/prisma/enums";
import { dayKey, formatDateTime, formatTime, today as todayIn } from "@/lib/dates";
import { MEETING_TYPES, MILESTONE_STATUS, MILESTONE_TYPES, TASK_STATUS } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { fetchMilestoneDetail, updateMilestone } from "@/server/actions/goals";
import { addMeetingNotes, fetchMeetingDetail, fetchMeetingNotes, prepareMeeting, type MeetingDetail, type MeetingNotesSummary } from "@/server/actions/meetings";
import type { PrepBrief } from "@/server/brain/prep-brief";
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
  const [state, setState] = useState<{ id: string; data: MilestoneDetail | null } | null>(null);
  const [progress, setProgress] = useState(0);
  const m = state && state.id === milestoneId ? state.data : null;
  const load = useCallback(async (id: string) => {
    const d = await fetchMilestoneDetail(id);
    setState({ id, data: d });
    if (d) setProgress(d.progress);
  }, []);
  useEffect(() => {
    if (!milestoneId) return;
    let cancelled = false;
    fetchMilestoneDetail(milestoneId).then((d) => {
      if (cancelled) return;
      setState({ id: milestoneId, data: d });
      if (d) setProgress(d.progress);
    });
    return () => {
      cancelled = true;
    };
  }, [milestoneId]);

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
  const [state, setState] = useState<{ id: string; data: MeetingDetail | null } | null>(null);
  const [preparing, setPreparing] = useState(false);
  // The chosen tab belongs to one meeting; opening another meeting starts from its default.
  const [tabFor, setTabFor] = useState<{ id: string; tab: "brief" | "notes" } | null>(null);
  const m = state && state.id === meetingId ? state.data : null;
  const tab = tabFor && tabFor.id === meetingId ? tabFor.tab : null;

  const prepare = useCallback(async (id: string) => {
    setPreparing(true);
    const res = await prepareMeeting(id);
    setPreparing(false);
    if (res.ok) {
      setState((cur) => (cur?.data && cur.id === id ? { ...cur, data: { ...cur.data, prepBrief: res.data, briefHidden: false, preparedAt: new Date() } } : cur));
    } else toast.error(res.error);
  }, []);

  useEffect(() => {
    if (!meetingId) return;
    let cancelled = false;
    fetchMeetingDetail(meetingId).then((d) => {
      if (cancelled) return;
      setState({ id: meetingId, data: d });
      // Prepare Me on open for upcoming meetings without a brief (editors only).
      if (d && !d.prepBrief && !d.briefHidden && d.canEdit && new Date(d.endsAt) > new Date()) prepare(d.id);
    });
    return () => {
      cancelled = true;
    };
  }, [meetingId, prepare]);

  const setNotes = useCallback((id: string, notes: MeetingNotesSummary[]) => {
    setState((cur) => (cur?.data && cur.id === id ? { ...cur, data: { ...cur.data, notes } } : cur));
  }, []);

  const tz = lookups.timezone;
  const b = m?.prepBrief;
  const past = m ? new Date(m.endsAt) < new Date() : false;
  const activeTab = tab ?? (m && (past || m.notes.length > 0) && !b ? "notes" : "brief");

  return (
    <Sheet open={Boolean(meetingId)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[680px]">
        {!m ? (
          <SheetSkeleton />
        ) : (
          <>
            <SheetHeader className="gap-2 border-b border-border p-5 pr-12">
              <div className="flex items-center gap-2 text-xs text-brain">
                <Sparkles className="size-3.5" aria-hidden /> {past ? "Meeting" : "Prepare Me"}
                {past && <span className="rounded bg-muted px-1.5 py-px text-2xs font-medium text-ink-2">Past meeting</span>}
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
              <ul className="mt-1 flex flex-wrap gap-1.5" aria-label="Attendees">
                {m.attendees.map((a) => (
                  <li key={a.id}>
                    <Link href={a.isCeo ? "#" : `/resources/people/${a.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-border py-0.5 pr-2 pl-0.5 text-xs hover:bg-muted">
                      <Avatar name={a.name} ceo={a.isCeo} />
                      {a.isCeo ? "You" : a.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </SheetHeader>

            <Tabs value={activeTab} onValueChange={(v) => setTabFor({ id: m.id, tab: v as "brief" | "notes" })} className="gap-0">
              <div className="sticky top-0 z-10 border-b border-border bg-background/95 px-5 pt-2 backdrop-blur">
                <TabsList variant="line" className="h-9">
                  <TabsTrigger value="brief">Prepare Me</TabsTrigger>
                  <TabsTrigger value="notes">
                    Meeting notes
                    {m.notes.length > 0 && <span className="rounded bg-muted px-1 text-2xs text-muted-foreground tabular">{m.notes.length}</span>}
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="brief" className="space-y-5 p-5">
                <div className="flex flex-wrap items-center gap-2">
                  {m.canEdit && (
                    <Button size="sm" variant="outline" onClick={() => prepare(m.id)} disabled={preparing}>
                      {preparing ? <Loader2 className="animate-spin" /> : <RefreshCcw />} {b ? "Regenerate" : "Prepare brief"}
                    </Button>
                  )}
                  {b && (
                    <span className="text-2xs text-muted-foreground">
                      {b.engine === "claude" ? "Written by Chief of Staff (Claude)" : "Assembled by CytoHub Brain rules"} · {formatDateTime(new Date(b.generatedAt), tz)}
                    </span>
                  )}
                </div>
                {m.briefHidden && !b && (
                  <p className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 p-3 text-xs text-ink-2">
                    <Lock className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden />
                    A brief prepared from sources above your access level exists for this meeting. {m.canEdit ? "Prepare one at your access level — it won’t replace theirs." : ""}
                  </p>
                )}
                {!b ? (
                  preparing ? (
                    <div className="space-y-3" aria-busy>
                      <p className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="size-3.5 animate-spin" /> Gathering context, emails, commitments and history from CytoHub Brain…
                      </p>
                      <Skeleton className="h-16 w-full" />
                      <Skeleton className="h-28 w-full" />
                    </div>
                  ) : (
                    !m.briefHidden && <EmptyState compact title="No brief yet" description="Prepare a brief to see context, participants, commitments, talking points and risks." />
                  )
                ) : (
                  <PrepBriefView brief={b} />
                )}
              </TabsContent>

              <TabsContent value="notes" className="space-y-5 p-5">
                <MeetingNotesPanel meetingId={m.id} notes={m.notes} canEdit={m.canEdit} past={past} onNotes={(n) => setNotes(m.id, n)} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Prepare Me brief ────────────────────────────────────────────────────────

function BriefSection({ title, count, defaultOpen = true, children }: { title: string; count?: number; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <section>
        <CollapsibleTrigger className="group flex w-full items-center gap-1.5 rounded text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <ChevronRight className={cn("size-3.5 text-ink-3 transition-transform", open && "rotate-90")} aria-hidden />
          <h3 className="eyebrow">{title}</h3>
          {count !== undefined && <span className="rounded bg-muted px-1 text-2xs text-muted-foreground tabular">{count}</span>}
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">{children}</CollapsibleContent>
      </section>
    </Collapsible>
  );
}

function Bullets({ items, ordered }: { items: string[]; ordered?: boolean }) {
  const List = ordered ? "ol" : "ul";
  return (
    <List className={ordered ? "list-decimal space-y-1.5 pl-5 text-[13px]" : "space-y-1.5 text-[13px]"}>
      {items.map((t, i) => (
        <li key={i} className={ordered ? "pl-1" : "flex gap-2"}>
          {!ordered && <span className="mt-2 size-1 shrink-0 rounded-full bg-ink-3" aria-hidden />}
          <span>{t}</span>
        </li>
      ))}
    </List>
  );
}

function LinkRow({ href, title, detail, meta, className }: { href?: string; title: string; detail?: string; meta?: React.ReactNode; className?: string }) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-foreground">{title}</span>
        {detail && <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{detail}</span>}
      </span>
      {meta}
    </>
  );
  return (
    <li>
      {href ? (
        <Link href={href} className={cn("flex items-start gap-3 px-3 py-2 hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none", className)}>
          {body}
        </Link>
      ) : (
        <div className={cn("flex items-start gap-3 px-3 py-2", className)}>{body}</div>
      )}
    </li>
  );
}

const Box = ({ children }: { children: React.ReactNode }) => <ul className="divide-y divide-hairline rounded-lg border border-border">{children}</ul>;

const HISTORY_LABEL: Record<string, string> = { meeting: "Meeting", thread: "Email", decision: "Decision", commitment: "Commitment", note: "Notes", signal: "Signal" };
const COMMITMENT_STATE: Record<string, { label: string; tone: "serious" | "info" | "done" }> = {
  overdue: { label: "Overdue", tone: "serious" },
  open: { label: "Open", tone: "info" },
  fulfilled: { label: "Fulfilled", tone: "done" },
};

export function PrepBriefView({ brief }: { brief: PrepBrief }) {
  const rich = (brief.version ?? 1) >= 2;
  const objective = brief.objective ?? brief.objectives[0];
  const si = brief.strategicImportance;
  const owed = brief.commitments.filter((c) => c.direction === "OUTBOUND");
  const owing = brief.commitments.filter((c) => c.direction !== "OUTBOUND");
  return (
    <div className="space-y-6">
      <section className="space-y-2 rounded-lg border border-brain/20 bg-brain-soft/60 p-3.5" aria-label="Meeting objective">
        {objective && (
          <p className="text-[13px]">
            <span className="font-medium text-brain">Objective: </span>
            {objective}
          </p>
        )}
        {brief.context && <p className="text-[13px] leading-relaxed text-ink-2">{brief.context}</p>}
        {brief.desiredOutcome && (
          <p className="text-[13px]">
            <span className="font-medium">Desired outcome: </span>
            {brief.desiredOutcome}
          </p>
        )}
      </section>

      {si && (si.goal || si.deal || si.whyNow.length > 0) && (
        <BriefSection title="Strategic importance">
          <div className="space-y-2 text-[13px]">
            {si.goal && (
              <Link href={si.goal.href} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 hover:bg-muted/60">
                <Target className="size-3.5 shrink-0 text-ink-3" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{si.goal.title}</span>
                {si.pillar && <span className="hidden text-2xs text-muted-foreground sm:inline">{si.pillar}</span>}
                <span className="text-xs font-medium tabular">{si.goal.progress}%</span>
              </Link>
            )}
            {si.deal && <p className="text-xs text-ink-2">Deal: {si.deal}</p>}
            {si.whyNow.length > 0 && <Bullets items={si.whyNow} />}
          </div>
        </BriefSection>
      )}

      {brief.talkingPoints.length > 0 && (
        <BriefSection title="Talking points" count={brief.talkingPoints.length}>
          <Bullets items={brief.talkingPoints} ordered />
        </BriefSection>
      )}
      {brief.questions.length > 0 && (
        <BriefSection title="Questions to ask" count={brief.questions.length}>
          <Bullets items={brief.questions} />
        </BriefSection>
      )}
      {brief.openQuestions.length > 0 && (
        <BriefSection title="Open questions" count={brief.openQuestions.length}>
          <Box>
            {brief.openQuestions.map((q, i) => (
              <LinkRow key={i} href={q.href} title={q.question} detail={q.source} />
            ))}
          </Box>
        </BriefSection>
      )}

      {rich && brief.participantContext.length > 0 ? (
        <BriefSection title="Participants" count={brief.participantContext.length}>
          <ul className="space-y-3 text-[13px]">
            {brief.participantContext.map((p) => (
              <li key={p.personId ?? p.name} className="flex gap-3">
                <Avatar name={p.name} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    {p.href ? (
                      <Link href={p.href} className="font-medium hover:underline">
                        {p.name}
                      </Link>
                    ) : (
                      <span className="font-medium">{p.name}</span>
                    )}
                    <span className="text-xs text-muted-foreground">{[p.title, p.company].filter(Boolean).join(" · ")}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-2xs text-muted-foreground">
                    <span>Last contact {p.lastContact ?? "unknown"}</span>
                    <span className="tabular">
                      {p.recentThreads} recent thread{p.recentThreads === 1 ? "" : "s"}
                    </span>
                    {p.owedByUs > 0 && <span className="font-medium text-serious-ink">You owe {p.owedByUs}</span>}
                    {p.owedToUs > 0 && <span className="font-medium text-ink-2">They owe {p.owedToUs}</span>}
                  </div>
                  {p.notes && <p className="mt-1 text-xs text-ink-2">{p.notes}</p>}
                </div>
              </li>
            ))}
          </ul>
        </BriefSection>
      ) : (
        brief.participants.length > 0 && (
          <BriefSection title="Participants" count={brief.participants.length}>
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
          </BriefSection>
        )
      )}

      {brief.companyContext && (
        <BriefSection title="Company context">
          <div className="space-y-2 rounded-lg border border-border p-3 text-[13px]">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/resources/companies/${brief.companyContext.id}`} className="font-medium hover:underline">
                {brief.companyContext.name}
              </Link>
              <span className="text-xs text-muted-foreground">
                {[brief.companyContext.type, brief.companyContext.parent ? `part of ${brief.companyContext.parent}` : null, `relationship ${brief.companyContext.relationship}/5`].filter(Boolean).join(" · ")}
              </span>
            </div>
            {brief.companyContext.description && <p className="text-xs text-ink-2">{brief.companyContext.description}</p>}
            {brief.companyContext.deal && (
              <p className="text-xs">
                <span className="font-medium">{brief.companyContext.deal.name}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {[brief.companyContext.deal.stage, brief.companyContext.deal.value, `${brief.companyContext.deal.probability}%`, brief.companyContext.deal.expectedClose ? `close ${brief.companyContext.deal.expectedClose}` : null].filter(Boolean).join(" · ")}
                </span>
                {brief.companyContext.deal.nextStep && <span className="block text-ink-2">Next: {brief.companyContext.deal.nextStep}</span>}
              </p>
            )}
            {brief.companyContext.recentInsights.length > 0 && (
              <ul className="space-y-1 border-t border-hairline pt-2 text-xs">
                {brief.companyContext.recentInsights.map((i) => (
                  <li key={i.title} className="flex gap-2">
                    <span className="w-12 shrink-0 text-2xs text-muted-foreground tabular">{i.date}</span>
                    {i.href ? (
                      <Link href={i.href} className="min-w-0 flex-1 truncate hover:underline">
                        {i.title}
                      </Link>
                    ) : (
                      <span className="min-w-0 flex-1 truncate">{i.title}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </BriefSection>
      )}

      {rich && brief.recentEmails.length > 0 && (
        <BriefSection title="Recent emails" count={brief.recentEmails.length}>
          <Box>
            {brief.recentEmails.map((e) => (
              <LinkRow
                key={e.id}
                href={e.href}
                title={e.subject}
                detail={e.summary}
                meta={<StatusPill tone={e.status === "AWAITING_CEO" ? "serious" : e.status === "AWAITING_THEM" ? "warning" : "neutral"} label={e.statusLabel} className="shrink-0" />}
              />
            ))}
          </Box>
        </BriefSection>
      )}

      {rich && brief.commitments.length > 0 && (
        <BriefSection title="Commitments" count={brief.commitments.length}>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { label: "You owe", items: owed },
              { label: "Owed to you", items: owing },
            ].map((col) => (
              <div key={col.label}>
                <div className="mb-1 text-2xs font-medium text-muted-foreground">
                  {col.label} · {col.items.length}
                </div>
                {col.items.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">Nothing</p>
                ) : (
                  <Box>
                    {col.items.map((c) => (
                      <LinkRow
                        key={c.id}
                        href={c.href}
                        title={c.title}
                        detail={[c.party, c.due].filter(Boolean).join(" · ")}
                        meta={<StatusPill tone={COMMITMENT_STATE[c.state].tone} label={COMMITMENT_STATE[c.state].label} className="shrink-0" />}
                      />
                    ))}
                  </Box>
                )}
              </div>
            ))}
          </div>
        </BriefSection>
      )}

      {rich && brief.openTasks.length > 0 ? (
        <BriefSection title="Open tasks" count={brief.openTasks.length}>
          <Box>
            {brief.openTasks.map((t) => (
              <LinkRow key={t.id} href={t.href} title={t.title} detail={t.detail} />
            ))}
          </Box>
        </BriefSection>
      ) : (
        brief.openIssues.length > 0 && (
          <BriefSection title="Open issues" count={brief.openIssues.length}>
            <Box>
              {brief.openIssues.map((o, i) => (
                <LinkRow key={i} href={o.href} title={o.title} detail={o.kind} />
              ))}
            </Box>
          </BriefSection>
        )
      )}

      {rich && brief.documents.length > 0 && (
        <BriefSection title="Relevant documents" count={brief.documents.length}>
          <Box>
            {brief.documents.map((d) => (
              <LinkRow
                key={d.id}
                href={d.href}
                title={d.title}
                detail={[[d.docType, `v${d.version}`, d.modifiedAt].filter(Boolean).join(" · "), d.changeSummary, ...d.changes].filter(Boolean).join(" — ")}
                meta={d.changeSummary ? <span className="shrink-0 rounded bg-warning-soft px-1.5 py-px text-2xs font-medium text-warning-ink">Changed</span> : undefined}
              />
            ))}
          </Box>
        </BriefSection>
      )}

      {rich && brief.relationshipHistory.length > 0 ? (
        <BriefSection title="Relationship history" count={brief.relationshipHistory.length} defaultOpen={false}>
          <ol className="relative space-y-2.5 border-l border-border pl-4">
            {brief.relationshipHistory.map((h, i) => (
              <li key={i} className="text-[13px]">
                <span className="absolute -left-[3px] mt-1.5 size-1.5 rounded-full bg-ink-3" aria-hidden />
                <div className="flex gap-2">
                  <span className="w-24 shrink-0 text-2xs text-muted-foreground tabular">{h.date}</span>
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xs text-muted-foreground">{HISTORY_LABEL[h.kind]}</span>
                      {h.href ? (
                        <Link href={h.href} className="min-w-0 hover:underline">
                          {h.title}
                        </Link>
                      ) : (
                        <span>{h.title}</span>
                      )}
                    </div>
                    {h.detail && <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{h.detail}</div>}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </BriefSection>
      ) : (
        brief.history.length > 0 && (
          <BriefSection title="History" count={brief.history.length} defaultOpen={false}>
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
          </BriefSection>
        )
      )}

      {rich && brief.potentialRisks.length > 0 ? (
        <BriefSection title="Potential risks" count={brief.potentialRisks.length}>
          <Box>
            {brief.potentialRisks.map((r, i) => (
              <LinkRow key={i} href={r.href} title={r.title} detail={r.detail} meta={<span className="shrink-0 text-2xs text-muted-foreground capitalize">{r.source}</span>} />
            ))}
          </Box>
        </BriefSection>
      ) : (
        brief.risks.length > 0 && (
          <BriefSection title="Risks" count={brief.risks.length}>
            <Bullets items={brief.risks} />
          </BriefSection>
        )
      )}

      {brief.nextActions.length > 0 && (
        <BriefSection title="Recommended next steps" count={brief.nextActions.length}>
          <Bullets items={brief.nextActions} />
        </BriefSection>
      )}
    </div>
  );
}

// ─── Post-meeting notes ──────────────────────────────────────────────────────

const NOTES_MAX = 100_000;
const NOTE_STATUS: Record<MeetingNotesSummary["status"], { label: string; tone: "good" | "info" | "critical" | "neutral" }> = {
  processed: { label: "Processed", tone: "good" },
  processing: { label: "Processing", tone: "info" },
  failed: { label: "Processing failed", tone: "critical" },
  skipped: { label: "Not actionable", tone: "neutral" },
};

function MeetingNotesPanel({ meetingId, notes, canEdit, past, onNotes }: { meetingId: string; notes: MeetingNotesSummary[]; canEdit: boolean; past: boolean; onNotes: (n: MeetingNotesSummary[]) => void }) {
  const { lookups } = useUI();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [polls, setPolls] = useState(0);
  const processing = notes.some((n) => n.status === "processing");

  // While notes are still in the pipeline, poll for a minute so results appear without a reload.
  useEffect(() => {
    if (!processing || polls >= 12) return;
    const t = setTimeout(async () => {
      try {
        onNotes(await fetchMeetingNotes(meetingId));
      } finally {
        setPolls((p) => p + 1);
      }
    }, 5_000);
    return () => clearTimeout(t);
  }, [processing, polls, meetingId, onNotes]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || text.trim().length < 10) return;
    setBusy(true);
    const res = await addMeetingNotes(meetingId, text);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(res.message ?? "Notes processed");
    setText("");
    setPolls(0);
    onNotes([res.data, ...notes.filter((n) => n.sourceItemId !== res.data.sourceItemId)]);
  }

  return (
    <div className="space-y-5">
      {canEdit && (
        <form onSubmit={submit} className="space-y-2" aria-busy={busy}>
          <Label htmlFor={`notes-${meetingId}`} className="text-[13px] font-medium">
            Add meeting notes
          </Label>
          <p className="text-xs text-muted-foreground">
            Paste your notes or a transcript{past ? "" : " (you can also add them after the meeting)"}. CytoHub Brain extracts decisions, action items with owners and deadlines, commitments, questions, risks, opportunities and
            follow-ups — uncertain items go to the Review Queue.
          </p>
          <Textarea
            id={`notes-${meetingId}`}
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, NOTES_MAX))}
            placeholder={"e.g.\nDecided to go with the limited release.\nMaya to send the validation report by Friday.\nWe promised Sarah the retention cohort by next week."}
            className="max-h-80 min-h-32"
            maxLength={NOTES_MAX}
            disabled={busy}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-2xs text-muted-foreground tabular">
              {text.length.toLocaleString("en-US")} / {NOTES_MAX.toLocaleString("en-US")}
            </span>
            <Button type="submit" size="sm" disabled={busy || text.trim().length < 10}>
              {busy ? <Loader2 className="animate-spin" /> : <NotebookPen />} {busy ? "Processing notes…" : "Add & process notes"}
            </Button>
          </div>
          {busy && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
              <Loader2 className="size-3.5 animate-spin" aria-hidden /> Extracting decisions, action items and commitments — this can take up to 20 seconds.
            </p>
          )}
        </form>
      )}

      {notes.length === 0 ? (
        <EmptyState compact icon={NotebookPen} title="No notes yet" description={canEdit ? "Notes you add are processed into tasks, commitments and decisions, with a link back to the notes." : "No notes have been added to this meeting."} />
      ) : (
        <ul className="space-y-4" aria-label="Processed notes">
          {notes.map((n) => (
            <li key={n.sourceItemId} className="rounded-lg border border-border">
              <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-3.5 py-2">
                <NotebookPen className="size-3.5 text-ink-3" aria-hidden />
                <span className="text-[13px] font-medium">Notes added {formatDateTime(new Date(n.addedAt), lookups.timezone)}</span>
                <StatusPill tone={NOTE_STATUS[n.status].tone} label={n.retrying ? "Retrying" : NOTE_STATUS[n.status].label} className="ml-auto" />
              </div>
              <div className="space-y-3 p-3.5">
                {n.status === "processing" && (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden /> Still processing in the background — results appear here as stages finish.
                  </p>
                )}
                {n.error && (n.status === "failed" || n.retrying) && (
                  <p className="flex items-start gap-2 rounded-md bg-critical-soft px-2.5 py-2 text-xs text-critical-ink">
                    <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
                    <span>
                      {n.error}
                      {n.retrying ? " — retrying automatically." : " — the notes are saved; processing can be retried from Ingestion Health."}
                    </span>
                  </p>
                )}
                {n.status === "skipped" && <p className="text-xs text-muted-foreground">CytoHub Brain found nothing actionable in these notes.</p>}
                {n.summary && <p className="text-[13px] leading-relaxed">{n.summary}</p>}
                <NotesGroup title="Decisions" items={n.decisions} />
                <NotesGroup title="Action items" items={n.actionItems} />
                <NotesGroup title="Commitments" items={n.commitments} />
                <NotesGroup title="Questions" items={n.questions} />
                <NotesGroup title="Risks" items={n.risks} />
                <NotesGroup title="Opportunities" items={n.opportunities} />
                <NotesGroup title="Follow-ups" items={n.followUps} />
                {n.reviewCount > 0 && (
                  <Link href="/brain/review" className="inline-flex items-center gap-1 text-xs font-medium text-brain hover:underline">
                    {n.reviewCount} item{n.reviewCount === 1 ? "" : "s"} waiting in the Review Queue
                  </Link>
                )}
                {n.status === "processed" &&
                  !n.summary &&
                  [n.decisions, n.actionItems, n.commitments, n.questions, n.risks, n.opportunities, n.followUps].every((g) => g.length === 0) && <p className="text-xs text-muted-foreground">Processed — nothing was extracted.</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NotesGroup({ title, items }: { title: string; items: { title: string; detail?: string; href?: string; pending?: boolean }[] }) {
  if (!items.length) return null;
  return (
    <section>
      <h4 className="mb-1 text-2xs font-medium text-muted-foreground">
        {title} · {items.length}
      </h4>
      <ul className="divide-y divide-hairline rounded-md border border-border">
        {items.map((it, i) => (
          <LinkRow key={i} href={it.href} title={it.title} detail={it.detail} meta={it.pending ? <span className="shrink-0 rounded bg-muted px-1.5 py-px text-2xs text-ink-2">Proposed</span> : undefined} />
        ))}
      </ul>
    </section>
  );
}
