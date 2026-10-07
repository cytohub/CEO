import { Activity, AlertTriangle, BarChart3, CheckCircle2, Gauge, History, ListChecks, Lock, ServerCog, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader, Panel } from "@/components/common/bits";
import { StatusPill } from "@/components/common/status";
import { AutoRefresh } from "@/components/health/auto-refresh";
import { MetricTiles, SyncTiles } from "@/components/health/health-tiles";
import { JobsTable } from "@/components/health/jobs-table";
import { ProcessedChart } from "@/components/health/processed-chart";
import { RUN_STATUS, RUN_TRIGGER, shortDuration } from "@/components/integrations/labels";
import { Button } from "@/components/ui/button";
import { formatDateTime, timeAgo } from "@/lib/dates";
import { formatNumber } from "@/lib/format";
import { JOB_TYPES, SOURCE_ITEM_KINDS } from "@/lib/intelligence";
import { cn } from "@/lib/utils";
import { getHealthData } from "@/server/queries/health";
import { can, requirePage } from "@/server/security/session";

export const metadata: Metadata = { title: "Ingestion health" };

const STAGE_LABEL: Record<string, string> = {
  RAW: "Raw",
  NORMALIZED: "Normalized",
  PARSED: "Parsed",
  ENTITIES_EXTRACTED: "Entities extracted",
  ENTITIES_RESOLVED: "Entities resolved",
  RELATIONSHIPS_MAPPED: "Relationships mapped",
  INTELLIGENCE_EXTRACTED: "Intelligence extracted",
  WRITTEN: "Written",
};

const th = "px-2 py-2 font-medium";

