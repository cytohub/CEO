"use client";

import { CalendarRange, Flag, Gavel, Handshake, ListChecks, Sparkles, UserPlus, Video } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState, Panel } from "@/components/common/bits";
import { useUI } from "@/components/shell/ui-context";
import { cn } from "@/lib/utils";
import { addDays, dayFromKey, dayKeyInTz, dayStartInstant, formatDayLong, formatTime, relativeDay, toDay } from "@/lib/dates";
import type { UpcomingEvent, UpcomingKind } from "@/server/queries/today";

const KIND_ICON: Record<UpcomingKind, typeof Video> = {
  meeting: Video,
  milestone: Flag,
  decision: Gavel,
  task: ListChecks,
  delegation: UserPlus,
  deal: Handshake,
};

export function UpcomingPanel({ events, today, timezone }: { events: UpcomingEvent[]; today: Date; timezone: string }) {
  const [horizon, setHorizon] = useState<"24h" | "7d">("24h");
  const cutoff = horizon === "24h" ? dayStartInstant(addDays(today, 2), timezone).getTime() : Infinity;
  const visible = events.filter((e) => (e.allDay ? dayStartInstant(e.at, timezone).getTime() : e.at.getTime()) < cutoff && (horizon === "7d" || e.importance >= 2));

  // Group by local calendar day.
  const groups = new Map<string, UpcomingEvent[]>();
  for (const e of visible) {
    const key = e.allDay ? e.at.toISOString().slice(0, 10) : dayKeyInTz(e.at, timezone);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }

  return (
    <Panel
      id="upcoming"
      title="Upcoming"
      icon={CalendarRange}
      href="/upcoming"
      actions={
        <div className="flex rounded-md border border-border p-0.5" role="tablist" aria-label="Horizon">
          {(["24h", "7d"] as const).map((h) => (
            <button
              key={h}
              role="tab"
              aria-selected={horizon === h}
              onClick={() => setHorizon(h)}
              className={cn("rounded px-1.5 py-0.5 text-2xs font-medium", horizon === h ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {h === "24h" ? "Next 24h" : "7 days"}
            </button>
          ))}
        </div>
      }
    >
      {visible.length === 0 ? (
        <EmptyState compact title="Nothing scheduled" />
      ) : (
        <div className="max-h-[420px] overflow-y-auto scrollbar-thin">
          {[...groups.entries()].map(([key, items]) => {
            const day = dayFromKey(key);
            return (
              <div key={key}>
                <div className="sticky top-0 z-[1] border-b border-hairline bg-surface/95 px-3.5 py-1 text-2xs font-semibold text-ink-3 backdrop-blur">
                  {relativeDay(day, today, false)} · {formatDayLong(day)}
                </div>
                <ul className="divide-y divide-hairline">
                  {items.map((e) => (
                    <UpcomingRow key={`${e.kind}-${e.id}`} event={e} timezone={timezone} />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

export function UpcomingRow({ event: e, timezone, showDate }: { event: UpcomingEvent; timezone: string; showDate?: boolean }) {
  const { openEntity } = useUI();
  const Icon = KIND_ICON[e.kind];
  const open = () => {
    if (e.kind === "meeting") openEntity("meeting", e.id);
    else if (e.href.startsWith("?task=")) openEntity("task", e.href.slice(6));
    else if (e.href.startsWith("/milestones?milestone=")) openEntity("milestone", e.id);
    else window.location.assign(e.href);
  };
  return (
    <li className="group flex items-start gap-2.5 px-3.5 py-2">
      <span className={cn("mt-0.5 shrink-0 text-2xs text-muted-foreground tabular", showDate ? "w-20" : "w-12")}>
        {showDate && <span className="block font-medium text-ink-2">{e.allDay ? formatDayLong(e.at) : formatDayLong(toDay(e.at, timezone))}</span>}
        {e.allDay ? "Due" : formatTime(e.at, timezone)}
      </span>
      <Icon className={cn("mt-0.5 size-3.5 shrink-0", e.importance >= 5 ? "text-foreground" : "text-ink-3")} aria-hidden />
      <button type="button" onClick={open} className="min-w-0 flex-1 text-left">
        <span className={cn("block truncate text-[14px]", e.importance >= 4 ? "font-medium text-foreground" : "text-ink-2")}>{e.title}</span>
        {e.subtitle && <span className="block truncate text-2xs text-muted-foreground">{e.subtitle}</span>}
      </button>
      {e.prepareable && (
        <Button variant={e.prepared ? "ghost" : "outline"} size="xs" onClick={() => openEntity("meeting", e.id)} className="shrink-0">
          <Sparkles className="text-brain" /> {e.prepared ? "Brief" : "Prepare me"}
        </Button>
      )}
    </li>
  );
}
