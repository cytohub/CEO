import {
  ArrowUpRight,
  BarChart3,
  Brain,
  Briefcase,
  CalendarClock,
  FileText,
  FolderOpen,
  Gavel,
  History,
  Mail,
  MessageSquare,
  NotebookPen,
  PenLine,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { Avatar, DueLabel, EmptyState, Panel, PersonName } from "@/components/common/bits";
import { StatusPill, TONE_TEXT } from "@/components/common/status";
import type { DealStatus, DealType, SignalKind } from "@/generated/prisma/enums";
import { formatDateTime, timeAgo } from "@/lib/dates";
import { DECISION_STATUS, INSIGHT_TYPES, PERSON_TYPES, RESOURCE_TYPES, type Tone } from "@/lib/domain";
import { cn } from "@/lib/utils";
import type { DetailActivity, DetailDecision, DetailNote, DetailResource, IntelItem } from "@/server/queries/resources";
import { formatUsd } from "@/components/scoreboard/metric-format";
import { safeHref } from "./links";

export const DEAL_STATUS: Record<DealStatus, { label: string; tone: Tone }> = {
  OPEN: { label: "Open", tone: "info" },
  WON: { label: "Won", tone: "good" },
  LOST: { label: "Lost", tone: "critical" },
  ON_HOLD: { label: "On hold", tone: "neutral" },
};

export const DEAL_TYPE: Record<DealType, string> = { SALES: "Sales", FUNDRAISING: "Fundraising", PARTNERSHIP: "Partnership" };

const SIGNAL_KIND: Record<SignalKind, { label: string; icon: LucideIcon }> = {
  EMAIL: { label: "Email", icon: Mail },
  CALENDAR_EVENT: { label: "Calendar", icon: CalendarClock },
  CRM_UPDATE: { label: "CRM update", icon: Briefcase },
  DOCUMENT: { label: "Document", icon: FileText },
  MEETING_NOTE: { label: "Meeting note", icon: MessageSquare },
  METRIC_UPDATE: { label: "Metric update", icon: BarChart3 },
  MESSAGE: { label: "Message", icon: MessageSquare },
  MANUAL: { label: "Manual note", icon: PenLine },
};

/** Breadcrumb trail above a detail header. */
export function Breadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        {items.map((it, i) => (
          <li key={i} className="flex min-w-0 items-center gap-1">
            {i > 0 && <span aria-hidden className="text-ink-3">/</span>}
            {it.href ? (
              <Link href={it.href} className="rounded-sm hover:text-foreground hover:underline">
                {it.label}
              </Link>
            ) : (
              <span aria-current="page" className="truncate text-ink-2">
                {it.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** A strip of headline numbers in hairline-separated cells. */
export function StatStrip({ items }: { items: { label: string; value: React.ReactNode; hint?: React.ReactNode }[] }) {
  return (
    <section aria-label="Summary" className="panel overflow-hidden">
      <dl className="-mr-px -mb-px flex flex-wrap">
        {items.map((s) => (
          <div key={s.label} className="min-w-0 flex-1 basis-[150px] border-r border-b border-hairline px-3.5 py-2.5">
            <dt className="text-2xs font-medium text-muted-foreground">{s.label}</dt>
            <dd className="mt-0.5 truncate text-[17px] font-semibold tracking-tight text-foreground">{s.value}</dd>
            {s.hint && <dd className="truncate text-2xs text-muted-foreground">{s.hint}</dd>}
          </div>
        ))}
      </dl>
    </section>
  );
}

type DealRow = {
  id: string;
  name: string;
  type: DealType;
  status: DealStatus;
  stage: string;
  value: number | null;
  probability: number;
  expectedClose: Date | null;
  lastActivityAt: Date | null;
  nextStep: string | null;
  owner: { id: string; name: string; isCeo: boolean } | null;
  company?: { id: string; name: string } | null;
};

export function DealsPanel({ deals, today, now, showCompany, title = "Deals" }: { deals: DealRow[]; today: Date; now: Date; showCompany?: boolean; title?: string }) {
  return (
    <Panel id="deals" title={title} icon={Briefcase} count={deals.length}>
      {deals.length === 0 ? (
        <EmptyState compact title="No deals" description="Sales, fundraising and partnership deals sync from the CRM." />
      ) : (
        <ul className="divide-y divide-hairline">
          {deals.map((d) => {
            const status = DEAL_STATUS[d.status];
            const open = d.status === "OPEN";
            return (
              <li key={d.id} className="px-3.5 py-2.5">
                <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                  <div className="min-w-0 flex-1 basis-[240px]">
                    <div className="flex items-center gap-2">
                      <span className={cn("truncate text-[15px] font-medium", open ? "text-foreground" : "text-ink-2")}>{d.name}</span>
                      <StatusPill tone={status.tone} label={status.label} />
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-2xs text-muted-foreground">
                      <span>{DEAL_TYPE[d.type]}</span>
                      <span aria-hidden>·</span>
                      <span className="text-ink-2">{d.stage}</span>
                      {showCompany && d.company && (
                        <>
                          <span aria-hidden>·</span>
                          <Link href={`/resources/companies/${d.company.id}`} className="hover:text-foreground hover:underline">
                            {d.company.name}
                          </Link>
                        </>
                      )}
                      {d.owner && (
                        <>
                          <span aria-hidden>·</span>
                          <PersonName person={d.owner} />
                        </>
                      )}
                    </div>
                  </div>
                  <div className="ml-auto flex shrink-0 items-start gap-4 text-right text-xs">
                    <div>
                      <div className="font-semibold text-foreground tabular">{formatUsd(d.value)}</div>
                      <div className="text-2xs text-muted-foreground tabular">{d.probability}% probability</div>
                    </div>
                    <div className="w-[86px]">
                      {open ? <DueLabel date={d.expectedClose} today={today} /> : <span className="text-muted-foreground">Closed</span>}
                      <div className="text-2xs text-muted-foreground">{d.lastActivityAt ? `Active ${timeAgo(d.lastActivityAt, now)}` : "No activity"}</div>
                    </div>
                  </div>
                </div>
                {d.nextStep && open && (
                  <p className="mt-1 text-xs text-ink-2">
                    <span className="text-muted-foreground">Next step:</span> {d.nextStep}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function DecisionsPanel({ decisions, today, title = "Decisions" }: { decisions: DetailDecision[]; today: Date; title?: string }) {
  return (
    <Panel id="decisions" title={title} icon={Gavel} count={decisions.length}>
      {decisions.length === 0 ? (
        <EmptyState compact title="No decisions linked" />
      ) : (
        <ul className="divide-y divide-hairline">
          {decisions.map((d) => {
            const meta = DECISION_STATUS[d.status];
            const closed = d.status === "DECIDED" || d.status === "DEFERRED";
            return (
              <li key={d.id}>
                <Link href={`/decisions/${d.id}`} className="block px-3.5 py-2.5 hover:bg-muted/50">
                  <div className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 text-[15px] leading-snug font-medium text-foreground">{d.title}</span>
                    <StatusPill tone={meta.tone} label={meta.label} />
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-2xs text-muted-foreground">
                    <span>Impact {d.strategicImpact}/5</span>
                    {d.deadline && !closed && (
                      <>
                        <span aria-hidden>·</span>
                        <DueLabel date={d.deadline} today={today} />
                      </>
                    )}
                  </div>
                  {d.finalDecision && <p className="mt-1 line-clamp-2 text-xs text-ink-2">Decided: {d.finalDecision}</p>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function IntelFeed({ items, now, emptyHint }: { items: IntelItem[]; now: Date; emptyHint: string }) {
  const insights = items.filter((i) => i.entry === "insight").length;
  const signals = items.length - insights;
  return (
    <Panel
      id="intelligence"
      title="Brain intelligence"
      icon={Brain}
      count={items.length}
      actions={items.length > 0 ? <span className="text-2xs text-muted-foreground">{insights} insights · {signals} signals</span> : undefined}
    >
      {items.length === 0 ? (
        <EmptyState compact icon={Brain} title="No intelligence yet" description={emptyHint} />
      ) : (
        <ol className="max-h-[560px] divide-y divide-hairline overflow-y-auto scrollbar-thin">
          {items.map((it) => {
            if (it.entry === "insight") {
              const meta = INSIGHT_TYPES[it.type];
              const Icon = meta.icon;
              return (
                <li key={`i-${it.id}`} className="flex gap-3 px-3.5 py-2.5">
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-brain-soft" aria-hidden>
                    <Icon className={cn("size-3.5", TONE_TEXT[meta.tone])} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                      <p className="min-w-0 flex-1 text-[15px] leading-snug font-medium text-foreground">{it.title}</p>
                      <time dateTime={it.occurredAt.toISOString()} className="shrink-0 text-2xs text-muted-foreground">
                        {timeAgo(it.occurredAt, now)}
                      </time>
                    </div>
                    {it.summary && <p className="mt-0.5 line-clamp-3 text-xs text-ink-2">{it.summary}</p>}
                    {it.recommendation && <p className="mt-1 text-xs text-foreground">→ {it.recommendation}</p>}
                    <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-2xs text-muted-foreground">
                      <span className="font-medium text-brain">Insight</span>
                      <span aria-hidden>·</span>
                      <span>{meta.label}</span>
                      <span aria-hidden>·</span>
                      <span>Importance {it.importance}/5</span>
                      {it.requiresCeo && (
                        <>
                          <span aria-hidden>·</span>
                          <span className="font-medium text-serious-ink">Needs you</span>
                        </>
                      )}
                      {it.status !== "NEW" && (
                        <>
                          <span aria-hidden>·</span>
                          <span>{it.status === "ACKNOWLEDGED" ? "Acknowledged" : it.status === "ACTIONED" ? "Actioned" : it.status}</span>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              );
            }
            const kind = SIGNAL_KIND[it.kind];
            const Icon = kind.icon;
            return (
              <li key={`s-${it.id}`} className="flex gap-3 px-3.5 py-2.5">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2" aria-hidden>
                  <Icon className="size-3.5 text-ink-3" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2">
                    <p className="min-w-0 flex-1 text-[15px] leading-snug text-foreground">{it.title}</p>
                    <time dateTime={it.occurredAt.toISOString()} className="shrink-0 text-2xs text-muted-foreground">
                      {timeAgo(it.occurredAt, now)}
                    </time>
                  </div>
                  {it.body && <p className="mt-0.5 line-clamp-2 text-xs text-ink-2">{it.body}</p>}
                  <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-2xs text-muted-foreground">
                    <span className="font-medium text-ink-2">Signal</span>
                    <span aria-hidden>·</span>
                    <span>{kind.label}</span>
                    <span aria-hidden>·</span>
                    <span>
                      {it.source.name}
                      {it.sample ? " (sample)" : ""}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}

export function PeoplePanel({
  people,
  now,
}: {
  people: { id: string; name: string; title: string | null; type: keyof typeof PERSON_TYPES; isCeo: boolean; email: string | null; lastContactAt: Date | null }[];
  now: Date;
}) {
  return (
    <Panel id="people" title="People" icon={Users} count={people.length}>
      {people.length === 0 ? (
        <EmptyState compact title="No contacts recorded" description="People at this company appear as they join meetings, deals and threads." />
      ) : (
        <ul className="divide-y divide-hairline">
          {people.map((p) => (
            <li key={p.id}>
              <Link href={`/resources/people/${p.id}`} className="flex items-center gap-2.5 px-3.5 py-2 hover:bg-muted/50">
                <Avatar name={p.name} ceo={p.isCeo} className="size-6 text-[12px]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium text-foreground">{p.isCeo ? "You" : p.name}</span>
                  <span className="block truncate text-2xs text-muted-foreground">{[p.title, PERSON_TYPES[p.type].label].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="shrink-0 text-2xs text-muted-foreground">{p.lastContactAt ? timeAgo(p.lastContactAt, now) : "No contact"}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function ResourcesPanel({ resources, addHint }: { resources: DetailResource[]; addHint: string }) {
  return (
    <Panel id="resources" title="Resources" icon={FolderOpen} count={resources.length} href={resources.length ? "/resources" : undefined} hrefLabel="Resource center">
      {resources.length === 0 ? (
        <EmptyState compact title="No resources linked" description={addHint} />
      ) : (
        <ul className="divide-y divide-hairline">
          {resources.map((r) => {
            const meta = RESOURCE_TYPES[r.type];
            const Icon = meta.icon;
            const href = safeHref(r.url);
            return (
              <li key={r.id} className="flex items-start gap-2.5 px-3.5 py-2">
                <Icon className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden />
                <div className="min-w-0 flex-1">
                  <Link href={`/resources?resource=${r.id}`} className="block truncate text-[15px] text-foreground hover:underline">
                    {r.title}
                  </Link>
                  <span className="block truncate text-2xs text-muted-foreground">{r.summary ?? meta.label}</span>
                </div>
                {href && (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded p-0.5 text-ink-3 hover:bg-muted hover:text-foreground" aria-label={`Open ${r.title} in a new tab`}>
                    <ArrowUpRight className="size-3.5" aria-hidden />
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function NotesPanel({ notes, timezone, extra }: { notes: DetailNote[]; timezone: string; extra?: React.ReactNode }) {
  return (
    <Panel id="notes" title="Notes" icon={NotebookPen} count={notes.length + (extra ? 1 : 0)}>
      {notes.length === 0 && !extra ? (
        <EmptyState compact title="No notes yet" />
      ) : (
        <ul className="divide-y divide-hairline">
          {extra && <li className="px-3.5 py-2.5">{extra}</li>}
          {notes.map((n) => (
            <li key={n.id} className="px-3.5 py-2.5">
              <p className="text-xs whitespace-pre-line text-ink-2">{n.body}</p>
              <p className="mt-1 text-2xs text-muted-foreground">
                {n.author} · {formatDateTime(n.createdAt, timezone)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function ActivityPanel({ activities, now, timezone }: { activities: DetailActivity[]; now: Date; timezone: string }) {
  return (
    <Panel id="activity" title="Activity" icon={History} count={activities.length}>
      {activities.length === 0 ? (
        <EmptyState compact title="No activity recorded" />
      ) : (
        <ol className="max-h-[420px] overflow-y-auto px-3.5 py-2 scrollbar-thin">
          {activities.map((a) => (
            <li key={a.id} className="relative border-l border-hairline py-1.5 pl-3.5">
              <span className="absolute top-3 -left-[3px] size-1.5 rounded-full bg-ink-3" aria-hidden />
              <p className="text-xs text-ink-2">{a.summary}</p>
              <p className="text-2xs text-muted-foreground" title={formatDateTime(a.createdAt, timezone)}>
                {a.actor === "CEO" ? "You" : a.actor} · {timeAgo(a.createdAt, now)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
