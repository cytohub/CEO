import { Building2, FileText, Plus, Users, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/common/bits";
import { CreateButton } from "@/components/common/create-button";
import { CompanyTable, PeopleTable } from "@/components/resources/directory-tables";
import { ResourceList } from "@/components/resources/resource-list";
import { cn } from "@/lib/utils";
import { getCeoContext } from "@/server/context";
import { getCompanyRows, getPersonRows, getResourceCenterCounts, getResourceRows } from "@/server/queries/resources";

export const metadata: Metadata = { title: "Resources" };

const TABS = ["documents", "companies", "people"] as const;
type Tab = (typeof TABS)[number];

const TAB_META: Record<Tab, { label: string; icon: LucideIcon }> = {
  documents: { label: "Documents", icon: FileText },
  companies: { label: "Companies", icon: Building2 },
  people: { label: "People", icon: Users },
};

export default async function ResourcesPage(props: { searchParams: Promise<{ tab?: string; resource?: string }> }) {
  const sp = await props.searchParams;
  // A deep link to a resource always lands on the documents tab.
  const tab: Tab = sp.resource ? "documents" : (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "documents";
  const [counts, ceo] = await Promise.all([getResourceCenterCounts(), getCeoContext()]);

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <PageHeader
        title="Resource center"
        description="Documents, companies and people — each connected to the goals, milestones, decisions and work they support."
        actions={<CreateButton kind="resource" label="Add resource" icon={<Plus />} />}
        className="pb-1"
      />

      <nav aria-label="Resource center sections" className="flex flex-wrap gap-1 border-b border-hairline pb-3">
        {TABS.map((t) => {
          const active = t === tab;
          const Icon = TAB_META[t].icon;
          return (
            <Link
              key={t}
              href={t === "documents" ? "/resources" : `/resources?tab=${t}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
                active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              {TAB_META[t].label}
              <span className={cn("tabular", active ? "text-background/70" : "text-muted-foreground")}>{counts[t]}</span>
            </Link>
          );
        })}
      </nav>

      {tab === "documents" && <ResourceList resources={await getResourceRows()} highlightId={sp.resource ?? null} />}
      {tab === "companies" && <CompanyTable rows={await getCompanyRows()} now={ceo.now} />}
      {tab === "people" && <PeopleTable rows={await getPersonRows()} now={ceo.now} />}
    </div>
  );
}
