import { StatusPill } from "@/components/common/status";
import { formatDateTime, timeAgo } from "@/lib/dates";
import { formatNumber } from "@/lib/format";
import type { RunRow } from "@/server/queries/integrations";
import { RUN_STATUS, RUN_TRIGGER, shortDuration } from "./labels";

/** The last runs of one connection: what each sync fetched and what it led to. */
export function RunsTable({ runs, now, timezone, caption }: { runs: RunRow[]; now: Date; timezone: string; caption: string }) {
  if (!runs.length) return <p className="px-4 py-3 text-xs text-muted-foreground">No syncs yet. Run one to ingest this account.</p>;
  return (
    <div className="relative overflow-x-auto scrollbar-thin">
      <table className="w-full min-w-[760px] text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-hairline text-left text-2xs font-medium text-muted-foreground">
            <th scope="col" className="px-4 py-1.5 font-medium">Started</th>
            <th scope="col" className="px-2 py-1.5 font-medium">Trigger</th>
            <th scope="col" className="px-2 py-1.5 font-medium">Status</th>
            <th scope="col" className="px-2 py-1.5 text-right font-medium">Fetched</th>
            <th scope="col" className="px-2 py-1.5 text-right font-medium">New</th>
            <th scope="col" className="px-2 py-1.5 text-right font-medium">Updated</th>
            <th scope="col" className="px-2 py-1.5 text-right font-medium">Noise</th>
            <th scope="col" className="px-2 py-1.5 text-right font-medium" title="Duplicates prevented">Dupes</th>
            <th scope="col" className="px-2 py-1.5 text-right font-medium">Review</th>
            <th scope="col" className="px-2 py-1.5 text-right font-medium">Duration</th>
            <th scope="col" className="px-4 py-1.5 font-medium">Error</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {runs.map((r) => {
            const s = RUN_STATUS[r.status];
            return (
              <tr key={r.id} className="align-top">
                <td className="px-4 py-1.5 whitespace-nowrap text-ink-2" title={formatDateTime(r.startedAt, timezone)}>
                  {timeAgo(r.startedAt, now)}
                </td>
                <td className="px-2 py-1.5 text-ink-2">{RUN_TRIGGER[r.trigger]}</td>
                <td className="px-2 py-1.5">
                  <StatusPill tone={s.tone} label={s.label} />
                </td>
                <td className="px-2 py-1.5 text-right tabular">{formatNumber(r.fetched)}</td>
                <td className="px-2 py-1.5 text-right tabular">{formatNumber(r.created)}</td>
                <td className="px-2 py-1.5 text-right tabular">{formatNumber(r.updated)}</td>
                <td className="px-2 py-1.5 text-right tabular text-muted-foreground">{formatNumber(r.noise)}</td>
                <td className="px-2 py-1.5 text-right tabular text-muted-foreground">{formatNumber(r.duplicatesPrevented)}</td>
                <td className="px-2 py-1.5 text-right tabular">{formatNumber(r.reviewItems)}</td>
                <td className="px-2 py-1.5 text-right whitespace-nowrap tabular text-muted-foreground">{r.status === "RUNNING" ? "running" : shortDuration(r.durationMs)}</td>
                <td className="max-w-[260px] px-4 py-1.5 text-critical-ink">
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
  );
}
