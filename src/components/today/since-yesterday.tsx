"use client";

import { Check, Newspaper } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/common/bits";
import { useAction } from "@/components/common/use-action";
import { cn } from "@/lib/utils";
import { formatDayLong } from "@/lib/dates";
import { markBriefReviewed } from "@/server/actions/brain";
import { BRIEF_SECTIONS, type BriefItem, type BriefSections } from "@/server/brain/types";
import { briefItemTitle } from "@/lib/format";

const PRIMARY: (typeof BRIEF_SECTIONS)[number]["key"][] = ["changes", "decisionsNeeded", "risks", "milestonesAtRisk", "dealsProgressing", "dealsSlowing", "opportunities"];

/** CEO Daily Intelligence Brief, compressed for the cockpit. */
export function SinceYesterday({
  headline,
  summary,
  payload,
  reviewedAt,
  isToday,
  date,
}: {
  headline: string;
  summary: string;
  payload: BriefSections;
  reviewedAt: Date | null;
  isToday: boolean;
  date: Date;
}) {
  const { pending, run } = useAction();
  // Persisting decisions, at-risk milestones and deadlines have their own cockpit
  // panels; here we only show what is genuinely new since the last refresh.
  const STATEFUL = new Set(["decisionsNeeded", "milestonesAtRisk", "deadlines"]);
  const itemsFor = (key: (typeof BRIEF_SECTIONS)[number]["key"]) => (payload.sections[key] ?? []).filter((i) => !STATEFUL.has(key) || i.isNew !== false);
  const sections = BRIEF_SECTIONS.filter((s) => itemsFor(s.key).length);
  const ordered = [...sections].sort((a, b) => (PRIMARY.includes(a.key) ? 0 : 1) - (PRIMARY.includes(b.key) ? 0 : 1));

  return (
    <Panel
      id="since-yesterday"
      title={isToday ? "Since yesterday" : `Daily brief · ${formatDayLong(date)}`}
      icon={Newspaper}
      href="/brain"
      hrefLabel="Full brief"
      actions={
        reviewedAt ? (
          <span className="flex items-center gap-1 px-1.5 text-2xs text-good-ink">
            <Check className="size-3" aria-hidden /> Reviewed
          </span>
        ) : (
          <Button variant="ghost" size="xs" disabled={pending} onClick={() => run(() => markBriefReviewed())}>
            <Check /> Mark reviewed
          </Button>
        )
      }
    >
      <div className="border-b border-hairline px-4 py-3">
        <p className="text-[13px] leading-snug font-medium text-foreground">{headline}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{summary}</p>
        <p className="mt-2 text-2xs text-muted-foreground tabular">
          {payload.stats.signalsProcessed} signals processed · {payload.stats.newInsights} new insights · {payload.stats.tasksCreated} commitments captured · {payload.stats.inboxCreated} inbox items filed
        </p>
      </div>
      {ordered.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">No material changes since the last refresh.</p>
      ) : (
        <div className="grid divide-hairline sm:grid-cols-2 sm:divide-x">
          {[0, 1].map((col) => (
            <div key={col} className="divide-y divide-hairline">
              {ordered
                .filter((_, i) => i % 2 === col)
                .map((s) => (
                  <BriefSection key={s.key} label={s.label} items={itemsFor(s.key)} />
                ))}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function BriefSection({ label, items }: { label: string; items: BriefItem[] }) {
  return (
    <div className="px-4 py-2.5">
      <h3 className="mb-1 text-2xs font-semibold tracking-wide text-ink-3 uppercase">{label}</h3>
      <ul className="space-y-1">
        {items.slice(0, 4).map((i, idx) => {
          const content = (
            <>
              <span
                aria-label={i.isNew === false ? "Still open" : "New"}
                className={cn("mt-[7px] size-1.5 shrink-0 rounded-full", i.isNew === false ? "border border-ink-3" : i.importance >= 4 ? "bg-brand" : "bg-ink-3")}
              />
              <span className="min-w-0">
                <span className="line-clamp-2 text-[12.5px] leading-snug text-foreground">{briefItemTitle(i.title)}</span>
                {i.detail && <span className="line-clamp-1 text-2xs text-muted-foreground">{i.detail}</span>}
              </span>
            </>
          );
          return (
            <li key={idx}>
              {i.href ? (
                <Link href={i.href} scroll={false} className="-mx-1 flex gap-2 rounded px-1 py-0.5 hover:bg-muted/70">
                  {content}
                </Link>
              ) : (
                <div className="flex gap-2 py-0.5">{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
