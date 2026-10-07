"use client";

import { Check, Loader2, Moon, RefreshCcw, Sparkles } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { useAction } from "@/components/common/use-action";
import { cn } from "@/lib/utils";
import { formatTime, greeting, hourInTz } from "@/lib/dates";
import { runDailyRefresh } from "@/server/actions/brain";
import { EndOfDayDialog, type EodTask } from "./end-of-day";

export function Greeting({ name, timezone, dateLabel }: { name: string; timezone: string; dateLabel: string }) {
  // Greeting depends on the clock; computed on the client only to avoid hydration drift.
  const hello = useSyncExternalStore(
    noopSubscribe,
    () => greeting(hourInTz(new Date(), timezone)),
    () => null,
  );
  return (
    <div className="min-w-0">
      <h1 className="text-[24px] font-semibold tracking-tight text-foreground">
        <span className={cn("transition-opacity", hello ? "opacity-100" : "opacity-0")}>{hello ?? "Good morning"}</span>, {name}
      </h1>
      <p className="mt-0.5 text-[15px] text-muted-foreground">{dateLabel}</p>
    </div>
  );
}

const noopSubscribe = () => () => {};

/** `quiet`: secondary style, when something else on the page is the next step (the setup checklist). */
export function RefreshButton({ refreshedToday, quiet = false }: { refreshedToday: boolean; quiet?: boolean }) {
  const { pending, run } = useAction();
  return (
    <Button variant={refreshedToday || quiet ? "outline" : "default"} size="sm" disabled={pending} onClick={() => run(() => runDailyRefresh())}>
      {pending ? <Loader2 className="animate-spin" /> : <RefreshCcw />}
      {pending ? "Refreshing Brain…" : refreshedToday ? "Refresh Brain" : "Run morning refresh"}
    </Button>
  );
}

export function EndOfDayButton({ done, tasks, notes }: { done: boolean; tasks: EodTask[]; notes: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {done ? <Check className="text-good-ink" /> : <Moon />}
        {done ? "Day closed" : "End-of-day review"}
      </Button>
      <EndOfDayDialog open={open} onOpenChange={setOpen} tasks={tasks} notes={notes} />
    </>
  );
}

export function BrainStrip({
  lastRefreshAt,
  status,
  timezone,
  newInsights,
  needsYou,
  sources,
  headline,
  narrativeEngine,
  embedded = false,
}: {
  lastRefreshAt: Date | null;
  status: string | null;
  timezone: string;
  newInsights: number;
  needsYou: number;
  sources: { connected: number; total: number };
  headline: string | null;
  narrativeEngine?: string;
  /** Inside another panel: no frame of its own. */
  embedded?: boolean;
}) {
  const healthy = status === "SUCCEEDED" || status === "PARTIAL";
  return (
    <div className={cn("flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3", !embedded && "panel")}>
      <div className="flex items-center gap-2.5">
        <div className="flex size-8 items-center justify-center rounded-lg bg-brain-soft">
          <Sparkles className="size-4 text-brain" aria-hidden />
        </div>
        <div className="leading-tight">
          <div className="text-[15px] font-semibold">CytoHub Brain</div>
          <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
            <span className={cn("size-1.5 rounded-full", healthy ? "bg-good" : status ? "bg-critical" : "bg-ink-3")} aria-hidden />
            {status === "RUNNING" ? "Refreshing" : healthy ? "Healthy" : status ? "Refresh failed" : "Not run yet"}
            {lastRefreshAt && <> · refreshed {formatTime(lastRefreshAt, timezone)}</>}
          </div>
        </div>
      </div>
      <dl className="flex gap-5 text-[15px]">
        <div>
          <dt className="text-2xs text-muted-foreground">New insights</dt>
          <dd className="font-semibold tabular">{newInsights}</dd>
        </div>
        <div>
          <dt className="text-2xs text-muted-foreground">Need your attention</dt>
          <dd className={cn("font-semibold tabular", needsYou > 0 && "text-serious-ink")}>{needsYou}</dd>
        </div>
        <div>
          <dt className="text-2xs text-muted-foreground">Sources</dt>
          <dd className="font-semibold tabular">
            {sources.connected}
            <span className="font-normal text-muted-foreground">/{sources.total}</span>
          </dd>
        </div>
      </dl>
      {headline && (
        <p className="min-w-0 basis-full border-t border-hairline pt-3 text-[15px] leading-snug text-ink-2 xl:flex-1 xl:basis-0 xl:border-t-0 xl:border-l xl:pt-0 xl:pl-5">
          <span className="font-medium text-foreground">{headline}</span>
          {narrativeEngine === "claude" && <span className="ml-2 text-2xs text-brain">· Claude</span>}
        </p>
      )}
    </div>
  );
}
