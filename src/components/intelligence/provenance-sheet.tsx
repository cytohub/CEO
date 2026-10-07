"use client";

import { ArrowRight, ExternalLink, FileSearch, Trash2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/bits";
import { useUI } from "@/components/shell/ui-context";
import { EntityType } from "@/generated/prisma/enums";
import { formatDateTime, timeAgo } from "@/lib/dates";
import { fetchProvenance } from "@/server/actions/provenance";
import type { Provenance, ProvenanceRef } from "@/server/queries/provenance";
import { ConfidenceBadge, Excerpt, HiddenSourcesNote, providerLabel, REFERENCE_ROLE, SourceKindIcon } from "./badges";
import { safeHttpUrl } from "./model";

const TARGET_LABEL: Partial<Record<EntityType, string>> = {
  TASK: "task",
  COMMITMENT: "commitment",
  DECISION: "decision",
  RISK: "risk",
  OPPORTUNITY: "opportunity",
  INSIGHT: "insight",
  INBOX_ITEM: "inbox item",
  MEETING: "meeting",
  GOAL: "goal",
  MILESTONE: "milestone",
  DOCUMENT: "document",
  SOURCE_ITEM: "item",
};

function parseTarget(raw: string | null): { type: EntityType; id: string } | null {
  if (!raw) return null;
  const i = raw.indexOf(":");
  const type = raw.slice(0, i) as EntityType;
  const id = raw.slice(i + 1);
  return i > 0 && id && type in EntityType ? { type, id } : null;
}

/** Right-side "View Source" sheet, driven by `?provenance=TYPE:id`. Mounted once in the app shell. */
export function ProvenanceSheet() {
  const params = useSearchParams();
  const { closeEntity, lookups } = useUI();
  const raw = params.get("provenance");
  const target = parseTarget(raw);
  const [state, setState] = useState<{ key: string; data: Provenance | null; failed?: boolean } | null>(null);
  const current = state && state.key === raw ? state : null;

  useEffect(() => {
    const t = parseTarget(raw);
    if (!raw || !t) return;
    let cancelled = false;
    fetchProvenance(t.type, t.id)
      .then((data) => !cancelled && setState({ key: raw, data }))
      .catch(() => !cancelled && setState({ key: raw, data: null, failed: true }));
    return () => {
      cancelled = true;
    };
  }, [raw]);

  const noun = target ? (TARGET_LABEL[target.type] ?? "record") : "record";
  const data = current?.data;

  return (
    <Sheet open={Boolean(raw)} onOpenChange={(o) => !o && closeEntity("provenance")}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[520px]">
        <SheetHeader className="gap-1 border-b border-border p-5 pr-12">
          <div className="flex items-center gap-1.5 text-xs font-medium text-brain">
            <FileSearch className="size-3.5" aria-hidden /> View source
          </div>
          <SheetTitle className="text-lg leading-snug">Where this {noun} came from</SheetTitle>
          <SheetDescription className="text-xs">
            {!current
              ? "Loading sources…"
              : data
                ? data.refs.length === 0 && data.hidden > 0
                  ? "Every source of this record is above your access level."
                  : `${data.refs.length} source${data.refs.length === 1 ? "" : "s"} · every record CytoHub Brain writes points back to what produced it.`
                : "Sources unavailable."}
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-3 p-5">
          {!target ? (
            <EmptyState compact icon={FileSearch} title="Nothing to show" description="This link doesn’t point at a record." />
          ) : !current ? (
            <div className="space-y-3" aria-busy aria-label="Loading sources">
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : !data ? (
            <EmptyState compact icon={FileSearch} title={current.failed ? "Couldn’t load sources" : "No sources"} description={current.failed ? "Try again in a moment." : undefined} />
          ) : (
            <>
              {data.refs.length === 0 && data.hidden === 0 && (
                <EmptyState compact icon={FileSearch} title="No source recorded" description="This record was created by hand or before source tracking." />
              )}
              <ul className="space-y-3">
                {data.refs.map((r) => (
                  <SourceCard key={r.id} r={r} timezone={lookups.timezone} />
                ))}
              </ul>
              <HiddenSourcesNote count={data.hidden} className="pt-1" />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SourceCard({ r, timezone }: { r: ProvenanceRef; timezone: string }) {
  const url = safeHttpUrl(r.url);
  return (
    <li className="rounded-lg border border-border bg-surface p-3.5">
      <div className="flex items-center gap-2 text-2xs text-muted-foreground">
        <SourceKindIcon kind={r.kind} />
        <span className="shrink-0 font-medium whitespace-nowrap text-ink-2">{providerLabel(r.provider)}</span>
        {r.author && <span className="min-w-0 truncate">· {r.author}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {r.confidence != null && <ConfidenceBadge score={r.confidence} compact />}
          <span className="rounded bg-muted px-1.5 py-0.5 font-medium">{REFERENCE_ROLE[r.role]}</span>
        </span>
      </div>
      <p className="mt-1.5 text-[15px] leading-snug font-medium text-foreground">{r.title}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
        <time dateTime={new Date(r.occurredAt).toISOString()}>{formatDateTime(new Date(r.occurredAt), timezone)}</time>
        <span>·</span>
        <span>ingested {timeAgo(new Date(r.ingestedAt))}</span>
        {r.connectionLabel && (
          <>
            <span>·</span>
            <span className="truncate">{r.connectionLabel}</span>
          </>
        )}
      </div>
      {r.excerpt && <Excerpt className="mt-2.5">“{r.excerpt}”</Excerpt>}
      {(r.purged || r.deleted) && (
        <p className="mt-2 flex items-center gap-1.5 rounded-md bg-muted px-2 py-1.5 text-2xs text-muted-foreground">
          <Trash2 className="size-3" aria-hidden />
          {r.deleted ? "The original was deleted — this snapshot is kept for traceability." : "Content purged by the retention policy — metadata and this excerpt are kept."}
        </p>
      )}
      {(url || (r.sourceItemId && !r.deleted)) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {r.sourceItemId && !r.deleted && (
            <Button size="xs" variant="outline" asChild>
              <Link href={`/sources/${r.sourceItemId}`}>
                View full source <ArrowRight aria-hidden />
              </Link>
            </Button>
          )}
          {url && (
            <Button size="xs" variant="ghost" asChild>
              <a href={url} target="_blank" rel="noopener noreferrer">
                Open original <ExternalLink aria-hidden />
              </a>
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
