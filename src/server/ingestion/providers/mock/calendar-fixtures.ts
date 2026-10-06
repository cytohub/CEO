/**
 * Demo calendar for the CytoHub CEO.
 *
 * One event per seeded meeting (prisma/seed-data.ts MEETINGS) with the same
 * title and the same placement the seed uses, so the seed can build meetings
 * from the calendar instead of directly (externalId `demo-evt-<meeting key>`).
 * Plus: the weekly exec meeting as a recurring series, 1:1s, a recruiting
 * final round, legal and product reviews, a personal appointment, a
 * networking dinner, a cancelled meeting, a declined invite, an RSVP that
 * changes after the anchor and the Helix diligence session, which is
 * rescheduled ~3 hours after the anchor (same externalId, new start).
 */
import type { EventStatus, ResponseStatus } from "@/generated/prisma/enums";
import { DAY_MS, addDays } from "@/lib/dates";
import { MEETINGS } from "../../../../../prisma/seed-data";
import type { NormalizedAttendee, NormalizedCalendarEvent, Participant } from "../../types";
import type { Revealable } from "./reveal";
import { HELIX_MOVE, helixMovedStart } from "./scenario";
import type { DemoWorld } from "./world";

type Who = string | { name: string; email: string };

interface EventSpec {
  key: string;
  /** Distinguishes versions of the same event. */
  version?: string;
  revealAt: Date;
  title: string;
  start: Date;
  durationMin: number;
  organizer: Who;
  attendees: { who: Who; response: ResponseStatus; optional?: boolean }[];
  description?: string | null;
  location?: string | null;
  conferenceUrl?: string | null;
  status?: EventStatus;
  series?: { id: string; rule: string };
  allDay?: boolean;
}

/** Small deterministic hash so links and RSVP variety are stable per event. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const zoom = (key: string) => `https://zoom.us/j/${String(8_000_000_000 + (hash(key) % 999_999_999))}`;
const meet = (key: string) => {
  const letters = "abcdefghijkmnopqrstuvwxyz";
  const h = hash(key);
  const pick = (n: number, shift: number) => Array.from({ length: n }, (_, i) => letters[(h >>> ((i + shift) % 24)) % letters.length]).join("");
  return `https://meet.google.com/${pick(3, 0)}-${pick(4, 3)}-${pick(3, 7)}`;
};
const teams = (key: string) => `https://teams.microsoft.com/l/meetup-join/19%3ameeting_${hash(key).toString(36)}${hash(`${key}x`).toString(36)}%40thread.v2/0`;

const HQ = "CytoHub HQ, Board Room";

/** Who organizes a seeded meeting (the CEO unless the counterpart hosts). */
const SEED_ORGANIZER: Record<string, string> = {
  mNorthbridgePartner: "sarah",
  mHelixDiligence: "david",
  mNhiSteering: "ingrid",
  mBrightwaterRedlines: "priya",
  mBrightwaterNeg: "priya",
  mAureliusQbr: "priya",
  mBioEurope: "ben",
};

