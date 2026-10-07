import { ArrowRight } from "lucide-react";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { DocumentDetail } from "@/server/queries/documents";
import { readChanges } from "../model";

const SIGNIFICANCE: Record<string, string> = {
  HIGH: "bg-serious-soft text-serious-ink",
  CRITICAL: "bg-critical-soft text-critical-ink",
  MEDIUM: "bg-warning-soft text-warning-ink",
  LOW: "bg-muted text-muted-foreground",
};

/** Every version, newest first: when, what changed, and the significant figure changes (from → to). */
export function VersionTimeline({ versions, timezone }: { versions: DocumentDetail["doc"]["versions"]; timezone: string }) {
  if (!versions.length) return <p className="px-4 py-3 text-xs text-muted-foreground">No versions recorded yet.</p>;
  return (
    <ol className="relative space-y-4 px-4 py-4 before:absolute before:top-6 before:bottom-6 before:left-[27px] before:w-px before:bg-border">
      {versions.map((v, i) => {
        const changes = readChanges(v.significantChanges);
        return (
          <li key={v.id} className="relative flex gap-3">
            <span
              className={cn(
                "relative z-[1] mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-2xs font-semibold tabular ring-4 ring-surface",
                v.isSignificant ? "bg-serious-soft text-serious-ink" : i === 0 ? "bg-foreground text-background" : "bg-muted text-ink-2",
              )}
              aria-hidden
            >
              {v.version}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[15px] font-medium">Version {v.version}</span>
                {i === 0 && <span className="rounded bg-muted px-1.5 text-2xs text-muted-foreground">Current</span>}
                {v.isSignificant && <span className="rounded bg-serious-soft px-1.5 text-2xs font-medium text-serious-ink">Significant change</span>}
                <time className="ml-auto text-2xs text-muted-foreground tabular" dateTime={v.modifiedAt.toISOString()}>
                  {formatDateTime(v.modifiedAt, timezone)}
                </time>
              </div>
              <p className="mt-0.5 text-xs text-ink-2">{v.changeSummary ?? (i === versions.length - 1 ? "First version ingested." : "Content changed.")}</p>
              {changes.length > 0 && (
                <ul className="mt-2 divide-y divide-hairline rounded-md border border-border">
                  {changes.map((c, j) => (
                    <li key={j} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5 text-[15px]">
                      <span className="min-w-0 flex-1 text-ink-2">{c.label}</span>
                      <span className="text-muted-foreground line-through decoration-ink-3/60">{c.from ?? "—"}</span>
                      <ArrowRight className="size-3.5 text-ink-3" aria-label="changed to" />
                      <span className="font-semibold">{c.to ?? "—"}</span>
                      {c.significance && <span className={cn("rounded px-1.5 text-2xs font-medium", SIGNIFICANCE[c.significance] ?? SIGNIFICANCE.LOW)}>{c.significance.toLowerCase()}</span>}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-2xs text-muted-foreground">
                {v.pageCount != null && `${v.pageCount} pages · `}
                {v.textLength.toLocaleString("en-US")} characters · parsed by {v.parser}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
