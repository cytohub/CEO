import { AlarmClock, ArrowDownLeft, ArrowUpRight, CheckCircle2, Users } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/common/bits";
import { CommitmentTable } from "@/components/intelligence/commitments/commitment-table";
import { TabLink, UrlSearch, UrlSelect } from "@/components/intelligence/url-filters";
import { cn } from "@/lib/utils";
import { COMMITMENT_TABS, getCommitments, tabForCommitment, type CommitmentTab } from "@/server/queries/commitments";
import { requirePage } from "@/server/security/session";

export const metadata: Metadata = { title: "Commitments" };

const TAB_META: Record<CommitmentTab, { label: string; icon: typeof ArrowUpRight }> = {
  owe: { label: "I owe", icon: ArrowUpRight },
  owed: { label: "Owed to us", icon: ArrowDownLeft },
  internal: { label: "Internal", icon: Users },
  overdue: { label: "Overdue", icon: AlarmClock },
  fulfilled: { label: "Fulfilled", icon: CheckCircle2 },
};

export default async function CommitmentsPage(props: { searchParams: Promise<{ tab?: string; company?: string; q?: string; highlight?: string }> }) {
  const viewer = await requirePage("workspace.view", "/commitments");
  const sp = await props.searchParams;
  let tab = (COMMITMENT_TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as CommitmentTab) : null;
  if (!tab && sp.highlight) tab = await tabForCommitment(sp.highlight.slice(0, 64));
  tab ??= "owe";
  const company = sp.company?.slice(0, 64) || null;
  const q = sp.q?.slice(0, 100) || null;
  const data = await getCommitments(viewer, { tab, companyId: company, q });
  const c = data.counts;
  const qs = (t: CommitmentTab) => {
    const p = new URLSearchParams();
    if (t !== "owe") p.set("tab", t);
    if (company) p.set("company", company);
    if (q) p.set("q", q);
    const s = p.toString();
    return s ? `/commitments?${s}` : "/commitments";
  };
  const tabs = COMMITMENT_TABS.filter((t) => t !== "internal" || c.internal > 0 || tab === "internal");
  const count: Record<CommitmentTab, number> = { owe: c.owe, owed: c.owed, internal: c.internal, overdue: c.overdue, fulfilled: c.fulfilled };

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <PageHeader
        title="Commitments"
        description="Promises you made and promises made to you — captured from email, meetings and documents, each with its source, so nothing quietly slips."
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["You owe", c.owe, c.oweOverdue ? `${c.oweOverdue} overdue` : "All on time", c.oweOverdue > 0],
          ["Owed to you", c.owed, c.owedOverdue ? `${c.owedOverdue} overdue` : "All on time", c.owedOverdue > 0],
          ["Overdue", c.overdue, "either direction", c.overdue > 0],
          ["Fulfilled (30 days)", c.fulfilled30, "kept promises", false],
        ].map(([label, value, hint, alert]) => (
          <div key={label as string} className="panel px-3.5 py-3">
            <div className="text-2xs text-muted-foreground">{label}</div>
            <div className="mt-0.5 text-xl font-semibold tabular">{value as number}</div>
            <div className={cn("text-2xs", alert ? "font-medium text-critical-ink" : "text-muted-foreground")}>{hint}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-border">
        <nav aria-label="Commitment views" className="-mb-px flex max-w-full gap-1 overflow-x-auto scrollbar-thin">
          {tabs.map((t) => {
            const M = TAB_META[t];
            return (
              <TabLink key={t} href={qs(t)} active={t === tab} count={count[t]}>
                <M.icon className="size-3.5" aria-hidden /> {M.label}
              </TabLink>
            );
          })}
        </nav>
        <div className="flex w-full flex-wrap items-center gap-2 pb-1.5 sm:w-auto">
          <Suspense>
            <UrlSearch placeholder="Search commitments…" label="Search commitments" />
            <UrlSelect param="company" options={data.companies.map((co) => ({ value: co.id, label: co.name }))} allLabel="All companies" ariaLabel="Filter by company" className="w-[180px]" />
          </Suspense>
        </div>
      </div>

      <Suspense>
        <CommitmentTable items={data.items} today={data.today} timezone={data.timezone} tab={tab} filtered={Boolean(company || q)} />
      </Suspense>
    </div>
  );
}
