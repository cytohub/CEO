"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/common/bits";
import { StatusPill } from "@/components/common/status";
import { daysBetween, formatDay } from "@/lib/dates";
import { DECISION_STATUS } from "@/lib/domain";
import type { DecisionListItem } from "@/server/queries/decisions";

export function DecisionHistory({ items }: { items: DecisionListItem[] }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return [...items]
      .filter((d) => !n || [d.title, d.finalDecision, d.outcome, d.lessonsLearned, d.context].some((x) => x?.toLowerCase().includes(n)))
      .sort((a, b) => (b.decidedAt ?? b.raisedAt).getTime() - (a.decidedAt ?? a.raisedAt).getTime());
  }, [items, q]);
  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-hairline p-2.5">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search decisions, outcomes and lessons…" className="h-8 pl-8" aria-label="Search decision history" />
        </div>
      </div>
      {list.length === 0 ? (
        <EmptyState compact title="No decisions found" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-[15px]">
            <thead>
              <tr className="border-b border-hairline text-left text-2xs text-muted-foreground">
                <th className="py-2 pr-3 pl-4 font-medium">Decision</th>
                <th className="w-28 py-2 pr-3 font-medium">Status</th>
                <th className="w-24 py-2 pr-3 font-medium">Decided</th>
                <th className="w-20 py-2 pr-3 font-medium">Time</th>
                <th className="py-2 pr-4 font-medium">Lessons learned</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {list.map((d) => (
                <tr key={d.id} className="align-top hover:bg-muted/40">
                  <td className="py-2.5 pr-3 pl-4">
                    <Link href={`/decisions/${d.id}`} className="font-medium hover:underline">
                      {d.title}
                    </Link>
                    {d.finalDecision && <p className="mt-0.5 text-xs text-ink-2">→ {d.finalDecision}</p>}
                  </td>
                  <td className="py-2.5 pr-3">
                    <StatusPill tone={DECISION_STATUS[d.status].tone} label={DECISION_STATUS[d.status].label} />
                  </td>
                  <td className="py-2.5 pr-3 text-xs text-muted-foreground tabular">{formatDay(d.decidedAt, true)}</td>
                  <td className="py-2.5 pr-3 text-xs text-muted-foreground tabular">{d.decidedAt ? `${daysBetween(d.raisedAt, d.decidedAt)}d` : "—"}</td>
                  <td className="py-2.5 pr-4 text-xs text-ink-2">{d.lessonsLearned ?? <span className="text-muted-foreground">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
