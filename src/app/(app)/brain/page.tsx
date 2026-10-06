import { ArrowRight, Brain, Check, CircleSlash, Database, FileText, Inbox, ListChecks, Plug, RefreshCcw, ScrollText, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { InsightFeed } from "@/components/brain/insight-feed";
import { EmptyState, PageHeader, Panel } from "@/components/common/bits";
import { StatusPill, TONE_TEXT } from "@/components/common/status";
import { RefreshButton } from "@/components/today/today-header";
import { cn } from "@/lib/utils";
import { formatDateTime, formatDayFull, timeAgo } from "@/lib/dates";
import { INSIGHT_TYPES } from "@/lib/domain";
import { BRIEF_SECTIONS, type SyncResult } from "@/server/brain/types";
import { getBrainOverview, getInsightFeed, getRecentSignals } from "@/server/queries/brain";
import { requirePage } from "@/server/security/session";

export const metadata: Metadata = { title: "CytoHub Brain" };

const TABS = [
  { key: "brief", label: "Daily Intelligence Brief", icon: FileText },
  { key: "insights", label: "Insights", icon: Sparkles },
  { key: "signals", label: "Ingested signals", icon: Database },
  { key: "log", label: "Refresh log", icon: ScrollText },
  { key: "sources", label: "Sources", icon: Plug },
] as const;
type Tab = (typeof TABS)[number]["key"];

export default async function BrainPage(props: { searchParams: Promise<{ tab?: string; insight?: string }> }) {
  await requirePage("brain.view", "/brain");
  const sp = await props.searchParams;
  const tab: Tab = sp.insight ? "insights" : ((TABS.find((t) => t.key === sp.tab)?.key ?? "brief") as Tab);
  const o = await getBrainOverview();
  const tz = o.ceo.timezone;
  const last = o.last;
  const connected = o.sources.filter((s) => s.status === "CONNECTED").length;

  const stages = [
    { label: "Ingest", detail: `${connected}/${o.sources.length} sources`, value: last?.signalsScanned ?? 0, unit: "signals", icon: Plug },
    { label: "Understand", detail: "Signals → structured facts", value: last?.insightsCreated ?? 0, unit: "new insights", icon: Brain },
    { label: "Prioritize", detail: "CEO Priority Score", value: last?.tasksUpdated ?? 0, unit: "tasks scored", icon: ListChecks },
    { label: "Act", detail: "Inbox, tasks, Top 5", value: (last?.inboxCreated ?? 0) + (last?.tasksCreated ?? 0), unit: "items filed", icon: Inbox },
    { label: "Brief", detail: "Daily Intelligence Brief", value: o.brief ? 1 : 0, unit: "brief", icon: FileText },
    { label: "Learn", detail: "History feeds tomorrow", value: o.refreshes.length, unit: "runs on record", icon: RefreshCcw },
  ];

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <PageHeader
        title="CytoHub Brain"
        description="The intelligence layer behind the command center. Every morning it ingests company signals, understands what changed, re-ranks priorities and briefs you."
        actions={<RefreshButton refreshedToday />}
      />

      <section className="panel p-4" aria-label="Brain status">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-brain-soft">
              <Sparkles className="size-5 text-brain" aria-hidden />
            </div>
            <div>
              <div className="flex items-center gap-2 text-[15px] font-semibold">
                Daily Brain Refresh
                {last && <StatusPill tone={last.status === "SUCCEEDED" ? "good" : last.status === "PARTIAL" ? "warning" : last.status === "RUNNING" ? "info" : "critical"} label={last.status.toLowerCase().replace(/^./, (c) => c.toUpperCase())} />}
              </div>
              <div className="text-xs text-muted-foreground">
                {last ? (
                  <>
                    Last run {formatDateTime(last.startedAt, tz)} ({timeAgo(last.startedAt)}) · {last.trigger.toLowerCase()} · {last.durationMs ? `${(last.durationMs / 1000).toFixed(1)}s` : "—"}
                  </>
                ) : (
                  "Never run"
                )}
              </div>
            </div>
          </div>
          <dl className="flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
            {[
              ["Signals processed", last?.signalsScanned],
              ["New insights", last?.insightsCreated],
              ["Commitments captured", last?.tasksCreated],
              ["Tasks rescored", last?.tasksUpdated],
              ["Milestones changed", last?.milestonesChanged],
              ["Inbox items filed", last?.inboxCreated],
            ].map(([label, v]) => (
              <div key={label as string}>
                <dt className="text-2xs text-muted-foreground">{label}</dt>
                <dd className="font-semibold tabular">{(v as number | undefined) ?? 0}</dd>
              </div>
            ))}
          </dl>
          {last?.error && <p className="w-full text-xs text-critical-ink">Error: {last.error}</p>}
        </div>

        <ol className="mt-4 grid grid-cols-2 gap-2 border-t border-hairline pt-4 sm:grid-cols-3 lg:grid-cols-6" aria-label="Brain pipeline">
          {stages.map((s, i) => (
            <li key={s.label} className="relative rounded-lg border border-border bg-surface-2/50 p-3">
              <div className="flex items-center gap-1.5 text-xs font-medium">
                <s.icon className="size-3.5 text-brain" aria-hidden />
                {i + 1}. {s.label}
              </div>
              <div className="mt-1.5 text-lg font-semibold tabular">{s.value}</div>
              <div className="text-2xs text-muted-foreground">{s.unit}</div>
              <div className="mt-1 text-2xs text-ink-3">{s.detail}</div>
              {i < stages.length - 1 && <ArrowRight className="absolute top-1/2 -right-[13px] z-[1] hidden size-3.5 -translate-y-1/2 text-ink-3 lg:block" aria-hidden />}
            </li>
          ))}
        </ol>
      </section>

      <nav aria-label="Brain sections" className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === "brief" ? "/brain" : `/brain?tab=${t.key}`}
            aria-current={t.key === tab ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors",
              t.key === tab ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon className="size-3.5" aria-hidden /> {t.label}
            {t.key === "insights" && o.insightCounts.NEW ? <span className="rounded bg-brand-soft px-1 text-2xs text-brand tabular">{o.insightCounts.NEW}</span> : null}
          </Link>
        ))}
      </nav>

      {tab === "brief" && <BriefTab brief={o.brief} timezone={tz} />}
      {tab === "insights" && (
        <Suspense fallback={<div className="panel h-96 animate-pulse" />}>
          <InsightsTab />
        </Suspense>
      )}
      {tab === "signals" && <SignalsTab />}
      {tab === "log" && <LogTab refreshes={o.refreshes} timezone={tz} />}
      {tab === "sources" && <SourcesTab sources={o.sources} timezone={tz} />}
    </div>
  );
}

