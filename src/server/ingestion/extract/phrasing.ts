/**
 * Executive phrasing helpers: everything the rules engine shows the CEO
 * (titles, summaries, recommended actions) goes through these so it reads as
 * a short, specific noun phrase or imperative — never a raw source fragment.
 * Evidence stays verbatim; only the CEO-facing wording is shaped here.
 */
import { dayFromKey, dayKeyInTz } from "@/lib/dates";

const SUFFIX = /\s+(?:Inc\.?|Incorporated|Ltd\.?|Limited|LLC|GmbH|AG|SA|S\.A\.|plc|PLC|Corp\.?|Corporation|Co\.?|Pharma|Pharmaceuticals|Therapeutics|Biosciences|Bio|Biologics|Biotech|Ventures|Capital|Partners|Fund|Instruments|Cloud|Oncology|Labs|Laboratories|Genomics|Diagnostics|Holdings|Group)$/;

/** "Granite Peak Capital" → "Granite Peak", "Cellwave Instruments GmbH | Munich" → "Cellwave", "Nordic Heart Institute" stays. */
export function shortCompany(name: string | null | undefined): string | null {
  if (!name) return null;
  let s = name.split(/\s+[|·]\s+/)[0].replace(/,.*$/, "").trim();
  for (let i = 0; i < 3; i++) {
    const next = s.replace(SUFFIX, "").trim();
    if (next === s || !next) break;
    s = next;
  }
  return s || null;
}

/** Upper-case the first letter (after any opening quote); leave the rest as written. */
export function sentenceCase(s: string): string {
  return s.replace(/^(["'“‘(]*)(\p{Ll})/u, (_m, q: string, c: string) => q + c.toUpperCase());
}

const DANGLING = /(?:\s+(?:and|or|but|the|a|an|of|for|with|to|in|on|at|by|from|that|which|who|so|as|via|your|our|their|its|is|are|was|will))+$/i;
const BOUNDARY = /\s(?:and|or|for|with|to|in|on|at|by|from|of|that|which|who|because|so|after|before|while|including|via|once|when|where)\s|\s?[—–;,:]\s/gi;

/**
 * Collapse whitespace, tidy punctuation, and shorten to `max` characters at a
 * natural boundary (a preposition or clause break), without an ellipsis.
 */
export function tidy(input: string, max = 80): string {
  let s = input
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?)])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/…+$/, "")
    .trim();
  const strip = (x: string) => x.replace(/[\s,;:–—-]+$/, "").replace(DANGLING, "").replace(/[\s,;:–—-]+$/, "").trim();
  s = strip(s.replace(/[.!]+$/, ""));
  if (s.length > max) {
    const window = s.slice(0, max + 1);
    let cut = -1;
    for (const m of window.matchAll(BOUNDARY)) if (m.index! >= max * 0.5 && m.index! <= max) cut = m.index!;
    if (cut < 0) cut = Math.max(window.lastIndexOf(" ", max), Math.floor(max * 0.6));
    s = strip(s.slice(0, cut));
    // Unbalanced parenthesis after a cut: drop the open part.
    if ((s.match(/\(/g) ?? []).length > (s.match(/\)/g) ?? []).length) s = strip(s.slice(0, s.lastIndexOf("(")));
  }
  return sentenceCase(s);
}

/** Strip "Re:", "Fwd:" and label prefixes ("Approval needed:", "Escalation:") from a subject. */
export function subjectTopic(subject: string | null | undefined): string {
  if (!subject) return "";
  return subject
    .replace(/^(?:(?:re|fwd?|aw|sv)\s*:\s*)+/i, "")
    .replace(/^(?:approval needed|decision needed|action required|escalation|urgent|fyi|reminder|request)\s*:\s*/i, "")
    .trim();
}

const WEEKDAY = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" });
const MONTH_DAY = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const SHORT = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });

/** "today", "tomorrow", "by Friday", "by Oct 20", "(was due Oct 5)" relative to `now` in the CEO's timezone. */
export function dueWords(day: string | null, now: Date, timeZone: string): string {
  if (!day) return "";
  const today = dayFromKey(dayKeyInTz(now, timeZone));
  const d = dayFromKey(day);
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return `(was due ${MONTH_DAY.format(d)})`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days <= 6) return `by ${WEEKDAY.format(d)}`;
  return `by ${MONTH_DAY.format(d)}`;
}

/** "Fri, Oct 9" — for summaries, which are a record and should not drift with time. */
export function dayShort(day: string): string {
  return SHORT.format(dayFromKey(day));
}

/** Join an action and its timing without doubled spaces. */
export function withDue(action: string, due: string): string {
  return due ? `${action} ${due}` : action;
}

/** First word lower-cased unless it is an acronym, a code or a proper noun with inner capitals ("Q4", "NDA", "CardioPredict"). */
export function lowerFirst(s: string): string {
  if (!s) return s;
  const first = s.split(/\s+/)[0];
  if (/^[A-Z][A-Z0-9]|^[A-Z][a-z]+[A-Z]|\d/.test(first)) return s;
  return s[0].toLowerCase() + s.slice(1);
}

/** Article for a noun phrase in running text: "a potential study expansion". */
export function withArticle(phrase: string): string {
  if (/^(?:a|an|the|\$|\d)/i.test(phrase)) return phrase;
  return `${/^[aeiou]/i.test(phrase) ? "an" : "a"} ${phrase}`;
}

const NUMBER_WORDS: Record<string, string> = { one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", twelve: "12" };

/** "approximately six weeks" → "~6 weeks"; null when the text states no duration. */
export function durationIn(text: string): string | null {
  const m = /\b(approximately|about|around|roughly|nearly|over|more than|up to)?\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+(days?|weeks?|months?|quarters?)\b/i.exec(text);
  if (!m) return null;
  const n = NUMBER_WORDS[m[2].toLowerCase()] ?? m[2];
  const approx = m[1] && /approx|about|around|roughly|nearly/i.test(m[1]) ? "~" : m[1] ? `${m[1].toLowerCase()} ` : "";
  return `${approx}${n} ${m[3].toLowerCase()}`;
}
