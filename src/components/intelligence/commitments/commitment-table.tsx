"use client";

import { Ban, CalendarClock, Check, ChevronRight, Handshake, ListPlus, Mail, MoreHorizontal, RotateCcw, SquareArrowOutUpRight } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, EmptyState } from "@/components/common/bits";
import { Field } from "@/components/common/fields";
import { StatusPill, TONE_SOFT, TONE_TEXT } from "@/components/common/status";
import { useAction } from "@/components/common/use-action";
import { useCan, useUI } from "@/components/shell/ui-context";
import { dayKey, formatDay, formatDateTime, toDay } from "@/lib/dates";
import { COMMITMENT_DIRECTION, COMMITMENT_STATUS } from "@/lib/intelligence";
import { cn } from "@/lib/utils";
import { cancelCommitment, createFollowUpTask, fulfillCommitment, reopenCommitment, setCommitmentDue } from "@/server/actions/commitments";
import type { CommitmentRow } from "@/server/queries/commitments";
import { ConfidenceBadge } from "../badges";
import { commitmentDue } from "../model";
import { ViewSourceButton } from "../view-source";

type DialogState = { kind: "fulfill" | "cancel" | "due"; row: CommitmentRow } | null;

export function CommitmentTable({ items, today, timezone, tab, filtered }: { items: CommitmentRow[]; today: Date; timezone: string; tab: string; filtered: boolean }) {
  const params = useSearchParams();
  const highlight = params.get("highlight");
  const [dialog, setDialog] = useState<DialogState>(null);

  useEffect(() => {
    if (highlight) document.getElementById(`commitment-${highlight}`)?.scrollIntoView({ block: "center" });
  }, [highlight]);

  if (items.length === 0) {
    return (
      <div className="panel">
        <EmptyState
          icon={Handshake}
          title={filtered ? "No commitments match" : EMPTY[tab]?.title ?? "No commitments"}
          description={filtered ? "Try clearing the company filter or search." : EMPTY[tab]?.description}
        />
      </div>
    );
  }

  return (
    <div className="panel overflow-hidden">
      <div className="hidden grid-cols-[minmax(0,1fr)_190px_110px_84px_150px_96px] gap-3 border-b border-hairline px-4 py-2 text-2xs font-medium text-muted-foreground lg:grid" aria-hidden>
        <span>Commitment</span>
        <span>{tab === "owed" ? "Owed by" : tab === "owe" ? "Owed to" : "With"}</span>
        <span>Due</span>
        <span>Committed</span>
        <span>Status</span>
        <span className="text-right">Actions</span>
      </div>
      <ul className="divide-y divide-hairline" aria-label="Commitments">
        {items.map((c) => (
          <CommitmentRowView key={c.id} c={c} today={today} timezone={timezone} highlighted={c.id === highlight} onDialog={setDialog} />
        ))}
      </ul>
      <CommitmentDialog key={dialog ? `${dialog.kind}-${dialog.row.id}` : "closed"} state={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}

const EMPTY: Record<string, { title: string; description: string }> = {
  owe: { title: "You don’t owe anyone anything", description: "When you promise something in an email or meeting, CytoHub Brain records it here with the source." },
  owed: { title: "Nothing owed to you", description: "Promises others make to CytoHub — term sheets, data, contracts — appear here so nothing slips." },
  internal: { title: "No internal commitments", description: "Commitments between team members show up here." },
  overdue: { title: "Nothing overdue", description: "Every open commitment is on time." },
  fulfilled: { title: "No fulfilled commitments yet", description: "Fulfilled and cancelled commitments are kept here as history." },
};

function PartyCell({ c }: { c: CommitmentRow }) {
  const p = c.other;
  const company = c.company?.name;
  if (!p && !company) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {p && <Avatar name={p.name} ceo={p.isCeo} />}
      <span className="min-w-0 truncate">
        {p ? (p.isCeo ? "You" : p.name) : null}
        {p && company && <span className="text-muted-foreground"> · </span>}
        {company && <span className={cn(p && "text-muted-foreground")}>{company}</span>}
      </span>
    </span>
  );
}

function CommitmentRowView({ c, today, timezone, highlighted, onDialog }: { c: CommitmentRow; today: Date; timezone: string; highlighted: boolean; onDialog: (d: DialogState) => void }) {
  const [open, setOpen] = useState(highlighted);
  const { openEntity } = useUI();
  const canEdit = useCan("workspace.edit");
  const { pending, run } = useAction();
  const isOpen = c.status === "OPEN";
  const due = commitmentDue(c.dueDate, today, isOpen);
  const st = COMMITMENT_STATUS[c.status];
  const detailsId = `commitment-${c.id}-details`;

  return (
    <li id={`commitment-${c.id}`} className={cn("scroll-mt-24 transition-colors", highlighted && "bg-brand-soft/40")}>
      <div className="grid gap-x-3 gap-y-2 px-4 py-2.5 lg:grid-cols-[minmax(0,1fr)_190px_110px_84px_150px_96px] lg:items-center">
        <div className="flex min-w-0 items-start gap-1.5">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls={detailsId}
            aria-label={open ? "Hide details" : "Show the commitment as written"}
            className="-ml-1 mt-px flex size-5 shrink-0 items-center justify-center rounded text-ink-3 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} aria-hidden />
          </button>
          <div className="min-w-0">
            <div className="text-[14px] leading-snug font-medium text-foreground" title={c.text ? `“${c.text}”` : undefined}>
              {c.title}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-2xs text-muted-foreground">
              <span>{COMMITMENT_DIRECTION[c.direction].label}</span>
              {c.dueText && <span>· “{c.dueText}”</span>}
              {c.task && <span>· tracked as a task</span>}
            </div>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-2 pl-5 text-xs lg:pl-0">
          <span className="text-2xs text-muted-foreground lg:hidden">{c.direction === "INBOUND" ? "Owed by" : "Owed to"}</span>
          <PartyCell c={c} />
        </div>
        <div className="flex items-center gap-2 pl-5 text-xs lg:pl-0">
          <span className="text-2xs text-muted-foreground lg:hidden">Due</span>
          {due.overdue ? (
            <span className={cn("rounded px-1.5 py-0.5 text-2xs font-medium tabular", TONE_SOFT.critical, TONE_TEXT.critical)} title={c.dueDate ? formatDay(c.dueDate, true) : undefined}>
              {due.label}
            </span>
          ) : (
            <span className={cn("tabular", isOpen ? TONE_TEXT[due.tone] : "text-muted-foreground", isOpen && due.tone !== "neutral" && "font-medium")} title={c.dueDate ? formatDay(c.dueDate, true) : undefined}>
              {due.label}
            </span>
          )}
        </div>
        <div className="hidden text-xs text-muted-foreground tabular lg:block" title={formatDateTime(c.committedAt, timezone)}>
          {formatDay(toDay(c.committedAt, timezone))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 pl-5 lg:pl-0">
          <StatusPill tone={st.tone} label={st.label} />
          <ConfidenceBadge level={c.confidence} score={c.confidenceScore} compact />
        </div>
        <div className="flex items-center justify-start gap-0.5 pl-4 lg:justify-end lg:pl-0">
          {(c.sources.count > 0 || c.sources.hidden > 0) && <ViewSourceButton targetType="COMMITMENT" targetId={c.id} count={c.sources.count} hidden={c.sources.hidden} />}
          {canEdit && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" aria-label={`Actions for “${c.title}”`} disabled={pending}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {isOpen ? (
                  <>
                    <DropdownMenuItem onSelect={() => onDialog({ kind: "fulfill", row: c })}>
                      <Check /> Mark fulfilled…
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onDialog({ kind: "due", row: c })}>
                      <CalendarClock /> Change due date…
                    </DropdownMenuItem>
                    {c.task && (
                      <DropdownMenuItem onSelect={() => openEntity("task", c.task!.id)}>
                        <SquareArrowOutUpRight /> Open task
                      </DropdownMenuItem>
                    )}
                    {c.direction !== "OUTBOUND" && (
                      <DropdownMenuItem onSelect={() => run(() => createFollowUpTask(c.id), { onSuccess: (d) => openEntity("task", d.taskId) })}>
                        <ListPlus /> Create follow-up task
                      </DropdownMenuItem>
                    )}
                    {c.thread && (
                      <DropdownMenuItem asChild>
                        <Link href={`/brain/threads/${c.thread.id}`}>
                          <Mail /> Open thread
                        </Link>
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => onDialog({ kind: "cancel", row: c })}>
                      <Ban /> Cancel commitment…
                    </DropdownMenuItem>
                  </>
                ) : (
                  <>
                    {c.task && (
                      <DropdownMenuItem onSelect={() => openEntity("task", c.task!.id)}>
                        <SquareArrowOutUpRight /> Open task
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onSelect={() => run(() => reopenCommitment(c.id))}>
                      <RotateCcw /> Reopen
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      {open && (
        <div id={detailsId} className="space-y-2 border-t border-hairline bg-surface-2/40 py-3 pr-4 pl-10 text-xs">
          {c.text ? (
            <p className="max-w-3xl text-[14px] leading-relaxed text-ink-2 italic">“{c.text}”</p>
          ) : (
            <p className="text-muted-foreground">The original wording is hidden by your access level.</p>
          )}
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-2xs text-muted-foreground">
            <div>
              <dt className="inline">Committed </dt>
              <dd className="inline text-ink-2">{formatDateTime(c.committedAt, timezone)}</dd>
            </div>
            {c.followUpDate && isOpen && (
              <div>
                <dt className="inline">Follow up </dt>
                <dd className="inline text-ink-2">{formatDay(c.followUpDate)}</dd>
              </div>
            )}
            {c.fulfilledAt && (
              <div>
                <dt className="inline">Fulfilled </dt>
                <dd className="inline text-ink-2">{formatDateTime(c.fulfilledAt, timezone)}</dd>
              </div>
            )}
            {c.resolutionNote && (
              <div>
                <dt className="inline">Note </dt>
                <dd className="inline text-ink-2">{c.resolutionNote}</dd>
              </div>
            )}
          </dl>
          <div className="flex flex-wrap gap-1.5">
            {c.thread && (
              <Link href={`/brain/threads/${c.thread.id}`} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 hover:bg-muted">
                <Mail className="size-3 text-ink-3" aria-hidden /> {c.thread.subject}
              </Link>
            )}
            {c.task && (
              <button type="button" onClick={() => openEntity("task", c.task!.id)} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 hover:bg-muted">
                Task · {c.task.title}
              </button>
            )}
            {c.goal && (
              <Link href={`/goals/${c.goal.id}`} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 hover:bg-muted">
                Goal · {c.goal.title}
              </Link>
            )}
            {c.meeting && (
              <button type="button" onClick={() => openEntity("meeting", c.meeting!.id)} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 hover:bg-muted">
                Meeting · {c.meeting.title}
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function CommitmentDialog({ state, onClose }: { state: DialogState; onClose: () => void }) {
  const { pending, run } = useAction();
  const row = state?.row;
  // Keyed by kind + row, so initial values reset per dialog.
  const [note, setNote] = useState("");
  const [due, setDue] = useState(row?.dueDate ? dayKey(row.dueDate) : "");

  const title = state?.kind === "fulfill" ? "Mark fulfilled" : state?.kind === "cancel" ? "Cancel commitment" : "Change due date";
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!state || !row) return;
    const res = await run(
      () => (state.kind === "fulfill" ? fulfillCommitment(row.id, note) : state.kind === "cancel" ? cancelCommitment(row.id, note) : setCommitmentDue(row.id, due || null)),
      state.kind === "fulfill" ? { success: false } : {},
    );
    if (res.ok) {
      if (state.kind === "fulfill") toast.success("Marked fulfilled", { action: { label: "Undo", onClick: () => void reopenCommitment(row.id).then((r) => (r.ok ? toast.success("Reopened") : toast.error(r.error))) } });
      onClose();
    }
  }

  return (
    <Dialog open={Boolean(state)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="line-clamp-2">{row?.title}</DialogDescription>
          </DialogHeader>
          {state?.kind === "due" ? (
            <Field label="Due date" htmlFor="commitment-due" hint={row?.task ? "The mirrored task moves too." : undefined}>
              <Input id="commitment-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} className="w-[200px]" autoFocus />
            </Field>
          ) : (
            <Field label="Note (optional)" htmlFor="commitment-note" hint={state?.kind === "fulfill" && row?.task ? "Its mirrored task will be completed." : state?.kind === "cancel" && row?.task ? "Its mirrored task will be cancelled." : undefined}>
              <Textarea id="commitment-note" rows={3} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder={state?.kind === "fulfill" ? "e.g. Sent with the follow-up email" : "Why it’s no longer owed"} autoFocus />
            </Field>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button type="submit" disabled={pending} variant={state?.kind === "cancel" ? "destructive" : "default"}>
              {state?.kind === "fulfill" ? (
                <>
                  <Check /> Mark fulfilled
                </>
              ) : state?.kind === "cancel" ? (
                <>
                  <Ban /> Cancel commitment
                </>
              ) : (
                "Save date"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
