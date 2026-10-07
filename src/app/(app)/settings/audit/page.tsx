import { ChevronLeft, ChevronRight, ScrollText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AdminPage } from "@/components/admin/admin-page";
import { AuditFilters } from "@/components/admin/audit-filters";
import { EmptyState } from "@/components/common/bits";
import { StatusPill } from "@/components/common/status";
import { Button } from "@/components/ui/button";
import type { AuditOutcome } from "@/generated/prisma/enums";
import { formatDateTime } from "@/lib/dates";
import type { Tone } from "@/lib/domain";
import { getCeoContext } from "@/server/context";
import { AUDIT_PAGE_SIZE, getAuditPage, parseAuditFilters, type AuditFilters as Filters } from "@/server/queries/audit";
import { requirePage } from "@/server/security/session";
import { exportAuditCsv } from "./actions";

export const metadata: Metadata = { title: "Audit log" };

const OUTCOME: Record<AuditOutcome, { label: string; tone: Tone }> = {
  SUCCESS: { label: "Success", tone: "good" },
  DENIED: { label: "Denied", tone: "serious" },
  FAILURE: { label: "Failure", tone: "critical" },
};

function pageHref(f: Filters, page: number) {
  const sp = new URLSearchParams();
  for (const k of ["action", "actor", "outcome", "from", "to"] as const) if (f[k]) sp.set(k, f[k]!);
  if (page > 1) sp.set("page", String(page));
  return sp.size ? `/settings/audit?${sp}` : "/settings/audit";
}

export default async function AuditPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requirePage("audit.view", "/settings/audit");
  const filters = parseAuditFilters(await props.searchParams);
  const ceo = await getCeoContext();
  const data = await getAuditPage(filters, ceo.timezone);
  const first = data.total ? (data.page - 1) * AUDIT_PAGE_SIZE + 1 : 0;
  const last = Math.min(data.total, data.page * AUDIT_PAGE_SIZE);
  const applied = { action: filters.action, actor: filters.actor, outcome: filters.outcome, from: filters.from, to: filters.to };

  return (
    <AdminPage
      capabilities={viewer.capabilities}
      current="/settings/audit"
      title="Audit log"
      description={`Sign-ins, connection changes, source views, review decisions, permission and retention changes. Times in ${ceo.timezone}.`}
    >
      <div className="space-y-3">
        <AuditFilters key={JSON.stringify(applied)} initial={applied} actions={data.actions} exporter={exportAuditCsv} />
        <div className="panel">
          {data.rows.length === 0 ? (
            <EmptyState icon={ScrollText} title="No audit entries match" description="Try a wider date range or clear a filter." />
          ) : (
            <div className="relative overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[860px] text-[15px]">
                <caption className="sr-only">Audit log entries, newest first</caption>
                <thead>
                  <tr className="border-b border-hairline text-left text-2xs font-medium text-muted-foreground">
                    <th scope="col" className="px-4 py-2 font-medium">When</th>
                    <th scope="col" className="px-2 py-2 font-medium">Action</th>
                    <th scope="col" className="px-2 py-2 font-medium">Outcome</th>
                    <th scope="col" className="px-2 py-2 font-medium">Actor</th>
                    <th scope="col" className="px-2 py-2 font-medium">Target</th>
                    <th scope="col" className="px-4 py-2 font-medium">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {data.rows.map((r) => {
                    const o = OUTCOME[r.outcome];
                    const hasMeta = r.metadata != null && !(typeof r.metadata === "object" && Object.keys(r.metadata as object).length === 0);
                    return (
                      <tr key={r.id} className="align-top">
                        <td className="px-4 py-2 text-xs whitespace-nowrap text-ink-2 tabular">
                          <time dateTime={r.at.toISOString()}>{formatDateTime(r.at, ceo.timezone)}</time>
                        </td>
                        <td className="px-2 py-2">
                          <code className="rounded bg-muted px-1 font-mono text-[13.5px] text-foreground">{r.action}</code>
                        </td>
                        <td className="px-2 py-2">
                          <StatusPill tone={o.tone} label={o.label} />
                        </td>
                        <td className="max-w-[220px] px-2 py-2">
                          <div className="truncate text-ink-2" title={r.actorLabel}>
                            {r.actorName ?? r.actorLabel}
                          </div>
                          {r.actorName && <div className="truncate text-2xs text-muted-foreground">{r.actorLabel}</div>}
                        </td>
                        <td className="max-w-[200px] px-2 py-2 text-xs">
                          {r.targetType ? (
                            <>
                              <div className="text-ink-2">{r.targetType}</div>
                              <div className="truncate font-mono text-[12.5px] text-muted-foreground" title={r.targetId ?? undefined}>
                                {r.targetId}
                              </div>
                            </>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="min-w-[220px] px-4 py-2 text-xs">
                          {hasMeta || r.ip ? (
                            <details className="group">
                              <summary className="cursor-pointer rounded text-muted-foreground outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                                {r.ip ? `IP ${r.ip}` : "Metadata"}
                                <span className="ml-1 text-ink-3 group-open:hidden">· show</span>
                              </summary>
                              <pre className="mt-1.5 max-h-64 max-w-[420px] overflow-auto rounded-md bg-surface-2 p-2 font-mono text-[13px] leading-4 whitespace-pre-wrap break-all text-ink-2 scrollbar-thin">
                                {JSON.stringify({ ...(hasMeta ? { metadata: r.metadata } : {}), ...(r.userAgent ? { userAgent: r.userAgent } : {}) }, null, 2)}
                              </pre>
                            </details>
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
          )}
          <nav aria-label="Audit log pages" className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline px-4 py-2">
            <span className="text-2xs text-muted-foreground tabular">
              {data.total ? `${first.toLocaleString("en-US")}–${last.toLocaleString("en-US")} of ${data.total.toLocaleString("en-US")}` : "0 entries"}
            </span>
            <div className="flex items-center gap-1">
              {data.page > 1 ? (
                <Button variant="ghost" size="sm" asChild>
                  <Link href={pageHref(filters, data.page - 1)} aria-label="Previous page">
                    <ChevronLeft aria-hidden /> Newer
                  </Link>
                </Button>
              ) : (
                <Button variant="ghost" size="sm" disabled aria-label="Previous page">
                  <ChevronLeft aria-hidden /> Newer
                </Button>
              )}
              <span className="px-1 text-2xs text-muted-foreground tabular">
                Page {data.page} of {data.pageCount}
              </span>
              {data.page < data.pageCount ? (
                <Button variant="ghost" size="sm" asChild>
                  <Link href={pageHref(filters, data.page + 1)} aria-label="Next page">
                    Older <ChevronRight aria-hidden />
                  </Link>
                </Button>
              ) : (
                <Button variant="ghost" size="sm" disabled aria-label="Next page">
                  Older <ChevronRight aria-hidden />
                </Button>
              )}
            </div>
          </nav>
        </div>
      </div>
    </AdminPage>
  );
}
