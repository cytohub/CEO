import { Clock, Gavel, History, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader, Panel, PillarTag } from "@/components/common/bits";
import { CreateButton } from "@/components/common/create-button";
import { StatusPill } from "@/components/common/status";
import { DecisionHistory } from "@/components/decisions/decision-history";
import { cn } from "@/lib/utils";
import { addDays, daysBetween, formatDay } from "@/lib/dates";
import { DECISION_STATUS } from "@/lib/domain";
import { getDecisionCenter, type DecisionListItem } from "@/server/queries/decisions";
import { requirePage } from "@/server/security/session";

export const metadata: Metadata = { title: "Decisions" };

export default async function DecisionsPage() {
  await requirePage("workspace.view", "/decisions");
  const { decisions, today, now } = await getDecisionCenter();
  const needed = decisions.filter((d) => d.status === "NEEDED");
  const waiting = decisions.filter((d) => d.status === "WAITING_INFO");
  const recent = decisions.filter((d) => d.status === "DECIDED" && d.decidedAt && d.decidedAt >= addDays(today, -30)).sort((a, b) => b.decidedAt!.getTime() - a.decidedAt!.getTime());
  const history = decisions.filter((d) => d.status === "DECIDED" || d.status === "DEFERRED");
  const decidedWithTime = decisions.filter((d) => d.decidedAt);
  const medianDays = (() => {
    const xs = decidedWithTime.map((d) => daysBetween(d.raisedAt, d.decidedAt!)).sort((a, b) => a - b);
    return xs.length ? xs[Math.floor(xs.length / 2)] : null;
  })();

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <PageHeader
        title="Decision Center"
        description="The calls only you can make — with context, options, a recommendation and a record of what you decided and what happened."
        actions={<CreateButton kind="decision" label="Record decision" icon={<Plus />} />}
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Decisions needed", needed.length, needed.filter((d) => d.deadline && daysBetween(today, d.deadline) <= 2).length ? `${needed.filter((d) => d.deadline && daysBetween(today, d.deadline) <= 2).length} due within 48h` : "None urgent"],
          ["Waiting for information", waiting.length, waiting.length ? `oldest ${Math.max(...waiting.map((d) => daysBetween(d.raisedAt, now)))}d` : "—"],
          ["Decided (30 days)", recent.length, "with outcomes tracked"],
          ["Median decision time", medianDays === null ? "—" : `${medianDays}d`, "raised → decided"],
        ].map(([label, value, hint]) => (
          <div key={label as string} className="panel px-3.5 py-3">
            <div className="text-2xs text-muted-foreground">{label}</div>
            <div className="mt-0.5 text-xl font-semibold tabular">{value}</div>
            <div className="text-2xs text-muted-foreground">{hint}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Decisions needed" icon={Gavel} count={needed.length}>
          {needed.length === 0 ? <EmptyState compact title="Nothing waiting on you" /> : <DecisionCards items={needed} today={today} now={now} />}
        </Panel>
        <Panel title="Waiting for information" icon={Clock} count={waiting.length}>
          {waiting.length === 0 ? <EmptyState compact title="No decisions blocked on information" /> : <DecisionCards items={waiting} today={today} now={now} />}
        </Panel>
      </div>

      <Panel title="Recently decided" icon={History} count={recent.length}>
        {recent.length === 0 ? (
          <EmptyState compact title="No decisions in the last 30 days" />
        ) : (
          <ul className="divide-y divide-hairline">
            {recent.map((d) => (
              <li key={d.id}>
                <Link href={`/decisions/${d.id}`} className="grid gap-1 px-4 py-3 hover:bg-muted/40 md:grid-cols-[1fr_auto] md:gap-6">
                  <div className="min-w-0">
                    <div className="text-[14px] font-medium">{d.title}</div>
                    <div className="mt-0.5 text-xs text-ink-2">→ {d.finalDecision}</div>
                    {d.outcome ? <div className="mt-0.5 text-2xs text-muted-foreground">Outcome: {d.outcome}</div> : <div className="mt-0.5 text-2xs text-warning-ink">Outcome not yet recorded</div>}
                  </div>
                  <div className="text-2xs text-muted-foreground md:text-right">
                    Decided {formatDay(d.decidedAt)} · {daysBetween(d.raisedAt, d.decidedAt!)}d to decide
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <section aria-labelledby="history-title" className="space-y-2">
        <h2 id="history-title" className="flex items-center gap-2 pt-2 text-[16px] font-semibold tracking-tight">
          <History className="size-4 text-ink-3" aria-hidden /> Decision history
        </h2>
        <DecisionHistory items={history} />
      </section>
    </div>
  );
}

function DecisionCards({ items, today, now }: { items: DecisionListItem[]; today: Date; now: Date }) {
  return (
    <ul className="divide-y divide-hairline">
      {items.map((d) => {
        const days = d.deadline ? daysBetween(today, d.deadline) : null;
        const rec = d.options.find((o) => o.recommended);
        return (
          <li key={d.id}>
            <Link href={`/decisions/${d.id}`} className="block px-4 py-3 hover:bg-muted/40">
              <div className="flex items-start gap-3">
                <span className="min-w-0 flex-1 text-[14px] leading-snug font-medium">{d.title}</span>
                {days !== null && (
                  <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-2xs font-medium tabular", days <= 1 ? "bg-critical-soft text-critical-ink" : days <= 3 ? "bg-serious-soft text-serious-ink" : "bg-muted text-muted-foreground")}>
                    {days < 0 ? `${-days}d late` : days === 0 ? "Due today" : `Due in ${days}d`}
                  </span>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
                <StatusPill tone={DECISION_STATUS[d.status].tone} label={DECISION_STATUS[d.status].label} />
                <span>Impact {d.strategicImpact}/5</span>
                <span>Open {daysBetween(d.raisedAt, now)}d</span>
                <span>{d.options.length} options</span>
                {d.pillar && <PillarTag name={d.pillar.name} color={d.pillar.color} compact className="text-2xs" />}
              </div>
              {d.status === "WAITING_INFO" && d.waitingOn && <p className="mt-1.5 text-xs text-ink-2">Waiting on: {d.waitingOn}</p>}
              {(d.recommendation || rec) && <p className="mt-1.5 line-clamp-2 text-xs text-brain">Recommendation: {d.recommendation ?? rec?.title}</p>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
