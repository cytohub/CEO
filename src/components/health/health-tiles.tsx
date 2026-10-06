import { AlertTriangle, CalendarDays, FileText, Mail, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { StatusPill } from "@/components/common/status";
import { shortDuration } from "@/components/integrations/labels";
import type { SourceKind } from "@/generated/prisma/enums";
import { formatDateTime, timeAgo } from "@/lib/dates";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { HealthSnapshot } from "@/server/ingestion/health";

const KIND_ICON: Record<SourceKind, LucideIcon> = { EMAIL: Mail, CALENDAR: CalendarDays, DOCUMENTS: FileText };
const KIND_NOUN: Record<SourceKind, string> = { EMAIL: "email", CALENDAR: "calendar", DOCUMENTS: "document" };

/** Stat tile: label, value (proportional figures), hint. Status is never color-alone. */
function Tile({ label, value, hint, alert, className }: { label: string; value: React.ReactNode; hint?: React.ReactNode; alert?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("panel min-w-0 px-3.5 py-3", className)}>
      <div className="flex items-start justify-between gap-2">
        <dt className="text-2xs font-medium text-muted-foreground">{label}</dt>
        {alert}
      </div>
      <dd className="mt-1 text-lg font-semibold tracking-tight text-foreground">{value}</dd>
      {hint && <dd className="mt-0.5 text-2xs text-muted-foreground">{hint}</dd>}
    </div>
  );
}

export function SyncTiles({ snapshot, timezone }: { snapshot: HealthSnapshot; timezone: string }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-3">
      {snapshot.sync.map((k) => {
        const Icon = KIND_ICON[k.kind];
        const last = k.lastSuccess;
        return (
          <Tile
            key={k.kind}
            label={`Last ${KIND_NOUN[k.kind]} sync`}
            value={
              <span className="flex items-center gap-2">
                <Icon className="size-4 text-ink-3" aria-hidden />
                {last ? timeAgo(last.at, snapshot.now) : k.connections ? "Never" : "Not connected"}
              </span>
            }
            hint={last ? `${formatDateTime(last.at, timezone)} · ${last.connectionLabel}` : k.connections ? `${k.connections} connection${k.connections === 1 ? "" : "s"}, no successful run yet` : "Connect an account in Integrations"}
            alert={k.inError.length ? <StatusPill tone={k.inError.some((c) => c.status === "NEEDS_REAUTH") ? "serious" : "critical"} label={`${k.inError.length} in error`} /> : undefined}
          />
        );
      })}
    </dl>
  );
}

function age(from: Date | null, now: Date) {
  if (!from) return "—";
  return timeAgo(from, now).replace(" ago", "");
}

export function MetricTiles({ snapshot, timezone, reviewHref }: { snapshot: HealthSnapshot; timezone: string; reviewHref: string | null }) {
  const s = snapshot;
  const failures = s.failures.failedItems + s.failures.deadJobs;
  const top = s.pending.byType
    .map((t) => ({ t, n: t.queued + t.running + t.retrying }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 2);
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile label="Records processed · 24 h" value={formatNumber(s.processed.last24h)} hint={`7 d: ${formatNumber(s.processed.last7d)} · ${formatNumber(s.processed.skipped7d)} skipped as noise`} />
      <Tile
        label="Processing failures"
        value={formatNumber(failures)}
        hint={`${formatNumber(s.failures.failedItems)} failed item${s.failures.failedItems === 1 ? "" : "s"} · ${formatNumber(s.failures.deadJobs)} dead job${s.failures.deadJobs === 1 ? "" : "s"}`}
        alert={failures ? <AlertTriangle className="size-3.5 text-critical-ink" aria-label="Needs attention" /> : undefined}
      />
      <Tile
        label="Pending jobs"
        value={formatNumber(s.pending.total)}
        hint={top.length ? top.map(({ t, n }) => `${n} ${t.type.toLowerCase().replace(/_/g, " ")}`).join(" · ") : "Queue is empty"}
      />
      <Tile label="AI extraction errors · 24 h" value={formatNumber(s.extraction.errors24h)} hint={`7 d: ${formatNumber(s.extraction.errors7d)} · failed validation, dropped`} />
      <Tile
        label="Duplicates prevented · 7 d"
        value={formatNumber(s.duplicates.prevented7d)}
        hint={`24 h: ${formatNumber(s.duplicates.prevented24h)} · cross-provider: ${formatNumber(s.duplicates.crossProvider)}`}
      />
      <Tile
        label="Review queue"
        value={reviewHref ? <Link href={reviewHref} className="hover:underline">{formatNumber(s.review.pending)}</Link> : formatNumber(s.review.pending)}
        hint={s.review.oldestPendingAt ? `Oldest waiting ${age(s.review.oldestPendingAt, s.now)}` : "Nothing waiting"}
      />
      <Tile
        label="Ingested → processed"
        value={shortDuration(s.timing.avgLatencyMs)}
        hint={s.timing.p95LatencyMs != null ? `average · p95 ${shortDuration(s.timing.p95LatencyMs)} (7 d)` : "No items processed in 7 d"}
      />
      <Tile
        label="Brain last updated"
        value={s.brain.lastRefresh ? timeAgo(s.brain.lastRefresh.at, s.now) : "Never"}
        hint={
          s.brain.lastRefresh
            ? `Refresh ${s.brain.lastRefresh.status.toLowerCase()} ${formatDateTime(s.brain.lastRefresh.at, timezone)}${s.brain.lastProcessedAt ? ` · last item ${timeAgo(s.brain.lastProcessedAt, s.now)}` : ""}`
            : s.brain.lastProcessedAt
              ? `Last item processed ${timeAgo(s.brain.lastProcessedAt, s.now)}`
              : "No refresh yet"
        }
      />
    </dl>
  );
}
