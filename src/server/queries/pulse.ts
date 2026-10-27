/**
 * Daily Pulse: where things stand today, on one page — the Brain's takeaway,
 * the standing flags (overdue work, open risks), what needs the CEO's call,
 * the fundraising pipeline and how many meetings were held. Everything is
 * read live from the workspace; sections that depend on a source that isn't
 * connected say which one to connect.
 */
import type { InboxType } from "@/generated/prisma/enums";
import type { Tone } from "@/lib/domain";
import { db } from "@/lib/db";
import { addDays, dayKey, dayKeyInTz, dayStartInstant, daysBetween, toDay } from "@/lib/dates";
import { formatCurrency } from "@/lib/format";
import { getCeoContext } from "@/server/context";

export interface PulseFlag {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: Tone;
  href: string;
}

export interface PulseCall {
  id: string;
  title: string;
  why: string;
  action: string;
  due: Date | null;
  urgency: number;
}

export interface PulseInvestor {
  id: string;
  investor: string;
  status: string;
  tone: Tone;
  note: string;
}

export interface PulseData {
  today: Date;
  timezone: string;
  takeaway: { text: string; isToday: boolean; date: Date } | null;
  flags: PulseFlag[];
  calls: PulseCall[];
  reviewPending: number;
  investors: PulseInvestor[];
  meetings: { day: string; count: number }[];
  meetingsWithNotes: number;
  connected: { crm: boolean; calendar: boolean; notes: boolean };
}

