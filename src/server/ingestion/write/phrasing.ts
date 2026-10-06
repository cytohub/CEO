/**
 * Pure phrasing and matching helpers for change detection, commitment
 * fulfilment and calendar sync: how the Brain words an "Important change",
 * recognizes a signature or a delivery in text, and labels meeting slots.
 * Kept free of database access so they are unit-tested directly.
 */
import type { FocusArea, MeetingCategory, MeetingType } from "@/generated/prisma/enums";
import { companyShortName } from "../resolve/names";
import { actionTokens, tokenCoverage } from "./dedupe";

// ─── Change wording ──────────────────────────────────────────────────────────

const LEAD_VERB = /^(please\s+)?(send|share|provide|deliver|prepare|submit|get|give|forward|complete|finali[sz]e|update|resend|re-send|return|supply|upload|circulate)\s+(over\s+)?/i;
const DETERMINER = /^(the|a|an|our|their|your|his|her|its|this|that|these|those)\b/i;

/** "Send revised data package" → "the revised data package"; "Send us the deck" → "the deck". */
export function objectPhrase(title: string): string {
  const t = title.trim().replace(/[.!]+$/, "");
  if (!LEAD_VERB.test(t)) return `“${t}”`;
  let rest = t.replace(LEAD_VERB, "").replace(/^(us|me|them|him|her)\s+/i, "");
  rest = rest.replace(/\s+(to|for)\s+(us|me|them)\b.*$/i, "");
  if (!rest) return `“${t}”`;
  return DETERMINER.test(rest) ? rest : `the ${rest}`;
}

const REQUESTED = /\b(?:requested|requests|asked for|asking for|ask for|need|needs|needed|send(?: us| me)?|share(?: with us)?|provide|deliver)\s+((?:the|an?|our|your|their|updated|revised|new)\s+[^.?!,;\n]+?)(?=\s+(?:by|before|no later than|until|ahead of)\b|[.?!,;\n]|$)/i;

/** The thing asked for in a sentence: "Lumen requested the revised electrophysiology dataset by October 14" → "the revised electrophysiology dataset". */
export function requestedObject(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = REQUESTED.exec(text);
  if (!m) return null;
  const obj = m[1].trim();
  return obj.split(/\s+/).length <= 10 ? obj : null;
}

/** Best phrase for what a customer asked for: the action's object, else what the evidence says was requested. */
export function deliverablePhrase(title: string, ...evidence: (string | null | undefined)[]): string {
  const fromTitle = objectPhrase(title);
  if (!fromTitle.startsWith("“")) return fromTitle;
  for (const e of evidence) {
    const o = requestedObject(e);
    if (o) return o;
  }
  return fromTitle;
}

export function longDay(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric" }).format(d);
}

