"use client";

import { useMemo, useState } from "react";
import { EmptyState } from "@/components/common/bits";
import { UpcomingRow } from "@/components/today/upcoming-panel";
import { cn } from "@/lib/utils";
import { dayFromKey, dayKeyInTz, formatDayLong, relativeDay, startOfWeek } from "@/lib/dates";
import type { UpcomingEvent, UpcomingKind } from "@/server/queries/today";

const KINDS: { key: UpcomingKind; label: string }[] = [
  { key: "meeting", label: "Meetings" },
  { key: "milestone", label: "Milestones" },
  { key: "decision", label: "Decisions" },
  { key: "task", label: "Deadlines" },
  { key: "delegation", label: "Delegated" },
  { key: "deal", label: "Deal closes" },
];

export function UpcomingTimeline({ events, today, timezone, groupByWeek }: { events: UpcomingEvent[]; today: Date; timezone: string; groupByWeek: boolean }) {
  const [hidden, setHidden] = useState<UpcomingKind[]>([]);
  const [majorOnly, setMajorOnly] = useState(false);
  const visible = events.filter((e) => !hidden.includes(e.kind) && (!majorOnly || e.importance >= 4));

  const groups = useMemo(() => {
    const map = new Map<string, UpcomingEvent[]>();
    for (const e of visible) {
      const day = e.allDay ? e.at.toISOString().slice(0, 10) : dayKeyInTz(e.at, timezone);
      const key = groupByWeek ? startOfWeek(dayFromKey(day)).toISOString().slice(0, 10) : day;
      map.set(key, [...(map.get(key) ?? []), e]);
    }
    return [...map.entries()];
  }, [visible, timezone, groupByWeek]);

  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-hairline p-2.5" role="group" aria-label="Event types">
        {KINDS.map((k) => {
          const count = events.filter((e) => e.kind === k.key).length;
          const on = !hidden.includes(k.key);
          return (
            <button
              key={k.key}
              type="button"
              aria-pressed={on}
              disabled={count === 0}
              onClick={() => setHidden((h) => (on ? [...h, k.key] : h.filter((x) => x !== k.key)))}
              className={cn("rounded-full border px-2.5 py-0.5 text-xs transition-colors disabled:opacity-40", on ? "border-foreground/30 bg-muted text-foreground" : "border-border text-muted-foreground line-through")}
            >
              {k.label} <span className="tabular text-muted-foreground">{count}</span>
            </button>
          );
        })}
        <button type="button" aria-pressed={majorOnly} onClick={() => setMajorOnly((v) => !v)} className={cn("ml-auto rounded-full border px-2.5 py-0.5 text-xs", majorOnly ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground")}>
          Major only
        </button>
      </div>
      {groups.length === 0 ? (
        <EmptyState title="Nothing in this window" description="Widen the horizon or show more event types." />
      ) : (
        groups.map(([key, items]) => {
          const day = dayFromKey(key);
          return (
            <section key={key} aria-label={key}>
              <div className="sticky top-12 z-[1] flex items-baseline gap-2 border-b border-hairline bg-surface/95 px-3.5 py-1.5 backdrop-blur">
                <span className="text-xs font-semibold">{groupByWeek ? `Week of ${formatDayLong(day)}` : `${relativeDay(day, today, false)} · ${formatDayLong(day)}`}</span>
                <span className="text-2xs text-muted-foreground tabular">{items.length}</span>
              </div>
              <ul className="divide-y divide-hairline">
                {items.map((e) => (
                  <UpcomingRow key={`${e.kind}-${e.id}`} event={e} timezone={timezone} showDate={groupByWeek} />
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
