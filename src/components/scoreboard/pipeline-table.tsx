"use client";

import { Briefcase, Landmark } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DueLabel, EmptyState, Panel, PersonName } from "@/components/common/bits";
import { cn } from "@/lib/utils";
import type { PipelineDeal } from "@/server/queries/scoreboard";
import { formatUsd as formatCurrency } from "./metric-format";

type Kind = "SALES" | "FUNDRAISING";

const KINDS: Record<Kind, { label: string; icon: typeof Briefcase; note: string }> = {
  SALES: {
    label: "Sales",
    icon: Briefcase,
    note: "Open sales deals. Weighted = value × probability; the totals are the Weighted and Open sales pipeline tiles above.",
  },
  FUNDRAISING: {
    label: "Fundraising",
    icon: Landmark,
    note: "Open investor conversations. “Committed” counts open deals at ≥ 90% plus won deals (won deals are not listed here).",
  },
};

const STALE_DAYS = 14;

function ProbabilityCell({ value }: { value: number }) {
  return (
    <div className="flex items-center justify-end gap-2" title={`${value}% probability`}>
      <div className="h-1 w-10 overflow-hidden rounded-full bg-track" aria-hidden>
        <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
      <span className="w-8 text-right tabular">{value}%</span>
    </div>
  );
}

export function PipelineComposition({ deals, today }: { deals: PipelineDeal[]; today: Date }) {
  const [kind, setKind] = useState<Kind>("SALES");
  const rows = deals.filter((d) => d.type === kind).sort((a, b) => b.weighted - a.weighted || (b.value ?? 0) - (a.value ?? 0));
  const total = rows.reduce((s, d) => s + (d.value ?? 0), 0);
  const weighted = rows.reduce((s, d) => s + d.weighted, 0);
  const committed = rows.filter((d) => d.probability >= 90).reduce((s, d) => s + (d.value ?? 0), 0);
  const counts: Record<Kind, number> = {
    SALES: deals.filter((d) => d.type === "SALES").length,
    FUNDRAISING: deals.filter((d) => d.type === "FUNDRAISING").length,
  };

  return (
    <Panel
      id="pipeline-composition"
      title="Pipeline composition"
      icon={Briefcase}
      className="scroll-mt-24"
      actions={
        <div className="flex rounded-md border border-border p-0.5" role="tablist" aria-label="Pipeline type">
          {(Object.keys(KINDS) as Kind[]).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              id={`pipeline-tab-${k}`}
              aria-selected={kind === k}
              aria-controls="pipeline-panel"
              onClick={() => setKind(k)}
              className={cn(
                "rounded px-1.5 py-0.5 text-2xs font-medium",
                kind === k ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {KINDS[k].label} <span className="tabular text-muted-foreground">{counts[k]}</span>
            </button>
          ))}
        </div>
      }
    >
      <div id="pipeline-panel" role="tabpanel" aria-labelledby={`pipeline-tab-${kind}`}>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-hairline px-3.5 py-2 text-xs">
          <span className="text-muted-foreground">
            Open value <span className="font-semibold text-foreground tabular">{formatCurrency(total)}</span>
          </span>
          <span className="text-muted-foreground">
            Weighted <span className="font-semibold text-foreground tabular">{formatCurrency(weighted)}</span>
          </span>
          {kind === "FUNDRAISING" && (
            <span className="text-muted-foreground">
              Open at ≥ 90% <span className="font-semibold text-foreground tabular">{formatCurrency(committed)}</span>
            </span>
          )}
          <span className="basis-full text-2xs text-muted-foreground">{KINDS[kind].note}</span>
        </div>
        {rows.length === 0 ? (
          <EmptyState compact icon={KINDS[kind].icon} title={`No open ${KINDS[kind].label.toLowerCase()} deals`} description="Deals sync from the CRM; open ones appear here with their weighted value." />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[860px] text-[14px]">
              <caption className="sr-only">Open {KINDS[kind].label.toLowerCase()} deals behind the derived pipeline metrics</caption>
              <thead>
                <tr className="border-b border-hairline text-left text-2xs font-medium text-muted-foreground">
                  <th scope="col" className="px-3.5 py-2 font-medium">Deal</th>
                  <th scope="col" className="px-2 py-2 font-medium">Company</th>
                  <th scope="col" className="px-2 py-2 font-medium">Stage</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">Value</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">Probability</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">Weighted</th>
                  <th scope="col" className="px-2 py-2 font-medium">Expected close</th>
                  <th scope="col" className="px-3.5 py-2 text-right font-medium">Last activity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {rows.map((d) => {
                  const stale = d.daysSinceActivity !== null && d.daysSinceActivity >= STALE_DAYS;
                  return (
                    <tr key={d.id} className="align-top hover:bg-muted/40">
                      <td className="max-w-[280px] px-3.5 py-2">
                        <div className="truncate font-medium text-foreground" title={d.name}>
                          {d.name}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-2xs text-muted-foreground">
                          {d.owner && <PersonName person={d.owner} className="max-w-[120px]" />}
                          {d.nextStep && (
                            <span className="truncate" title={d.nextStep}>
                              {d.owner ? "· " : ""}Next: {d.nextStep}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        {d.company ? (
                          <Link href={`/resources/companies/${d.company.id}`} className="text-ink-2 hover:text-foreground hover:underline">
                            {d.company.name}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-ink-2">{d.stage}</td>
                      <td className="px-2 py-2 text-right tabular">{formatCurrency(d.value)}</td>
                      <td className="px-2 py-2">
                        <ProbabilityCell value={d.probability} />
                        {kind === "FUNDRAISING" && d.probability >= 90 && <div className="mt-0.5 text-right text-2xs font-medium text-good-ink">Counts as committed</div>}
                      </td>
                      <td className="px-2 py-2 text-right font-medium tabular">{formatCurrency(d.weighted)}</td>
                      <td className="px-2 py-2 text-xs">
                        <DueLabel date={d.expectedClose} today={today} />
                      </td>
                      <td className="px-3.5 py-2 text-right text-xs whitespace-nowrap">
                        {d.daysSinceActivity === null ? (
                          <span className="text-muted-foreground">None logged</span>
                        ) : (
                          <span className={cn("tabular", stale ? "font-medium text-warning-ink" : "text-muted-foreground")} title={`${d.daysSinceActivity} days since the last logged activity`}>
                            {d.daysSinceActivity === 0 ? "Today" : `${d.daysSinceActivity}d ago`}
                            {stale && <span className="ml-1 rounded bg-warning-soft px-1 text-2xs">Stale</span>}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-border text-xs font-medium">
                  <th scope="row" colSpan={3} className="px-3.5 py-2 text-left font-medium text-ink-2">
                    Total · {rows.length} open
                  </th>
                  <td className="px-2 py-2 text-right tabular">{formatCurrency(total)}</td>
                  <td />
                  <td className="px-2 py-2 text-right font-semibold tabular">{formatCurrency(weighted)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </Panel>
  );
}
