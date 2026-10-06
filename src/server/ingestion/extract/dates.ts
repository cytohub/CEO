/**
 * Natural-language date resolution for intelligence extraction.
 *
 * Every phrase ("by Friday", "next week", "Oct 14th", "within 30 days")
 * resolves to a calendar day (YYYY-MM-DD) relative to a reference instant —
 * the message's sent time, an event start or a document's modification time —
 * in the CEO's IANA timezone. The reference instant is first converted to the
 * CEO's local calendar day, so a message sent at 23:30 in New York on a
 * Thursday is "Thursday" even though it is already Friday in UTC; after that
 * all arithmetic is on whole calendar days, which is immune to DST shifts.
 *
 * Conventions (deliberate, documented choices):
 *  - "<weekday>", "on/by/this/until <weekday>": the next occurrence counting
 *    today, so "by Friday" written on a Friday means today.
 *  - "next <weekday>" and "this coming <weekday>": the next occurrence strictly
 *    after today (1–7 days ahead). We do not try to guess the "week after"
 *    reading; the original phrase is kept in `text` for a human to see.
 *  - "next week" / "early next week" / "the following week": Monday of next
 *    week — the earliest day the phrase can mean, so nothing is reported late.
 *  - "end of (the) week", "EOW", "this week", "later this week": Friday of the
 *    current Monday–Sunday week; on a Saturday or Sunday, the next Friday.
 *  - "<Month> <day>" without a year: the closest such day, preferring the
 *    future — dates up to ~3 months in the past keep the current year
 *    ("the Sept 30 deadline" written on Oct 6), older ones roll forward.
 *  - "end of month/quarter/year": the last day of the current period.
 *  - "mid-<Month>": the 15th; "end of <Month>": that month's last day.
 *  - "the 14th": day 14 of this month, or of next month when already past.
 *  - "hard" deadlines: phrased with by / no later than / before / due /
 *    deadline / within.
 */
import { addDays, dayFromKey, dayKey, endOfMonth, startOfWeek, toDay } from "@/lib/dates";

export interface ResolvedDate {
  /** YYYY-MM-DD calendar day. */
  date: string;
  /** The phrase as written, including its preposition ("by Friday"). */
  text: string;
  /** Phrased as a deadline (by / no later than / before / due / deadline / within). */
  hard: boolean;
  /** Offset of `text` in the analyzed string. */
  index: number;
  end: number;
}

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
  aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6,
};
const WEEKDAY_FULL_RE = "(sunday|monday|tuesday|wednesday|thursday|friday|saturday)";
const WEEKDAY_ABBR_RE = "(sun|mon|tues?|wed|thu(?:rs?)?|fri|sat)\\.?";

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  fourteen: 14, fifteen: 15, twenty: 20, thirty: 30, sixty: 60, ninety: 90, "a couple of": 2, "a couple": 2, "a few": 3, couple: 2, few: 3,
};
const COUNT_RE = "(\\d{1,3}|a couple of|a couple|a few|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fourteen|fifteen|twenty|thirty|sixty|ninety)";

/** Prepositions that open a date phrase; captured into `text`. */
const PREFIX_RE = /(?:^|[\s(,;:])((?:no|not) later than|by|on|before|until|till|due(?:\s+(?:on|by))?|deadline(?:\s+(?:is|of))?:?|for)\s+$/i;
const HARD_PREFIX = /^(?:(?:no|not) later than|by|before|due|deadline)/i;
const HARD_CONTEXT = /\b(?:deadline|due|no later than|latest by|hard stop)\b[^.!?\n]{0,30}$/i;

type Resolver = (m: RegExpExecArray, ref: Date) => Date | null;

interface Rule {
  re: RegExp;
  resolve: Resolver;
  /** Only accept the match when a preposition precedes it (abbreviations, bare numbers). */
  needsPrefix?: boolean;
  hard?: boolean;
}

// ─── Calendar helpers (calendar days are Dates at 00:00 UTC) ────────────────

function makeDay(year: number, month: number, day: number): Date | null {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month, day));
  return d.getUTCMonth() === month && d.getUTCDate() === day ? d : null;
}

