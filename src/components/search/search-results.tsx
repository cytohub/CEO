"use client";

import { ArrowUpRight, SearchX, Sparkles } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/bits";
import { useUI } from "@/components/shell/ui-context";
import { cn } from "@/lib/utils";
import type { SearchHit, SearchHitType } from "@/server/brain/search";
import { HIT_TYPES, Highlight } from "./highlight";

export function SearchResults({ hits, query, limitPerType }: { hits: SearchHit[]; query: string; limitPerType: number }) {
  const { openChief } = useUI();
  const [filter, setFilter] = useState<SearchHitType | "all">("all");

  const groups = useMemo(
    () => HIT_TYPES.map((t) => ({ ...t, hits: hits.filter((h) => h.type === t.type) })).filter((g) => g.hits.length > 0),
    [hits],
  );
  const visible = filter === "all" ? groups : groups.filter((g) => g.type === filter);
  const askChief = () => openChief(`Show me everything related to ${query}`);

  if (hits.length === 0) {
    return (
      <div className="panel">
        <EmptyState
          icon={SearchX}
          title={`No results for “${query}”`}
          description="CytoHub Brain searched tasks, goals, milestones, decisions, meetings, companies, people, resources and insights. Try a shorter term, a company or person name, or ask the Chief of Staff to reason across everything."
          action={
            <Button size="sm" variant="outline" onClick={askChief}>
              <Sparkles className="text-brain" /> Ask the Chief of Staff
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Filter results by type" className="flex flex-wrap items-center gap-1.5">
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")} label="All" count={hits.length} />
          {groups.map((g) => (
            <FilterChip key={g.type} active={filter === g.type} onClick={() => setFilter(g.type)} label={g.plural} count={g.hits.length} />
          ))}
        </div>
      </div>

      {visible.map((g) => {
        const Icon = g.icon;
        return (
          <section key={g.type} className="panel" aria-labelledby={`group-${g.type}`}>
            <div className="flex h-10 items-center gap-2 border-b border-hairline px-3.5">
              <Icon className="size-3.5 text-ink-3" aria-hidden />
              <h2 id={`group-${g.type}`} className="text-[12.5px] font-semibold tracking-tight">
                {g.plural}
              </h2>
              <span className="rounded bg-muted px-1.5 text-2xs font-medium text-muted-foreground tabular">{g.hits.length}</span>
              {g.hits.length >= limitPerType && <span className="ml-auto text-2xs text-muted-foreground">Top {limitPerType} — refine to narrow down</span>}
            </div>
            <ul className="divide-y divide-hairline">
              {g.hits.map((h) => {
                const inTitle = h.title.toLowerCase().includes(query.trim().toLowerCase());
                return (
                  <li key={`${h.type}-${h.id}`}>
                    <Link href={h.href} className="group flex items-center gap-3 px-3.5 py-2 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-foreground">
                          <Highlight text={h.title} query={query} />
                        </span>
                        {(h.subtitle || !inTitle) && (
                          <span className="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
                            {h.subtitle && (
                              <span className="truncate">
                                <Highlight text={h.subtitle} query={query} />
                              </span>
                            )}
                            {!inTitle && (
                              <>
                                {h.subtitle && <span aria-hidden>·</span>}
                                <span className="shrink-0 rounded bg-muted px-1 text-ink-3">matched in details</span>
                              </>
                            )}
                          </span>
                        )}
                      </span>
                      <span className="hidden shrink-0 text-2xs text-muted-foreground sm:inline">{g.label}</span>
                      <ArrowUpRight className="size-3.5 shrink-0 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** Hands the query to the Chief of Staff for a synthesized answer. */
export function AskChiefButton({ query }: { query: string }) {
  const { openChief } = useUI();
  return (
    <Button size="sm" variant="outline" onClick={() => openChief(`Show me everything related to ${query}`)}>
      <Sparkles className="text-brain" /> Ask Chief of Staff
    </Button>
  );
}

function FilterChip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        active ? "border-foreground bg-foreground text-background" : "border-border bg-surface text-ink-2 hover:bg-muted hover:text-foreground",
      )}
    >
      {label}
      <span className={cn("tabular", active ? "text-background/70" : "text-muted-foreground")}>{count}</span>
    </button>
  );
}