function BriefTab({ brief, timezone }: { brief: Awaited<ReturnType<typeof getBrainOverview>>["brief"]; timezone: string }) {
  if (!brief) return <div className="panel"><EmptyState icon={FileText} title="No brief yet" description="Run the Daily Brain Refresh to generate today’s CEO Daily Intelligence Brief." /></div>;
  const p = brief.payload;
  const sections = BRIEF_SECTIONS.filter((s) => p.sections[s.key]?.length);
  return (
    <article className="panel overflow-hidden" aria-labelledby="brief-title">
      <header className="border-b border-hairline px-5 py-4">
        <div className="eyebrow">CEO Daily Intelligence Brief · {formatDayFull(brief.date)}</div>
        <h2 id="brief-title" className="mt-1.5 text-lg leading-snug font-semibold tracking-tight">
          {brief.headline}
        </h2>
        <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-ink-2">{brief.summary}</p>
        <p className="mt-2 text-2xs text-muted-foreground">
          Covers changes since {formatDateTime(new Date(p.since), timezone)} · {p.narrativeEngine === "claude" ? "Narrative by Claude" : "Narrative by Brain rules"} ·{" "}
          {brief.reviewedAt ? `Reviewed ${formatDateTime(brief.reviewedAt, timezone)}` : "Not yet reviewed"}
        </p>
      </header>
      <div className="grid md:grid-cols-2 md:divide-x md:divide-hairline">
        {[0, 1].map((col) => (
          <div key={col} className="divide-y divide-hairline">
            {sections
              .filter((_, i) => i % 2 === col)
              .map((s) => (
                <section key={s.key} className="px-5 py-3.5" aria-label={s.label}>
                  <h3 className="mb-2 text-2xs font-semibold tracking-wide text-ink-3 uppercase">{s.label}</h3>
                  <ul className="space-y-2">
                    {p.sections[s.key]!.map((item, idx) => (
                      <li key={idx} className="flex gap-2.5">
                        <span className={cn("mt-[7px] size-1.5 shrink-0 rounded-full", item.isNew === false ? "border border-ink-3" : "bg-brand")} aria-label={item.isNew === false ? "Still open" : "New"} />
                        <div className="min-w-0">
                          {item.href ? (
                            <Link href={item.href} className="text-[13px] leading-snug text-foreground hover:underline">
                              {item.title}
                            </Link>
                          ) : (
                            <span className="text-[13px] leading-snug">{item.title}</span>
                          )}
                          {item.detail && <p className="text-xs text-muted-foreground">{item.detail}</p>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
          </div>
        ))}
      </div>
      <footer className="flex flex-wrap gap-4 border-t border-hairline px-5 py-2.5 text-2xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-brand" aria-hidden /> New since last refresh
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full border border-ink-3" aria-hidden /> Still open
        </span>
      </footer>
    </article>
  );
}

async function InsightsTab() {
  const { insights, timezone } = await getInsightFeed();
  return <InsightFeed insights={insights} timezone={timezone} />;
}

async function SignalsTab() {
  const { signals, timezone } = await getRecentSignals();
  return (
    <Panel title="Ingested signals" icon={Database} count={signals.length}>
      <p className="border-b border-hairline px-4 py-2 text-2xs text-muted-foreground">
        Raw items normalized by connectors (email, calendar, CRM, documents, meeting notes). The Brain turns each into insights, inbox items or tasks.
      </p>
      <ul className="divide-y divide-hairline">
        {signals.map((s) => {
          const meta = s.metadata as { signalType?: string; summary?: string } | null;
          return (
            <li key={s.id} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[140px_1fr_auto] sm:gap-4">
              <div className="text-2xs text-muted-foreground">
                <div className="font-medium text-ink-2">{s.source.name}</div>
                <div>{formatDateTime(s.occurredAt, timezone)}</div>
              </div>
              <div className="min-w-0">
                <div className="text-[13px]">{s.title}</div>
                {(meta?.summary ?? s.body) && <p className="line-clamp-2 text-xs text-muted-foreground">{meta?.summary ?? s.body}</p>}
                <div className="mt-1 flex flex-wrap gap-x-3 text-2xs text-muted-foreground">
                  <span>{s.kind.replace("_", " ").toLowerCase()}</span>
                  {meta?.signalType && <span>classified: {meta.signalType.replace(/_/g, " ")}</span>}
                  {s.person && <span>{s.person.name}</span>}
                  {s.company && <span>{s.company.name}</span>}
                  {s.insights.map((i) => (
                    <Link key={i.id} href={`/brain?insight=${i.id}`} className={cn("hover:underline", TONE_TEXT[INSIGHT_TYPES[i.type].tone])}>
                      → {INSIGHT_TYPES[i.type].label}
                    </Link>
                  ))}
                </div>
              </div>
              <div className="text-2xs">
                {s.processedAt ? (
                  <span className="inline-flex items-center gap-1 text-good-ink">
                    <Check className="size-3" aria-hidden /> Processed
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <CircleSlash className="size-3" aria-hidden /> Pending
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function LogTab({ refreshes, timezone }: { refreshes: Awaited<ReturnType<typeof getBrainOverview>>["refreshes"]; timezone: string }) {
  return (
    <div className="space-y-3">
      {refreshes.map((r) => {
        const log = (r.log as { at: string; stage: string; message: string }[] | null) ?? [];
        const sources = (r.sourceResults as SyncResult[] | null) ?? [];
        return (
          <details key={r.id} className="panel group" open={r === refreshes[0]}>
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
              <StatusPill tone={r.status === "SUCCEEDED" ? "good" : r.status === "PARTIAL" ? "warning" : r.status === "RUNNING" ? "info" : "critical"} label={r.status.toLowerCase()} />
              <span className="text-[13px] font-medium">{formatDateTime(r.startedAt, timezone)}</span>
              <span className="text-xs text-muted-foreground">{r.trigger.toLowerCase()}</span>
              <span className="ml-auto text-2xs text-muted-foreground tabular">
                {r.signalsScanned} signals · {r.insightsCreated} insights · {r.inboxCreated} inbox · {r.tasksCreated} tasks · {r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : "—"}
              </span>
            </summary>
            <div className="grid gap-4 border-t border-hairline px-4 py-3 md:grid-cols-2">
              <div>
                <h3 className="eyebrow mb-2">Pipeline stages</h3>
                <ol className="space-y-1 font-mono text-2xs">
                  {log.map((l, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="w-20 shrink-0 text-brain">{l.stage}</span>
                      <span className="text-ink-2">{l.message}</span>
                    </li>
                  ))}
                  {log.length === 0 && <li className="text-muted-foreground">No log recorded.</li>}
                </ol>
                {r.error && <p className="mt-2 text-xs text-critical-ink">{r.error}</p>}
              </div>
              <div>
                <h3 className="eyebrow mb-2">Sources</h3>
                <ul className="space-y-1 text-2xs">
                  {sources.map((s) => (
                    <li key={s.key} className="flex gap-2">
                      <span className={cn("w-14 shrink-0 font-medium", s.status === "ok" ? "text-good-ink" : s.status === "error" ? "text-critical-ink" : "text-muted-foreground")}>{s.status}</span>
                      <span className="w-32 shrink-0 text-ink-2">{s.key}</span>
                      <span className="text-muted-foreground">{s.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </details>
        );
      })}
    </div>
  );
}

function SourcesTab({ sources, timezone }: { sources: Awaited<ReturnType<typeof getBrainOverview>>["sources"]; timezone: string }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {sources.map((s) => (
        <section key={s.key} className="panel flex flex-col p-4" aria-label={s.name}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-[13px] font-semibold">{s.name}</h3>
              <p className="text-2xs text-muted-foreground">
                {s.provider} · {s.category.toLowerCase()}
              </p>
            </div>
            <StatusPill tone={s.status === "CONNECTED" ? (s.sample ? "info" : "good") : s.status === "ERROR" ? "critical" : "neutral"} label={s.status === "CONNECTED" ? (s.sample ? "Sample data" : "Connected") : s.status === "DISABLED" ? "Disabled" : "Not connected"} />
          </div>
          <p className="mt-2 text-xs text-ink-2">{s.description}</p>
          <ul className="mt-2 flex flex-wrap gap-1">
            {s.extracts.map((e) => (
              <li key={e} className="rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">
                {e}
              </li>
            ))}
          </ul>
          <div className="mt-auto pt-3 text-2xs text-muted-foreground">
            {s.status === "CONNECTED" ? (
              <>
                {s.key === "workspace" ? "Analyzed live on every refresh" : `${s.itemsIndexed.toLocaleString()} items indexed · ${s.signals} signals`}
                {s.lastSyncAt && <> · synced {formatDateTime(s.lastSyncAt, timezone)}</>}
              </>
            ) : s.env.length ? (
              <>
                Connect by setting <code className="rounded bg-muted px-1 font-mono">{s.env.join(", ")}</code>
              </>
            ) : (
              "Not connected"
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
