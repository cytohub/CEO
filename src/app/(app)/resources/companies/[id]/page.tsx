import { ArrowUpRight, CheckSquare, Globe, MapPin, Video } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Panel } from "@/components/common/bits";
import { DetailActions, MeetingRows, TaskRows } from "@/components/resources/detail-client";
import {
  ActivityPanel,
  Breadcrumb,
  DealsPanel,
  DecisionsPanel,
  IntelFeed,
  NotesPanel,
  PeoplePanel,
  ResourcesPanel,
  StatStrip,
} from "@/components/resources/detail-sections";
import { safeHref } from "@/components/resources/links";
import { RelationshipDots } from "@/components/resources/relationship";
import { formatUsd } from "@/components/scoreboard/metric-format";
import { db } from "@/lib/db";
import { formatDateTime, timeAgo } from "@/lib/dates";
import { COMPANY_TYPES } from "@/lib/domain";
import { getCompanyDetail } from "@/server/queries/resources";
import { requirePage } from "@/server/security/session";

export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await props.params;
  const c = await db.company.findUnique({ where: { id }, select: { name: true } });
  return { title: c ? c.name : "Company not found" };
}

export default async function CompanyPage(props: { params: Promise<{ id: string }> }) {
  await requirePage("workspace.view", "/resources");
  const { id } = await props.params;
  const d = await getCompanyDetail(id);
  if (!d) notFound();
  const { company: c, today, now, timezone } = d;
  const type = COMPANY_TYPES[c.type];
  const TypeIcon = type.icon;
  const website = safeHref(c.website) ?? (c.website && !/^[a-z]+:/i.test(c.website) ? `https://${c.website}` : null);
  const websiteLabel = c.website?.replace(/^https?:\/\//i, "").replace(/\/$/, "");

  const openDeals = d.deals.filter((x) => x.status === "OPEN");
  const openValue = openDeals.reduce((s, x) => s + (x.value ?? 0), 0);
  const weighted = openDeals.reduce((s, x) => s + ((x.value ?? 0) * x.probability) / 100, 0);
  const nextMeeting = d.meetings.upcoming[0];
  const lastTouch = [c.lastActivityAt, ...d.deals.map((x) => x.lastActivityAt), d.meetings.past[0]?.startsAt]
    .filter((x): x is Date => Boolean(x))
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <Breadcrumb items={[{ label: "Resources", href: "/resources" }, { label: "Companies", href: "/resources?tab=companies" }, { label: c.name }]} />

      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-[420px]">
          <div className="eyebrow mb-1.5 flex items-center gap-1.5">
            <TypeIcon className="size-3" aria-hidden />
            {type.label}
            {c.industry && <span className="normal-case tracking-normal">· {c.industry}</span>}
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{c.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <RelationshipDots value={c.relationship} showLabel />
            {c.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3" aria-hidden /> {c.location}
              </span>
            )}
            {website && (
              <a href={website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-foreground hover:underline">
                <Globe className="size-3" aria-hidden /> {websiteLabel}
                <ArrowUpRight className="size-3" aria-hidden />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            )}
          </div>
          {c.description && <p className="mt-2 max-w-3xl text-[14px] text-ink-2">{c.description}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DetailActions subject={c.name} companyId={c.id} />
        </div>
      </header>

      <StatStrip
        items={[
          { label: "Open pipeline", value: openDeals.length ? formatUsd(openValue) : "—", hint: `${openDeals.length} open deal${openDeals.length === 1 ? "" : "s"}` },
          { label: "Weighted", value: openDeals.length ? formatUsd(weighted) : "—", hint: "Value × probability" },
          { label: "Open tasks", value: d.openTasks.length, hint: `${d.completedTasks} completed` },
          {
            label: "Next meeting",
            value: nextMeeting ? formatDateTime(nextMeeting.startsAt, timezone) : "None scheduled",
            hint: nextMeeting?.title,
          },
          { label: "Last touch", value: lastTouch ? timeAgo(lastTouch, now) : "—", hint: `${c.people.length} contact${c.people.length === 1 ? "" : "s"}` },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="min-w-0 space-y-4 xl:col-span-8">
          <DealsPanel deals={d.deals} today={today} now={now} />
          <Panel id="open-tasks" title="Open tasks" icon={CheckSquare} count={d.openTasks.length}>
            <TaskRows tasks={d.openTasks} today={today} emptyTitle={`No open tasks involving ${c.name}`} />
          </Panel>
          <Panel id="meetings" title="Meetings" icon={Video} count={d.meetings.upcoming.length + d.meetings.past.length}>
            <MeetingRows upcoming={d.meetings.upcoming} past={d.meetings.past} timezone={timezone} />
          </Panel>
          <IntelFeed items={d.intel} now={now} emptyHint="Insights and signals from email, CRM and meetings about this company will appear here after a Brain refresh." />
        </div>
        <div className="min-w-0 space-y-4 xl:col-span-4">
          <PeoplePanel people={c.people} now={now} />
          <DecisionsPanel decisions={d.decisions} today={today} />
          <ResourcesPanel resources={d.resources} addHint="Link decks, contracts and models to this company from the Resource Center." />
          <NotesPanel notes={d.notes} timezone={timezone} />
          <ActivityPanel activities={d.activities} now={now} timezone={timezone} />
        </div>
      </div>
    </div>
  );
}
