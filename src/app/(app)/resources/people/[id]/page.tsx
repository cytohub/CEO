import { Building2, CheckSquare, Mail, UserPlus, Video } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar, Panel } from "@/components/common/bits";
import { DelegationRows, DetailActions, MeetingRows, TaskRows } from "@/components/resources/detail-client";
import {
  ActivityPanel,
  Breadcrumb,
  DealsPanel,
  DecisionsPanel,
  IntelFeed,
  NotesPanel,
  ResourcesPanel,
  StatStrip,
} from "@/components/resources/detail-sections";
import { db } from "@/lib/db";
import { formatDateTime, timeAgo } from "@/lib/dates";
import { FOCUS_AREAS, PERSON_TYPES } from "@/lib/domain";
import { getPersonDetail } from "@/server/queries/resources";

export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await props.params;
  const p = await db.person.findUnique({ where: { id }, select: { name: true, isCeo: true } });
  return { title: p ? (p.isCeo ? "You" : p.name) : "Person not found" };
}

export default async function PersonPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const d = await getPersonDetail(id);
  if (!d) notFound();
  const { person: p, today, now, timezone } = d;
  const displayName = p.isCeo ? "You" : p.name;
  // Delegation is something the CEO does to team members, so the CEO's own page skips it.
  const team = p.type === "TEAM" && !p.isCeo;
  const activeDelegations = d.delegations.filter((x) => x.status === "ACTIVE" || x.status === "NEEDS_FOLLOW_UP");
  const followUps = d.delegations.filter((x) => x.status === "NEEDS_FOLLOW_UP").length;
  const openDeals = d.deals.filter((x) => x.status === "OPEN");
  const nextMeeting = d.meetings.upcoming[0];

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <Breadcrumb items={[{ label: "Resources", href: "/resources" }, { label: "People", href: "/resources?tab=people" }, { label: displayName }]} />

      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-[420px] items-start gap-3">
          <Avatar name={p.name} ceo={p.isCeo} className="size-10 text-xs" />
          <div className="min-w-0">
            <div className="eyebrow mb-1">
              {PERSON_TYPES[p.type].label}
              {p.department && <span className="normal-case tracking-normal"> · {p.department}</span>}
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              {displayName}
              {p.isCeo && <span className="ml-2 text-sm font-normal text-muted-foreground">{p.name}</span>}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {p.title && <span className="text-ink-2">{p.title}</span>}
              {p.company && (
                <Link href={`/resources/companies/${p.company.id}`} className="inline-flex items-center gap-1 hover:text-foreground hover:underline">
                  <Building2 className="size-3" aria-hidden /> {p.company.name}
                </Link>
              )}
              {p.email && (
                <a href={`mailto:${p.email}`} className="inline-flex items-center gap-1 hover:text-foreground hover:underline">
                  <Mail className="size-3" aria-hidden /> {p.email}
                </a>
              )}
              {!p.isCeo && (
                <span title={p.lastContactAt ? formatDateTime(p.lastContactAt, timezone) : undefined}>
                  Last contact {p.lastContactAt ? timeAgo(p.lastContactAt, now) : "not recorded"}
                </span>
              )}
            </div>
            {p.expertise.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1" aria-label="Can own">
                {p.expertise.map((f) => (
                  <li key={f} className="rounded bg-muted px-1.5 py-0.5 text-2xs text-ink-2">
                    {FOCUS_AREAS[f].label}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DetailActions subject={p.isCeo ? "my own commitments" : `${p.name}${p.company ? ` (${p.company.name})` : ""}`} companyId={p.company?.id} canAddResource={Boolean(p.company)} />
        </div>
      </header>

      <StatStrip
        items={[
          { label: "Open tasks", value: d.openTasks.length, hint: d.doneTasks.length === 0 ? "None completed yet" : d.doneTasks.length < 6 ? `${d.doneTasks.length} completed` : "6+ completed" },
          {
            label: "Next meeting",
            value: nextMeeting ? formatDateTime(nextMeeting.startsAt, timezone) : "None scheduled",
            hint: nextMeeting?.title ?? `${d.meetings.past.length} past meeting${d.meetings.past.length === 1 ? "" : "s"}`,
          },
          team
            ? { label: "Delegated to them", value: activeDelegations.length, hint: followUps ? `${followUps} need follow-up` : "None need follow-up" }
            : { label: "Open deals", value: openDeals.length, hint: p.isCeo ? "Deals you own" : p.company ? `At ${p.company.name}` : "Owned or at their company" },
          { label: "Intelligence", value: d.intel.length, hint: "Brain insights & signals" },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="min-w-0 space-y-4 xl:col-span-8">
          <Panel id="tasks" title="Tasks" icon={CheckSquare} count={d.openTasks.length}>
            <TaskRows tasks={d.openTasks} today={today} emptyTitle={p.isCeo ? "No open tasks" : `No open tasks owned by or involving ${p.name}`} />
            {d.doneTasks.length > 0 && (
              <>
                <div className="border-y border-hairline bg-surface-2/50 px-3.5 py-1 text-2xs font-semibold text-ink-3">Recently completed</div>
                <TaskRows tasks={d.doneTasks} today={today} emptyTitle="" />
              </>
            )}
          </Panel>
          <Panel id="meetings" title="Meetings attended" icon={Video} count={d.meetings.upcoming.length + d.meetings.past.length}>
            <MeetingRows upcoming={d.meetings.upcoming} past={d.meetings.past} timezone={timezone} />
          </Panel>
          <IntelFeed items={d.intel} now={now} emptyHint="Insights and signals mentioning this person — emails, CRM updates, meeting notes — appear here after a Brain refresh." />
        </div>
        <div className="min-w-0 space-y-4 xl:col-span-4">
          {team && (
            <Panel id="delegations" title="Delegations" icon={UserPlus} count={d.delegations.length} href="/delegation" hrefLabel="Delegation">
              <DelegationRows delegations={d.delegations} today={today} />
            </Panel>
          )}
          {(d.deals.length > 0 || !team) && <DealsPanel deals={d.deals} today={today} now={now} showCompany title={p.isCeo ? "Deals you own" : team ? "Deals they own" : "Deals"} />}
          {d.decisions.length > 0 && <DecisionsPanel decisions={d.decisions} today={today} title={p.isCeo ? "Decisions you own" : "Decisions they own"} />}
          <ResourcesPanel resources={d.resources} addHint="Link documents to this person from the Resource Center (Edit links)." />
          <NotesPanel
            notes={d.notes}
            timezone={timezone}
            extra={
              p.notesText ? (
                <>
                  <p className="text-xs whitespace-pre-line text-ink-2">{p.notesText}</p>
                  <p className="mt-1 text-2xs text-muted-foreground">Profile note</p>
                </>
              ) : undefined
            }
          />
          <ActivityPanel activities={d.activities} now={now} timezone={timezone} />
        </div>
      </div>
    </div>
  );
}