/** Closest occurrence of month/day around `ref`, preferring the future (past days weigh 3×). */
function nearestYear(month: number, day: number, ref: Date): Date | null {
  const y = ref.getUTCFullYear();
  let best: Date | null = null;
  let bestCost = Infinity;
  for (const year of [y - 1, y, y + 1]) {
    const d = makeDay(year, month, day);
    if (!d) continue;
    const diff = (d.getTime() - ref.getTime()) / 86_400_000;
    const cost = diff >= 0 ? diff : -diff * 3;
    if (cost < bestCost) {
      bestCost = cost;
      best = d;
    }
  }
  return best;
}

function nextWeekday(ref: Date, target: number, strictlyAfter: boolean): Date {
  let offset = (target - ref.getUTCDay() + 7) % 7;
  if (offset === 0 && strictlyAfter) offset = 7;
  return addDays(ref, offset);
}

function fridayOfWeek(ref: Date): Date {
  const friday = addDays(startOfWeek(ref), 4);
  return friday.getTime() < ref.getTime() ? addDays(friday, 7) : friday;
}

function addMonths(ref: Date, n: number): Date {
  const y = ref.getUTCFullYear();
  const m = ref.getUTCMonth() + n;
  const last = endOfMonth(new Date(Date.UTC(y, m, 1))).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(ref.getUTCDate(), last)));
}

