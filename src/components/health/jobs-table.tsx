"use client";

import { CheckCircle2, Loader2, Lock, RotateCw } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/common/bits";
import { StatusPill } from "@/components/common/status";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import { formatDateTime, timeAgo } from "@/lib/dates";
import { JOB_STATUS, JOB_TYPES } from "@/lib/intelligence";
import { retryIngestionJob } from "@/server/actions/jobs";
import type { HealthJobRow } from "@/server/queries/health";

/** Jobs that are retrying (FAILED) or gave up (DEAD), with a manual retry. */
export function JobsTable({ jobs, now, timezone, canRetry }: { jobs: HealthJobRow[]; now: Date; timezone: string; canRetry: boolean }) {
  const { pending, run } = useAction();
  const [busy, setBusy] = useState<string | null>(null);
  if (!jobs.length) return <EmptyState compact icon={CheckCircle2} title="No failing jobs" description="Every job succeeded or is waiting its turn." />;
  return (
    <div className="relative overflow-x-auto scrollbar-thin">
      <table className="w-full min-w-[820px] text-[14px]">
        <caption className="sr-only">Failing and failed ingestion jobs</caption>
        <thead>
          <tr className="border-b border-hairline text-left text-2xs font-medium text-muted-foreground">
            <th scope="col" className="px-3.5 py-2 font-medium">Job</th>
            <th scope="col" className="px-2 py-2 font-medium">Status</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Attempts</th>
            <th scope="col" className="px-2 py-2 font-medium">Error</th>
            <th scope="col" className="px-2 py-2 font-medium">Updated</th>
            <th scope="col" className="w-24 px-3.5 py-2">
              <span className="sr-only">Retry</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {jobs.map((j) => {
            const s = JOB_STATUS[j.status];
            return (
              <tr key={j.id} className="align-top" data-job-id={j.id}>
                <td className="max-w-[260px] px-3.5 py-2">
                  <div className="font-medium text-foreground">{JOB_TYPES[j.type].label}</div>
                  {j.subject && (
                    <div className={`flex items-center gap-1 truncate text-2xs ${j.restricted ? "text-muted-foreground italic" : "text-muted-foreground"}`} title={j.restricted ? undefined : j.subject}>
                      {j.restricted && <Lock className="size-3 shrink-0" aria-hidden />}
                      <span className="truncate">{j.subject}</span>
                    </div>
                  )}
                </td>
                <td className="px-2 py-2">
                  <StatusPill tone={s.tone} label={s.label} />
                  {j.status === "FAILED" && <div className="mt-0.5 text-2xs text-muted-foreground">next try {formatDateTime(j.runAt, timezone)}</div>}
                </td>
                <td className="px-2 py-2 text-right text-xs text-ink-2 tabular">
                  {j.attempts}/{j.maxAttempts}
                </td>
                <td className="max-w-[320px] px-2 py-2 text-xs text-critical-ink">
                  <span className="line-clamp-2 break-words" title={j.lastError ?? undefined}>
                    {j.lastError ?? "—"}
                  </span>
                </td>
                <td className="px-2 py-2 text-xs whitespace-nowrap text-muted-foreground" title={formatDateTime(j.updatedAt, timezone)}>
                  {timeAgo(j.updatedAt, now)}
                </td>
                <td className="px-3.5 py-1.5 text-right">
                  {canRetry ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      aria-label={`Retry ${JOB_TYPES[j.type].label} job`}
                      onClick={async () => {
                        setBusy(j.id);
                        await run(() => retryIngestionJob(j.id));
                        setBusy(null);
                      }}
                    >
                      {pending && busy === j.id ? <Loader2 className="animate-spin" aria-hidden /> : <RotateCw aria-hidden />}
                      Retry
                    </Button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
