"use client";

import { ArrowUpRight, Ban, Check, CircleDot, Eye, Lightbulb, ListPlus, MoreHorizontal, RotateCcw, ShieldCheck, Target, Trophy, UserRound, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, PersonName } from "@/components/common/bits";
import { Field, PersonSelect, SimpleSelect } from "@/components/common/fields";
import { StatusPill } from "@/components/common/status";
import { useAction } from "@/components/common/use-action";
import { useCan, useUI } from "@/components/shell/ui-context";
import type { RiskStatus } from "@/generated/prisma/enums";
import { formatDay, toDay } from "@/lib/dates";
import { formatCurrency } from "@/lib/format";
import { OPPORTUNITY_KIND, OPPORTUNITY_STATUS, RISK_STATUS } from "@/lib/intelligence";
import { cn } from "@/lib/utils";
import { createOpportunityTask, setOpportunityStatus, setRiskOwner, setRiskStatus } from "@/server/actions/risks";
import type { OpportunityRow, RiskRow } from "@/server/queries/risks";
import { ConfidenceBadge, SeverityMeter } from "../badges";
import { ViewSourceButton } from "../view-source";

function useHighlight() {
  const highlight = useSearchParams().get("highlight");
  useEffect(() => {
    if (highlight) document.getElementById(`row-${highlight}`)?.scrollIntoView({ block: "center" });
  }, [highlight]);
  return highlight;
}

const chip = "inline-flex max-w-[240px] items-center gap-1 truncate hover:text-foreground hover:underline";

// ─── Risks ───────────────────────────────────────────────────────────────────

type RiskDialog = { kind: "status"; risk: RiskRow; status: RiskStatus } | { kind: "owner"; risk: RiskRow } | null;

export function RiskList({ items, timezone, filtered }: { items: RiskRow[]; timezone: string; filtered: boolean }) {
  const highlight = useHighlight();
  const [dialog, setDialog] = useState<RiskDialog>(null);
  if (items.length === 0) {
    return (
      <div className="panel">
        <EmptyState icon={ShieldCheck} title={filtered ? "No risks match" : "No open risks"} description={filtered ? "Try another company or view." : "Risks CytoHub Brain spots in email, meetings and documents appear here with their source."} />
      </div>
    );
  }
  return (
    <>
      <ul className="panel divide-y divide-hairline" aria-label="Risks">
        {items.map((r) => (
          <RiskItem key={r.id} r={r} timezone={timezone} highlighted={r.id === highlight} onDialog={setDialog} />
        ))}
      </ul>
      <RiskDialogView key={dialog ? `${dialog.kind}-${dialog.risk.id}-${dialog.kind === "status" ? dialog.status : ""}` : "closed"} state={dialog} onClose={() => setDialog(null)} />
    </>
  );
}

