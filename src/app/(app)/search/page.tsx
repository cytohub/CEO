import { Brain, Command, Lightbulb, Search, Target } from "lucide-react";
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { EmptyState, PageHeader, Panel } from "@/components/common/bits";
import { Kbd, StatusPill, TONE_TEXT } from "@/components/common/status";
import { AskChiefButton, SearchResults } from "@/components/search/search-results";
import { HIT_TYPES } from "@/components/search/highlight";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { timeAgo } from "@/lib/dates";
import { GOAL_STATUS, INSIGHT_TYPES } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { searchWorkspace } from "@/server/brain/search";
import { getCeoContext } from "@/server/context";
import { requirePage } from "@/server/security/session";

export const metadata: Metadata = { title: "Search" };

const LIMIT_PER_TYPE = 15;

export default async function SearchPage(props: { searchParams: Promise<{ q?: string | string[] }> }) {
  await requirePage("search.use", "/search");
  const sp = await props.searchParams;
  const raw = Array.isArray(sp.q) ? sp.q[0] : sp.q;
  const q = (raw ?? "").trim().slice(0, 200);
  const searching = q.length >= 2;
  const hits = searching ? await searchWorkspace(q, { limitPerType: LIMIT_PER_TYPE }) : [];

  return (
    <div className="mx-auto max-w-[1440px]">
      <PageHeader
        title="Search"
        description={
          searching ? (
            <>
              <span className="font-medium text-foreground tabular">{hits.length}</span> result{hits.length === 1 ? "" : "s"} for “{q}” across CytoHub Brain
            </>
          ) : (
            "Everything CytoHub Brain knows — tasks, goals, milestones, decisions, meetings, companies, people, resources and insights."
          )
        }
        actions={searching && hits.length > 0 ? <AskChiefButton query={q} /> : undefined}
      />

      <Form action="/search" role="search" className="mb-5 flex max-w-3xl items-center gap-2">
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
            placeholder="Search tasks, goals, companies, people…"
            aria-label="Search CytoHub Brain"
            className="h-10 w-full rounded-lg border border-input bg-surface pr-3 pl-9 text-[14px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 [&::-webkit-search-cancel-button]:appearance-none"
          />
        </div>
        <Button type="submit" className="h-10 px-4">
          Search
        </Button>
      </Form>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          {searching ? (
            <SearchResults hits={hits} query={q} limitPerType={LIMIT_PER_TYPE} />
          ) : q.length === 1 ? (
            <div className="panel">
              <EmptyState icon={Search} title="Keep typing" description="Search needs at least two characters." />
            </div>
          ) : (
            <Suggestions />
          )}
        </div>
        <aside className="min-w-0 space-y-4">
          <Tips />
        </aside>
      </div>
    </div>
  );
}

async function Suggestions() {
  const ceo = await getCeoContext();
  const [insights, goals, companies] = await Promise.all([
    db.brainInsight.findMany({
      where: { status: { not: "DISMISSED" } },
      orderBy: [{ createdAt: "desc" }, { importance: "desc" }],
      take: 7,
      select: { id: true, title: true, type: true, createdAt: true },
    }),
    db.goal.findMany({
      where: { type: { in: ["COMPANY", "ANNUAL"] }, status: { notIn: ["COMPLETED", "PAUSED"] } },
      orderBy: [{ type: "asc" }, { progress: "asc" }],
      take: 7,
      select: { id: true, title: true, status: true, progress: true },
    }),
    db.company.findMany({ orderBy: { lastActivityAt: { sort: "desc", nulls: "last" } }, take: 6, select: { name: true } }),
  ]);

  return (
    <div className="space-y-4">
      {companies.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-2xs font-medium text-muted-foreground">Try</span>
          {companies.map((c) => (
            <Link
              key={c.name}
              href={`/search?q=${encodeURIComponent(c.name)}`}
              className="inline-flex h-7 items-center rounded-full border border-border bg-surface px-2.5 text-xs text-ink-2 transition-colors hover:bg-muted hover:text-foreground"
            >
              {c.name}
            </Link>
          ))}
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
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
      </div>
    </div>
  );
}

function Tips() {
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
          <li className="flex items-start justify-between gap-3">
            <span>Ask the Chief of Staff for a synthesized answer</span>
            <span className="flex shrink-0 gap-0.5">
              <Kbd>⌘</Kbd>
              <Kbd>J</Kbd>
            </span>
          </li>
          <li className="flex items-start justify-between gap-3">
            <span>Go to Search</span>
            <span className="flex shrink-0 gap-0.5">
              <Kbd>G</Kbd>
              <Kbd>/</Kbd>
            </span>
          </li>
        </ul>
      </Panel>
      <Panel title="What’s searched" icon={Lightbulb}>
        <div className="space-y-2 px-3.5 py-3">
          <ul className="flex flex-wrap gap-1">
            {HIT_TYPES.map((t) => {
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
            Matches titles, descriptions, context and tags, case-insensitively. Up to {LIMIT_PER_TYPE} results per type, open work first.
          </p>
        </div>
      </Panel>
    </>
  );
}