const SIGNED = /\b(fully executed|counter-?signed|(?:has|have) (?:now )?been (?:signed|executed)|(?:is|are|was|were) (?:now )?(?:signed|executed)|we(?:'ve| have) (?:just |now |finally )?signed|(?:just|finally) signed|signed (?:the |our |a )?(?:msa|master services agreement|agreement|contract|sow|nda|term sheet|licen[cs]e|partnership agreement))\b/i;
const NOT_YET = /\b(not yet|once|when|before|after|until|unless|ready to|will|would|to be|awaiting|pending|need(?:s)? to|about to|if)\b[^.]{0,40}\b(sign|signed|signing|execut)/i;
const CONTRACT_WORD = /\b(msa|master services agreement|term sheet|sow|nda|license|licence|partnership agreement|agreement|contract)\b/i;

/** The sentence announcing a signature, if any ("The MSA is signed"), ignoring "once signed", "ready to sign". */
export function signedSentence(text: string): { sentence: string; contract: string } | null {
  const sentences = text.replace(/([.!?])\s+/g, "$1\n").split(/\n+/);
  for (const s of sentences) {
    if (!SIGNED.test(s) || NOT_YET.test(s)) continue;
    const m = CONTRACT_WORD.exec(s);
    if (!m) continue;
    const word = m[1].toLowerCase();
    const contract = word === "msa" || word === "master services agreement" ? "MSA" : word === "nda" ? "NDA" : word === "sow" ? "SOW" : word;
    return { sentence: s.trim(), contract };
  }
  return null;
}

/** DocumentVersion.significantChanges entry (written by the documents workstream). */
export interface SignificantChange {
  label: string;
  from: string | null;
  to: string | null;
  kind?: string | null;
  /** "HIGH" | "MEDIUM" | "LOW" (or a 1–5 number). */
  significance?: number | string | null;
  change?: "changed" | "added" | "removed" | null;
}

/** "raise amount changed from $35M to $40M" / "runway added: 24 months" / "pricing removed (was $50K)". */
export function describeChange(c: SignificantChange): string {
  const label = lowerFirst(c.label);
  if (c.change === "added" || (c.from == null && c.to != null)) return `${label} added: ${c.to}`;
  if (c.change === "removed" || (c.to == null && c.from != null)) return `${label} removed (was ${c.from})`;
  return `${label} changed from ${c.from ?? "—"} to ${c.to ?? "—"}`;
}

export function significanceRank(s: SignificantChange["significance"]): number {
  if (typeof s === "number") return Math.max(1, Math.min(5, Math.round(s <= 1 ? s * 5 : s)));
  const v = String(s ?? "").toLowerCase();
  return v === "critical" ? 5 : v === "high" ? 4 : v === "medium" ? 3 : 2;
}

export function documentShortTitle(title: string): string {
  return (
    title
      .replace(/\.[a-z0-9]{2,5}$/i, "")
      .replace(/[_]+/g, " ")
      .replace(/\s*[-–(]?\s*(v(ersion)?\s?\d+(\.\d+)*|final|draft|copy|\(\d+\))\s*\)?\s*$/gi, "")
      .trim() || title
  );
}

export function lowerFirst(s: string): string {
  return /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
}

// ─── Commitment fulfilment ───────────────────────────────────────────────────

const DELIVERY_CUE =
  /\b(attached|attaching|please find|as promised|as discussed,? here|here (is|are)|here's|enclosed|i('ve| have) (just )?(sent|shared|uploaded|attached)|we('ve| have) (just )?(sent|shared|uploaded|attached)|sharing (the|our)|sent (it )?over|just sent|delivered|you('ll| will) find|now (available|live|uploaded)|uploaded (it|the)|link (to|below)|following up with the)\b/i;

/** Verbs that describe the act, not the deliverable — "send revised data package" is about the package. */
const ACT_VERBS = new Set(["send", "share", "provid", "deliver", "prepar", "submit", "get", "giv", "forward", "complet", "finaliz", "finalis", "updat", "resend", "return", "suppli", "upload", "circulat", "follow", "confirm", "draft", "writ", "put", "together", "make"]);

export function deliverableTokens(title: string): string[] {
  const tokens = actionTokens(title);
  const object = tokens.filter((t) => !ACT_VERBS.has(t));
  return object.length ? object : tokens;
}

export function hasDeliveryCue(text: string): boolean {
  return DELIVERY_CUE.test(text);
}

/** How well a message delivers a promised thing: 0–1 coverage of the deliverable's words, plus whether it reads like a delivery. */
export function fulfilmentMatch(title: string, messageText: string, attachmentNames: string[] = []): { coverage: number; cue: boolean } {
  const object = deliverableTokens(title).join(" ");
  const haystack = `${messageText}\n${attachmentNames.join(" ").replace(/[._-]+/g, " ")}`;
  return { coverage: tokenCoverage(object, haystack), cue: hasDeliveryCue(messageText) || attachmentNames.length > 0 };
}

// ─── Meetings ────────────────────────────────────────────────────────────────

const TYPE_BY_CATEGORY: Partial<Record<MeetingCategory, MeetingType>> = {
  INVESTOR: "INVESTOR",
  FUNDRAISING: "INVESTOR",
  CUSTOMER: "CUSTOMER",
  SALES: "CUSTOMER",
  BOARD: "BOARD",
  PARTNER: "PARTNER",
  RECRUITING: "CANDIDATE",
};

export const FOCUS_BY_MEETING_CATEGORY: Record<MeetingCategory, FocusArea> = {
  INVESTOR: "FUNDRAISING",
  FUNDRAISING: "FUNDRAISING",
  CUSTOMER: "CUSTOMERS",
  SALES: "REVENUE",
  BOARD: "STRATEGY",
  PARTNER: "PARTNERSHIPS",
  SCIENTIFIC: "SCIENCE",
  RECRUITING: "RECRUITING",
  LEGAL: "LEGAL",
  FINANCE: "FINANCE",
  PRODUCT: "PRODUCT",
  INTERNAL_LEADERSHIP: "TEAM",
  NETWORKING: "PARTNERSHIPS",
  PERSONAL: "CEO_DEVELOPMENT",
  OTHER: "OPERATIONS",
};

export function meetingTypeFor(category: MeetingCategory, internalAttendees: number, externalAttendees: number): MeetingType {
  const mapped = TYPE_BY_CATEGORY[category];
  if (mapped) return mapped;
  if (externalAttendees > 0) return "EXTERNAL";
  return internalAttendees === 1 ? "ONE_ON_ONE" : "INTERNAL";
}

/** "Thu 10:00", or "Thu Oct 8, 10:00" when the dates are far apart. */
export function formatSlot(at: Date, timeZone: string, withDate: boolean): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return withDate ? `${parts.weekday} ${parts.month} ${parts.day}, ${parts.hour}:${parts.minute}` : `${parts.weekday} ${parts.hour}:${parts.minute}`;
}

