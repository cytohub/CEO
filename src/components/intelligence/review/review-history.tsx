"use client";

import { History } from "lucide-react";
import { EmptyState } from "@/components/common/bits";
import { StatusPill } from "@/components/common/status";
import { formatDateTime } from "@/lib/dates";
import { REVIEW_KINDS, REVIEW_STATUS } from "@/lib/intelligence";
import type { ReviewEntry } from "@/server/queries/review";
import { REVIEW_KIND_ICON } from "../badges";
import { RecordLink } from "./special-views";

/** Resolved review items: who decided what, when, and why. */
export function ReviewHistory({ items, timezone }: { items: ReviewEntry[]; timezone: string }) {
  if (items.length === 0) {
    return (
      <div className="panel">
        <EmptyState icon={History} title="No decisions yet" description="Approved, rejected, merged and ignored items will be listed here with who resolved them." />
      </div>
    );
  }
  return (
    <ul className="panel divide-y divide-hairline" aria-label="Resolved review items">
      {items.map((i) => {
        const Icon = REVIEW_KIND_ICON[i.kind];
        const st = REVIEW_STATUS[i.status];
        return (
          <li key={i.id} className="grid gap-x-4 gap-y-1 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-2xs text-muted-foreground">
                <Icon className="size-3.5 text-ink-3" aria-hidden />
                {REVIEW_KINDS[i.kind].label}
              </div>
              <div className="mt-0.5 text-[14px] font-medium">{i.title}</div>
              {i.resolutionNote && <p className="mt-1 text-xs text-ink-2">“{i.resolutionNote}”</p>}
              {i.result && (
                <div className="mt-1 flex items-center gap-1.5 text-2xs text-muted-foreground">
                  <span>Result:</span>
                  <RecordLink record={i.result} className="text-xs" />
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground md:flex-col md:items-end md:gap-1">
              <StatusPill tone={st.tone} label={st.label} />
              <span>
                {i.resolvedBy ?? "CytoHub Brain"}
                {i.resolvedAt && ` · ${formatDateTime(i.resolvedAt, timezone)}`}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
