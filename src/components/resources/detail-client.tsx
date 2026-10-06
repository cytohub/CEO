"use client";

import { CalendarClock, ListPlus, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DueLabel, EmptyState, PersonName } from "@/components/common/bits";
import { PriorityBadge, StatusPill } from "@/components/common/status";
import { useUI } from "@/components/shell/ui-context";
import { formatDateTime, formatTime, dayKeyInTz } from "@/lib/dates";
import { DELEGATION_STATUS, MEETING_TYPES, TASK_STATUS } from "@/lib/domain";
import { cn } from "@/lib/utils";
import type { DetailMeeting, DetailTask, PersonDetail } from "@/server/queries/resources";

/** Header actions on company and person pages. */
export function DetailActions({ subject, companyId, canAddResource = true }: { subject: string; companyId?: string; canAddResource?: boolean }) {
  const { openChief, openCreate } = useUI();
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => openChief(`Show me everything related to ${subject}: where things stand, open commitments, risks, and what I should do next.`)}
      >
        <Sparkles className="text-brain" /> Ask Chief of Staff
      </Button>
      {canAddResource && (
        <Button variant="outline" size="sm" onClick={() => openCreate("resource", companyId ? { companyId } : undefined)}>
          <ListPlus /> Add resource
        </Button>
      )}
      <Button size="sm" onClick={() => openCreate("task", companyId ? { companyId } : undefined)}>
        <Plus /> New task
      </Button>
    </>
  );
}