/** "Northbridge Ventures — partner meeting" + "Northbridge Ventures" → "the partner meeting". */
export function meetingPhrase(title: string, companyName: string | null): string {
  if (companyName) {
    const forms = [companyName, companyShortName(companyName)].sort((a, b) => b.length - a.length);
    for (const f of forms) {
      const re = new RegExp(`^\\s*${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[—–:\\-|]\\s*`, "i");
      if (re.test(title)) {
        const rest = title.replace(re, "").trim();
        if (rest) return `the ${rest[0].toLowerCase()}${rest.slice(1)}`;
      }
    }
  }
  return `“${title}”`;
}

// ─── Same-sentence coverage ──────────────────────────────────────────────────

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Sentences of a text, normalized (lower-case, single spaces). */
export function sentencesOf(text: string): string[] {
  return text
    .replace(/([.!?])\s+/g, "$1\n")
    .split(/\n+/)
    .map(norm)
    .filter(Boolean);
}

/**
 * True when two quotes come from the same sentence of the source (or one
 * contains the other): the extractor often reports one ask as a task, a
 * deadline and a decision, each quoting the same sentence.
 */
export function sameSentence(a: string, b: string, sentences: string[]): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na.includes(nb) || nb.includes(na)) return true;
  const probe = (s: string) => s.slice(0, Math.min(40, s.length));
  const hostsA = sentences.filter((s) => s.includes(probe(na)) || na.includes(s));
  return hostsA.some((s) => s.includes(probe(nb)) || nb.includes(s));
}

const THIRD_PARTY = /^(?:(?:dr|prof|mr|ms|mrs)\.?\s+)?(?:[A-Z][\w'’.-]+(?:\s+[A-Z][\w'’.-]+){0,3}|legal|they|he|she|the team|our team|their team|procurement|finance)\s+(?:will|is going to|are going to|plans to|is expected to|are expected to|expects to)\b/;

/** "Daniel Kim will ship the dashboard…" — a dated action someone else owns. */
export function thirdPartyActor(sentence: string, ceoNames: string[] = []): boolean {
  const s = sentence.trim();
  const m = THIRD_PARTY.exec(s);
  if (!m) return false;
  const lead = s.slice(0, m[0].length).toLowerCase();
  if (/^(i|we|you)\b/.test(lead)) return false;
  return !ceoNames.some((n) => n && lead.startsWith(n.toLowerCase()));
}

// ─── Titles and advice ───────────────────────────────────────────────────────

