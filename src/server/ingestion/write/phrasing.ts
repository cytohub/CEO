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
