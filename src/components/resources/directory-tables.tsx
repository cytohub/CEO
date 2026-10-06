"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Building2, Users } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, EmptyState } from "@/components/common/bits";
import type { CompanyType, PersonType } from "@/generated/prisma/enums";
import { formatDateTime, timeAgo } from "@/lib/dates";
import { useLookups } from "@/components/shell/ui-context";
import { COMPANY_TYPES, PERSON_TYPES } from "@/lib/domain";
import { cn } from "@/lib/utils";
import type { CompanyRow, PersonRow } from "@/server/queries/resources";
import { FilterToolbar } from "./filter-toolbar";
import { RelationshipDots } from "./relationship";
import { formatUsd } from "@/components/scoreboard/metric-format";

type Dir = "asc" | "desc";

function useSort<K extends string>(initial: K, initialDir: Dir = "asc") {
  const [key, setKey] = useState<K>(initial);
  const [dir, setDir] = useState<Dir>(initialDir);
  const toggle = (k: K, defaultDir: Dir) => {
    if (k === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setKey(k);
      setDir(defaultDir);
    }
  };
  return { key, dir, toggle };
}

function SortHeader<K extends string>({
  label,
  k,
  sort,
  defaultDir = "asc",
  className,
  align = "left",
}: {
  label: string;
  k: K;
  sort: { key: K; dir: Dir; toggle: (k: K, d: Dir) => void };
  defaultDir?: Dir;
  className?: string;
  align?: "left" | "right";
}) {
  const active = sort.key === k;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th scope="col" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined} className={cn("px-2 py-2 font-medium", align === "right" && "text-right", className)}>
      <button
        type="button"
        onClick={() => sort.toggle(k, defaultDir)}
        className={cn("inline-flex items-center gap-1 rounded hover:text-foreground", active && "text-foreground", align === "right" && "flex-row-reverse")}
      >
        {label}
        <Icon className={cn("size-3", active ? "text-ink-2" : "text-ink-3/60")} aria-hidden />
      </button>
    </th>
  );
}

const cmpStr = (a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "base" });
const cmpNullableDate = (a: Date | null, b: Date | null) => (a?.getTime() ?? -Infinity) - (b?.getTime() ?? -Infinity);

// ─── Companies ───────────────────────────────────────────────────────────────

type CompanySortKey = "name" | "type" | "relationship" | "deals" | "people" | "tasks" | "activity";