function seedEvents(w: DemoWorld): EventSpec[] {
  const c = w.clock;
  const out: EventSpec[] = [];
  for (const m of MEETINGS) {
    const start = c.seedMeeting(m.day, m.hour, m.minute ?? 0);
    const past = start.getTime() < c.anchor.getTime();
    const organizer = SEED_ORGANIZER[m.key] ?? "ceo";
    const people = [...new Set(["ceo", ...m.attendees])];
    const attendees = people.map((who, i) => {
      let response: ResponseStatus = "ACCEPTED";
      // Future invites: a realistic mix of pending and tentative answers.
      if (!past && who !== "ceo" && who !== organizer) {
        const r = (hash(m.key) + i) % 7;
        if (r === 0) response = "TENTATIVE";
        else if (r === 1) response = "NEEDS_ACTION";
      }
      return { who, response };
    });
    let location: string | null = m.location ?? null;
    let conferenceUrl: string | null = null;
    let description = m.objective ?? m.description ?? null;
    switch (m.type) {
      case "INVESTOR":
        if (!location) conferenceUrl = zoom(m.key);
        break;
      case "CUSTOMER":
      case "PARTNER":
        // Pharma partners send Teams invites; the link lives only in the body.
        description = `${description ?? m.title}\n\nJoin Microsoft Teams meeting: ${teams(m.key)}`;
        break;
      case "BOARD":
        location = location ?? HQ;
        conferenceUrl = meet(m.key);
        break;
      case "INTERNAL":
      case "ONE_ON_ONE":
        location = location ?? (m.type === "ONE_ON_ONE" ? "CEO office" : HQ);
        conferenceUrl = m.type === "INTERNAL" ? meet(m.key) : null;
        break;
      default:
        break;
    }
    const base: EventSpec = {
      key: m.key,
      revealAt: new Date(Math.min(start.getTime() - 10 * DAY_MS, c.anchor.getTime() - 2 * 3_600_000)),
      title: m.title,
      start,
      durationMin: m.durationMin,
      organizer,
      attendees,
      description,
      location,
      conferenceUrl,
    };

    if (m.key === "mExecWeekly") {
      // A weekly series: last week, this week (the seeded meeting) and the next three.
      const series = { id: "demo-series-exec-weekly", rule: "RRULE:FREQ=WEEKLY;BYDAY=" + ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][(m.day === 0 ? c.today : c.workday(m.day)).getUTCDay()] };
      for (const week of [-1, 0, 1, 2, 3]) {
        const day = addDays(m.day === 0 ? c.today : c.workday(m.day), week * 7);
        const s = c.at(day, m.hour, m.minute ?? 0);
        out.push({
          ...base,
          key: week === 0 ? m.key : `${m.key}-w${week < 0 ? "m" : "p"}${Math.abs(week)}`,
          start: s,
          revealAt: new Date(c.anchor.getTime() - 30 * DAY_MS),
          series,
          attendees: base.attendees.map((a) => ({ ...a, response: "ACCEPTED" as ResponseStatus })),
          description: "Weekly exec sync: priorities, blockers, metrics and decisions needed.",
        });
      }
      continue;
    }

    out.push(base);
    if (m.key === HELIX_MOVE.meetingKey) {
      const moved = helixMovedStart(c);
      out.push({
        ...base,
        version: "rescheduled",
        revealAt: c.hours(HELIX_MOVE.inviteHours),
        start: moved,
        description: `${base.description ?? ""}\n\nMoved at Helix's request so their technical partner can join.`.trim(),
        attendees: base.attendees.map((a) => (a.who === "ceo" ? { ...a, response: "NEEDS_ACTION" as ResponseStatus } : a)),
      });
    }
  }
  return out;
}

