/**
 * Date handling for the command center.
 *
 * Two kinds of values flow through the app:
 *  - Calendar days (task due dates, milestone dates, day plans). Stored as
 *    Postgres DATE and represented in JS as a Date at 00:00 UTC. They must be
 *    formatted in UTC so they never shift by a day.
 *  - Instants (meetings, activity, refreshes). Formatted in the CEO's timezone.
 *
 * "Today" is always the CEO's local calendar day, expressed as a calendar-day
 * Date so it compares directly with stored due dates.
 */

export const DAY_MS = 86_400_000;
export const LOCALE = "en-US";

/** YYYY-MM-DD for the given instant in the given timezone. */
export function dayKeyInTz(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
  return parts; // en-CA formats as YYYY-MM-DD
}

/** Calendar-day Date (00:00 UTC) from a YYYY-MM-DD key. */
export function dayFromKey(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

/** YYYY-MM-DD for a calendar-day Date. */
export function dayKey(day: Date): string {
  return day.toISOString().slice(0, 10);
}

/** The CEO's current calendar day. */
export function today(timeZone: string, now: Date = new Date()): Date {
  return dayFromKey(dayKeyInTz(now, timeZone));
}

/** Converts any instant to the calendar day it falls on in `timeZone`. */
export function toDay(instant: Date, timeZone: string): Date {
  return dayFromKey(dayKeyInTz(instant, timeZone));
}

export function addDays(day: Date, days: number): Date {
  return new Date(day.getTime() + days * DAY_MS);
}

/** Whole days from `from` to `to` (both calendar days). Negative when `to` is earlier. */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

/** Monday of the week containing `day`. */
export function startOfWeek(day: Date): Date {
  const dow = day.getUTCDay(); // 0 = Sunday
  const offset = dow === 0 ? -6 : 1 - dow;
  return addDays(day, offset);
}

export function startOfMonth(day: Date): Date {
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
}

export function endOfMonth(day: Date): Date {
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0));
}

export function startOfQuarter(day: Date): Date {
  const q = Math.floor(day.getUTCMonth() / 3);
  return new Date(Date.UTC(day.getUTCFullYear(), q * 3, 1));
}

export function quarterKey(day: Date): string {
  return `${day.getUTCFullYear()}-Q${Math.floor(day.getUTCMonth() / 3) + 1}`;
}

/**
 * The UTC instant at which the CEO's calendar day begins. Used to query
 * timestamp columns (meetings, activities) for "today".
 */
export function dayStartInstant(day: Date, timeZone: string): Date {
  // Find the offset of the timezone at roughly that day and correct for it.
  const guess = new Date(day.getTime());
  const offsetMin = tzOffsetMinutes(guess, timeZone);
  const candidate = new Date(day.getTime() - offsetMin * 60_000);
  // Re-check across DST boundaries.
  const offset2 = tzOffsetMinutes(candidate, timeZone);
  return offset2 === offsetMin ? candidate : new Date(day.getTime() - offset2 * 60_000);
}

/** Minutes the timezone is ahead of UTC at the given instant. */
export function tzOffsetMinutes(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(instant).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** Hour of day (0–23) for the instant in the timezone. */
export function hourInTz(instant: Date, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(instant),
  );
}

// ─── Formatting ──────────────────────────────────────────────────────────────

const dayFmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(key: string, opts: Intl.DateTimeFormatOptions) {
  let f = dayFmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(LOCALE, opts);
    dayFmtCache.set(key, f);
  }
  return f;
}

/** "Oct 8" — calendar day. */
export function formatDay(day: Date | null | undefined, withYear = false): string {
  if (!day) return "—";
  return fmt(`d${withYear}`, {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  }).format(day);
}

/** "Wed, Oct 8" — calendar day with weekday. */
export function formatDayLong(day: Date | null | undefined): string {
  if (!day) return "—";
  return fmt("dl", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(day);
}

/** "Tuesday, October 6, 2026" */
export function formatDayFull(day: Date): string {
  return fmt("df", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(day);
}

/** "Oct 2026" */
export function formatMonth(day: Date): string {
  return fmt("m", { timeZone: "UTC", month: "long", year: "numeric" }).format(day);
}

/** "9:30 AM" — instant in timezone. */
export function formatTime(instant: Date, timeZone: string): string {
  return fmt(`t${timeZone}`, { timeZone, hour: "numeric", minute: "2-digit" }).format(instant);
}

/** "Oct 8, 9:30 AM" — instant in timezone. */
export function formatDateTime(instant: Date | null | undefined, timeZone: string): string {
  if (!instant) return "—";
  return fmt(`dt${timeZone}`, {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(instant);
}

/**
 * Human relative label for a calendar day vs today:
 * "Today", "Tomorrow", "Yesterday", "in 3d", "4d overdue" (when overdueStyle).
 */
export function relativeDay(day: Date | null | undefined, todayDay: Date, overdueStyle = true): string {
  if (!day) return "No date";
  const d = daysBetween(todayDay, day);
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d === -1) return overdueStyle ? "1d overdue" : "Yesterday";
  if (d < 0) return overdueStyle ? `${-d}d overdue` : `${-d}d ago`;
  if (d < 7) return `in ${d}d`;
  if (d < 60) return `in ${Math.round(d / 7)}w`;
  return formatDay(day);
}

/** "5m ago", "3h ago", "2d ago" for an instant. */
export function timeAgo(instant: Date | null | undefined, now: Date = new Date()): string {
  if (!instant) return "never";
  const diff = Math.max(0, now.getTime() - instant.getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
}

export function greeting(hour: number): string {
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** Parse a YYYY-MM-DD form value into a calendar day, or null. */
export function parseDayInput(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = dayFromKey(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