function addBusinessDays(ref: Date, n: number): Date {
  let d = ref;
  let left = n;
  while (left > 0) {
    d = addDays(d, 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return d;
}

function endOfQuarter(ref: Date, quarter?: number): Date {
  const q = quarter ?? Math.floor(ref.getUTCMonth() / 3);
  return new Date(Date.UTC(ref.getUTCFullYear(), q * 3 + 3, 0));
}

function count(word: string): number | null {
  const w = word.toLowerCase();
  if (/^\d+$/.test(w)) return Number(w);
  return NUMBER_WORDS[w] ?? null;
}

function monthIndex(word: string): number | null {
  const w = word.toLowerCase().replace(/\.$/, "");
  return w in MONTHS ? MONTHS[w] : null;
}

function year4(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return raw.length === 2 ? 2000 + n : n;
}

// ─── Rules ───────────────────────────────────────────────────────────────────

const RULES: Rule[] = [
  // ISO 2026-10-14
  { re: /\b(\d{4})-(\d{2})-(\d{2})\b/gi, resolve: (m) => makeDay(Number(m[1]), Number(m[2]) - 1, Number(m[3])) },
  // [Friday,] October 14[th][, 2026]
  {
    re: new RegExp(`\\b(?:(?:${WEEKDAY_FULL_RE}|${WEEKDAY_ABBR_RE}),?\\s+)?${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, "gi"),
    resolve: (m, ref) => {
      const month = monthIndex(m[3]);
      if (month == null) return null;
      const day = Number(m[4]);
      const y = year4(m[5]);
      return y ? makeDay(y, month, day) : nearestYear(month, day, ref);
    },
  },
  // [the] 14[th] [of] October[, 2026]
  {
    re: new RegExp(`\\b(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\b\\.?(?:,?\\s+(\\d{4}))?`, "gi"),
    resolve: (m, ref) => {
      const month = monthIndex(m[2]);
      if (month == null) return null;
      const y = year4(m[3]);
      return y ? makeDay(y, month, Number(m[1])) : nearestYear(month, Number(m[1]), ref);
    },
  },
  // mid-October / middle of October / end of October / beginning of October
  {
    re: new RegExp(`\\b(mid-?\\s?|middle of\\s+|(?:the\\s+)?end of\\s+|(?:the\\s+)?(?:beginning|start) of\\s+)${MONTH_RE}\\b(?:,?\\s+(\\d{4}))?`, "gi"),
    resolve: (m, ref) => {
      const month = monthIndex(m[2]);
      if (month == null) return null;
      const kind = m[1].toLowerCase();
      const y = year4(m[3]);
      const pick = (day: number) => (y ? makeDay(y, month, day) : nearestYear(month, day, ref));
      if (kind.includes("end")) {
        const first = pick(1);
        return first ? endOfMonth(first) : null;
      }
      if (kind.includes("beginning") || kind.includes("start")) return pick(1);
      return pick(15);
    },
  },
  // US numeric 10/14[/2026]
  {
    re: /(?<![\d/.])\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?\b(?!\/\d)(?!\s*(?:of|th|rd|nd|st)\b)/gi,
    resolve: (m, ref) => {
      const month = Number(m[1]) - 1;
      const day = Number(m[2]);
      // Common fractions are not dates.
      if (!m[3] && ["1/2", "1/3", "2/3", "1/4", "3/4"].includes(`${m[1]}/${m[2]}`)) return null;
      const y = year4(m[3]);
      return y ? makeDay(y, month, day) : nearestYear(month, day, ref);
    },
  },
  // day after tomorrow / tomorrow / today / tonight / EOD / COB
  {
    re: /\b(the day after tomorrow|day after tomorrow|tomorrow|tmrw|today|tonight|this (?:morning|afternoon|evening)|(?:the )?end of (?:the )?day(?: today)?|end of today|eod|cob|close of business)(?:\s+(?:eod|cob|end of day|morning|afternoon|evening|night))?\b/gi,
    resolve: (m, ref) => {
      const w = m[1].toLowerCase();
      if (w.includes("after tomorrow")) return addDays(ref, 2);
      if (w === "tomorrow" || w === "tmrw") return addDays(ref, 1);
      return ref;
    },
  },
  // end of next week
  { re: /\b(?:the\s+)?end\s+of\s+next\s+week\b/gi, resolve: (_m, ref) => addDays(startOfWeek(ref), 11) },
  // end of (the|this) week / EOW / this week / later this week
  { re: /\b(?:(?:the\s+)?end\s+of\s+(?:the\s+|this\s+)?week|eow|(?:later\s+)?this\s+week)\b/gi, resolve: (_m, ref) => fridayOfWeek(ref) },
  // next week / early next week / the following week
  { re: /\b(?:(?:early\s+)?next\s+week|the\s+following\s+week)\b/gi, resolve: (_m, ref) => addDays(startOfWeek(ref), 7) },
  // end of next month
  { re: /\b(?:the\s+)?end\s+of\s+next\s+month\b/gi, resolve: (_m, ref) => endOfMonth(addMonths(new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1)), 1)) },
  // end of (the) month / EOM / month-end
  { re: /\b(?:(?:the\s+)?end\s+of\s+(?:the\s+|this\s+)?month|eom|month[- ]end)\b/gi, resolve: (_m, ref) => endOfMonth(ref) },
  // end of Q3
  {
    re: /\b(?:the\s+)?end\s+of\s+q([1-4])\b(?:\s+(\d{4}))?/gi,
    resolve: (m, ref) => {
      const q = Number(m[1]) - 1;
      const y = year4(m[2]);
      if (y) return new Date(Date.UTC(y, q * 3 + 3, 0));
      const end = endOfQuarter(ref, q);
      // A quarter that ended more than ~3 months ago means next year's.
      return end.getTime() < ref.getTime() - 92 * 86_400_000 ? new Date(Date.UTC(end.getUTCFullYear() + 1, q * 3 + 3, 0)) : end;
    },
  },
  // end of (the) quarter / EOQ / quarter-end
  { re: /\b(?:(?:the\s+)?end\s+of\s+(?:the\s+|this\s+)?quarter|eoq|quarter[- ]end)\b/gi, resolve: (_m, ref) => endOfQuarter(ref) },
  // end of (the) year / EOY / year-end
  { re: /\b(?:(?:the\s+)?end\s+of\s+(?:the\s+|this\s+)?year|eoy|year[- ]end)\b/gi, resolve: (_m, ref) => new Date(Date.UTC(ref.getUTCFullYear(), 11, 31)) },
  // in / within / over the next N days|weeks|months, N business days
  {
    re: new RegExp(`\\b(in|within|over the next|in the next)\\s+${COUNT_RE}\\s+(business\\s+|working\\s+)?(day|week|month)s?\\b`, "gi"),
    resolve: (m, ref) => {
      const n = count(m[2]);
      if (n == null || n > 400) return null;
      const unit = m[4].toLowerCase();
      if (unit === "month") return addMonths(ref, n);
      if (unit === "week") return addDays(ref, n * 7);
      return m[3] ? addBusinessDays(ref, n) : addDays(ref, n);
    },
  },
  // N days|weeks from now|today
  {
    re: new RegExp(`\\b${COUNT_RE}\\s+(day|week)s?\\s+from\\s+(?:now|today)\\b`, "gi"),
    resolve: (m, ref) => {
      const n = count(m[1]);
      if (n == null || n > 400) return null;
      return addDays(ref, m[2].toLowerCase() === "week" ? n * 7 : n);
    },
  },
  // next / this coming <weekday>
  {
    re: new RegExp(`\\b(?:next|this\\s+coming|coming)\\s+(?:${WEEKDAY_FULL_RE}|${WEEKDAY_ABBR_RE})\\b`, "gi"),
    resolve: (m, ref) => nextWeekday(ref, WEEKDAYS[(m[1] ?? m[2]).toLowerCase().replace(/\.$/, "")], true),
  },
  // [this] <weekday> (full names)
  {
    re: new RegExp(`\\b(?:this\\s+)?${WEEKDAY_FULL_RE}\\b`, "gi"),
    resolve: (m, ref) => nextWeekday(ref, WEEKDAYS[m[1].toLowerCase()], false),
  },
  // by/on Fri. (abbreviations only after a preposition — "sat", "wed" are words too)
  {
    re: new RegExp(`\\b${WEEKDAY_ABBR_RE}(?![\\w'])`, "gi"),
    resolve: (m, ref) => nextWeekday(ref, WEEKDAYS[m[1].toLowerCase()], false),
    needsPrefix: true,
  },
  // the 14th (of this month, or next month when past)
  {
    re: /\bthe\s+(\d{1,2})(?:st|nd|rd|th)\b(?!\s+(?:century|percentile|anniversary|floor|time|place|round|edition|birthday|annual|largest|biggest|patient|donor|heart|site|of\s+[a-z]))/gi,
    resolve: (m, ref) => {
      const day = Number(m[1]);
      for (let k = 0; k < 3; k++) {
        const base = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + k, 1));
        const d = makeDay(base.getUTCFullYear(), base.getUTCMonth(), day);
        if (d && d.getTime() >= ref.getTime()) return d;
      }
      return null;
    },
  },
];

// ─── Public API ──────────────────────────────────────────────────────────────

/** The CEO's calendar day for a reference instant. */
export function referenceDay(ref: Date, timeZone: string): Date {
  return toDay(ref, timeZone);
}

/**
 * Every date phrase in `text`, in reading order, resolved relative to `ref`
 * (an instant) in `timeZone`. Overlapping candidates keep the longest phrase.
 */
export function findDates(text: string, ref: Date, timeZone: string): ResolvedDate[] {
  if (!text) return [];
  const refDay = referenceDay(ref, timeZone);
  const candidates: { start: number; end: number; day: Date; rule: Rule }[] = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(text))) {
      if (m[0].length === 0) {
        rule.re.lastIndex++;
        continue;
      }
      const day = rule.resolve(m, refDay);
      if (!day) continue;
      candidates.push({ start: m.index, end: m.index + m[0].length, day, rule });
    }
  }
  // Longest phrase wins ("Friday, October 9" over "Friday"), then reading order.
  candidates.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const kept: typeof candidates = [];
  for (const c of candidates) if (!kept.some((k) => c.start < k.end && k.start < c.end)) kept.push(c);
  kept.sort((a, b) => a.start - b.start);

  const out: ResolvedDate[] = [];
  for (const c of kept) {
    const before = text.slice(Math.max(0, c.start - 40), c.start);
    const prefix = PREFIX_RE.exec(before);
    if (c.rule.needsPrefix && !prefix) continue;
    const start = prefix ? c.start - (before.length - before.lastIndexOf(prefix[1])) : c.start;
    const phrase = text.slice(start, c.end).replace(/\s+/g, " ").trim();
    const hard = Boolean(c.rule.hard) || (prefix ? HARD_PREFIX.test(prefix[1]) : false) || /^within\b/i.test(phrase) || HARD_CONTEXT.test(before);
    out.push({ date: dayKey(c.day), text: phrase, hard, index: start, end: c.end });
  }
  return out;
}

/** The most deadline-like date in `text` (first hard one, else the first one), or null. */
export function resolveDate(text: string, ref: Date, timeZone: string): ResolvedDate | null {
  const all = findDates(text, ref, timeZone);
  return all.find((d) => d.hard) ?? all[0] ?? null;
}

/** "Fri, Oct 9" for a YYYY-MM-DD day (used in summaries and recommended actions). */
export function formatDayShort(key: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(dayFromKey(key));
}

/** Whole days from the reference day to `key` (negative when past). */
export function daysFrom(key: string, ref: Date, timeZone: string): number {
  return Math.round((dayFromKey(key).getTime() - referenceDay(ref, timeZone).getTime()) / 86_400_000);
}