function extraEvents(w: DemoWorld): EventSpec[] {
  const c = w.clock;
  const before = (days: number) => c.hours(-24 * days);
  const ostrava = c.at(c.workday(3), 16, 0);
  const productReview = c.at(c.workday(4), 10, 0);
  return [
    {
      key: "oneone-jonas",
      revealAt: before(30),
      title: "1:1 — Jonas Weber",
      start: c.at(c.workday(1), 11, 0),
      durationMin: 30,
      organizer: "ceo",
      attendees: [
        { who: "ceo", response: "ACCEPTED" },
        { who: "jonas", response: "ACCEPTED" },
      ],
      location: "CEO office",
      description: "Runway scenarios, data room status, board pre-read.",
      series: { id: "demo-series-1on1-jonas", rule: "RRULE:FREQ=WEEKLY" },
    },
    {
      key: "oneone-tom",
      revealAt: before(30),
      title: "1:1 — Tom Okafor",
      start: c.at(c.workday(-2), 15, 0),
      durationMin: 30,
      organizer: "ceo",
      attendees: [
        { who: "ceo", response: "ACCEPTED" },
        { who: "tom", response: "ACCEPTED" },
      ],
      location: "CEO office",
      series: { id: "demo-series-1on1-tom", rule: "RRULE:FREQ=WEEKLY" },
    },
    {
      key: "oneone-priya",
      revealAt: before(30),
      title: "1:1 — Priya Raman",
      start: c.at(c.workday(2), 16, 30),
      durationMin: 30,
      organizer: "ceo",
      attendees: [
        { who: "ceo", response: "ACCEPTED" },
        { who: "priya", response: "ACCEPTED" },
      ],
      location: "CEO office",
      description: "Pipeline review: Brightwater, Aurelius expansion, Lumen renewal.",
      series: { id: "demo-series-1on1-priya", rule: "RRULE:FREQ=WEEKLY" },
    },
    {
      key: "recruiting-final-laura",
      revealAt: before(12),
      title: "Final round: Laura Mitchell (VP Sales)",
      start: c.at(c.workday(-5), 15, 0),
      durationMin: 90,
      organizer: "sofia",
      attendees: [
        { who: "ceo", response: "ACCEPTED" },
        { who: "sofia", response: "ACCEPTED" },
        { who: "priya", response: "ACCEPTED" },
        { who: "laura", response: "ACCEPTED" },
      ],
      location: HQ,
      description: "Final-round interview and pharma go-to-market case discussion. Panel: CEO, Sofia, Priya.",
    },
    {
      key: "legal-review-nhi",
      revealAt: before(4),
      title: "Legal review: NHI publication embargo",
      start: c.at(c.workday(1), 13, 0),
      durationMin: 30,
      organizer: "marcus",
      attendees: [
        { who: "ceo", response: "ACCEPTED" },
        { who: "marcus", response: "ACCEPTED" },
        { who: "lea", response: "TENTATIVE", optional: true },
      ],
      conferenceUrl: meet("legal-review-nhi"),
      description: "Agree our position on the 60 vs 90 day publication embargo before term sheet comments go back to NHI.",
    },
    {
      key: "product-review",
      revealAt: before(6),
      title: "Product review: onboarding roadmap",
      start: productReview,
      durationMin: 60,
      organizer: "daniel",
      attendees: [
        { who: "ceo", response: "ACCEPTED" },
        { who: "daniel", response: "ACCEPTED" },
        { who: "tom", response: "NEEDS_ACTION" },
        { who: "priya", response: "ACCEPTED" },
      ],
      location: HQ,
      description: "Roadmap to cut customer onboarding from five weeks to two; assay turnaround dashboard for Lumen.",
    },
    {
      key: "product-review",
      version: "tom-accepts",
      revealAt: c.hours(5),
      title: "Product review: onboarding roadmap",
      start: productReview,
      durationMin: 60,
      organizer: "daniel",
      attendees: [
        { who: "ceo", response: "ACCEPTED" },
        { who: "daniel", response: "ACCEPTED" },
        { who: "tom", response: "ACCEPTED" },
        { who: "priya", response: "ACCEPTED" },
      ],
      location: HQ,
      description: "Roadmap to cut customer onboarding from five weeks to two; assay turnaround dashboard for Lumen.",
    },
    {
      key: "personal-dentist",
      revealAt: before(20),
      title: "Dentist",
      start: c.at(c.workday(5), 8, 0),
      durationMin: 60,
      organizer: "ceo",
      attendees: [],
      location: "Back Bay Dental, 330 Newbury St",
    },
    {
      key: "networking-dinner",
      revealAt: before(9),
      title: "Boston Life Sciences CEO Dinner",
      start: c.at(c.workday(7), 19, 0),
      durationMin: 150,
      organizer: { name: "Boston Life Sciences Forum", email: "events@bostonlifesciences.example" },
      attendees: [
        { who: "ceo", response: "ACCEPTED" },
        { who: "nina", response: "ACCEPTED" },
        { who: { name: "Rebecca Stone", email: "rebecca.stone@harborbio.example" }, response: "ACCEPTED" },
        { who: { name: "Boston Life Sciences Forum", email: "events@bostonlifesciences.example" }, response: "ACCEPTED" },
      ],
      location: "Mistral, 223 Columbus Ave, Boston",
      description: "Invitation-only dinner for life-science CEOs. Topic: AI in drug safety.",
    },
    {
      key: "ostrava-checkin",
      revealAt: before(10),
      title: "Ostrava Pharma: pilot check-in",
      start: ostrava,
      durationMin: 30,
      organizer: "priya",
      attendees: [
        { who: "ceo", response: "ACCEPTED" },
        { who: "priya", response: "ACCEPTED" },
        { who: "paul", response: "ACCEPTED" },
      ],
      conferenceUrl: zoom("ostrava-checkin"),
      description: "Re-engage on the cardiotox screening pilot; share the v2 validation summary.",
    },
    {
      key: "ostrava-checkin",
      version: "cancelled",
      revealAt: c.hours(-20),
      title: "Ostrava Pharma: pilot check-in",
      start: ostrava,
      durationMin: 30,
      organizer: "priya",
      attendees: [
        { who: "ceo", response: "ACCEPTED" },
        { who: "priya", response: "ACCEPTED" },
        { who: "paul", response: "DECLINED" },
      ],
      status: "CANCELLED",
      description: "Cancelled: Paul is travelling and will propose a new date.",
    },
    {
      key: "cellwave-webinar",
      revealAt: before(14),
      title: "Cellwave Instruments: 2027 product roadmap webinar",
      start: c.at(c.workday(2), 12, 0),
      durationMin: 60,
      organizer: { name: "Cellwave Events", email: "events@cellwave.example" },
      attendees: [
        { who: "ceo", response: "DECLINED" },
        { who: "maya", response: "ACCEPTED" },
      ],
      conferenceUrl: zoom("cellwave-webinar"),
      description: "Roadmap for the FlexSense MEA platform and the 2027 instrument line.",
    },
  ];
}

