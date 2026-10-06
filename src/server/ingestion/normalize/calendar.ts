/**
 * Calendar normalization shared by Google Calendar, Outlook Calendar and the
 * demo adapter: attendee hygiene, conference links, the CEO's own response,
 * and the text / hash material the pipeline uses for change detection.
 */
import type { ResponseStatus } from "@/generated/prisma/enums";
import type { NormalizedAttendee, NormalizedCalendarEvent, Participant } from "../types";

/** Most informative response wins when the same person appears twice. */
const RESPONSE_RANK: Record<ResponseStatus, number> = { ORGANIZER: 5, ACCEPTED: 4, DECLINED: 3, TENTATIVE: 2, NEEDS_ACTION: 1 };

export function dedupeAttendees(attendees: NormalizedAttendee[]): NormalizedAttendee[] {
  const byEmail = new Map<string, NormalizedAttendee>();
  for (const a of attendees) {
    const email = a.email?.trim().toLowerCase();
    if (!email || !email.includes("@")) continue;
    const existing = byEmail.get(email);
    const candidate: NormalizedAttendee = { name: a.name?.trim() || null, email, responseStatus: a.responseStatus, optional: Boolean(a.optional) };
    if (!existing) {
      byEmail.set(email, candidate);
      continue;
    }
    if (!existing.name && candidate.name) existing.name = candidate.name;
    if (RESPONSE_RANK[candidate.responseStatus] > RESPONSE_RANK[existing.responseStatus]) existing.responseStatus = candidate.responseStatus;
    existing.optional = Boolean(existing.optional && candidate.optional);
  }
  return [...byEmail.values()];
}

const CONFERENCE_PATTERNS = [
  /https:\/\/(?:[a-z0-9-]+\.)*zoom\.us\/(?:j|my|w|s)\/[^\s<>"')\]]+/i,
  /https:\/\/meet\.google\.com\/[a-z]{3,4}-[a-z]{3,4}-[a-z]{3,4}[^\s<>"')\]]*/i,
  /https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s<>"')\]]+/i,
  /https:\/\/teams\.live\.com\/meet\/[^\s<>"')\]]+/i,
  /https:\/\/(?:[a-z0-9-]+\.)*webex\.com\/(?:meet|join|[a-z0-9-]+\/j\.php)[^\s<>"')\]]*/i,
  /https:\/\/(?:[a-z0-9-]+\.)*whereby\.com\/[^\s<>"')\]]+/i,
];

/** First Zoom / Meet / Teams / Webex link in any of the given texts. */
export function extractConferenceUrl(...texts: (string | null | undefined)[]): string | null {
  for (const re of CONFERENCE_PATTERNS) {
    for (const text of texts) {
      if (!text) continue;
      const m = text.match(re);
      if (m) return m[0].replace(/[.,;:]+$/, "");
    }
  }
  return null;
}

/** The connected account's own response: its attendee entry, or ORGANIZER when it organizes. */
export function ceoResponseFrom(attendees: NormalizedAttendee[], accountEmail: string | null, organizer?: Participant | null): ResponseStatus | null {
  const me = accountEmail?.toLowerCase();
  if (!me) return null;
  if (organizer?.email?.toLowerCase() === me) return "ORGANIZER";
  const entry = attendees.find((a) => a.email.toLowerCase() === me);
  return entry ? entry.responseStatus : null;
}

/** Final pass every adapter's output goes through before it is stored. */
export function normalizeCalendarEvent(event: NormalizedCalendarEvent, opts: { accountEmail: string | null }): NormalizedCalendarEvent {
  const attendees = dedupeAttendees(event.attendees);
  const organizer = event.organizer?.email ? { name: event.organizer.name?.trim() || null, email: event.organizer.email.trim().toLowerCase() } : null;
  return {
    ...event,
    title: event.title.trim() || "(no title)",
    description: event.description?.trim() || null,
    location: event.location?.trim() || null,
    attendees,
    organizer,
    conferenceUrl: event.conferenceUrl || extractConferenceUrl(event.location, event.description),
    ceoResponse: event.ceoResponse ?? ceoResponseFrom(attendees, opts.accountEmail, organizer),
  };
}

const RESPONSE_LABEL: Record<ResponseStatus, string> = {
  ACCEPTED: "accepted",
  DECLINED: "declined",
  TENTATIVE: "tentative",
  NEEDS_ACTION: "no response",
  ORGANIZER: "organizer",
};

/** Text the Brain reads for an event: title, description, location and attendee lines. */
export function calendarItemText(event: NormalizedCalendarEvent): string {
  const lines = [event.title];
  if (event.status === "CANCELLED") lines.push("Status: cancelled");
  if (event.description) lines.push("", event.description);
  if (event.location) lines.push("", `Location: ${event.location}`);
  if (event.conferenceUrl) lines.push(`Conference: ${event.conferenceUrl}`);
  if (event.organizer) lines.push(`Organizer: ${formatParticipant(event.organizer)}`);
  if (event.attendees.length) {
    lines.push("", "Attendees:");
    for (const a of event.attendees) lines.push(`- ${formatParticipant(a)} (${RESPONSE_LABEL[a.responseStatus]}${a.optional ? ", optional" : ""})`);
  }
  return lines.join("\n").trim();
}

/** Changes that matter even when the text does not: times, status and responses. */
export function calendarHashMaterial(event: NormalizedCalendarEvent): string {
  const responses = event.attendees
    .map((a) => `${a.email}:${a.responseStatus}`)
    .sort()
    .join(",");
  return [event.startsAt.toISOString(), event.endsAt.toISOString(), event.allDay ? "all-day" : "", event.status, event.ceoResponse ?? "", responses].join("|");
}

function formatParticipant(p: Participant) {
  return p.name ? `${p.name} <${p.email}>` : p.email;
}
