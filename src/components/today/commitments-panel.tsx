"use client";

import { Check, Handshake, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/common/bits";
import { TONE_TEXT } from "@/components/common/status";
import { useCan } from "@/components/shell/ui-context";
import { commitmentDue } from "@/components/intelligence/model";
import { cn } from "@/lib/utils";
import { fulfillCommitment, reopenCommitment } from "@/server/actions/commitments";
import type { CockpitCommitments } from "@/server/queries/commitments";

type Row = CockpitCommitments["youOwe"][number];

/** Today cockpit: what you owe (overdue first, then due soon) and what others owe you that is overdue. */
export function CommitmentsPanel({ data }: { data: CockpitCommitments }) {
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const youOwe = data.youOwe.filter((c) => !done.has(c.id));
  const owed = data.owedToYou.filter((c) => !done.has(c.id));
  const hide = (id: string, hidden: boolean) =>
    setDone((s) => {
      const n = new Set(s);
      if (hidden) n.add(id);
      else n.delete(id);
      return n;
    });

  return (
    <Panel id="commitments" title="Commitments" icon={Handshake} count={data.youOweTotal + data.owedToYouOverdueTotal} href="/commitments">
      <Group title="You owe" empty="You don’t owe anyone anything right now." rows={youOwe} today={data.today} direction="to" onHide={hide} more={data.youOweTotal - data.youOwe.length} />
      <div className="border-t border-hairline" />
      <Group title="Owed to you · overdue" empty="Nothing owed to you is overdue." rows={owed} today={data.today} direction="from" onHide={hide} more={data.owedToYouOverdueTotal - data.owedToYou.length} />
    </Panel>
  );
}

function Group({ title, empty, rows, today, direction, onHide, more }: { title: string; empty: string; rows: Row[]; today: Date; direction: "to" | "from"; onHide: (id: string, hidden: boolean) => void; more: number }) {
  return (
    <div>
      <h3 className="eyebrow px-3.5 pt-2.5 pb-1">{title}</h3>
      {rows.length === 0 ? (
        <p className="px-3.5 pb-2.5 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {rows.map((c) => (
            <CommitmentLine key={c.id} c={c} today={today} direction={direction} onHide={onHide} />
          ))}
        </ul>
      )}
      {more > 0 && (
        <Link href={direction === "to" ? "/commitments" : "/commitments?tab=owed"} className="block px-3.5 pb-2 text-2xs text-muted-foreground hover:text-foreground">
          +{more} more
        </Link>
      )}
    </div>
  );
}

function CommitmentLine({ c, today, direction, onHide }: { c: Row; today: Date; direction: "to" | "from"; onHide: (id: string, hidden: boolean) => void }) {
  const canEdit = useCan("workspace.edit");
  const [busy, setBusy] = useState(false);
  const due = commitmentDue(c.dueDate, today);
  const who = [c.other ? (c.other.isCeo ? "You" : c.other.name) : null, c.company?.name].filter(Boolean).join(" · ");

  async function fulfil() {
    setBusy(true);
    const res = await fulfillCommitment(c.id);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    onHide(c.id, true);
    toast.success("Marked fulfilled", {
      action: {
        label: "Undo",
        onClick: () =>
          void reopenCommitment(c.id).then((r) => {
            if (r.ok) onHide(c.id, false);
            else toast.error(r.error);
          }),
      },
    });
  }

  return (
    <li className="group flex items-start gap-2 px-3.5 py-2 hover:bg-muted/50">
      <Link href={`/commitments?highlight=${c.id}`} className="min-w-0 flex-1 rounded-sm focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
        <span className="flex items-start gap-2">
          <span className="line-clamp-2 flex-1 text-[14px] leading-snug font-medium">{c.title}</span>
          <span className={cn("shrink-0 text-2xs font-medium tabular", due.overdue ? "text-critical-ink" : due.tone === "neutral" ? "text-muted-foreground" : TONE_TEXT[due.tone])}>{due.label}</span>
        </span>
        {who && (
          <span className="mt-0.5 block truncate text-2xs text-muted-foreground">
            {direction === "to" ? "To" : "From"} {who}
          </span>
        )}
      </Link>
      {canEdit && (
        <Button
          size="icon-xs"
          variant="ghost"
          className="mt-px text-muted-foreground opacity-100 hover:text-good-ink sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
          onClick={fulfil}
          disabled={busy}
          aria-label={`Mark “${c.title}” fulfilled`}
          title="Mark fulfilled"
        >
          {busy ? <Loader2 className="animate-spin" /> : <Check />}
        </Button>
      )}
    </li>
  );
}
