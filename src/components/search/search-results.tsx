"use client";

import { ArrowUpRight, SearchX, Sparkles } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/common/bits";
import { useCan, useUI } from "@/components/shell/ui-context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SearchGroup, SearchResultType } from "@/server/ingestion/search/types";
import { HighlightParts, Highlight, RESULT_ICONS } from "./highlight";

export function SearchResults({ groups, terms, limitPerType }: { groups: SearchGroup[]; terms: string[]; limitPerType: number }) {
  const [filter, setFilter] = useState<SearchResultType | "all">("all");
  const total = useMemo(() => groups.reduce((n, g) => n + g.results.length, 0), [groups]);
  const visible = filter === "all" ? groups : groups.filter((g) => g.type === filter);

  if (total === 0) {
    return (
      <div className="panel">
        <EmptyState
          compact
          icon={SearchX}
          title="No matching records"
          description="CytoHub Brain searched the email threads, documents, meetings and records you can access. Try a company or person name, a shorter phrase, or one of the example questions."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groups.length > 1 && (
        <div role="group" aria-label="Filter results by type" className="flex flex-wrap items-center gap-1.5">
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")} label="All" count={total} />
          {groups.map((g) => (
            <FilterChip key={g.type} active={filter === g.type} onClick={() => setFilter(g.type)} label={g.label} count={g.results.length} />
          ))}
        </div>
      )}

      {visible.map((g) => {
        const Icon = RESULT_ICONS[g.type];
        return (
          <section key={g.type} className="panel" aria-labelledby={`group-${g.type}`}>
            <div className="flex h-10 items-center gap-2 border-b border-hairline px-3.5">
              <Icon className="size-3.5 text-ink-3" aria-hidden />
              <h2 id={`group-${g.type}`} className="text-[13.5px] font-semibold tracking-tight">
                {g.label}
              </h2>
              <span className="rounded bg-muted px-1.5 text-2xs font-medium text-muted-foreground tabular">{g.results.length}</span>
              {g.truncated && <span className="ml-auto truncate text-2xs text-muted-foreground">Top {limitPerType} — refine to narrow down</span>}
            </div>
            <ul className="divide-y divide-hairline">
              {g.results.map((r) => (
                <li key={`${r.type}-${r.id}`}>
                  <Link href={r.href} className="group flex items-start gap-3 px-3.5 py-2.5 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none">
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-[14px] font-medium text-foreground">
                          <Highlight text={r.title} query={terms} />
                        </span>
                        {r.badges?.map((b) => (
                          <span key={b} className={cn("shrink-0 rounded px-1.5 py-px text-2xs font-medium", badgeTone(b))}>
                            {b}
                          </span>
                        ))}
                      </span>
                      {r.subtitle && <span className="mt-0.5 block truncate text-2xs text-muted-foreground">{r.subtitle}</span>}
                      {r.snippet && r.snippet.length > 0 && (
                        <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-ink-2">
                          <HighlightParts parts={r.snippet} />
                        </span>
                      )}
                    </span>
                    <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function badgeTone(label: string): string {
  if (/overdue|awaiting your reply/i.test(label)) return "bg-serious-soft text-serious-ink";
  if (/significant|due today|waiting on them/i.test(label)) return "bg-warning-soft text-warning-ink";
  if (/fulfilled/i.test(label)) return "bg-good-soft text-good-ink";
  return "bg-muted text-ink-2";
}

/** Hands the question to the Chief of Staff (only for viewers who can use it). */
export function AskChiefButton({ query, variant = "outline" }: { query: string; variant?: "outline" | "default" }) {
  const { openChief } = useUI();
  const allowed = useCan("chief.use");
  if (!allowed) return null;
  return (
    <Button size="sm" variant={variant} onClick={() => openChief(query)}>
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
