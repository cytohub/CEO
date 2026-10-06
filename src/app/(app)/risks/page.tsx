import { Lightbulb, ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/common/bits";
import { OpportunityList, RiskList } from "@/components/intelligence/risks/risk-lists";
import { TabLink, UrlSelect } from "@/components/intelligence/url-filters";
import { formatCurrency } from "@/lib/format";
import { getOpportunities, getRiskCompanies, getRisks, type RiskView } from "@/server/queries/risks";
import { requirePage } from "@/server/security/session";

export const metadata: Metadata = { title: "Risks & Opportunities" };

const VIEW_OPTIONS = [
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

export default async function RisksPage(props: { searchParams: Promise<{ tab?: string; view?: string; company?: string; highlight?: string }> }) {
  const viewer = await requirePage("workspace.view", "/risks");
  const sp = await props.searchParams;
  const tab = sp.tab === "opportunities" ? "opportunities" : "risks";
  // Deep links to a closed record must still find it.
  const view: RiskView = sp.view === "closed" || sp.view === "all" ? sp.view : sp.highlight ? "all" : "active";
  const company = sp.company?.slice(0, 64) || null;
  const [risks, opps, companies] = await Promise.all([
    getRisks(viewer, { view: tab === "risks" ? view : "active", companyId: tab === "risks" ? company : null }),
    getOpportunities(viewer, { view: tab === "opportunities" ? view : "active", companyId: tab === "opportunities" ? company : null }),
    getRiskCompanies(),
  ]);
  const filtered = Boolean(company) || view !== "active";

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <PageHeader
        title="Risks & Opportunities"
        description="What could hurt a goal, deal or relationship — and the upside worth chasing. Identified from email, meetings and documents; every item links back to its source."
      />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Open risks", risks.active, `${risks.highSeverity} high severity`],
          ["Closed risks", risks.closed, "mitigated, resolved or accepted"],
          ["Open opportunities", opps.active, "open or pursuing"],
          ["Opportunity value", formatCurrency(opps.activeValue), "estimated, open"],
        ].map(([label, value, hint]) => (
          <div key={label as string} className="panel px-3.5 py-3">
            <div className="text-2xs text-muted-foreground">{label}</div>
            <div className="mt-0.5 text-xl font-semibold tabular">{value}</div>
            <div className="text-2xs text-muted-foreground">{hint}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-border">
        <nav aria-label="Risks or opportunities" className="-mb-px flex gap-1">
          <TabLink href="/risks" active={tab === "risks"} count={risks.active}>
            <ShieldAlert className="size-3.5" aria-hidden /> Risks
          </TabLink>
          <TabLink href="/risks?tab=opportunities" active={tab === "opportunities"} count={opps.active}>
            <Lightbulb className="size-3.5" aria-hidden /> Opportunities
          </TabLink>
        </nav>
        <div className="flex flex-wrap items-center gap-2 pb-1.5">
          <Suspense>
            <UrlSelect param="view" options={VIEW_OPTIONS} allLabel="Active" ariaLabel="Status" className="w-[120px]" />
            <UrlSelect param="company" options={companies.map((c) => ({ value: c.id, label: c.name }))} allLabel="All companies" ariaLabel="Filter by company" className="w-[180px]" />
          </Suspense>
        </div>
      </div>
      <Suspense>
        {tab === "risks" ? <RiskList items={risks.items} timezone={risks.timezone} filtered={filtered} /> : <OpportunityList items={opps.items} timezone={opps.timezone} filtered={filtered} />}
      </Suspense>
    </div>
  );
}
