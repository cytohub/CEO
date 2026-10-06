import { AlertTriangle, Brain, Command, Lightbulb, Search, Target } from "lucide-react";
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { EmptyState, PageHeader, Panel } from "@/components/common/bits";
import { Kbd, StatusPill, TONE_TEXT } from "@/components/common/status";
import { AnswerCard } from "@/components/search/answer-card";
import { HIT_TYPES } from "@/components/search/highlight";
import { SearchResults } from "@/components/search/search-results";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { timeAgo } from "@/lib/dates";
import { GOAL_STATUS, INSIGHT_TYPES } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { getCeoContext } from "@/server/context";
import { searchForViewer } from "@/server/ingestion/search";
import { insightAccessWhere } from "@/server/ingestion/search/visibility";
import { getAccessScope } from "@/server/security/access";
import { isSourceType, TIME_PRESETS, type TimePreset } from "@/server/ingestion/search/types";
import { can, requirePage, type Viewer } from "@/server/security/session";

export const metadata: Metadata = { title: "Search" };

const LIMIT_PER_TYPE = 10;

const WHEN_LABELS: { value: TimePreset | null; label: string }[] = [
  { value: null, label: "Any time" },
  { value: "7d", label: "Past 7 days" },
  { value: "30d", label: "Past 30 days" },
  { value: "90d", label: "Past 90 days" },
  { value: "next7d", label: "Next 7 days" },
  { value: "next30d", label: "Next 30 days" },
];

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function SearchPage(props: { searchParams: Promise<{ q?: string | string[]; when?: string | string[] }> }) {
  const viewer = await requirePage("search.use", "/search");
  const sp = await props.searchParams;
  const q = first(sp.q).replace(/\s+/g, " ").trim().slice(0, 200);
  const whenRaw = first(sp.when);
  const when = (TIME_PRESETS as readonly string[]).includes(whenRaw) ? (whenRaw as TimePreset) : null;
  const searching = q.length >= 2;
  const [outcome, examples] = await Promise.all([
    searching ? searchForViewer(viewer, q, { source: "page", limitPerType: LIMIT_PER_TYPE, synthesize: true, claudePlanner: true, when }) : null,
    examplePrompts(viewer),
  ]);
  const response = outcome?.ok ? outcome.response : null;

  return (
    <div className="mx-auto max-w-[1440px]">
      <PageHeader
        title="Search"
        description={
          response ? (
            <>
              <span className="font-medium text-foreground tabular">{response.total}</span> result{response.total === 1 ? "" : "s"} for “{q}”
              {response.durationMs ? <span className="text-muted-foreground"> · {response.durationMs} ms</span> : null}
            </>
          ) : (
            "Ask a question or search everything CytoHub Brain knows — email threads, documents, meetings and notes you can access, plus commitments, tasks, goals and decisions."
          )
        }
      />

      <Form action="/search" role="search" className="mb-3 flex max-w-3xl items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <input
            key={q}
            type="search"
            name="q"
            defaultValue={q}
            autoFocus
            autoComplete="off"
            maxLength={200}
            placeholder="Ask a question — “What did we promise Karen?” — or search…"
            aria-label="Search or ask CytoHub Brain"
            className="h-10 w-full rounded-lg border border-input bg-surface pr-3 pl-9 text-[14px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 [&::-webkit-search-cancel-button]:appearance-none"
          />
        </div>
        {when && <input type="hidden" name="when" value={when} />}
        <Button type="submit" className="h-10 px-4">
          Search
        </Button>
      </Form>

      <nav aria-label="Example questions" className="mb-5 flex max-w-full flex-wrap items-center gap-1.5">
        <span className="mr-1 text-2xs font-medium text-muted-foreground">Try</span>
        {examples.map((e) => (
          <Link
            key={e}
            href={`/search?q=${encodeURIComponent(e)}`}
            aria-current={e === q ? "true" : undefined}
            className={cn(
              "inline-flex min-h-7 max-w-full items-center rounded-full border px-2.5 py-0.5 text-xs transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
              e === q ? "border-foreground bg-foreground text-background" : "border-border bg-surface text-ink-2 hover:bg-muted hover:text-foreground",
            )}
          >
            <span className="truncate">{e}</span>
          </Link>
        ))}
      </nav>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          {outcome && !outcome.ok ? (
            <div className="panel">
              <EmptyState icon={AlertTriangle} title="Search unavailable" description={outcome.error} />
            </div>
          ) : response ? (
            <>
              <AnswerCard response={response} />
              <nav aria-label="Time range" className="flex flex-wrap items-center gap-1.5">
                {WHEN_LABELS.map((w) => {
                  const active = w.value === when;
                  const href = `/search?q=${encodeURIComponent(q)}${w.value ? `&when=${w.value}` : ""}`;
                  return (
                    <Link
                      key={w.label}
                      href={href}
                      aria-current={active ? "true" : undefined}
                      className={cn(
                        "inline-flex h-7 items-center rounded-md px-2 text-xs transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                        active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                      )}
                    >
                      {w.label}
                    </Link>
                  );
                })}
                {response.plan.timeRange && !when && <span className="text-2xs text-muted-foreground">· question asks for {response.plan.timeRange.label.toLowerCase()}</span>}
              </nav>
              <SearchResults key={`${q}|${when ?? ""}`} groups={response.groups} terms={response.plan.terms} limitPerType={LIMIT_PER_TYPE} />
            </>
          ) : q.length === 1 ? (
            <div className="panel">
              <EmptyState icon={Search} title="Keep typing" description="Search needs at least two characters." />
            </div>
          ) : (
            <Suggestions viewer={viewer} />
          )}
        </div>
        <aside className="min-w-0 space-y-4">
          <Tips viewer={viewer} />
        </aside>
      </div>
    </div>
  );
}

/** The eight example questions, with names taken from the workspace when the viewer may see them. */
async function examplePrompts(viewer: Viewer): Promise<string[]> {
  const generic = ["What commitments have I made to investors?", "What is happening with the Series B?", "What deadlines do we have next week?", "Which customers are waiting on CytoHub?", "Show investor conversations from the last 30 days"];
  if (!can(viewer, "workspace.view")) return ["Show investor conversations from the last 30 days", "What deadlines do we have next week?", "Which customers are waiting on CytoHub?"];
  const [customer, investor, promised] = await Promise.all([
    db.company.findFirst({ where: { type: { in: ["CUSTOMER", "PROSPECT"] } }, orderBy: { lastActivityAt: { sort: "desc", nulls: "last" } }, select: { name: true } }),
    db.company.findFirst({ where: { type: "INVESTOR" }, orderBy: { lastActivityAt: { sort: "desc", nulls: "last" } }, select: { name: true } }),
    db.commitment.findFirst({
      where: { direction: "OUTBOUND", status: "OPEN", counterparty: { isCeo: false } },
      orderBy: { dueDate: { sort: "asc", nulls: "last" } },
      select: { counterparty: { select: { name: true } } },
    }),
  ]);
  const firstName = promised?.counterparty?.name.replace(/^(dr|prof)\.?\s+/i, "").split(/\s+/)[0];
  return [
    `What have we discussed with ${customer?.name ?? "Calder Biosciences"}?`,
    `Show everything related to ${investor?.name ?? "Northbridge Ventures"}`,
    generic[0],
    generic[1],
    generic[2],
    generic[3],
    `What did we promise ${firstName ?? "Karen"}?`,
    generic[4],
  ];
}

async function Suggestions({ viewer }: { viewer: Viewer }) {
  const canInsights = can(viewer, "brain.view");
  const canGoals = can(viewer, "workspace.view");
  if (!canInsights && !canGoals) {
    return (
      <div className="panel">
        <EmptyState icon={Search} title="Search the sources shared with you" description="Ask a question or type a keyword. Results include email threads, documents, meetings and notes your role can access." />
      </div>
    );
  }
  const ceo = await getCeoContext();
  const [insights, goals] = await Promise.all([
    canInsights
      ? db.brainInsight.findMany({
          where: { AND: [{ status: { not: "DISMISSED" } }, insightAccessWhere(await getAccessScope(viewer))] },
          orderBy: [{ createdAt: "desc" }, { importance: "desc" }],
          take: 7,
          select: { id: true, title: true, type: true, createdAt: true },
        })
      : [],
    canGoals
      ? db.goal.findMany({
          where: { type: { in: ["COMPANY", "ANNUAL"] }, status: { notIn: ["COMPLETED", "PAUSED"] } },
          orderBy: [{ type: "asc" }, { progress: "asc" }],
          take: 7,
          select: { id: true, title: true, status: true, progress: true },
        })
      : [],
  ]);

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {canInsights && (
        <Panel id="recent-insights" title="Recent Brain insights" icon={Brain} href="/brain" hrefLabel="Brain">
          {insights.length === 0 ? (
            <EmptyState compact title="No insights yet" description="Run a Brain refresh from Today." />
          ) : (
            <ul className="divide-y divide-hairline">
              {insights.map((i) => {
                const meta = INSIGHT_TYPES[i.type];
                const Icon = meta.icon;
                return (
                  <li key={i.id}>
                    <Link href={`/brain?insight=${i.id}`} className="flex items-start gap-2.5 px-3.5 py-2 hover:bg-muted/50">
                      <Icon className={cn("mt-0.5 size-3.5 shrink-0", TONE_TEXT[meta.tone])} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-foreground">{i.title}</span>
                        <span className="block text-2xs text-muted-foreground">
                          {meta.label} · {timeAgo(i.createdAt, ceo.now)}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}
      {canGoals && (
        <Panel id="top-goals" title="Company & annual goals" icon={Target} href="/goals" hrefLabel="Goals">
          {goals.length === 0 ? (
            <EmptyState compact title="No active goals" />
          ) : (
            <ul className="divide-y divide-hairline">
              {goals.map((g) => {
                const status = GOAL_STATUS[g.status];
                return (
                  <li key={g.id}>
                    <Link href={`/goals/${g.id}`} className="flex items-center gap-3 px-3.5 py-2 hover:bg-muted/50">
                      <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{g.title}</span>
                      <StatusPill tone={status.tone} label={status.label} />
                      <span className="w-9 shrink-0 text-right text-xs font-medium tabular">{g.progress}%</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}
    </div>
  );
}

function Tips({ viewer }: { viewer: Viewer }) {
  const types = HIT_TYPES.filter((t) => isSourceType(t.type) || (t.type === "insight" ? can(viewer, "brain.view") : can(viewer, "workspace.view"))).filter((t) => t.type !== "source");
  return (
    <>
      <Panel title="Search faster" icon={Command}>
        <ul className="space-y-2.5 px-3.5 py-3 text-xs text-ink-2">
          <li className="flex items-start justify-between gap-3">
            <span>Instant search and commands from anywhere</span>
            <span className="flex shrink-0 gap-0.5">
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </span>
          </li>
          <li className="flex items-start justify-between gap-3">
            <span>Open the command bar</span>
            <Kbd>/</Kbd>
          </li>
          {can(viewer, "chief.use") && (
            <li className="flex items-start justify-between gap-3">
              <span>Ask the Chief of Staff for a deeper answer</span>
              <span className="flex shrink-0 gap-0.5">
                <Kbd>⌘</Kbd>
                <Kbd>J</Kbd>
              </span>
            </li>
          )}
        </ul>
      </Panel>
      <Panel title="What’s searched" icon={Lightbulb}>
        <div className="space-y-2 px-3.5 py-3">
          <ul className="flex flex-wrap gap-1">
            {types.map((t) => {
              const Icon = t.icon;
              return (
                <li key={t.type} className="inline-flex items-center gap-1 rounded border border-border bg-surface-2 px-1.5 py-0.5 text-2xs text-ink-2">
                  <Icon className="size-3 text-ink-3" aria-hidden />
                  {t.plural}
                </li>
              );
            })}
          </ul>
          <p className="text-2xs text-muted-foreground">
            Questions are interpreted (people, companies and their subsidiaries, dates, commitments in either direction) and answered from results you are allowed to see. Full-text search covers email,
            documents, calendar events and meeting notes.
          </p>
        </div>
      </Panel>
    </>
  );
}