/** Inbox items that are a call only the CEO can make. */
const CALL_TYPES: InboxType[] = ["DECISION", "APPROVAL", "HIRING_DECISION", "ESCALATION"];
const MEETING_DAYS = 14;
const OPEN_TASK = { notIn: ["DONE", "CANCELLED"] as ("DONE" | "CANCELLED")[] };

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export async function getPulseData(): Promise<PulseData> {
  const ceo = await getCeoContext();
  const { today, timezone } = ceo;
  const windowStart = addDays(today, -(MEETING_DAYS - 1));
  const windowStartInstant = dayStartInstant(windowStart, timezone);
  const windowEndInstant = dayStartInstant(addDays(today, 1), timezone);

  const [brief, overdueTasks, overdueCommitments, risks, calls, reviewPending, deals, meetings, looseNotes, connections] = await Promise.all([
    db.dailyBrief.findUnique({ where: { date: today } }).then((b) => b ?? db.dailyBrief.findFirst({ orderBy: { date: "desc" } })),
    db.task.findMany({ where: { status: OPEN_TASK, dueDate: { lt: today } }, orderBy: { dueDate: "asc" }, select: { title: true, dueDate: true }, take: 50 }),
    db.commitment.findMany({ where: { status: "OPEN", direction: "OUTBOUND", dueDate: { lt: today } }, orderBy: { dueDate: "asc" }, select: { title: true, dueDate: true }, take: 50 }),
    db.risk.findMany({ where: { status: { in: ["OPEN", "MONITORING"] } }, orderBy: [{ severity: "desc" }, { identifiedAt: "asc" }], take: 3, select: { id: true, title: true, category: true, severity: true, identifiedAt: true, mitigation: true, description: true } }),
    db.inboxItem.findMany({
      where: { status: "OPEN", type: { in: CALL_TYPES } },
      orderBy: [{ urgency: "desc" }, { dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      take: 6,
      select: { id: true, title: true, whyCeo: true, recommendedAction: true, dueDate: true, urgency: true },
    }),
    db.reviewQueueItem.count({ where: { status: "PENDING" } }),
    db.deal.findMany({
      where: { type: "FUNDRAISING", OR: [{ status: "OPEN" }, { status: { in: ["WON", "LOST"] }, updatedAt: { gte: addDays(today, -60) } }] },
      orderBy: [{ probability: "desc" }, { value: { sort: "desc", nulls: "last" } }],
      take: 12,
      select: { id: true, name: true, status: true, stage: true, probability: true, value: true, nextStep: true, lastActivityAt: true, company: { select: { name: true } } },
    }),
    db.meeting.findMany({
      where: { startsAt: { gte: windowStartInstant, lt: windowEndInstant }, status: { not: "CANCELLED" } },
      select: { startsAt: true, notesProcessedAt: true, _count: { select: { sourceItems: { where: { kind: "MEETING_NOTES" } } } } },
    }),
    // Notes (Granola, Read AI, typed in) that matched no calendar meeting still count as a meeting logged.
    db.sourceItem.findMany({ where: { kind: "MEETING_NOTES", meetingId: null, occurredAt: { gte: windowStartInstant, lt: windowEndInstant } }, select: { occurredAt: true } }),
    db.sourceConnection.groupBy({ by: ["kind"], where: { status: { not: "DISCONNECTED" } }, _count: true }),
  ]);

  // ── Standing flags ──
  const flags: PulseFlag[] = [];
  const overdue = [...overdueTasks, ...overdueCommitments].sort((a, b) => (a.dueDate?.getTime() ?? 0) - (b.dueDate?.getTime() ?? 0));
  const oldest = overdue[0];
  flags.push({
    id: "overdue",
    label: "Overdue deadlines",
    value: String(overdue.length),
    detail: oldest?.dueDate ? `Oldest: ${oldest.title} — ${plural(daysBetween(oldest.dueDate, today), "day")} late` : "Nothing past due",
    tone: overdue.length > 0 ? "critical" : "good",
    href: "/tasks?view=overdue",
  });
  for (const r of risks) {
    const open = Math.max(0, daysBetween(toDay(r.identifiedAt, timezone), today));
    flags.push({
      id: `risk-${r.id}`,
      label: r.title,
      value: open === 0 ? "New today" : `${plural(open, "day")} open`,
      detail: r.mitigation ?? r.description ?? (r.category ? `${r.category.charAt(0)}${r.category.slice(1).toLowerCase()} risk` : "Open risk"),
      tone: r.severity >= 4 ? "critical" : r.severity === 3 ? "warning" : "neutral",
      href: "/risks",
    });
  }
  if (!risks.length) flags.push({ id: "risks", label: "Open risks", value: "0", detail: "Nothing flagged", tone: "good", href: "/risks" });

  // ── Fundraising ──
  const investors: PulseInvestor[] = deals.map((d) => {
    const quiet = d.lastActivityAt ? daysBetween(toDay(d.lastActivityAt, timezone), today) : null;
    const parts = [d.value ? formatCurrency(d.value) : null, d.nextStep ?? (quiet !== null && quiet >= 14 ? `No activity in ${quiet} days` : null)].filter(Boolean);
    if (d.status === "WON") return { id: d.id, investor: d.company?.name ?? d.name, status: "Committed", tone: "good", note: parts.join(" · ") };
    if (d.status === "LOST") return { id: d.id, investor: d.company?.name ?? d.name, status: "Declined", tone: "critical", note: parts.join(" · ") };
    return { id: d.id, investor: d.company?.name ?? d.name, status: d.stage, tone: d.probability >= 70 ? "good" : quiet !== null && quiet >= 14 ? "serious" : "warning", note: parts.join(" · ") };
  });

  // ── Meetings per day (CEO's timezone) ──
  const byDay = new Map<string, number>();
  for (let i = 0; i < MEETING_DAYS; i++) byDay.set(dayKey(addDays(windowStart, i)), 0);
  for (const m of meetings) {
    const k = dayKeyInTz(m.startsAt, timezone);
    if (byDay.has(k)) byDay.set(k, (byDay.get(k) ?? 0) + 1);
  }
  for (const n of looseNotes) {
    const k = dayKeyInTz(n.occurredAt, timezone);
    if (byDay.has(k)) byDay.set(k, (byDay.get(k) ?? 0) + 1);
  }
  const withNotes = meetings.filter((m) => m.notesProcessedAt || m._count.sourceItems > 0).length + looseNotes.length;

  const kinds = new Set(connections.map((c) => c.kind));
  return {
    today,
    timezone,
    takeaway: brief?.headline ? { text: brief.headline, isToday: brief.date.getTime() === today.getTime(), date: brief.date } : null,
    flags,
    calls: calls.map((c) => ({ id: c.id, title: c.title, why: c.whyCeo, action: c.recommendedAction, due: c.dueDate, urgency: c.urgency })),
    reviewPending,
    investors,
    meetings: [...byDay.entries()].map(([day, count]) => ({ day, count })),
    meetingsWithNotes: withNotes,
    connected: { crm: kinds.has("CRM"), calendar: kinds.has("CALENDAR"), notes: kinds.has("MEETINGS") },
  };
}