const TITLE_PREFIX = /^(?:(?:decision needed|decision|possible task|action(?: item)?|todo|to do|re|fwd?|request|ask)\s*[:?—-]\s*)+/i;

/**
 * Display-safe title from extractor text: known prefixes removed, a dangling
 * parenthesis cut ("Decide on the offer package (base $240K" → "Decide on the
 * offer package"), sentence case, trimmed at a word boundary.
 */
export function cleanTitle(input: string, max = 100): string {
  let s = input.replace(/\s+/g, " ").trim().replace(TITLE_PREFIX, "");
  const open = s.lastIndexOf("(");
  if (open > 0 && s.indexOf(")", open) < 0) s = s.slice(0, open);
  s = s.replace(/[\s,;:—–-]+$/g, "").replace(/(?:…|\.{2,})+$/g, "").replace(/\s+(?:with|and|to|for|of|the|a|an|by|on|in|at|or)$/i, "").trim();
  if (s.length > max) {
    const cut = s.slice(0, max);
    const space = cut.lastIndexOf(" ");
    s = `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:—–-]+$/g, "")}…`;
  }
  if (/^[a-z]/.test(s)) s = s[0].toUpperCase() + s.slice(1);
  return s || input.trim();
}

/** "I need a decision by Thursday to secure the booth" → "Secure the booth"; seeded titles pass through. */
export function cleanDecisionTitle(input: string): string {
  const s = cleanTitle(input, 120);
  const m = /^(?:i|we)\s+(?:need|want|would like)\s+(?:a|your)\s+(?:decision|call|go-ahead|answer)(?:\s+by\s+\w+)?(?:\s+(?:on|about|to|for))?\s+(.+)$/i.exec(s);
  return m?.[1] ? cleanTitle(m[1], 120) : s;
}

const GIVE_VERB = /^(send|share|provide|forward|give|deliver|resend|return|show)\s+(.+)$/i;

/** "Send revised data package" + "Henrik" → "Send Henrik the revised data package". */
export function actionWithRecipient(title: string, recipient: string | null): string {
  const t = cleanTitle(title, 120);
  const m = GIVE_VERB.exec(t);
  if (!m) return t;
  const object = objectPhrase(`${m[1]} ${m[2]}`);
  const obj = object.startsWith("“") ? m[2] : object;
  return recipient ? `${m[1]} ${recipient} ${obj}` : `${m[1]} ${obj}`;
}

/** Lower-cased clause for "asked you directly to …": "send the revised data package". */
export function actionClause(title: string): string {
  const t = actionWithRecipient(title, null);
  return /^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t;
}

// ─── Scientific results ──────────────────────────────────────────────────────

const GENERIC_FACT_LABEL = /^(?:percentage|percent|number|value|count|metric|figure|amount|total|result|score|rate|ratio|ownership|hearts|days|months|share)s?(?:\s*\([^)]*\))?$/i;
const METRIC_WORDS = new Set(["auc", "roc", "accuracy", "sensitivity", "specificity", "precision", "recall", "f1", "r2", "correlation", "ppv", "npv", "ic50", "ec50", "retention", "concordance", "kappa", "mae", "rmse", "yield", "viability", "efficacy", "qc"]);

/** Facts worth announcing as a result: a real label, not "Percentage: 94%". */
export function isMeaningfulMetricLabel(label: string): boolean {
  const l = label.trim();
  return l.length >= 2 && !GENERIC_FACT_LABEL.test(l);
}

/** Stable identity of a reported metric: "Hold-out AUC" 0.88 and "AUC" 0.88 are the same result. */
export function metricKey(label: string, value: string): string {
  const tokens = actionTokens(label);
  const metric = tokens.filter((t) => METRIC_WORDS.has(t));
  const name = (metric.length ? metric : tokens).join("-") || label.toLowerCase();
  const num = /-?\d+(?:\.\d+)?/.exec(value.replace(/,/g, ""))?.[0];
  return `${name}:${num != null ? String(Number(num)) : value.trim().toLowerCase()}`;
}
