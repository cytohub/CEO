"use client";

import { BellRing, Check, CornerDownLeft, Loader2, MessageSquareText, MoreHorizontal, Sparkles, UserCheck, UserPlus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, DueLabel, EmptyState } from "@/components/common/bits";
import { Field } from "@/components/common/fields";
import { StatusPill } from "@/components/common/status";
import { useAction } from "@/components/common/use-action";
import { useUI } from "@/components/shell/ui-context";
import { dayKey, daysBetween } from "@/lib/dates";
import { DELEGATION_STATUS, FOCUS_AREAS } from "@/lib/domain";
import { formatMinutes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { followUpDelegation, keepWithCeo, logDelegationUpdate, recallDelegation } from "@/server/actions/delegation";
import { completeTask, delegateTask } from "@/server/actions/tasks";
import type { DelegationCenter } from "@/server/queries/delegation";

export function Recommendations({ items, today }: { items: DelegationCenter["recommendations"]; today: Date }) {
  const { openDelegate, openEntity } = useUI();
  const { pending, run } = useAction();
  if (items.length === 0) return <EmptyState compact icon={UserCheck} title="Nothing to hand off" description="Everything on your plate genuinely needs you." />;
  return (
    <ul className="divide-y divide-hairline">
      {items.map((t) => (
        <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <div className="min-w-[240px] flex-1">
            <button type="button" onClick={() => openEntity("task", t.id)} className="text-left text-[13px] font-medium hover:underline">
              {t.title}
            </button>
            <div className="mt-0.5 flex flex-wrap gap-x-3 text-2xs text-muted-foreground">
              <span>{FOCUS_AREAS[t.focusArea].label}</span>
              <span>CEO uniqueness {t.ceoUniqueness}/5</span>
              {t.estimatedMinutes && <span>frees {formatMinutes(t.estimatedMinutes)}</span>}
              {t.dueDate && (
                <span>
                  due <DueLabel date={t.dueDate} today={today} />
                </span>
              )}
            </div>
          </div>
          {t.suggestedDelegate ? (
            <div className="flex items-center gap-2 text-xs">
              <Sparkles className="size-3.5 text-brain" aria-hidden />
              <span className="text-muted-foreground">Suggested:</span>
              <Avatar name={t.suggestedDelegate.name} />
              <span className="font-medium">{t.suggestedDelegate.name}</span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">No obvious owner</span>
          )}
          <div className="flex items-center gap-1.5">
            {t.suggestedDelegate && (
              <Button size="sm" disabled={pending} onClick={() => run(() => delegateTask(t.id, { delegateId: t.suggestedDelegate!.id, dueDate: t.dueDate ? dayKey(t.dueDate) : null, expectations: t.description }))}>
                <UserPlus /> Delegate
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => openDelegate(t.id)}>
              Choose…
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => keepWithCeo(t.id))}>
              Keep
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function DelegatedTable({ items, today, now }: { items: DelegationCenter["delegations"]; today: Date; now: Date }) {
  if (items.length === 0) return <EmptyState compact title="Nothing delegated right now" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-[13px]">
        <thead>
          <tr className="border-b border-hairline text-left text-2xs text-muted-foreground">
            <th className="py-2 pr-3 pl-4 font-medium">Task</th>
            <th className="w-40 py-2 pr-3 font-medium">Owner</th>
            <th className="w-24 py-2 pr-3 font-medium">Deadline</th>
            <th className="w-36 py-2 pr-3 font-medium">Status</th>
            <th className="py-2 pr-3 font-medium">Last update</th>
            <th className="w-36 py-2 pr-4" />
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {items.map((d) => (
            <DelegationRow key={d.id} d={d} today={today} now={now} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DelegationRow({ d, today, now }: { d: DelegationCenter["delegations"][number]; today: Date; now: Date }) {
  const { openEntity } = useUI();
  const { pending, run } = useAction();
  const [updateOpen, setUpdateOpen] = useState(false);
  const last = d.lastUpdateAt ?? d.delegatedAt;
  const silent = daysBetween(last, now);
  const overdue = d.dueDate ? daysBetween(today, d.dueDate) < 0 : false;
  const followUp = d.status === "NEEDS_FOLLOW_UP" || overdue;
  return (
    <tr className={cn("align-top hover:bg-muted/40", followUp && "bg-warning-soft/40")}>
      <td className="py-2.5 pr-3 pl-4">
        <button type="button" onClick={() => openEntity("task", d.task.id)} className="text-left font-medium hover:underline">
          {d.task.title}
        </button>
        {d.expectations && <p className="mt-0.5 line-clamp-1 text-2xs text-muted-foreground">Expectation: {d.expectations}</p>}
      </td>
      <td className="py-2.5 pr-3 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <Avatar name={d.delegate.name} /> {d.delegate.name}
        </span>
      </td>
      <td className="py-2.5 pr-3 text-xs">
        <DueLabel date={d.dueDate} today={today} />
      </td>
      <td className="py-2.5 pr-3">
        <StatusPill tone={followUp ? "warning" : DELEGATION_STATUS[d.status].tone} label={followUp ? "Follow-up required" : DELEGATION_STATUS[d.status].label} />
      </td>
      <td className="py-2.5 pr-3 text-xs">
        <span className={cn(silent >= 5 ? "text-warning-ink" : "text-muted-foreground")}>{silent === 0 ? "today" : `${silent}d ago`}</span>
        {d.lastUpdateNote && <p className="mt-0.5 line-clamp-2 text-ink-2">“{d.lastUpdateNote}”</p>}
      </td>
      <td className="py-2 pr-4">
        <div className="flex justify-end gap-1">
          {followUp && (
            <Button size="xs" variant="outline" disabled={pending} onClick={() => run(() => followUpDelegation(d.id))}>
              <BellRing /> Follow up
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-xs" variant="ghost" aria-label="More actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setUpdateOpen(true)}>
                <MessageSquareText /> Log update
              </DropdownMenuItem>
              {!followUp && (
                <DropdownMenuItem onSelect={() => run(() => followUpDelegation(d.id))}>
                  <BellRing /> Follow up
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => run(() => completeTask(d.task.id), { success: "Marked complete" })}>
                <Check /> Mark complete
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => run(() => recallDelegation(d.id))}>
                <CornerDownLeft /> Take it back
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <UpdateDialog open={updateOpen} onOpenChange={setUpdateOpen} delegationId={d.id} name={d.delegate.name} due={d.dueDate} />
      </td>
    </tr>
  );
}

function UpdateDialog({ open, onOpenChange, delegationId, name, due }: { open: boolean; onOpenChange: (o: boolean) => void; delegationId: string; name: string; due: Date | null }) {
  const [note, setNote] = useState("");
  const [date, setDate] = useState(due ? dayKey(due) : "");
  const { pending, run } = useAction();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Update from {name}</DialogTitle>
          <DialogDescription>Keeps the Delegation Center current and resets the follow-up clock.</DialogDescription>
        </DialogHeader>
        <Field label="What did they report?" htmlFor="del-note">
          <Textarea id="del-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Field label="Committed date" htmlFor="del-date">
          <Input id="del-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button
            disabled={pending || !note.trim()}
            onClick={async () => {
              const res = await run(() => logDelegationUpdate(delegationId, { note, dueDate: date || null }));
              if (res.ok) {
                setNote("");
                onOpenChange(false);
              }
            }}
          >
            {pending && <Loader2 className="animate-spin" />} Save update
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
