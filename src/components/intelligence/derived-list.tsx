import { ArrowUpRight, Sparkles } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/common/bits";
import { StatusPill } from "@/components/common/status";
import type { DerivedRecord } from "@/server/queries/provenance";
import { HiddenSourcesNote, REFERENCE_ROLE } from "./badges";

/** Records CytoHub Brain derived from a source (tasks, commitments, decisions, risks…), with links. */
export function DerivedList({ records, hidden, emptyTitle = "Nothing derived yet", emptyDescription }: { records: DerivedRecord[]; hidden: number; emptyTitle?: string; emptyDescription?: string }) {
  return (
    <div>
      {records.length === 0 ? (
        <EmptyState compact icon={Sparkles} title={emptyTitle} description={emptyDescription ?? "Records CytoHub Brain writes from this source will appear here with a link back."} />
      ) : (
        <ul className="divide-y divide-hairline">
          {records.map((r) => {
            const body = (
              <>
                <span className="w-[84px] shrink-0 text-2xs text-muted-foreground">{r.kindLabel}</span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-[13px] leading-snug text-foreground">{r.title}</span>
                  {r.role && r.role !== "CREATED_FROM" && <span className="block text-2xs text-muted-foreground">{REFERENCE_ROLE[r.role]} this source</span>}
                </span>
                {r.status && <StatusPill tone={r.status.tone} label={r.status.label} className="hidden sm:inline-flex" />}
                {r.href && <ArrowUpRight className="size-3.5 shrink-0 text-ink-3" aria-hidden />}
              </>
            );
            return (
              <li key={r.key}>
                {r.href ? (
                  <Link href={r.href} scroll={false} className="flex items-center gap-3 px-3.5 py-2 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none">
                    {body}
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 px-3.5 py-2">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {hidden > 0 && (
        <div className="border-t border-hairline px-3.5 py-2">
          <HiddenSourcesNote count={hidden} noun="record" />
        </div>
      )}
    </div>
  );
}