export function CompanyTable({ rows, now }: { rows: CompanyRow[]; now: Date }) {
  const { timezone } = useLookups();
  const [query, setQuery] = useState("");
  const [type, setType] = useState<CompanyType | null>(null);
  const sort = useSort<CompanySortKey>("name");

  const typeCounts = useMemo(() => {
    const m = new Map<CompanyType, number>();
    for (const r of rows) m.set(r.type, (m.get(r.type) ?? 0) + 1);
    return m;
  }, [rows]);

  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = rows.filter((r) => {
    if (type && r.type !== type) return false;
    const hay = [r.name, r.industry, r.location, COMPANY_TYPES[r.type].label].filter(Boolean).join(" ").toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
  const sorted = [...filtered].sort((a, b) => {
    let c = 0;
    switch (sort.key) {
      case "name":
        c = cmpStr(a.name, b.name);
        break;
      case "type":
        c = cmpStr(COMPANY_TYPES[a.type].label, COMPANY_TYPES[b.type].label) || cmpStr(a.name, b.name);
        break;
      case "relationship":
        c = a.relationship - b.relationship;
        break;
      case "deals":
        c = a.openDealValue - b.openDealValue || a.openDeals - b.openDeals;
        break;
      case "people":
        c = a.peopleCount - b.peopleCount;
        break;
      case "tasks":
        c = a.openTasks - b.openTasks;
        break;
      case "activity":
        c = cmpNullableDate(a.lastActivityAt, b.lastActivityAt);
        break;
    }
    return sort.dir === "asc" ? c : -c;
  });

  return (
    <div className="space-y-3">
      <FilterToolbar
        query={query}
        onQuery={setQuery}
        searchLabel="Search companies"
        placeholder="Search by name, industry or location…"
        type={type}
        onType={(t) => setType(t as CompanyType | null)}
        typeOptions={(Object.keys(COMPANY_TYPES) as CompanyType[]).filter((t) => typeCounts.has(t)).map((t) => ({ value: t, label: `${COMPANY_TYPES[t].label} · ${typeCounts.get(t)}` }))}
        shown={filtered.length}
        total={rows.length}
        noun={rows.length === 1 ? "company" : "companies"}
      />
      <div className="panel overflow-hidden">
        {sorted.length === 0 ? (
          <EmptyState
            compact={rows.length > 0}
            icon={Building2}
            title={rows.length === 0 ? "No companies yet" : "No companies match"}
            description={rows.length === 0 ? "Customers, investors and partners appear here as they sync from the CRM or are added to deals and meetings." : "Try a different name or type."}
            action={
              rows.length > 0 ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setQuery("");
                    setType(null);
                  }}
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[820px] text-[13px]">
              <caption className="sr-only">Companies, sortable by column</caption>
              <thead>
                <tr className="border-b border-hairline text-left text-2xs text-muted-foreground">
                  <SortHeader label="Company" k="name" sort={sort} className="pl-3.5" />
                  <SortHeader label="Type" k="type" sort={sort} />
                  <SortHeader label="Relationship" k="relationship" sort={sort} defaultDir="desc" />
                  <SortHeader label="Open deals" k="deals" sort={sort} defaultDir="desc" align="right" />
                  <SortHeader label="People" k="people" sort={sort} defaultDir="desc" align="right" />
                  <SortHeader label="Open tasks" k="tasks" sort={sort} defaultDir="desc" align="right" />
                  <SortHeader label="Last activity" k="activity" sort={sort} defaultDir="desc" align="right" className="pr-3.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {sorted.map((c) => {
                  const TypeIcon = COMPANY_TYPES[c.type].icon;
                  return (
                    <tr key={c.id} className="group hover:bg-muted/40">
                      <td className="max-w-[320px] py-2 pr-2 pl-3.5">
                        <Link href={`/resources/companies/${c.id}`} className="block min-w-0 rounded-sm">
                          <span className="block truncate font-medium text-foreground group-hover:underline">{c.name}</span>
                          <span className="block truncate text-2xs text-muted-foreground">{[c.industry, c.location].filter(Boolean).join(" · ") || "—"}</span>
                        </Link>
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-ink-2">
                        <span className="inline-flex items-center gap-1.5">
                          <TypeIcon className="size-3.5 text-ink-3" aria-hidden />
                          {COMPANY_TYPES[c.type].label}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <RelationshipDots value={c.relationship} />
                      </td>
                      <td className="px-2 py-2 text-right whitespace-nowrap tabular">
                        {c.openDeals > 0 ? (
                          c.openDealValue > 0 ? (
                            <>
                              <span className="font-medium text-foreground">{formatUsd(c.openDealValue)}</span>
                              <span className="text-muted-foreground"> · {c.openDeals}</span>
                            </>
                          ) : (
                            <span className="text-ink-2" title="Open deal without a recorded value">
                              {c.openDeals} open
                            </span>
                          )
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right tabular text-ink-2">{c.peopleCount || <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-2 py-2 text-right tabular text-ink-2">{c.openTasks || <span className="text-muted-foreground">—</span>}</td>
                      <td className="py-2 pr-3.5 pl-2 text-right text-xs whitespace-nowrap text-muted-foreground" title={c.lastActivityAt ? formatDateTime(c.lastActivityAt, timezone) : undefined}>
                        {c.lastActivityAt ? timeAgo(c.lastActivityAt, now) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── People ──────────────────────────────────────────────────────────────────

type PersonSortKey = "name" | "company" | "type" | "contact" | "tasks";

export function PeopleTable({ rows, now }: { rows: PersonRow[]; now: Date }) {
  const { timezone } = useLookups();
  const [query, setQuery] = useState("");
  const [type, setType] = useState<PersonType | null>(null);
  const sort = useSort<PersonSortKey>("name");

  const typeCounts = useMemo(() => {
    const m = new Map<PersonType, number>();
    for (const r of rows) m.set(r.type, (m.get(r.type) ?? 0) + 1);
    return m;
  }, [rows]);

  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = rows.filter((r) => {
    if (type && r.type !== type) return false;
    const hay = [r.isCeo ? "you" : "", r.name, r.title, r.email, r.company?.name, PERSON_TYPES[r.type].label].filter(Boolean).join(" ").toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
  const sorted = [...filtered].sort((a, b) => {
    let c = 0;
    switch (sort.key) {
      case "name":
        // The CEO ("You") stays first when sorting by name ascending.
        c = Number(b.isCeo) - Number(a.isCeo) || cmpStr(a.name, b.name);
        if (sort.dir === "desc") c = cmpStr(a.name, b.name);
        break;
      case "company":
        c = cmpStr(a.company?.name ?? "￿", b.company?.name ?? "￿") || cmpStr(a.name, b.name);
        break;
      case "type":
        c = cmpStr(PERSON_TYPES[a.type].label, PERSON_TYPES[b.type].label) || cmpStr(a.name, b.name);
        break;
      case "contact":
        c = cmpNullableDate(a.lastContactAt, b.lastContactAt);
        break;
      case "tasks":
        c = a.openTasks - b.openTasks;
        break;
    }
    return sort.dir === "asc" ? c : -c;
  });

  return (
    <div className="space-y-3">
      <FilterToolbar
        query={query}
        onQuery={setQuery}
        searchLabel="Search people"
        placeholder="Search by name, title, company or email…"
        type={type}
        onType={(t) => setType(t as PersonType | null)}
        typeOptions={(Object.keys(PERSON_TYPES) as PersonType[]).filter((t) => typeCounts.has(t)).map((t) => ({ value: t, label: `${PERSON_TYPES[t].label} · ${typeCounts.get(t)}` }))}
        shown={filtered.length}
        total={rows.length}
        noun={rows.length === 1 ? "person" : "people"}
      />
      <div className="panel overflow-hidden">
        {sorted.length === 0 ? (
          <EmptyState
            compact={rows.length > 0}
            icon={Users}
            title={rows.length === 0 ? "No people yet" : "No people match"}
            description={rows.length === 0 ? "Your team, investors, customers and partners appear here." : "Try a different name, company or type."}
            action={
              rows.length > 0 ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setQuery("");
                    setType(null);
                  }}
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[760px] text-[13px]">
              <caption className="sr-only">People, sortable by column</caption>
              <thead>
                <tr className="border-b border-hairline text-left text-2xs text-muted-foreground">
                  <SortHeader label="Name" k="name" sort={sort} className="pl-3.5" />
                  <th scope="col" className="px-2 py-2 font-medium">
                    Title
                  </th>
                  <SortHeader label="Company" k="company" sort={sort} />
                  <SortHeader label="Type" k="type" sort={sort} />
                  <SortHeader label="Last contact" k="contact" sort={sort} defaultDir="desc" align="right" />
                  <SortHeader label="Open tasks" k="tasks" sort={sort} defaultDir="desc" align="right" className="pr-3.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {sorted.map((p) => (
                  <tr key={p.id} className="group hover:bg-muted/40">
                    <td className="max-w-[260px] py-2 pr-2 pl-3.5">
                      <Link href={`/resources/people/${p.id}`} className="flex min-w-0 items-center gap-2 rounded-sm">
                        <Avatar name={p.name} ceo={p.isCeo} />
                        <span className="truncate font-medium text-foreground group-hover:underline">{p.isCeo ? "You" : p.name}</span>
                      </Link>
                    </td>
                    <td className="max-w-[240px] truncate px-2 py-2 text-ink-2" title={p.title ?? undefined}>
                      {p.title ?? <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="max-w-[200px] truncate px-2 py-2">
                      {p.company ? (
                        <Link href={`/resources/companies/${p.company.id}`} className="text-ink-2 hover:text-foreground hover:underline">
                          {p.company.name}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">{p.type === "TEAM" ? "CytoHub" : "—"}</span>
                      )}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap text-ink-2">{PERSON_TYPES[p.type].label}</td>
                    <td className="px-2 py-2 text-right text-xs whitespace-nowrap text-muted-foreground" title={p.lastContactAt ? formatDateTime(p.lastContactAt, timezone) : undefined}>
                      {p.lastContactAt ? timeAgo(p.lastContactAt, now) : "—"}
                    </td>
                    <td className={cn("py-2 pr-3.5 pl-2 text-right tabular", p.openTasks ? "text-ink-2" : "text-muted-foreground")}>{p.openTasks || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