function toEvent(w: DemoWorld, spec: EventSpec): NormalizedCalendarEvent {
  const resolve = (who: Who): Participant => (typeof who === "string" ? { name: w.person(who).name, email: w.person(who).email } : who);
  const organizer = resolve(spec.organizer);
  const attendees: NormalizedAttendee[] = spec.attendees.map((a) => ({ ...resolve(a.who), responseStatus: a.response, optional: Boolean(a.optional) }));
  const own = attendees.find((a) => a.email === w.ceo.email);
  const ceoIsOrganizer = organizer.email === w.ceo.email;
  const externalId = `demo-evt-${spec.key}`;
  const endsAt = new Date(spec.start.getTime() + spec.durationMin * 60_000);
  return {
    externalId,
    iCalUid: `${externalId}@cytohub-demo.example`,
    seriesId: spec.series?.id ?? null,
    title: spec.title,
    description: spec.description ?? null,
    startsAt: spec.start,
    endsAt,
    allDay: Boolean(spec.allDay),
    timezone: w.clock.timezone,
    location: spec.location ?? null,
    conferenceUrl: spec.conferenceUrl ?? null,
    organizer,
    attendees,
    isRecurring: Boolean(spec.series),
    recurrence: spec.series?.rule ?? null,
    status: spec.status ?? "CONFIRMED",
    ceoResponse: ceoIsOrganizer && own?.responseStatus !== "DECLINED" ? "ORGANIZER" : (own?.responseStatus ?? null),
    updatedAt: spec.revealAt,
    webUrl: null,
    raw: { demo: true, key: spec.key, version: spec.version ?? "v1", title: spec.title, start: spec.start.toISOString(), end: endsAt.toISOString(), status: spec.status ?? "CONFIRMED" },
  };
}

/** The demo calendar as revealable versions. */
export function buildCalendarFixtures(w: DemoWorld): Revealable<NormalizedCalendarEvent>[] {
  return [...seedEvents(w), ...extraEvents(w)].map((spec) => ({
    key: `evt:${spec.key}:${spec.version ?? "v1"}`,
    externalId: `demo-evt-${spec.key}`,
    revealAt: spec.revealAt,
    item: toEvent(w, spec),
  }));
}