function RiskItem({ r, timezone, highlighted, onDialog }: { r: RiskRow; timezone: string; highlighted: boolean; onDialog: (d: RiskDialog) => void }) {
  const canEdit = useCan("workspace.edit");
  const { openEntity } = useUI();
  const st = RISK_STATUS[r.status];
  const active = r.status === "OPEN" || r.status === "MONITORING";
  return (
    <li id={`row-${r.id}`} className={cn("grid scroll-mt-24 gap-x-4 gap-y-2 px-4 py-3 md:grid-cols-[150px_minmax(0,1fr)_auto]", highlighted && "bg-brand-soft/40", !active && "opacity-75")}>
      <div className="flex items-center gap-2 md:block">
        <SeverityMeter severity={r.severity} />
        {r.likelihood != null && <div className="text-2xs text-muted-foreground md:mt-1">Likelihood {r.likelihood}/5</div>}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[15px] leading-snug font-medium">{r.title}</span>
          <StatusPill tone={st.tone} label={st.label} />
        </div>
        {r.description && <p className="mt-0.5 line-clamp-2 text-xs text-ink-2">{r.description}</p>}
        {r.excerpt && !r.description && <p className="mt-0.5 line-clamp-2 text-xs text-ink-2 italic">“{r.excerpt}”</p>}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
          {r.category && <span>{r.category.charAt(0) + r.category.slice(1).toLowerCase()}</span>}
          {r.company && (
            <Link href={`/resources/companies/${r.company.id}`} className={chip}>
              {r.company.name}
            </Link>
          )}
          {r.goal && (
            <Link href={`/goals/${r.goal.id}`} className={chip}>
              Goal · {r.goal.title}
            </Link>
          )}
          {r.milestone && (
            <button type="button" onClick={() => openEntity("milestone", r.milestone!.id)} className={chip}>
              Milestone · {r.milestone.title}
            </button>
          )}
          {r.deal && r.deal.companyId && (
            <Link href={`/resources/companies/${r.deal.companyId}`} className={chip}>
              Deal · {r.deal.name}
            </Link>
          )}
          <span title={r.identifiedAt.toISOString()}>Identified {formatDay(toDay(r.identifiedAt, timezone))}</span>
          <span className="inline-flex items-center gap-1">
            <UserRound className="size-3" aria-hidden />
            {r.owner ? <PersonName person={r.owner} className="text-2xs" /> : "No owner"}
          </span>
          <ConfidenceBadge level={r.confidence} score={r.confidenceScore} compact />
        </div>
        {r.mitigation && active && <p className="mt-1.5 text-xs text-ink-2">Mitigation: {r.mitigation}</p>}
        {r.resolution && !active && <p className="mt-1.5 text-xs text-ink-2">Resolution: {r.resolution}</p>}
      </div>
      <div className="flex items-start gap-0.5 md:justify-end">
        {(r.sources.count > 0 || r.sources.hidden > 0) && <ViewSourceButton targetType="RISK" targetId={r.id} count={r.sources.count} hidden={r.sources.hidden} />}
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label={`Actions for “${r.title}”`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="text-2xs">Status</DropdownMenuLabel>
              {(
                [
                  ["MONITORING", Eye],
                  ["MITIGATED", ShieldCheck],
                  ["RESOLVED", Check],
                  ["ACCEPTED", CircleDot],
                  ["OPEN", RotateCcw],
                ] as const
              )
                .filter(([s]) => s !== r.status)
                .map(([s, Icon]) => (
                  <DropdownMenuItem key={s} onSelect={() => onDialog({ kind: "status", risk: r, status: s })}>
                    <Icon /> {s === "OPEN" ? "Reopen" : `Mark ${RISK_STATUS[s].label.toLowerCase()}…`}
                  </DropdownMenuItem>
                ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onDialog({ kind: "owner", risk: r })}>
                <UserRound /> Set owner…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </li>
  );
}

function RiskDialogView({ state, onClose }: { state: RiskDialog; onClose: () => void }) {
  const { pending, run } = useAction();
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<RiskStatus | null>(state?.kind === "status" ? state.status : null);
  const [owner, setOwner] = useState<string | null>(state?.risk.ownerPersonId ?? null);
  if (!state) return <Dialog open={false} />;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await run(() => (state.kind === "status" ? setRiskStatus(state.risk.id, status ?? state.status, note) : setRiskOwner(state.risk.id, owner)));
    if (res.ok) onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{state.kind === "status" ? "Update risk status" : "Set risk owner"}</DialogTitle>
            <DialogDescription className="line-clamp-2">{state.risk.title}</DialogDescription>
          </DialogHeader>
          {state.kind === "status" ? (
            <>
              <Field label="Status" htmlFor="risk-status">
                <SimpleSelect id="risk-status" value={status} onChange={(v) => v && setStatus(v as RiskStatus)} options={(Object.keys(RISK_STATUS) as RiskStatus[]).map((s) => ({ value: s, label: RISK_STATUS[s].label }))} />
              </Field>
              <Field label={status === "MONITORING" ? "Mitigation plan (optional)" : "Note (optional)"} htmlFor="risk-note" hint={status === "RESOLVED" ? "Recorded in the activity history as a resolved risk." : undefined}>
                <Textarea id="risk-note" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
              </Field>
            </>
          ) : (
            <Field label="Owner" htmlFor="risk-owner">
              <PersonSelect id="risk-owner" value={owner} onChange={setOwner} allowNone teamOnly />
            </Field>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button type="submit" disabled={pending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Opportunities ───────────────────────────────────────────────────────────

export function OpportunityList({ items, timezone, filtered }: { items: OpportunityRow[]; timezone: string; filtered: boolean }) {
  const highlight = useHighlight();
  if (items.length === 0) {
    return (
      <div className="panel">
        <EmptyState icon={Lightbulb} title={filtered ? "No opportunities match" : "No open opportunities"} description={filtered ? "Try another company or view." : "Upside the Brain spots — expansions, partnerships, investors — lands here with its source."} />
      </div>
    );
  }
  return (
    <ul className="panel divide-y divide-hairline" aria-label="Opportunities">
      {items.map((o) => (
        <OpportunityItem key={o.id} o={o} timezone={timezone} highlighted={o.id === highlight} />
      ))}
    </ul>
  );
}

function OpportunityItem({ o, timezone, highlighted }: { o: OpportunityRow; timezone: string; highlighted: boolean }) {
  const canEdit = useCan("workspace.edit");
  const { openEntity } = useUI();
  const { pending, run } = useAction();
  const st = OPPORTUNITY_STATUS[o.status];
  const active = o.status === "OPEN" || o.status === "PURSUING";
  const setStatus = (s: string) => run(() => setOpportunityStatus(o.id, s));
  return (
    <li id={`row-${o.id}`} className={cn("grid scroll-mt-24 gap-x-4 gap-y-2 px-4 py-3 md:grid-cols-[110px_minmax(0,1fr)_auto]", highlighted && "bg-brand-soft/40", !active && "opacity-75")}>
      <div className="flex items-baseline gap-2 md:block">
        <div className="text-[17px] font-semibold tabular">{o.estimatedValue != null ? formatCurrency(o.estimatedValue) : "—"}</div>
        <div className="text-2xs text-muted-foreground">{OPPORTUNITY_KIND[o.kind].label}</div>
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[15px] leading-snug font-medium">{o.title}</span>
          <StatusPill tone={st.tone} label={st.label} />
        </div>
        {(o.description ?? o.excerpt) && <p className={cn("mt-0.5 line-clamp-2 text-xs text-ink-2", !o.description && "italic")}>{o.description ?? `“${o.excerpt}”`}</p>}
        {o.nextStep && (
          <p className="mt-1 text-xs">
            <span className="text-brain">Next step →</span> {o.nextStep}
          </p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
          {o.company && (
            <Link href={`/resources/companies/${o.company.id}`} className={chip}>
              {o.company.name}
            </Link>
          )}
          {o.person && (
            <Link href={`/resources/people/${o.person.id}`} className={chip}>
              {o.person.name}
            </Link>
          )}
          {o.goal && (
            <Link href={`/goals/${o.goal.id}`} className={chip}>
              Goal · {o.goal.title}
            </Link>
          )}
          {o.deal && <span>Deal · {o.deal.name} ({o.deal.stage})</span>}
          <span>Identified {formatDay(toDay(o.identifiedAt, timezone))}</span>
          <ConfidenceBadge level={o.confidence} score={o.confidenceScore} compact />
          {o.pursuitTask && (
            <button type="button" onClick={() => openEntity("task", o.pursuitTask!.id)} className={cn(chip, "text-brand")}>
              Pursuit task <ArrowUpRight className="size-3" aria-hidden />
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-start gap-1 md:justify-end">
        {(o.sources.count > 0 || o.sources.hidden > 0) && <ViewSourceButton targetType="OPPORTUNITY" targetId={o.id} count={o.sources.count} hidden={o.sources.hidden} />}
        {canEdit && active && !o.pursuitTask && (
          <Button size="xs" variant="outline" disabled={pending} onClick={() => run(() => createOpportunityTask(o.id), { onSuccess: (d) => openEntity("task", d.taskId) })}>
            <ListPlus /> Create task
          </Button>
        )}
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label={`Actions for “${o.title}”`} disabled={pending}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {o.status !== "PURSUING" && active && (
                <DropdownMenuItem onSelect={() => setStatus("PURSUING")}>
                  <Target /> Pursue
                </DropdownMenuItem>
              )}
              {o.status !== "WON" && (
                <DropdownMenuItem onSelect={() => setStatus("WON")}>
                  <Trophy /> Mark won
                </DropdownMenuItem>
              )}
              {o.status !== "LOST" && (
                <DropdownMenuItem onSelect={() => setStatus("LOST")}>
                  <X /> Mark lost
                </DropdownMenuItem>
              )}
              {!active && (
                <DropdownMenuItem onSelect={() => setStatus("OPEN")}>
                  <RotateCcw /> Reopen
                </DropdownMenuItem>
              )}
              {o.status !== "DISMISSED" && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => setStatus("DISMISSED")}>
                    <Ban /> Dismiss
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </li>
  );
}