export function TaskRows({ tasks, today, emptyTitle, showOwner = true }: { tasks: DetailTask[]; today: Date; emptyTitle: string; showOwner?: boolean }) {
  const { openEntity } = useUI();
  if (tasks.length === 0) return <EmptyState compact title={emptyTitle} />;
  return (
    <ul className="divide-y divide-hairline">
      {tasks.map((t) => {
        const done = t.status === "DONE" || t.status === "CANCELLED";
        return (
          <li key={t.id}>
            <button type="button" onClick={() => openEntity("task", t.id)} className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left hover:bg-muted/50">
              <PriorityBadge priority={t.priority} />
              <span className={cn("min-w-0 flex-1 truncate text-[13px]", done ? "text-muted-foreground line-through" : "text-foreground")}>{t.title}</span>
              <span className="hidden sm:inline-flex">
                <StatusPill tone={TASK_STATUS[t.status].tone} label={TASK_STATUS[t.status].label} />
              </span>
              {showOwner && <PersonName person={t.owner} className="hidden w-[130px] shrink-0 text-xs text-ink-2 md:inline-flex" />}
              <DueLabel date={t.dueDate} today={today} done={done} className="w-[78px] shrink-0 text-right text-xs" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function MeetingWhen({ m, timezone }: { m: DetailMeeting; timezone: string }) {
  const sameDay = dayKeyInTz(m.startsAt, timezone) === dayKeyInTz(m.endsAt, timezone);
  return (
    <time dateTime={m.startsAt.toISOString()} className="text-2xs text-muted-foreground tabular">
      {formatDateTime(m.startsAt, timezone)}
      {sameDay ? `–${formatTime(m.endsAt, timezone)}` : ""}
    </time>
  );
}

const EXTERNAL_MEETINGS = new Set(["INVESTOR", "CUSTOMER", "BOARD", "PARTNER", "EXTERNAL", "CANDIDATE"]);

/** Same rule as Today's Upcoming panel: important external meetings get the emphasized Prepare Me. */
function isKeyMeeting(m: DetailMeeting) {
  return m.importance >= 4 && EXTERNAL_MEETINGS.has(m.type);
}

export function MeetingRows({ upcoming, past, timezone }: { upcoming: DetailMeeting[]; past: DetailMeeting[]; timezone: string }) {
  const { openEntity } = useUI();
  if (upcoming.length === 0 && past.length === 0) {
    return <EmptyState compact icon={CalendarClock} title="No meetings yet" description="Meetings sync from the calendar and appear here with their notes." />;
  }
  return (
    <div>
      <div className="border-b border-hairline bg-surface-2/50 px-3.5 py-1 text-2xs font-semibold text-ink-3">Upcoming · {upcoming.length}</div>
      {upcoming.length === 0 ? (
        <p className="px-3.5 py-3 text-xs text-muted-foreground">Nothing scheduled.</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {upcoming.map((m) => (
            <li key={m.id} className="flex items-start gap-3 px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <button type="button" onClick={() => openEntity("meeting", m.id)} className="block max-w-full truncate text-left text-[13px] font-medium text-foreground hover:underline">
                  {m.title}
                </button>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-2xs text-muted-foreground">
                  <MeetingWhen m={m} timezone={timezone} />
                  <span>· {MEETING_TYPES[m.type].label}</span>
                  {m.attendees.length > 0 && <span>· {m.attendees.map((a) => (a.isCeo ? "You" : a.name)).join(", ")}</span>}
                </div>
                {m.objective && <p className="mt-1 line-clamp-2 text-xs text-ink-2">Objective: {m.objective}</p>}
              </div>
              <Button
                variant={!m.preparedAt && isKeyMeeting(m) ? "outline" : "ghost"}
                size="xs"
                onClick={() => openEntity("meeting", m.id)}
                className="shrink-0"
                aria-label={`${m.preparedAt ? "View brief for" : "Prepare me for"} ${m.title}`}
              >
                <Sparkles className="text-brain" /> {m.preparedAt ? "View brief" : "Prepare me"}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="border-y border-hairline bg-surface-2/50 px-3.5 py-1 text-2xs font-semibold text-ink-3">Past · {past.length}</div>
      {past.length === 0 ? (
        <p className="px-3.5 py-3 text-xs text-muted-foreground">No past meetings.</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {past.map((m) => (
            <li key={m.id} className="px-3.5 py-2.5">
              <div className="flex items-start gap-2">
                <button type="button" onClick={() => openEntity("meeting", m.id)} className="min-w-0 flex-1 truncate text-left text-[13px] font-medium text-foreground hover:underline">
                  {m.title}
                </button>
                <MeetingWhen m={m} timezone={timezone} />
              </div>
              {m.notes.length > 0 ? (
                <ul className="mt-1.5 space-y-1.5">
                  {m.notes.slice(0, 2).map((n) => (
                    <li key={n.id} className="rounded-md border-l-2 border-border bg-surface-2/60 px-2.5 py-1.5">
                      <p className="line-clamp-4 text-xs whitespace-pre-line text-ink-2">{n.body}</p>
                      <p className="mt-0.5 text-2xs text-muted-foreground">
                        {n.author} · {formatDateTime(n.createdAt, timezone)}
                      </p>
                    </li>
                  ))}
                  {m.notes.length > 2 && <li className="text-2xs text-muted-foreground">+{m.notes.length - 2} more notes in the meeting</li>}
                </ul>
              ) : m.description ? (
                <p className="mt-1 line-clamp-2 text-xs text-ink-2">{m.description}</p>
              ) : (
                <p className="mt-1 text-2xs text-muted-foreground">No notes captured.</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DelegationRows({ delegations, today }: { delegations: PersonDetail["delegations"]; today: Date }) {
  const { openEntity } = useUI();
  if (delegations.length === 0) return <EmptyState compact title="Nothing delegated to them" />;
  return (
    <ul className="divide-y divide-hairline">
      {delegations.map((d) => {
        const meta = DELEGATION_STATUS[d.status];
        const closed = d.status === "COMPLETED" || d.status === "RECALLED";
        return (
          <li key={d.id}>
            <button type="button" onClick={() => openEntity("task", d.task.id)} className="flex w-full items-start gap-2.5 px-3.5 py-2 text-left hover:bg-muted/50">
              <span className="min-w-0 flex-1">
                <span className={cn("block text-[13px] leading-snug", closed ? "text-muted-foreground" : "text-foreground")}>{d.task.title}</span>
                <span className="mt-1 flex min-w-0 items-center gap-2">
                  <StatusPill tone={meta.tone} label={meta.label} />
                  {d.lastUpdateNote && <span className="truncate text-2xs text-muted-foreground">Latest: {d.lastUpdateNote}</span>}
                </span>
              </span>
              <DueLabel date={d.dueDate} today={today} done={closed} className="shrink-0 text-right text-xs" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
