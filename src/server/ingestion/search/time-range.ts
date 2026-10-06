/**
 * Natural-language time ranges ("last 30 days", "next week", "since Monday")
 * resolved against the CEO's calendar day. Pure: callers pass `today` as a
 * calendar-day Date (00:00 UTC) from src/lib/dates.ts.
 */
import { addDays, dayKey, startOfMonth, endOfMonth, startOfQuarter } from "@/lib/dates";
import type { PlanTimeRange, TimePreset } from "./types";

export interface ParsedTimeRange extends PlanTimeRange {
  /** The phrase that matched (removed from the free text). */
  phrase: string;
  /** The range points into the future (deadline-style questions). */
  future: boolean;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fourteen: 14, thirty: 30, ninety: 90 };

const range = (from: Date | null, to: Date | null, label: string, phrase: string, future = false): ParsedTimeRange => ({
  from: from ? dayKey(from) : null,
  to: to ? dayKey(to) : null,
  label,
  phrase,
  future,
});

/** Monday-based week start. */
function weekStart(day: Date): Date {
  const dow = day.getUTCDay();
  return addDays(day, dow === 0 ? -6 : 1 - dow);
}

function num(token: string): number | null {
  if (/^\d{1,3}$/.test(token)) return Number(token);
  return NUMBER_WORDS[token] ?? null;
}

function fmt(day: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(day);
}

/**
 * Find the first time expression in `query`. Returns null when there is none.
 * Matching is case-insensitive and word-bounded.
 */
export function parseTimeRange(query: string, today: Date): ParsedTimeRange | null {
  const q = query.toLowerCase();
  let m: RegExpExecArray | null;

  // last / past / previous N days|weeks|months
  m = /\b(?:in |over |during |from |within )?(?:the )?(last|past|previous) (\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fourteen|thirty|ninety) (day|week|month)s?\b/.exec(q);
  if (m) {
    const n = num(m[2]) ?? 1;
    const days = m[3] === "day" ? n : m[3] === "week" ? n * 7 : n * 30;
    return range(addDays(today, -days), today, `Last ${n} ${m[3]}${n === 1 ? "" : "s"}`, m[0]);
  }
  // next / coming N days|weeks|months
  m = /\b(?:in |over |within )?(?:the )?(next|coming) (\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fourteen|thirty|ninety) (day|week|month)s?\b/.exec(q);
  if (m) {
    const n = num(m[2]) ?? 1;
    const days = m[3] === "day" ? n : m[3] === "week" ? n * 7 : n * 30;
    return range(today, addDays(today, days), `Next ${n} ${m[3]}${n === 1 ? "" : "s"}`, m[0], true);
  }
  m = /\b(this|next|last|previous|past) week\b/.exec(q);
  if (m) {
    const mon = weekStart(today);
    if (m[1] === "this") return range(mon, addDays(mon, 6), `This week (${fmt(mon)}–${fmt(addDays(mon, 6))})`, m[0], true);
    if (m[1] === "next") return range(addDays(mon, 7), addDays(mon, 13), `Next week (${fmt(addDays(mon, 7))}–${fmt(addDays(mon, 13))})`, m[0], true);
    return range(addDays(mon, -7), addDays(mon, -1), `Last week (${fmt(addDays(mon, -7))}–${fmt(addDays(mon, -1))})`, m[0]);
  }
  m = /\b(this|next|last|previous|past) month\b/.exec(q);
  if (m) {
    if (m[1] === "this") return range(startOfMonth(today), endOfMonth(today), "This month", m[0], true);
    if (m[1] === "next") {
      const first = addDays(endOfMonth(today), 1);
      return range(first, endOfMonth(first), "Next month", m[0], true);
    }
    const prevEnd = addDays(startOfMonth(today), -1);
    return range(startOfMonth(prevEnd), prevEnd, "Last month", m[0]);
  }
  m = /\bthis quarter\b/.exec(q);
  if (m) {
    const start = startOfQuarter(today);
    const end = addDays(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 3, 1)), -1);
    return range(start, end, "This quarter", m[0], true);
  }
  m = /\bsince (monday|tuesday|wednesday|thursday|friday|saturday|sunday|yesterday|last week)\b/.exec(q);
  if (m) {
    if (m[1] === "yesterday") return range(addDays(today, -1), today, "Since yesterday", m[0]);
    if (m[1] === "last week") return range(addDays(weekStart(today), -7), today, "Since last week", m[0]);
    const target = WEEKDAYS.indexOf(m[1]);
    // Most recent occurrence, today included ("since Monday" on a Monday = today).
    const back = (today.getUTCDay() - target + 7) % 7;
    const from = addDays(today, -back);
    return range(from, today, `Since ${m[1][0].toUpperCase()}${m[1].slice(1)} (${fmt(from)})`, m[0]);
  }
  m = /\bsince (january|february|march|april|may|june|july|august|september|october|november|december) (\d{1,2})\b/.exec(q);
  if (m) {
    const month = MONTHS.indexOf(m[1]);
    let from = new Date(Date.UTC(today.getUTCFullYear(), month, Number(m[2])));
    if (from > today) from = new Date(Date.UTC(today.getUTCFullYear() - 1, month, Number(m[2])));
    return range(from, today, `Since ${fmt(from)}`, m[0]);
  }
  m = /\b(today|tonight)\b/.exec(q);
  if (m) return range(today, today, "Today", m[0], true);
  m = /\btomorrow\b/.exec(q);
  if (m) return range(addDays(today, 1), addDays(today, 1), "Tomorrow", m[0], true);
  m = /\byesterday\b/.exec(q);
  if (m) return range(addDays(today, -1), addDays(today, -1), "Yesterday", m[0]);
  m = /\b(?:on |by |this )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.exec(q);
  if (m && /\b(due|deadline|meeting|meetings|on|by|this)\b/.test(q)) {
    // "due Friday" / "meetings on Thursday" → the next occurrence (today included).
    const target = WEEKDAYS.indexOf(m[1]);
    const ahead = (target - today.getUTCDay() + 7) % 7;
    const day = addDays(today, ahead);
    return range(day, day, `${m[1][0].toUpperCase()}${m[1].slice(1)} (${fmt(day)})`, m[0], true);
  }
  m = /\b(recent|recently|lately|latest)\b/.exec(q);
  if (m) return range(addDays(today, -30), today, "Last 30 days", m[0]);
  return null;
}

/** UI preset → range. */
export function presetRange(preset: TimePreset, today: Date): ParsedTimeRange {
  switch (preset) {
    case "7d":
      return range(addDays(today, -7), today, "Last 7 days", "");
    case "30d":
      return range(addDays(today, -30), today, "Last 30 days", "");
    case "90d":
      return range(addDays(today, -90), today, "Last 90 days", "");
    case "next7d":
      return range(today, addDays(today, 7), "Next 7 days", "", true);
    case "next30d":
      return range(today, addDays(today, 30), "Next 30 days", "", true);
  }
}