export default async function IngestionHealthPage() {
  const viewer = await requirePage("health.view", "/brain/ingestion");
  const d = await getHealthData(viewer);
  const { snapshot: s, timezone: tz } = d;
  const now = s.now;

  return (
    <div className="mx-auto max-w-[1440px] space-y-4 pb-16">
      <PageHeader
        eyebrow="CytoHub Brain"
        title="Ingestion health"
        description="Is the Brain keeping up? Syncs, the processing pipeline, AI extraction and the review queue — with failing work you can retry."
        actions={<AutoRefresh />}
      />

      {d.reauth.length > 0 && (
        <div className="space-y-2" role="alert">
          {d.reauth.map((c) => (
            <div key={c.id} className={cn("flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border px-3.5 py-2.5 text-xs", c.status === "NEEDS_REAUTH" ? "border-serious/30 bg-serious-soft" : "border-critical/30 bg-critical-soft")}>
              <AlertTriangle className={cn("mt-0.5 size-4 shrink-0", c.status === "NEEDS_REAUTH" ? "text-serious-ink" : "text-critical-ink")} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground">
                  {c.providerLabel} · {c.label}: {c.status === "NEEDS_REAUTH" ? "access expired or was revoked — syncing has stopped." : "the last sync failed."}
                </p>
                {c.lastError && <p className="mt-0.5 font-mono text-[12px] break-words text-ink-2">{c.lastError}</p>}
              </div>
              {d.canManage ? (
                <Button size="sm" asChild>
                  <Link href={c.reconnectHref}>{c.status === "NEEDS_REAUTH" ? "Reconnect" : "Open integration"}</Link>
                </Button>
              ) : (
                <span className="text-2xs text-muted-foreground">Ask an admin to reconnect it.</span>
              )}
            </div>
          ))}
        </div>
      )}

      <SyncTiles snapshot={s} timezone={tz} />
      <MetricTiles snapshot={s} timezone={tz} reviewHref={can(viewer, "review.resolve") ? "/brain/review" : null} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="Items processed per day" icon={BarChart3} id="processed">
          <ProcessedChart series={s.daily} />
        </Panel>
        <Panel title="Pending jobs by type" icon={ListChecks} count={s.pending.total} id="pending">
          {s.pending.byType.length === 0 ? (
            <EmptyState compact icon={CheckCircle2} title="Queue is empty" description="Nothing is waiting to run." />
          ) : (
            <div className="relative overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[360px] text-[14px]">
                <caption className="sr-only">Pending jobs by type and state</caption>
                <thead>
                  <tr className="border-b border-hairline text-left text-2xs text-muted-foreground">
                    <th scope="col" className="px-3.5 py-2 font-medium">Job</th>
                    <th scope="col" className={cn(th, "text-right")}>Queued</th>
                    <th scope="col" className={cn(th, "text-right")}>Running</th>
                    <th scope="col" className="px-3.5 py-2 text-right font-medium">Retrying</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {s.pending.byType.map((p) => (
                    <tr key={p.type}>
                      <td className="px-3.5 py-1.5 text-ink-2">{JOB_TYPES[p.type].label}</td>
                      <td className="px-2 py-1.5 text-right tabular">{p.queued || <span className="text-muted-foreground">0</span>}</td>
                      <td className="px-2 py-1.5 text-right tabular">{p.running || <span className="text-muted-foreground">0</span>}</td>
                      <td className={cn("px-3.5 py-1.5 text-right tabular", p.retrying ? "font-medium text-warning-ink" : "text-muted-foreground")}>{p.retrying}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Processing time by stage · 7 d" icon={Gauge} id="timing">
        {s.timing.stages.length === 0 ? (
          <EmptyState compact icon={Gauge} title="No completed jobs in the last 7 days" />
        ) : (
          <div className="relative overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[480px] text-[14px]">
              <caption className="sr-only">Average and 95th percentile job duration per stage</caption>
              <thead>
                <tr className="border-b border-hairline text-left text-2xs text-muted-foreground">
                  <th scope="col" className="px-3.5 py-2 font-medium">Stage</th>
                  <th scope="col" className={cn(th, "text-right")}>Jobs</th>
                  <th scope="col" className={cn(th, "text-right")}>Average</th>
                  <th scope="col" className="px-3.5 py-2 text-right font-medium">p95</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {s.timing.stages.map((t) => (
                  <tr key={t.type}>
                    <td className="px-3.5 py-1.5 text-ink-2">{JOB_TYPES[t.type].label}</td>
                    <td className="px-2 py-1.5 text-right text-muted-foreground tabular">{formatNumber(t.count)}</td>
                    <td className="px-2 py-1.5 text-right tabular">{shortDuration(t.avgMs)}</td>
                    <td className="px-3.5 py-1.5 text-right tabular">{shortDuration(t.p95Ms)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border text-xs">
                  <th scope="row" className="px-3.5 py-2 text-left font-medium text-ink-2">
                    Ingested → processed (per item)
                  </th>
                  <td />
                  <td className="px-2 py-2 text-right font-medium tabular">{shortDuration(s.timing.avgLatencyMs)}</td>
                  <td className="px-3.5 py-2 text-right font-medium tabular">{shortDuration(s.timing.p95LatencyMs)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Failing jobs" icon={ServerCog} count={d.jobs.length} id="jobs">
        <JobsTable jobs={d.jobs} now={now} timezone={tz} canRetry={d.canManage} />
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Items with processing errors" icon={AlertTriangle} count={d.items.length} id="items">
          {d.items.length === 0 ? (
            <EmptyState compact icon={CheckCircle2} title="No processing errors" />
          ) : (
            <ul className="divide-y divide-hairline">
              {d.items.map((i) => (
                <li key={i.id} className="px-3.5 py-2">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={cn("flex min-w-0 items-center gap-1 truncate text-[14px]", i.restricted ? "text-muted-foreground italic" : "font-medium text-foreground")}>
                      {i.restricted && <Lock className="size-3 shrink-0" aria-hidden />}
                      <span className="truncate">{i.title}</span>
                    </span>
                    <StatusPill tone={i.status === "FAILED" ? "critical" : "warning"} label={i.status === "FAILED" ? "Failed" : "Retrying"} />
                  </div>
                  <p className="mt-0.5 text-2xs text-muted-foreground">
                    {SOURCE_ITEM_KINDS[i.kind].label} · {i.providerLabel} · stopped after {STAGE_LABEL[i.stage] ?? i.stage} · {i.attempts} attempt{i.attempts === 1 ? "" : "s"} ·{" "}
                    <span title={formatDateTime(i.updatedAt, tz)}>{timeAgo(i.updatedAt, now)}</span>
                  </p>
                  {i.error && <p className="mt-0.5 line-clamp-2 font-mono text-[12px] break-words text-critical-ink">{i.error}</p>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Recent AI extraction issues" icon={Sparkles} count={d.issues.length} id="issues">
          {d.issues.length === 0 ? (
            <EmptyState compact icon={CheckCircle2} title="No validation issues recorded" description="Facts whose evidence or dates fail validation are dropped and listed here." />
          ) : (
            <ul className="divide-y divide-hairline">
              {d.issues.map((i) => (
                <li key={i.id} className="px-3.5 py-2">
                  <div className={cn("flex min-w-0 items-center gap-1 truncate text-[14px]", i.restricted ? "text-muted-foreground italic" : "font-medium text-foreground")}>
                    {i.restricted && <Lock className="size-3 shrink-0" aria-hidden />}
                    <span className="truncate">{i.title}</span>
                  </div>
                  <p className="mt-0.5 text-2xs text-muted-foreground">
                    {i.issueCount} issue{i.issueCount === 1 ? "" : "s"}
                    {i.at ? ` · ${timeAgo(i.at, now)}` : ""}
                    {i.restricted ? " · details hidden (restricted source)" : ""}
                  </p>
                  {i.issues.map((x, n) => (
                    <p key={n} className="mt-0.5 line-clamp-2 text-2xs break-words text-ink-2">
                      <code className="font-mono text-[11.5px] text-muted-foreground">{x.path}</code> {x.reason}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Recent runs" icon={History} count={d.runs.length} id="runs" href={d.canManage ? "/settings/integrations" : undefined} hrefLabel="Integrations">
        {d.runs.length === 0 ? (
          <EmptyState compact icon={Activity} title="No sync runs yet" description="Runs appear after the first sync of a connected account." />
        ) : (
          <div className="relative overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[980px] text-xs">
              <caption className="sr-only">Recent sync runs across all connections</caption>
              <thead>
                <tr className="border-b border-hairline text-left text-2xs text-muted-foreground">
                  <th scope="col" className="px-3.5 py-2 font-medium">Connection</th>
                  <th scope="col" className={th}>Started</th>
                  <th scope="col" className={th}>Trigger</th>
                  <th scope="col" className={th}>Status</th>
                  <th scope="col" className={cn(th, "text-right")}>Fetched</th>
                  <th scope="col" className={cn(th, "text-right")}>New</th>
                  <th scope="col" className={cn(th, "text-right")}>Updated</th>
                  <th scope="col" className={cn(th, "text-right")}>Noise</th>
                  <th scope="col" className={cn(th, "text-right")} title="Duplicates prevented">
                    Dupes
                  </th>
                  <th scope="col" className={cn(th, "text-right")}>Written</th>
                  <th scope="col" className={cn(th, "text-right")}>Review</th>
                  <th scope="col" className={cn(th, "text-right")}>Duration</th>
                  <th scope="col" className="px-3.5 py-2 font-medium">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {d.runs.map((r) => {
                  const st = RUN_STATUS[r.status];
                  return (
                    <tr key={r.id} className="align-top">
                      <td className="max-w-[220px] px-3.5 py-1.5">
                        <div className="truncate text-ink-2">{r.connection ? r.connection.providerLabel : "Pipeline"}</div>
                        {r.connection && <div className="truncate text-2xs text-muted-foreground">{r.connection.label}</div>}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap text-ink-2" title={formatDateTime(r.startedAt, tz)}>
                        {timeAgo(r.startedAt, now)}
                      </td>
                      <td className="px-2 py-1.5 text-ink-2">{RUN_TRIGGER[r.trigger]}</td>
                      <td className="px-2 py-1.5">
                        <StatusPill tone={st.tone} label={st.label} />
                      </td>
                      <td className="px-2 py-1.5 text-right tabular">{formatNumber(r.fetched)}</td>
                      <td className="px-2 py-1.5 text-right tabular">{formatNumber(r.created)}</td>
                      <td className="px-2 py-1.5 text-right tabular">{formatNumber(r.updated)}</td>
                      <td className="px-2 py-1.5 text-right text-muted-foreground tabular">{formatNumber(r.noise)}</td>
                      <td className="px-2 py-1.5 text-right text-muted-foreground tabular">{formatNumber(r.duplicatesPrevented)}</td>
                      <td className="px-2 py-1.5 text-right tabular">{formatNumber(r.recordsWritten)}</td>
                      <td className="px-2 py-1.5 text-right tabular">{formatNumber(r.reviewItems)}</td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap text-muted-foreground tabular">{r.status === "RUNNING" ? "running" : shortDuration(r.durationMs)}</td>
                      <td className="max-w-[240px] px-3.5 py-1.5 text-critical-ink">
                        {r.error ? (
                          <span className="line-clamp-2 break-words" title={r.error}>
                            {r.error}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
