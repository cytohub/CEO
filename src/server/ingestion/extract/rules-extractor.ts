/**
 * Deterministic intelligence extractor — always available, and what runs when
 * Claude is not configured. Produces the same IntelligenceExtraction contract
 * as the Claude path, sentence by sentence, with every item's evidence being
 * the exact sentence it came from (so validateExtraction keeps it unchanged).
 *
 * Point of view: "the CEO" is input.ceo. In messages the CEO did not write,
 * requests addressed to them become tasks with ownerIsCeo; in messages the CEO
 * wrote, first-person promises become OUTBOUND (or INTERNAL) commitments and
 * requests to others become tasks owned by the named recipient.
 */
import type { CeoCategory, FocusArea, OpportunityKind } from "@/generated/prisma/enums";
import { dayKeyInTz } from "@/lib/dates";
import {
  type ExtractedCommitmentT,
  type ExtractedDecisionT,
  type ExtractedFactT,
  type ExtractedOpportunityT,
  type ExtractedRiskT,
  type ExtractedTaskT,
  type IntelligenceExtraction,
  ACTIVITY_TAGS,
  RISK_CATEGORIES,
  emptyExtraction,
} from "../extraction-schema";
import type { ExtractionInput, Participant } from "../types";
import { type ResolvedDate, daysFrom, findDates, formatDayShort } from "./dates";
import { scanSignatures, scanTextMentions } from "./mentions";
import { type Sentence, clipEvidence, splitSentences } from "./sentences";
import { ACTION_VERBS, BOILERPLATE, actionTitle, hasPronounObject, leadVerb, startsWithActionVerb } from "./titles";
import {
  MONEY_RE,
  capitalize,
  companyNameFromDomain,
  contentTokens,
  domainOf,
  firstMoney,
  firstNameOf,
  isFreeMailDomain,
  lcFirst,
  moneyValue,
  nameFromEmail,
  normalizeName,
  registrableDomain,
  titleKey,
  truncateWords,
} from "./text";

type RiskCategory = (typeof RISK_CATEGORIES)[number];

interface Party {
  name: string;
  first: string;
  email: string | null;
  company: string | null;
  internal: boolean;
  isCeo: boolean;
}

interface Run {
  input: ExtractionInput;
  now: Date;
  out: IntelligenceExtraction;
  ceoName: string;
  ceoFirst: string;
  fromCeo: boolean;
  sender: Party | null;
  /** To-recipients other than the CEO. */
  recipients: Party[];
  ceoInTo: boolean;
  ceoInCc: boolean;
  /** Greeting line ("Hi Rajib," / "Hi Maya," / "Hi all,"). */
  greeting: { names: string[]; ceo: boolean; group: boolean } | null;
  primaryCompany: string | null;
  kind: "email" | "event" | "notes" | "document";
  /** Event start as the CEO's calendar day. */
  eventDay: string | null;
  seen: Set<string>;
}

// ─── Lexicon ─────────────────────────────────────────────────────────────────

const SIGN_OFF = /^(?:best(?: regards| wishes)?|kind regards|warm regards|regards|thanks(?: again| so much)?|thank you|many thanks|cheers|sincerely|warmly|all the best|talk soon|br)\s*[,!.]?$/i;
const QUOTE_HEADER = /^(?:on .{6,80} wrote:|-{2,}\s*(?:original|forwarded) message\s*-{2,}|from:\s.+|sent:\s.+|>)/i;
const GREETING = /^(?:hi|hello|hey|dear|good (?:morning|afternoon|evening)|morning)\b[\s,]*([^,!:\n]{0,80}?)\s*[,!:]?$/i;
const GROUP_WORDS = /^(?:all|everyone|team|folks|both|both of you|y'all|you two|guys|everybody|there)$/i;

const REQUEST_PATTERNS: { re: RegExp; kind: "please" | "question" | "need" }[] = [
  { re: /(?:^|[,;:—–-]\s*|\b(?:and|also|so|then)\s+)(?:please|pls|kindly)\s+(?:do\s+)?(?:also\s+)?(?:make sure (?:to|that you)\s+)?(\p{L}[\s\S]*)$/iu, kind: "please" },
  { re: /\b(?:could|can|would|will)\s+you\s+(?:please\s+|kindly\s+)?(?:also\s+)?(\p{L}[\s\S]*?)\s*\??$/iu, kind: "question" },
  { re: /\b(?:i|we)\s+(?:would\s+|will\s+)?need\s+you\s+to\s+(\p{L}[\s\S]*)$/iu, kind: "need" },
];
const NEED_YOUR = /\b(?:i|we)\s+(?:would\s+|will\s+|still\s+)?need\s+your\s+(approval|sign-?off|signature|feedback|input|thoughts|comments|answer|response|help|review|go-ahead|green light)\s+(?:on|for|by|regarding|about|with|of)?\s*([\s\S]*)$/i;
const NEED_YOUR_VERB: Record<string, string> = {
  approval: "Approve",
  "sign-off": "Sign off on",
  signoff: "Sign off on",
  signature: "Sign",
  feedback: "Share feedback on",
  input: "Share input on",
  thoughts: "Share thoughts on",
  comments: "Send comments on",
  answer: "Answer on",
  response: "Respond on",
  help: "Help with",
  review: "Review",
  "go-ahead": "Give the go-ahead on",
  "green light": "Give the green light on",
};
/** Imperatives we accept without "please" when the message is clearly addressed to the CEO. */
const BARE_IMPERATIVES = new Set(["send", "share", "forward", "sign", "countersign", "review", "confirm", "approve", "provide", "call", "email", "schedule", "book", "submit", "return", "wire", "pay"]);

const COMMITMENT_RE =
  /\b(?:i'll|i will|i'm going to|i am going to|i shall|we'll|we will|we're going to|we are going to|we shall|let me|i can|i'd be happy to|happy to|i promise to|we promise to|expect)\s+(?:also\s+|definitely\s+|personally\s+|then\s+|still\s+|certainly\s+|aim to\s+|try to\s+|make sure to\s+)*(\p{L}[\s\S]*)$/iu;
const NOT_COMMITMENT = /^(?:be\b(?!\s+(?:sending|sharing|able to))|need|see|know|let you know if|have to|probably|likely|hear|miss|wait|keep you posted|talk soon|see you|hope|think|assume|let you know whether)/i;
const HEDGE = /\b(?:try to|hopefully|should be able to|aim to|if possible|if we can|might|may be able to|probably)\b/i;
const CONDITIONAL = /^(?:if|once|when|assuming|provided)\b/i;

const FOLLOW_UP = /\b(?:follow(?:ing)?[- ]up|circle back|check in|touch base|ping (?:me|you|us)|reconnect|revisit|chase)\b/i;
const MEETING_REQUEST =
  /\b(?:(?:can|could|shall|should) we (?:meet|talk|chat|connect|sync|catch up|get together|grab|hop on|jump on|set up|schedule|find)|(?:find|grab) (?:some )?time\b|schedule (?:a|an|some) (?:call|meeting|time|chat|session)|set up (?:a|an|some) (?:call|meeting|time|chat)|are you (?:available|free|around)|do you have (?:time|availability|\d+ minutes)|would you be (?:open|available) (?:to|for) (?:a )?(?:call|meeting|chat|discussion)|(?:hop|jump) on a (?:quick )?call|grab (?:coffee|lunch|dinner|a coffee)|meet (?:next week|this week|in person|on|for)|let'?s (?:meet|talk|connect|find time|set up|schedule|grab))\b/i;
const TIME_RE = /\b\d{1,2}(?::\d{2})?\s?(?:am|pm|a\.m\.|p\.m\.)(?:\s*(?:et|est|edt|pt|pst|pdt|ct|cet|gmt|utc))?\b/gi;

const DECISION_MADE =
  /\b(?:we(?:'ve| have)? (?:now )?decided|we(?:'ve| have)? agreed|it was agreed|(?:the )?(?:board|ic|investment committee|committee|partnership|partners|leadership team|exec team) (?:has )?(?:approved|decided|agreed|signed off)|(?:we|they|i)(?: have|'ve)? approved|(?:we|i)(?:'ll| will) go with|(?:we|i)(?:'re| are| am|'m) going (?:to go )?with|signed off on|(?:we|i) chose|(?:we|i)(?:'ve| have) chosen|decision(?: made)?\s*[:\-–]|decided\s*[:\-–]|agreed\s*[:\-–]|final call\s*[:\-–])\s*(?:that\s+|to\s+)?([\s\S]*)$/i;
const DECISION_NEGATED = /\b(?:haven'?t|have not|not yet|no|hasn'?t|has not|yet to)\s+(?:been\s+)?(?:decided|agreed|approved|decision)\b|\bundecided\b/i;
const DECISION_NEEDED =
  /\b(?:need (?:your|a|the) (?:decision|call|go-ahead|green light)|decide (?:by|on|whether|if|between|which)|go\/no[- ]go|your call\b|should we\b|which (?:option|one|way|approach) (?:do you|would you|should we)|do you want (?:us |me )?to\b|want (?:me|us) to\b|would you prefer|awaiting your (?:decision|approval|call)|pending your (?:decision|approval))/i;

const OPP_EXPANSION = /\b(?:expand(?:ing|ed)?|expansion (?:of|to|into)|extend(?:ing)? (?:the|our) (?:study|pilot|contract|engagement|program|partnership))\b/i;
const OPP_ADDITIONAL = /\b(?:additional|another|second|follow-on|follow-up|more) (study|studies|sites?|orders?|projects?|programs?|pilots?|compounds?|assays?|work)\b/i;
const OPP_UPSELL = /\b(?:upsell|cross-sell|add-on|upgrade to)\b/i;
const OPP_INTEREST = /\b(?:interested in|keen (?:on|to)|would (?:love|like) to (?:explore|discuss|learn more about|work together|collaborate|partner))\s*([\s\S]*)$/i;
const OPP_PARTNER = /\b(?:would like to partner|(?:explore|discuss|propose|open to|interested in) (?:a )?(?:partnership|collaboration)|co-develop|joint (?:study|venture|development))\b/i;
const OPP_INTRO = /\b(?:introduce you to|intro(?:duction)? to|connect you with|put you in touch with)\s+([\s\S]*)$/i;
const OPP_CREDITS = /\b(?:credits?|discount(?:ed)?|waive[ds]?|free (?:tier|access|trial)|grant funding)\b/i;
const OPP_PILOT = /\b(?:start|kick off|launch|run|explore|consider|propose|interested in|would like|set up|begin)\b[^.]{0,40}\bpilot\b|\bpilot\b[^.]{0,30}\b(?:proposal|opportunity)\b/i;
const OPP_RFP = /\b(?:RFP|request for proposals?|RFI|tender)\b/;
const OPP_ROUND = /\b(?:lead|co-lead|participate in|join|anchor) (?:the|your) (?:round|series [a-e]|raise)\b|\b(?:send|issue) (?:you |over )?(?:a|the|our) term ?sheet\b/i;
const NEGATION_NEAR = /\b(?:not|no longer|won'?t|will not|don'?t|do not|unable|can'?t|cannot|decline[ds]?|pass(?:ed)? on|unlikely|delay(?:ed|ing)?|postpon\w*|pause[ds]?|paus(?:ing)|cancel\w*|halt\w*|stop\w*|defer\w*|scal(?:e|ing) back)\b/i;

interface RiskRule {
  re: RegExp;
  label: string;
  category: RiskCategory | "CONTEXT";
  severity: number;
  confidence: number;
}
const RISK_RULES: RiskRule[] = [
  { re: /\bbreach(?:ed|es)?\b/i, label: "Breach", category: "LEGAL", severity: 5, confidence: 0.75 },
  { re: /\b(?:churn|not (?:going to )?renew|won'?t renew|non-renewal|cancel(?:l?ing)? (?:the|our) (?:contract|agreement|subscription|order)|terminat(?:e|ing|ion)|switch(?:ing)? to (?:another|a different) (?:vendor|provider|cro)|moving to a competitor)\b/i, label: "Churn risk", category: "CUSTOMER", severity: 5, confidence: 0.75 },
  { re: /\b(?:escalat\w*|unacceptable|very disappointed|frustrat\w*|complain\w*)\b/i, label: "Escalation", category: "CONTEXT", severity: 4, confidence: 0.75 },
  { re: /\bcompeting offer\b/i, label: "Competing offer", category: "PEOPLE", severity: 4, confidence: 0.75 },
  { re: /\b(?:resign\w*|quit(?:ting)?|leaving the company|giving notice|burn(?:ed|t)? out)\b/i, label: "People risk", category: "PEOPLE", severity: 4, confidence: 0.65 },
  { re: /\b(?:lawsuit|litigation|legal dispute|infring\w*|cease and desist)\b/i, label: "Legal risk", category: "LEGAL", severity: 4, confidence: 0.7 },
  { re: /\b(?:clinical hold|warning letter|fda (?:concern|hold|warning|objection)|non-?compliance|audit finding)\b/i, label: "Regulatory risk", category: "REGULATORY", severity: 4, confidence: 0.7 },
  { re: /\b(?:runway (?:is )?(?:short|shorter)|cash crunch|over budget|burn (?:is )?(?:up|higher|above)|shortfall|missed (?:the )?(?:revenue|bookings) (?:target|plan))\b/i, label: "Financial risk", category: "FINANCIAL", severity: 4, confidence: 0.7 },
  { re: /\b(?:pass(?:ed|ing)? on (?:the|this|our) (?:round|deal|investment|series [a-e])|decline[ds]? to (?:invest|participate|lead)|(?:not|won'?t) (?:be )?(?:able to )?lead)\b/i, label: "Fundraising setback", category: "FUNDRAISING", severity: 3, confidence: 0.7 },
  { re: /\b(?:shortage|supply (?:issue|constraint|problem)s?|out of stock|backorder(?:ed)?)\b/i, label: "Shortage", category: "OPERATIONAL", severity: 3, confidence: 0.65 },
  { re: /\b(?:failed (?:validation|to replicate|qc)|did(?:n'?t| not) replicate|below (?:target|threshold|plan)|underperform\w*|contaminat\w*|batch failure)\b/i, label: "Scientific risk", category: "SCIENTIFIC", severity: 3, confidence: 0.65 },
  { re: /\b(?:negative press|bad press|public criticism|negative coverage|reputational)\b/i, label: "Reputational risk", category: "REPUTATIONAL", severity: 3, confidence: 0.6 },
  { re: /\b(?:missed (?:the |our |a )?(?:deadline|date|milestone|window)|behind schedule|fall(?:ing|en)? behind|running (?:late|behind)|slip(?:ped|ping|s)?|delay(?:ed|s)?|push(?:ed)? (?:back|out)|postpone[ds]?)\b/i, label: "Delay", category: "CONTEXT", severity: 3, confidence: 0.65 },
  { re: /\b(?:at risk|blocker|blocked|jeopardi[sz]\w*|concerned about|serious concern|red flag)\b/i, label: "At risk", category: "CONTEXT", severity: 3, confidence: 0.6 },
];
const RISK_NEGATED = /\b(?:no|not|without|never|isn'?t|aren'?t|wasn'?t|no longer|zero)\s+(?:\w+\s+){0,2}(?:delays?|risks?|blockers?|issues?|concerns?|slip\w*|escalat\w*)\b|\bon track\b|\b(?:resolved|mitigated|fixed)\b/i;

const MONEY_LABELS: [RegExp, string][] = [
  [/\b(?:pre-money|post-money|valuation)\b/i, "Valuation"],
  [/\b(?:arr|annual recurring revenue)\b/i, "ARR"],
  [/\b(?:raise|raising|round|series [a-e])\b/i, "Raise amount"],
  [/\bburn\b/i, "Monthly burn"],
  [/\b(?:cash|bank balance)\b/i, "Cash"],
  [/\b(?:proposal|quote|quotation|sow|statement of work)\b/i, "Proposal value"],
  [/\b(?:msa|contract|agreement|deal|tcv|acv)\b/i, "Contract value"],
  [/\b(?:price|pricing|fees?|per (?:compound|study|site|sample))\b/i, "Price"],
  [/\bbudget\b/i, "Budget"],
  [/\bcredits?\b/i, "Credits"],
  [/\b(?:invoice|payment|paid|owe[ds]?|outstanding)\b/i, "Payment amount"],
  [/\bgrant\b/i, "Grant amount"],
  [/\b(?:salary|compensation|base pay)\b/i, "Compensation"],
  [/\b(?:investment|invest|commit(?:ment|ted)?|cheque|check|allocation|pro[- ]rata|ticket)\b/i, "Investment amount"],
  [/\brevenue\b/i, "Revenue"],
  [/\b(?:cost|costs|spend|expense)\b/i, "Cost"],
];
const PERCENT_LABELS: [RegExp, string][] = [
  [/\bmargin\b/i, "Margin"],
  [/\bgrowth\b/i, "Growth"],
  [/\bdiscount\b/i, "Discount"],
  [/\bsensitivity\b/i, "Sensitivity"],
  [/\bspecificity\b/i, "Specificity"],
  [/\baccuracy\b/i, "Accuracy"],
  [/\bretention\b/i, "Retention"],
  [/\b(?:ownership|stake|equity|dilution)\b/i, "Ownership"],
  [/\b(?:complete|completion|progress|done)\b/i, "Progress"],
  [/\bconversion\b/i, "Conversion"],
  [/\b(?:probability|likelihood|chance)\b/i, "Probability"],
  [/\b(?:increase|up|higher|grew)\b/i, "Increase"],
  [/\b(?:decrease|down|lower|drop(?:ped)?|decline)\b/i, "Decrease"],
];
const COUNT_RE =
  /\b(\d{1,3}(?:,\d{3})+|\d+)\s+(donor hearts?|human hearts?|hearts?|donors?|sites?|hospitals?|customers?|patients?|samples?|compounds?|employees?|hires?|studies|study|assays?|models?|investors?|programs?|wells?|plates?|months?|weeks?|days?)\b/gi;
const PERCENT_RE = /\b(\d+(?:\.\d+)?)\s?(?:%|percent\b)/gi;
const AUC_RE = /\b((?:hold-?out|holdout|validation|test|training|external)\s+)?AUC\b(?:\s+(?:of|was|is|at|reached|=|:))?\s*(0?\.\d+|1\.0)\b/gi;

const FOCUS_BY_CATEGORY: Partial<Record<CeoCategory, FocusArea>> = {
  INVESTOR: "FUNDRAISING",
  FUNDRAISING: "FUNDRAISING",
  CUSTOMER: "CUSTOMERS",
  COMMERCIAL_OPPORTUNITY: "REVENUE",
  STRATEGIC_PARTNER: "PARTNERSHIPS",
  BOARD: "STRATEGY",
  LEGAL: "LEGAL",
  FINANCE: "FINANCE",
  RECRUITING: "RECRUITING",
  SCIENTIFIC_LEADERSHIP: "SCIENCE",
  EXECUTIVE_TEAM: "OPERATIONS",
  MAJOR_VENDOR: "OPERATIONS",
  OPERATIONS: "OPERATIONS",
  INTERNAL_ESCALATION: "OPERATIONS",
};

// ─── Small helpers ───────────────────────────────────────────────────────────

const clamp = (n: number) => Math.round(Math.min(0.95, Math.max(0.05, n)) * 100) / 100;

/** Same window validateExtraction enforces, so rules output always survives validation unchanged. */
function inWindow(day: string, now: Date): boolean {
  const t = Date.parse(`${day}T00:00:00Z`);
  return !Number.isNaN(t) && t >= now.getTime() - 2 * 365 * 86_400_000 && t <= now.getTime() + 3 * 365 * 86_400_000;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const na = normalizeName(a);
  const nb = normalizeName(b);
  return na === nb || na.split(" ")[0] === nb || nb.split(" ")[0] === na;
}

function cut(s: string, max: number): string {
  return truncateWords(s, max);
}

/** The phrase after a date that anchors it to something other than the message ("within 30 days of signature"). */
function anchoredElsewhere(sentence: string, d: ResolvedDate, offset: number): boolean {
  const after = sentence.slice(d.end - offset, d.end - offset + 24);
  return /^\s+(?:of|after|from|following|upon)\b/i.test(after) && /^(?:within|in)\b/i.test(d.text);
}

// ─── Context ─────────────────────────────────────────────────────────────────

function partyFrom(run: Pick<Run, "input">, p: Participant, internalDomains: Set<string>): Party {
  const { input } = run;
  const email = p.email.toLowerCase();
  const ceoEmail = input.ceo.email?.toLowerCase();
  const resolved = input.resolution.people.find((r) => r.email?.toLowerCase() === email);
  const known = input.known.people.find((k) => k.email?.toLowerCase() === email);
  const name = p.name?.trim() || resolved?.label || known?.name || nameFromEmail(email);
  const domain = domainOf(email);
  const reg = domain ? registrableDomain(domain) : null;
  const internal = reg != null && internalDomains.has(reg);
  const companyById = resolved?.companyId ? input.resolution.companies.find((c) => c.id === resolved.companyId)?.label : null;
  const company = companyById ?? known?.company ?? (reg && !internal && !isFreeMailDomain(reg) ? companyNameFromDomain(reg) : null);
  return { name, first: firstNameOf(name), email, company: internal ? null : company, internal, isCeo: email === ceoEmail || Boolean(resolved?.isCeo) || Boolean(known?.isCeo) };
}

function buildRun(input: ExtractionInput, now: Date): Run {
  const ceoEmail = input.ceo.email?.toLowerCase() ?? null;
  const internalDomains = new Set<string>();
  const ceoDomain = domainOf(ceoEmail);
  if (ceoDomain && !isFreeMailDomain(ceoDomain)) internalDomains.add(registrableDomain(ceoDomain));
  const base = { input };
  const e = input.email;
  const sender = e ? partyFrom(base, e.from, internalDomains) : null;
  const to = e ? e.to.map((p) => partyFrom(base, p, internalDomains)) : [];
  const cc = e ? e.cc.map((p) => partyFrom(base, p, internalDomains)) : [];
  const fromCeo = Boolean(e && (e.direction === "OUTBOUND" || sender?.isCeo));

  const primary = input.resolution.primaryCompanyId ? input.resolution.companies.find((c) => c.id === input.resolution.primaryCompanyId)?.label ?? null : null;
  const externalParty = [sender, ...to, ...cc].find((p) => p && !p.isCeo && !p.internal && p.company);
  // Documents and notes have no sender: the counterparty is the first known company they name.
  const head = `${input.title}\n${input.text.slice(0, 20_000)}`.toLowerCase();
  const named = !e ? [...input.resolution.companies.map((c) => c.label), ...input.known.companies.map((c) => c.name)].find((n) => n.length >= 3 && head.includes(n.toLowerCase())) ?? null : null;
  const kind: Run["kind"] = input.kind === "MEETING_NOTES" || input.document?.docType === "MEETING_NOTES" ? "notes" : e ? "email" : input.event ? "event" : "document";

  return {
    input,
    now,
    out: emptyExtraction(),
    ceoName: input.ceo.name,
    ceoFirst: input.ceo.firstName || firstNameOf(input.ceo.name),
    fromCeo,
    sender,
    recipients: to.filter((p) => !p.isCeo),
    ceoInTo: to.some((p) => p.isCeo),
    ceoInCc: cc.some((p) => p.isCeo),
    greeting: null,
    primaryCompany: primary ?? externalParty?.company ?? named,
    kind,
    eventDay: input.event ? dayKeyInTz(input.event.startsAt, input.timezone) : null,
    seen: new Set(),
  };
}

function isCeoName(run: Run, name: string | null | undefined): boolean {
  if (!name) return false;
  const n = name.trim().toLowerCase();
  if (["me", "i", "myself", "ceo", "the ceo"].includes(n)) return true;
  return sameName(name, run.ceoName) || sameName(name, run.ceoFirst);
}

/** Who a request in this message is addressed to. */
function requestOwner(run: Run, vocative: string | null): { name: string | null; isCeo: boolean; explicit: boolean } {
  if (vocative) return { name: isCeoName(run, vocative) ? run.ceoFirst : vocative, isCeo: isCeoName(run, vocative), explicit: true };
  if (run.kind !== "email") return { name: null, isCeo: false, explicit: false };
  if (run.fromCeo) {
    const r = run.recipients[0];
    return { name: run.greeting && !run.greeting.group ? run.greeting.names[0] : r?.first ?? null, isCeo: false, explicit: Boolean(run.greeting && !run.greeting.group) };
  }
  if (run.greeting?.ceo) return { name: run.ceoFirst, isCeo: true, explicit: true };
  if (run.greeting && !run.greeting.group && run.greeting.names.length) return { name: run.greeting.names[0], isCeo: false, explicit: true };
  if (run.ceoInTo && run.recipients.length === 0) return { name: run.ceoFirst, isCeo: true, explicit: true };
  if (run.ceoInTo) return { name: run.ceoFirst, isCeo: true, explicit: false };
  return { name: run.recipients[0]?.first ?? null, isCeo: false, explicit: false };
}

// ─── Emitters (dedupe + caps) ────────────────────────────────────────────────

function once(run: Run, key: string): boolean {
  if (run.seen.has(key)) return false;
  run.seen.add(key);
  return true;
}

function evidenceOf(s: Sentence): string | null {
  const ev = clipEvidence(s.text);
  return ev.replace(/\s+/g, " ").trim().length >= 8 ? ev : null;
}

function dueOf(run: Run, sentence: string, offset = 0): { date: string | null; text: string | null; hard: boolean } {
  const dates = findDates(sentence, run.input.occurredAt, run.input.timezone);
  const d = dates.find((x) => x.hard) ?? dates[0];
  if (!d) return { date: null, text: null, hard: false };
  if (anchoredElsewhere(sentence, d, offset)) {
    const tail = sentence.slice(d.index).replace(/[.;!?]+$/, "");
    return { date: null, text: cut(tail, 120), hard: true };
  }
  return { date: inWindow(d.date, run.now) ? d.date : null, text: cut(d.text, 120), hard: d.hard };
}

function focusFor(run: Run, text: string): FocusArea | null {
  if (/\b(?:runway|burn|budget|financial model|forecast|invoice)\b/i.test(text)) return "FINANCE";
  if (/\b(?:cardiopredict|cytohub\.ai|auc|(?:ai|ml|predictive|safety) models?)\b/i.test(text)) return "CYTOHUB_AI";
  if (/\bheartready\b/i.test(text)) return "SCIENCE";
  return FOCUS_BY_CATEGORY[run.input.classification.category] ?? null;
}

function priorityFor(run: Run, due: string | null): ExtractedTaskT["priorityHint"] {
  const rel = run.input.classification.relevance;
  const days = due ? daysFrom(due, run.input.occurredAt, run.input.timezone) : null;
  if (rel === "CRITICAL" && days != null && days <= 1) return "P0";
  if (rel === "CRITICAL" || rel === "HIGH") return "P1";
  if (rel === "NORMAL") return "P2";
  return "P3";
}

function addTask(run: Run, t: Omit<ExtractedTaskT, "focusArea" | "priorityHint" | "companyName"> & { companyName?: string | null }) {
  if (run.out.tasks.length >= 15 || !once(run, `task:${titleKey(t.title)}`)) return;
  run.out.tasks.push({
    title: t.title,
    description: t.description ? cut(t.description, 1000) : null,
    ownerName: t.ownerName ? cut(t.ownerName, 200) : null,
    ownerIsCeo: t.ownerIsCeo,
    dueDate: t.dueDate,
    dueText: t.dueText,
    priorityHint: t.ownerIsCeo ? priorityFor(run, t.dueDate) : null,
    companyName: t.companyName ?? run.primaryCompany,
    focusArea: focusFor(run, `${t.title} ${t.evidence}`),
    confidence: clamp(t.confidence),
    evidence: t.evidence,
  });
}

function addCommitment(run: Run, c: ExtractedCommitmentT) {
  if (run.out.commitments.length >= 15 || !once(run, `commitment:${c.direction}:${titleKey(c.title)}`)) return;
  run.out.commitments.push({ ...c, text: cut(c.text, 1000), confidence: clamp(c.confidence) });
}

function addDecision(run: Run, d: ExtractedDecisionT) {
  if (run.out.decisions.length >= 10 || !once(run, `decision:${d.status}:${titleKey(d.title)}`)) return;
  run.out.decisions.push({ ...d, decision: d.decision ? cut(d.decision, 1000) : null, confidence: clamp(d.confidence) });
}

function addDeadline(run: Run, what: string, due: { date: string | null; hard: boolean }, evidence: string, confidence: number) {
  if (!due.date || !due.hard || run.out.deadlines.length >= 15 || !once(run, `deadline:${due.date}:${titleKey(what)}`)) return;
  run.out.deadlines.push({ what: cut(what, 200), date: due.date, hard: due.hard, confidence: clamp(confidence), evidence });
}

function addRisk(run: Run, r: ExtractedRiskT) {
  if (run.out.risks.length >= 10 || !once(run, `risk:${titleKey(r.title)}`)) return;
  run.out.risks.push({ ...r, title: cut(r.title, 200), description: r.description ? cut(r.description, 1000) : null, confidence: clamp(r.confidence) });
}

function addOpportunity(run: Run, o: ExtractedOpportunityT) {
  if (run.out.opportunities.length >= 10 || !once(run, `opp:${titleKey(o.title)}`)) return;
  run.out.opportunities.push({ ...o, title: cut(o.title, 200), description: o.description ? cut(o.description, 1000) : null, confidence: clamp(o.confidence) });
}

function addFollowUp(run: Run, title: string, withName: string | null, dueDate: string | null, confidence: number, evidence: string) {
  if (run.out.followUps.length >= 10 || !once(run, `follow:${titleKey(title)}`)) return;
  run.out.followUps.push({ title: cut(title, 200), withName: withName ? cut(withName, 200) : null, dueDate, confidence: clamp(confidence), evidence });
}

function addFact(run: Run, f: ExtractedFactT) {
  if (run.out.facts.length >= 40 || !once(run, `fact:${f.label.toLowerCase()}:${f.value.toLowerCase()}`)) return;
  if (f.numericValue != null && !Number.isFinite(f.numericValue)) f.numericValue = null;
  run.out.facts.push({ ...f, label: cut(f.label, 120), value: cut(f.value, 200) });
}

// ─── Sentence rules ──────────────────────────────────────────────────────────

function counterpart(run: Run): Party | null {
  if (run.fromCeo) return run.recipients[0] ?? null;
  return run.sender && !run.sender.isCeo ? run.sender : null;
}

/** "Send them to Karen" → "Send them to Karen (re: Revised data package)". */
function withSubject(run: Run, title: string): string {
  const subject = (run.input.email?.threadSubject ?? run.input.title).replace(/^(?:(?:re|fwd?|aw)\s*:\s*)+/i, "").trim();
  return subject ? cut(`${title} (re: ${subject})`, 200) : title;
}

function detectGreeting(run: Run, sentences: Sentence[]) {
  for (const s of sentences.slice(0, 3)) {
    const m = GREETING.exec(s.text.trim());
    if (!m) continue;
    const names = m[1]
      .split(/\s*(?:,|&|\band\b)\s*/i)
      .map((n) => n.trim())
      .filter(Boolean);
    const group = !names.length || names.some((n) => GROUP_WORDS.test(n));
    run.greeting = { names, ceo: names.some((n) => isCeoName(run, n)), group };
    return s;
  }
  return null;
}

function vocativeOf(text: string): string | null {
  const m = /^([\p{Lu}][\p{L}'’-]+(?:\s[\p{Lu}][\p{L}'’-]+)?)\s*[,—–-]\s+(?=\p{Ll}|please|can|could|would|will)/u.exec(text.trim());
  if (!m) return null;
  return /^(?:thanks|thank|hi|hello|hey|yes|no|ok|okay|great|also|so|and|but|sure|absolutely|unfortunately|separately|finally|meanwhile|again|overall)$/i.test(m[1]) ? null : m[1];
}

/** Requests in a message the CEO did not write (or the CEO's requests to others). */
function ruleRequest(run: Run, s: Sentence, ev: string): boolean {
  if (BOILERPLATE.test(s.text)) return false;
  const text = s.text;
  const vocative = vocativeOf(text);
  let clause: string | null = null;
  let kind: "please" | "question" | "need" | "imperative" | "needYour" = "please";
  for (const p of REQUEST_PATTERNS) {
    const m = p.re.exec(text);
    if (m && startsWithActionVerb(m[1]) && !/^(?:be|have a|feel|see|find|note)\b/i.test(m[1])) {
      clause = m[1];
      kind = p.kind;
      break;
    }
  }
  let title: string | null = null;
  const due = dueOf(run, text);
  if (!clause) {
    const ny = NEED_YOUR.exec(text);
    if (ny) {
      const verb = NEED_YOUR_VERB[ny[1].toLowerCase().replace(/\s+/g, " ")] ?? "Respond on";
      const object = actionTitle(`x ${ny[2]}`, { dateText: due.text })?.replace(/^X\s*/i, "") ?? "";
      title = cut(`${verb}${object ? ` ${lcFirst(object)}` : ""}`.trim(), 90);
      kind = "needYour";
      clause = ny[0];
    }
  }
  if (!clause && (vocative || run.kind === "email")) {
    // Bare imperative ("Send us the updated SOW when ready.") — only when the sentence opens with one.
    const body = vocative ? text.slice(text.indexOf(vocative) + vocative.length).replace(/^\s*[,—–-]\s*/, "") : text;
    if (BARE_IMPERATIVES.has(leadVerb(body)) && !/\?\s*$/.test(body)) {
      clause = body;
      kind = "imperative";
    }
  }
  if (!clause) return false;
  if (/\bmeet|call|chat|talk\b/i.test(clause) && MEETING_REQUEST.test(text) && !/\b(?:send|share|review|sign|confirm)\b/i.test(clause)) return false;

  const owner = requestOwner(run, vocative);
  if (!owner.isCeo && !run.fromCeo && kind !== "please" && kind !== "need" && kind !== "needYour") return false;
  const cp = counterpart(run);
  title ??= actionTitle(clause, { dateText: due.text, senderFirst: run.fromCeo ? run.ceoFirst : cp?.first ?? null, recipientFirst: run.fromCeo ? cp?.first ?? null : run.ceoFirst });
  if (!title) return false;
  const vague = hasPronounObject(title);
  if (vague) title = withSubject(run, title);

  let confidence = { please: 0.72, need: 0.72, needYour: 0.72, question: 0.68, imperative: 0.62 }[kind];
  if (vague) confidence -= 0.15;
  if (/^let\b/i.test(title)) confidence = 0.6;
  if (due.date) confidence += 0.08;
  if (owner.explicit) confidence += 0.05;
  else if (owner.isCeo && run.recipients.length > 0) confidence -= 0.1;
  if (run.fromCeo || !owner.isCeo) confidence -= 0.07;

  const asker = run.fromCeo ? run.ceoName : cp?.name ?? run.sender?.name ?? null;
  addTask(run, {
    title,
    description: asker ? `${run.fromCeo ? "You asked" : `${asker}${cp?.company ? ` (${cp.company})` : ""} asked`}: “${cut(text, 400)}”` : null,
    ownerName: owner.name,
    ownerIsCeo: owner.isCeo,
    dueDate: due.date,
    dueText: due.text,
    confidence,
    evidence: ev,
    companyName: cp?.company ?? run.primaryCompany,
  });
  addDeadline(run, title, due, ev, 0.78);
  return true;
}

/** First-person promises: CEO → OUTBOUND/INTERNAL; others → INBOUND/INTERNAL. */
function ruleCommitment(run: Run, s: Sentence, ev: string): boolean {
  const m = COMMITMENT_RE.exec(s.text);
  if (!m) return false;
  const clause = m[1];
  if (NOT_COMMITMENT.test(clause) || /\?\s*$/.test(s.text)) return false;
  const lead = s.text.slice(0, m.index).trim();
  if (/\b(?:let me know|if you|could you|can you|would you)\b/i.test(lead)) return false;
  const verb = leadVerb(clause);
  const isLetMe = /^let me$/i.test(m[0].split(/\s+/).slice(0, 2).join(" ")) || /\blet me\s+$/i.test(m[0].slice(0, m[0].length - clause.length));
  if (!ACTION_VERBS.has(verb) && !(verb === "be" && /^be (?:sending|sharing|able to)/i.test(clause))) return false;
  if (/^(?:i can|happy to|i'd be happy to)\b/i.test(m[0]) && !findDates(s.text, run.input.occurredAt, run.input.timezone).length) return false;
  if (run.kind === "document" || run.kind === "event") return false;

  const due = dueOf(run, s.text);
  const cp = counterpart(run);
  let title = actionTitle(clause, { dateText: due.text, senderFirst: run.fromCeo ? run.ceoFirst : cp?.first ?? null, recipientFirst: run.fromCeo ? cp?.first ?? null : run.ceoFirst });
  if (!title) return false;
  const vague = hasPronounObject(title);
  if (vague) title = withSubject(run, title);

  let confidence = 0.7 + (due.date ? 0.12 : 0) - (vague ? 0.1 : 0);
  if (HEDGE.test(s.text)) confidence -= 0.15;
  if (CONDITIONAL.test(s.text.trim()) || /\bif\b/i.test(lead)) confidence -= 0.1;
  if (/^(?:i can|happy to|i'd be happy to)\b/i.test(m[0])) confidence -= 0.1;
  if (isLetMe) confidence -= 0.05;

  const internalMsg = run.input.email?.direction === "INTERNAL";
  if (run.kind === "notes") {
    // "I'll send the deck" in the CEO's own notes is the CEO's commitment to the meeting's counterpart.
    addCommitment(run, { direction: run.primaryCompany ? "OUTBOUND" : "INTERNAL", title, text: s.text, owedByName: run.ceoName, owedToName: run.primaryCompany, companyName: run.primaryCompany, dueDate: due.date, dueText: due.text, confidence: confidence - 0.05, evidence: ev });
  } else if (run.fromCeo) {
    const to = run.recipients[0] ?? null;
    addCommitment(run, {
      direction: internalMsg || to?.internal ? "INTERNAL" : "OUTBOUND",
      title,
      text: s.text,
      owedByName: run.ceoName,
      owedToName: to?.name ?? null,
      companyName: to?.company ?? run.primaryCompany,
      dueDate: due.date,
      dueText: due.text,
      confidence,
      evidence: ev,
    });
  } else if (run.sender) {
    addCommitment(run, {
      direction: internalMsg || run.sender.internal ? "INTERNAL" : "INBOUND",
      title,
      text: s.text,
      owedByName: run.sender.name,
      owedToName: run.ceoInTo || run.ceoInCc ? run.ceoName : run.recipients[0]?.name ?? null,
      companyName: run.sender.company,
      dueDate: due.date,
      dueText: due.text,
      confidence,
      evidence: ev,
    });
  } else {
    return false;
  }
  addDeadline(run, title, due, ev, 0.75);
  return true;
}

function ruleFollowUp(run: Run, s: Sentence, ev: string) {
  if (!FOLLOW_UP.test(s.text) || BOILERPLATE.test(s.text)) return;
  const due = dueOf(run, s.text);
  const withM = /\b(?:with|to)\s+([\p{Lu}][\p{L}'’.-]+(?:\s+[\p{Lu}][\p{L}'’.-]+){0,3})/u.exec(s.text);
  const topic = /\b(?:on|about|regarding|re:?)\s+((?:the\s+)?[\p{L}\d][^,.;!?]{2,60})/iu.exec(s.text.slice(FOLLOW_UP.exec(s.text)!.index));
  const cp = counterpart(run);
  const firstPerson = /\b(?:i'll|i will|we'll|we will|let me|i'm going to|we're going to)\b/i.test(s.text);
  let title: string;
  let withName: string | null;
  if (firstPerson && !run.fromCeo && cp) {
    withName = cp.name;
    title = `Expect follow-up from ${cp.name}`;
  } else {
    withName = withM?.[1] ?? cp?.name ?? null;
    title = withName ? `Follow up with ${withName}` : "Follow up";
  }
  if (topic) title += ` on ${topic[1].replace(/\s+(?:by|on|next|this|before|until)\b.*$/i, "").trim()}`;
  addFollowUp(run, title, withName, due.date, 0.68 + (due.date ? 0.1 : 0), ev);
}

function ruleMeetingRequest(run: Run, s: Sentence, ev: string) {
  if (!MEETING_REQUEST.test(s.text) || run.out.meetingRequests.length >= 5) return;
  const cp = counterpart(run);
  const who = cp?.name ?? null;
  const subject = run.input.email?.threadSubject?.replace(/^(?:(?:re|fwd?|aw)\s*:\s*)+/i, "").trim();
  const title = cut(`${who ? `Meeting with ${who}` : "Meeting"}${subject ? ` re: ${subject}` : ""}`, 200);
  if (!once(run, `meet:${titleKey(title)}`)) return;
  const times = [
    ...findDates(s.text, run.input.occurredAt, run.input.timezone).map((d) => d.text),
    ...(s.text.match(TIME_RE) ?? []),
  ].map((t) => cut(t, 120));
  run.out.meetingRequests.push({ title, withName: who, proposedTimes: [...new Set(times)].slice(0, 5), confidence: 0.7, evidence: ev });
}

function ruleDecisions(run: Run, s: Sentence, ev: string, notes: boolean) {
  const made = DECISION_MADE.exec(s.text);
  if (made && !DECISION_NEGATED.test(s.text)) {
    // "IC approved moving forward." is clearer as written than as "Moving forward".
    // "decided to delay X" → "Delay X"; "approved the 2027 plan" / "IC approved moving forward" read best as written.
    const clause = (made[1] ?? "").trim();
    const title = (startsWithActionVerb(clause) && clause.split(/\s+/).length >= 2 ? actionTitle(clause) : null) ?? cut(s.text.replace(/[.!?]+$/, ""), 90);
    const board = /\bboard\b/i.test(s.text.slice(0, made.index + 20));
    const by = board ? "Board" : /\b(?:we|i)\b/i.test(s.text.slice(0, made.index + 12)) ? (run.fromCeo ? run.ceoName : run.sender?.name ?? null) : null;
    addDecision(run, { title, status: "MADE", decision: s.text, decidedByName: by, deadline: null, options: [], confidence: notes || /^(?:decision|decided|agreed)/i.test(s.text) ? 0.8 : 0.72, evidence: ev });
    return;
  }
  if (run.fromCeo || !DECISION_NEEDED.test(s.text) || DECISION_NEGATED.test(s.text) && !/\bnot yet\b/i.test(s.text)) return;
  const due = dueOf(run, s.text);
  let title: string | null = null;
  let options: string[] = [];
  const should = /\b(?:should we|do you want (?:us |me )?to|want (?:me|us) to|would you prefer (?:we|to|us to)?)\s+([^?]+)/i.exec(s.text);
  const on = /\b(?:decision|call|go-ahead|green light|approval)\s+(?:on|about|for|regarding)\s+((?:[^?.,;]|\.(?=\d))+)/i.exec(s.text);
  const between = /\bdecide between\s+([^?.;]+)/i.exec(s.text);
  const goNoGo = /\bgo\/no[- ]go\s+(?:on|for)\s+([^?.,;]+)/i.exec(s.text);
  if (between) {
    options = between[1].split(/\s*(?:,|\bor\b|\band\b)\s*/).map((o) => o.trim()).filter((o) => o.length > 1).slice(0, 6);
    title = `Decide between ${options.join(" and ")}`;
  } else if (goNoGo) {
    title = `Go/no-go on ${goNoGo[1].replace(/\s+(?:by|before|until)\b.*$/i, "").trim()}`;
  } else if (should) {
    const body = should[1].replace(new RegExp(`\\s*${due.text ? escapeRe(due.text) : "$^"}`, "i"), "").trim();
    const parts = body.split(/\s*,?\s+\bor\b\s+/i);
    if (parts.length > 1) options = parts.map((p) => cut(p.replace(/[?.!]+$/, ""), 200)).slice(0, 6);
    title = `Decide whether to ${lcFirst(parts[0].replace(/[?.!]+$/, ""))}`;
  } else if (on) {
    title = `Decide on ${on[1].replace(/\s+(?:by|before|until)\b.*$/i, "").trim()}`;
  }
  title ??= `Decision needed: ${cut(s.text.replace(/[?.!]+$/, ""), 80)}`;
  addDecision(run, {
    title: cut(title, 200),
    status: "NEEDED",
    decision: null,
    decidedByName: run.kind === "email" && !run.fromCeo ? run.ceoName : null,
    deadline: due.date,
    options,
    confidence: 0.68 + (due.date ? 0.08 : 0),
    evidence: ev,
  });
  addDeadline(run, title, due, ev, 0.75);
}

function riskCategory(run: Run, text: string): RiskCategory {
  const cat = run.input.classification.category;
  if (/\b(?:investor|round|term sheet|series [a-e]|raise)\b/i.test(text) || cat === "INVESTOR" || cat === "FUNDRAISING") return "FUNDRAISING";
  if (/\b(?:assay|validation|dataset|donor|model|auc|experiment|data|lab|tissue)\b/i.test(text) || cat === "SCIENTIFIC_LEADERSHIP") return "SCIENTIFIC";
  if (cat === "CUSTOMER") return "CUSTOMER";
  if (/\b(?:msa|contract|deal|proposal|pilot|renewal)\b/i.test(text) || cat === "COMMERCIAL_OPPORTUNITY") return "COMMERCIAL";
  if (/\b(?:fda|ind|regulatory)\b/i.test(text)) return "REGULATORY";
  if (/\b(?:hire|candidate|offer|team|headcount)\b/i.test(text) || cat === "RECRUITING") return "PEOPLE";
  if (cat === "LEGAL") return "LEGAL";
  if (cat === "FINANCE") return "FINANCIAL";
  return "OPERATIONAL";
}

function ruleRisk(run: Run, s: Sentence, ev: string) {
  if (RISK_NEGATED.test(s.text)) return;
  const rule = RISK_RULES.find((r) => r.re.test(s.text));
  if (!rule) return;
  // "We've decided to delay X" is a choice, recorded as a decision — not a slipping deliverable.
  if ((rule.label === "Delay" || rule.label === "At risk") && DECISION_MADE.test(s.text)) return;
  const category = rule.category === "CONTEXT" ? riskCategory(run, s.text) : rule.category;
  let severity = rule.severity;
  if (run.input.classification.relevance === "CRITICAL") severity = Math.min(5, severity + 1);
  const company = run.primaryCompany && !s.text.toLowerCase().includes(run.primaryCompany.toLowerCase().split(" ")[0]) ? run.primaryCompany : null;
  const clause = cut(s.text.replace(/[.!?]+$/, ""), 100);
  addRisk(run, {
    title: `${rule.label}${company ? ` (${company})` : ""}: ${lcFirst(clause)}`,
    description: s.text,
    category,
    severity,
    companyName: run.primaryCompany,
    confidence: rule.confidence,
    evidence: ev,
  });
}

function opportunityKind(run: Run): OpportunityKind {
  switch (run.input.classification.category) {
    case "INVESTOR":
    case "FUNDRAISING":
      return "FUNDRAISING";
    case "CUSTOMER":
    case "COMMERCIAL_OPPORTUNITY":
      return "COMMERCIAL";
    case "STRATEGIC_PARTNER":
      return "PARTNERSHIP";
    case "SCIENTIFIC_LEADERSHIP":
      return "SCIENTIFIC";
    case "RECRUITING":
      return "HIRING";
    default:
      return "OTHER";
  }
}

/** The noun an expansion is about: "expanding the study" → "study"; "expand to three more sites" → null. */
function expansionObject(text: string): string | null {
  const m = /\b(?:expand(?:ing|ed)?|expansion of|extend(?:ing)?)\s+(?:the|our|this|that|your)\s+([\p{L}\d-]+(?:\s+[\p{L}\d-]+){0,2})/iu.exec(text);
  if (!m) return null;
  const words = m[1].split(/\s+/);
  const stop = words.findIndex((w) => /^(?:to|into|with|for|across|by|and|or|in|at|on|beyond|next|this|once)$/i.test(w));
  const noun = (stop >= 0 ? words.slice(0, stop) : words).join(" ").replace(/[.,;:!?]+$/, "");
  return noun || null;
}

function ruleOpportunity(run: Run, s: Sentence, ev: string) {
  const t = s.text;
  const company = run.primaryCompany;
  const money = firstMoney(t);
  const base = { description: t, companyName: company, estimatedValue: money && money.value >= 0 ? money.value : null, evidence: ev };
  const negated = (re: RegExp) => {
    const m = re.exec(t);
    return m ? NEGATION_NEAR.test(t.slice(Math.max(0, m.index - 40), m.index)) : false;
  };

  if (OPP_EXPANSION.test(t) && !negated(OPP_EXPANSION)) {
    const obj = expansionObject(t);
    const after = /\bexpan(?:d|sion)\w*\s+((?:to|into)\s+[^,.;!?]{3,60})/i.exec(t)?.[1];
    addOpportunity(run, { ...base, kind: "EXPANSION", title: obj ? `Potential ${obj.toLowerCase()} expansion` : after ? `Potential expansion ${after.trim()}` : "Potential expansion", confidence: 0.62 });
    return;
  }
  const add = OPP_ADDITIONAL.exec(t);
  if (add && !negated(OPP_ADDITIONAL) && /\b(?:discuss|interested|would like|plan|considering|want|exploring|possible|potential|opportunity|need|request)\b/i.test(t)) {
    addOpportunity(run, { ...base, kind: "EXPANSION", title: `Potential additional ${add[1].toLowerCase()}`, confidence: 0.6 });
    return;
  }
  if (OPP_UPSELL.test(t)) {
    addOpportunity(run, { ...base, kind: "EXPANSION", title: `Upsell opportunity${company ? ` with ${company}` : ""}`, confidence: 0.55 });
    return;
  }
  if (OPP_ROUND.test(t) && !negated(OPP_ROUND) && !run.fromCeo) {
    const sheet = /term ?sheet/i.test(t);
    addOpportunity(run, { ...base, kind: "FUNDRAISING", title: sheet ? `Potential term sheet${company ? ` from ${company}` : ""}` : `Potential round participation${company ? ` from ${company}` : ""}`, confidence: 0.65 });
    return;
  }
  if (OPP_PARTNER.test(t) && !negated(OPP_PARTNER)) {
    addOpportunity(run, { ...base, kind: "PARTNERSHIP", title: `Potential partnership${company ? ` with ${company}` : ""}`, confidence: 0.6 });
    return;
  }
  const intro = OPP_INTRO.exec(t);
  if (intro && !run.fromCeo) {
    // Protect honorific dots ("Dr. Lee") before cutting the name at punctuation.
    const target = intro[1].replace(/\b(Dr|Prof|Mr|Mrs|Ms)\./g, "$1\u0000").split(/[,.;!?(]|\s+(?:who|which|that|at|from|so)\s+/)[0].replace(/\u0000/g, ".").trim();
    const kind: OpportunityKind = /\b(?:fund|ventures|capital|investor|partners|vc)\b/i.test(intro[1]) ? "FUNDRAISING" : /\b(?:pharma|biotech|therapeutics|head of|vp|director)\b/i.test(intro[1]) ? "COMMERCIAL" : "OTHER";
    if (target.length >= 2) addOpportunity(run, { ...base, kind, title: `Introduction to ${cut(target, 80)}`, confidence: 0.6 });
    return;
  }
  const interest = OPP_INTEREST.exec(t);
  if (interest && !negated(OPP_INTEREST) && !run.fromCeo) {
    const what = interest[1].split(/[,.;!?]|\s+(?:and|but|so|if|once|before)\s+/)[0].trim();
    if (what.length >= 3) {
      addOpportunity(run, { ...base, kind: opportunityKind(run), title: `${company ? `${company}: i` : "I"}nterest in ${cut(what.replace(/^(?:the|a|an)\s+/i, ""), 80)}`, confidence: 0.6 });
      return;
    }
  }
  if (OPP_PILOT.test(t) && !negated(/\bpilot\b/i)) {
    addOpportunity(run, { ...base, kind: "COMMERCIAL", title: `Potential pilot${company ? ` with ${company}` : ""}`, confidence: 0.58 });
    return;
  }
  if (OPP_RFP.test(t)) {
    addOpportunity(run, { ...base, kind: "COMMERCIAL", title: `RFP${company ? ` from ${company}` : ""}`, confidence: 0.62 });
    return;
  }
  if (OPP_CREDITS.test(t) && money && /\b(?:offer|provide|give|grant|available|include|extend)\w*\b/i.test(t)) {
    addOpportunity(run, { ...base, kind: run.input.classification.category === "STRATEGIC_PARTNER" ? "PARTNERSHIP" : "OTHER", title: `${money.text} ${/credit/i.test(t) ? "in credits" : "discount"}${company ? ` from ${company}` : ""}`, confidence: 0.6 });
  }
}

function labelNear(text: string, index: number, rules: [RegExp, string][], fallback: string, matchLength = 0): string {
  const before = text.slice(Math.max(0, index - 70), index);
  const after = text.slice(index + matchLength, index + matchLength + 40);
  // A label right after the number is the most specific ("$40M round", "$250K in credits").
  const immediate = /^\s+(?:in\s+|of\s+)?(\S+(?:\s+\S+)?)/.exec(after)?.[1] ?? "";
  for (const [re, label] of rules) if (re.test(immediate)) return label;
  if (rules === MONEY_LABELS && /^\s+from\s+[A-Z]/.test(after)) return "Investment amount";
  // Closest label before the number wins; then right after it.
  let best: { label: string; at: number } | null = null;
  for (const [re, label] of rules) {
    const g = new RegExp(re.source, "gi");
    for (let m = g.exec(before); m; m = g.exec(before)) if (!best || m.index > best.at) best = { label, at: m.index };
  }
  if (best) {
    const series = /\bseries ([a-e])\b/i.exec(before);
    return best.label === "Raise amount" && series ? `Series ${series[1].toUpperCase()} raise amount` : best.label;
  }
  for (const [re, label] of rules) if (re.test(after)) return label;
  return fallback;
}

function ruleFacts(run: Run, s: Sentence, ev: string) {
  const t = s.text;
  const money = new RegExp(MONEY_RE.source, "gi");
  for (let m = money.exec(t); m; m = money.exec(t)) {
    const value = moneyValue(m);
    if (value == null) continue;
    addFact(run, { label: labelNear(t, m.index, MONEY_LABELS, "Amount", m[0].length), value: m[0].trim(), kind: "MONEY", numericValue: value, evidence: ev });
  }
  const auc = new RegExp(AUC_RE.source, "gi");
  for (let m = auc.exec(t); m; m = auc.exec(t)) {
    const q = m[1]?.trim().toLowerCase().replace("holdout", "hold-out");
    addFact(run, { label: q ? `${capitalize(q)} AUC` : "AUC", value: m[2], kind: "METRIC", numericValue: Number(m[2]), evidence: ev });
  }
  const pct = new RegExp(PERCENT_RE.source, "gi");
  for (let m = pct.exec(t); m; m = pct.exec(t)) {
    addFact(run, { label: labelNear(t, m.index, PERCENT_LABELS, "Percentage", m[0].length), value: m[0].trim(), kind: "PERCENT", numericValue: Number(m[1]), evidence: ev });
  }
  const cnt = new RegExp(COUNT_RE.source, "gi");
  for (let m = cnt.exec(t); m; m = cnt.exec(t)) {
    const unit = m[2].toLowerCase();
    const n = Number(m[1].replace(/,/g, ""));
    let label: string | null = null;
    if (/^(?:months?|weeks?|days?)$/.test(unit)) {
      const ctxt = t.slice(Math.max(0, m.index - 50), m.index + m[0].length + 20);
      if (/\brunway\b/i.test(ctxt)) label = `Runway (${unit.replace(/s$/, "")}s)`;
      else if (/\b(?:turnaround|lead time|timeline|onboarding)\b/i.test(ctxt)) label = `${capitalize(/\b(turnaround|lead time|timeline|onboarding)\b/i.exec(ctxt)![1].toLowerCase())} (${unit.replace(/s$/, "")}s)`;
    } else {
      label = capitalize(unit.replace(/^(?:study)$/, "studies").replace(/([^s])$/, "$1s").replace(/ss$/, "s"));
    }
    if (label) addFact(run, { label, value: m[0].trim(), kind: "COUNT", numericValue: n, evidence: ev });
  }
}

/** "Action: Maya to send the deck by Oct 9", "- [ ] Jonas to update the model", "Decision: …", "Risk: …". */
function ruleNotesLine(run: Run, s: Sentence, ev: string, inActionSection: boolean, rawLine: string): boolean {
  const t = s.text.trim();
  const decision = /^(?:decision|decided|agreed)\s*[:\-–]\s*(.+)$/i.exec(t);
  if (decision) {
    addDecision(run, { title: actionTitle(decision[1]) ?? cut(decision[1], 90), status: "MADE", decision: decision[1], decidedByName: null, deadline: null, options: [], confidence: 0.8, evidence: ev });
    return true;
  }
  const risk = /^(?:risk|concern|blocker|issue)\s*[:\-–]\s*(.+)$/i.exec(t);
  if (risk) {
    const rule = RISK_RULES.find((r) => r.re.test(risk[1]));
    addRisk(run, {
      title: `${rule?.label ?? "Risk"}: ${lcFirst(cut(risk[1].replace(/[.!?]+$/, ""), 100))}`,
      description: risk[1],
      category: rule && rule.category !== "CONTEXT" ? rule.category : riskCategory(run, risk[1]),
      severity: rule?.severity ?? 3,
      companyName: run.primaryCompany,
      confidence: 0.75,
      evidence: ev,
    });
    return true;
  }
  const follow = /^(?:follow[- ]?ups?)\s*[:\-–]\s*(.+)$/i.exec(t);
  if (follow) {
    const due = dueOf(run, follow[1]);
    addFollowUp(run, actionTitle(follow[1], { dateText: due.text }) ?? cut(follow[1], 90), null, due.date, 0.72, ev);
    return true;
  }
  const action = /^(?:action(?:\s+items?)?|ai|todo|to-do|next steps?)\s*[:\-–]\s*(.+)$/i.exec(t);
  const checkbox = /^\s*(?:[-*•]\s*)?\[[ xX]?\]/.test(rawLine);
  if (!action && !inActionSection && !checkbox) return false;
  let body = action ? action[1] : t;
  let owner: string | null = null;
  const lead = /^@?([\p{Lu}][\p{L}'’-]+(?:\s[\p{Lu}][\p{L}'’-]+)?|I|me|we|CEO)\s*(?:to|will|should|needs to|is to|:|–|—|-)\s+(.+)$/u.exec(body);
  const trail = /^(.+?)\s*(?:[(\[]\s*(?:owner:\s*)?@?([\p{Lu}][\p{L}'’-]+(?:\s[\p{Lu}][\p{L}'’-]+)?)\s*[)\]]|\s[–—-]\s*@?([\p{Lu}][\p{L}'’-]+))\s*\.?$/u.exec(body);
  if (lead && !/^(?:We|All|Team|Everyone)$/.test(lead[1]) && (startsWithActionVerb(lead[2]) || /^(?:I|me|CEO)$/.test(lead[1]))) {
    owner = lead[1];
    body = lead[2];
  } else if (trail) {
    owner = trail[2] ?? trail[3] ?? null;
    body = trail[1];
  }
  const due = dueOf(run, body);
  const title = actionTitle(body, { dateText: due.text });
  if (!title) return false;
  const ownerIsCeo = isCeoName(run, owner);
  addTask(run, {
    title,
    description: `Action item from ${run.input.meeting?.title ?? run.input.title}`,
    ownerName: ownerIsCeo ? run.ceoFirst : owner,
    ownerIsCeo,
    dueDate: due.date,
    dueText: due.text,
    // Explicit action-item formats ("Action:", checkboxes, items under "Action items:") are reliable.
    confidence: 0.8 + (due.date ? 0.05 : 0) - (owner ? 0 : 0.08),
    evidence: ev,
  });
  addDeadline(run, title, due, ev, 0.75);
  return true;
}

/** Calendar descriptions: "Please bring the updated pipeline", "prepare the Q3 numbers" → CEO prep task due at the event. */
function ruleEventAsk(run: Run, s: Sentence, ev: string) {
  const m = /\b(?:please|pls|kindly|could you|can you|you(?:'ll| will) need to|be ready to|come prepared to)\s+(?:also\s+)?(bring|prepare|review|read|send|share|come with|have|circulate|update|be ready to|look over)\b([\s\S]*)$/i.exec(s.text);
  if (!m || !run.eventDay) return;
  const title = actionTitle(`${m[1]}${m[2]}`);
  if (!title) return;
  const meeting = cut(run.input.title, 100);
  addTask(run, {
    title,
    description: `Preparation for “${meeting}”`,
    ownerName: run.ceoFirst,
    ownerIsCeo: true,
    dueDate: inWindow(run.eventDay, run.now) ? run.eventDay : null,
    dueText: cut(`before ${meeting}`, 120),
    confidence: 0.68 + (/\byou\b/i.test(s.text) ? 0.07 : 0),
    evidence: ev,
  });
}

/** Contract language: "CytoHub shall deliver …" (OUTBOUND), "<Customer> shall pay …" (INBOUND). */
function ruleContract(run: Run, s: Sentence, ev: string) {
  const m = /^(.{2,80}?)\s+(?:shall|will|agrees to|must|is obligated to|undertakes to)\s+(?:promptly\s+|also\s+)?(\p{L}[\s\S]*)$/iu.exec(s.text.trim());
  if (!m || !startsWithActionVerb(m[2])) return;
  const subject = m[1].replace(/^(?:\d+(?:\.\d+)*\s+|\(?[a-z]\)\s+)/i, "").trim();
  if (/\b(?:each|both|either|neither) part(?:y|ies)\b|\bthe parties\b/i.test(subject)) return;
  const ours = /\bcytohub\b|\b(?:service )?provider\b|\bsupplier\b|\blicensor\b/i.test(subject);
  const known = [...run.input.resolution.companies.map((c) => c.label), ...run.input.known.companies.map((c) => c.name)].find((n) => subject.toLowerCase().includes(n.toLowerCase()));
  const theirs = known || /\b(?:customer|client|sponsor|licensee|partner|company|purchaser|buyer)\b/i.test(subject);
  if (!ours && !theirs) return;
  const due = dueOf(run, s.text, 0);
  // "within 45 days" in a contract runs from an event (invoice, signature), not from the document date.
  if (due.date && due.text && /^(?:within|in)\b/i.test(due.text)) due.date = null;
  const title = actionTitle(m[2], { dateText: due.text });
  if (!title) return;
  const counterparty = known ?? run.primaryCompany;
  addCommitment(run, {
    direction: ours ? "OUTBOUND" : "INBOUND",
    title,
    text: s.text,
    owedByName: ours ? "CytoHub" : counterparty ?? cut(subject, 200),
    owedToName: ours ? counterparty ?? null : "CytoHub",
    companyName: counterparty ?? null,
    dueDate: due.date,
    dueText: due.text,
    confidence: 0.62 + (due.date || due.text ? 0.05 : 0),
    evidence: ev,
  });
  addDeadline(run, title, due, ev, 0.7);
}

function ruleDeadlineOnly(run: Run, s: Sentence, ev: string) {
  const due = dueOf(run, s.text);
  if (!due.date || !due.hard) return;
  const t = s.text;
  const what =
    /^(.{3,80}?)\s+(?:is|are|was|will be)\s+due\b/i.exec(t)?.[1] ??
    /\bdeadline\s+(?:for|on|to)\s+(.{3,80}?)\s+(?:is|by|on|:)/i.exec(t)?.[1] ??
    /\b(?:submit|deliver|send|file|sign|close|finalize|complete)\s+(.{3,60}?)\s+(?:by|before|no later than)\b/i.exec(t)?.[0].replace(/\s+(?:by|before|no later than)$/i, "") ??
    cut(t.replace(due.text ?? "", "").replace(/[.!?]+$/, ""), 120);
  addDeadline(run, capitalize(what.replace(/^(?:the|our|your)\s+/i, "").trim()), due, ev, 0.7);
}

// ─── Whole-item fields ───────────────────────────────────────────────────────

function entities(run: Run) {
  const { input } = run;
  const list: IntelligenceExtraction["entities"] = [];
  const seen = new Set<string>();
  const push = (e: IntelligenceExtraction["entities"][number]) => {
    const keys = [`${e.type}:${normalizeName(e.name)}`, ...(e.email ? [`${e.type}:${e.email}`] : [])];
    if (keys.some((k) => seen.has(k)) || list.length >= 40 || !e.name.trim()) return;
    if (e.type === "PERSON" && (isCeoName(run, e.name) || (e.email && e.email === input.ceo.email?.toLowerCase()))) return;
    for (const k of keys) seen.add(k);
    list.push({ ...e, name: cut(e.name, 200), role: e.role ? cut(e.role, 160) : null, companyName: e.companyName ? cut(e.companyName, 200) : null });
  };
  const companyLabel = (id: string | null | undefined) => (id ? input.resolution.companies.find((c) => c.id === id)?.label ?? null : null);
  for (const p of input.resolution.people) if (!p.isCeo) push({ type: "PERSON", name: p.label, email: p.email ?? null, role: null, companyName: companyLabel(p.companyId), confidence: p.confidence });
  for (const c of input.resolution.companies) push({ type: "COMPANY", name: c.label, email: null, role: c.companyType.toLowerCase(), companyName: null, confidence: c.confidence });
  for (const p of input.resolution.projects) push({ type: p.kind === "PRODUCT" ? "PRODUCT" : p.kind === "SCIENTIFIC_PROGRAM" ? "PROGRAM" : "PROJECT", name: p.label, email: null, role: null, companyName: null, confidence: p.confidence });
  for (const party of [run.sender, ...run.recipients]) {
    if (party && !party.isCeo) push({ type: "PERSON", name: party.name, email: party.email, role: null, companyName: party.company, confidence: 0.9 });
  }
  for (const a of input.event?.attendees ?? []) {
    if (a.email.toLowerCase() !== input.ceo.email?.toLowerCase()) push({ type: "PERSON", name: a.name ?? nameFromEmail(a.email), email: a.email.toLowerCase(), role: null, companyName: null, confidence: 0.85 });
  }
  const sigs = scanSignatures(input.text);
  for (const m of scanTextMentions(input.text, { selfOrgs: ["CytoHub"] })) {
    const sig = sigs.find((x) => x.name === m.text);
    push({ type: m.entityType, name: m.text, email: null, role: sig?.title ?? null, companyName: m.companyHint ?? null, confidence: m.confidence });
  }
  for (const u of input.resolution.unresolved) {
    const type = u.entityType === "COMPANY" ? "COMPANY" : u.entityType === "PROJECT" ? "PROJECT" : "PERSON";
    push({ type, name: u.text, email: null, role: null, companyName: null, confidence: 0.4 });
  }
  return list;
}

function relationships(run: Run, ents: IntelligenceExtraction["entities"]) {
  const rels: IntelligenceExtraction["relationships"] = [];
  const seen = new Set<string>();
  const push = (r: IntelligenceExtraction["relationships"][number]) => {
    const key = `${normalizeName(r.fromName)}|${r.relation}|${normalizeName(r.toName)}`;
    if (seen.has(key) || rels.length >= 30 || normalizeName(r.fromName) === normalizeName(r.toName)) return;
    seen.add(key);
    rels.push({ ...r, fromName: cut(r.fromName, 200), toName: cut(r.toName, 200) });
  };
  for (const e of ents) {
    if (e.type === "PERSON" && e.companyName) push({ fromType: "PERSON", fromName: e.name, relation: "WORKS_AT", toType: "COMPANY", toName: e.companyName, confidence: clamp(Math.min(e.confidence, 0.85)) });
  }
  const sub = /\b([\p{Lu}][\p{L}&.-]+(?:\s+[\p{Lu}][\p{L}&.-]+){0,3}),?\s+(?:a|the)\s+(?:wholly[- ]owned\s+)?subsidiary of\s+([\p{Lu}][\p{L}&.-]+(?:\s+[\p{Lu}][\p{L}&.-]+){0,3})/gu;
  for (let m = sub.exec(run.input.text); m; m = sub.exec(run.input.text)) push({ fromType: "COMPANY", fromName: m[1], relation: "SUBSIDIARY_OF", toType: "COMPANY", toName: m[2], confidence: 0.7 });
  return rels;
}

function strategicRelevance(run: Run): IntelligenceExtraction["strategicRelevance"] {
  const text = `${run.input.title}\n${run.input.text.slice(0, 20_000)}`;
  const tokens = new Set(contentTokens(text));
  const scored: { title: string; score: number }[] = [];
  for (const g of run.input.known.goals) {
    const gt = [...new Set(contentTokens(g.title))].filter((t) => !/^\d+$/.test(t));
    if (!gt.length) continue;
    // Proper nouns in the goal ("Brightwater", "CardioPredict", "Series") are strong signals.
    const proper = new Set((g.title.match(/\b[A-Z][A-Za-z0-9.]+/g) ?? []).slice(1).map((w) => contentTokens(w)[0]).filter(Boolean));
    let hit = 0;
    let weight = 0;
    const matched: string[] = [];
    for (const t of gt) {
      const w = proper.has(t) ? 2 : 1;
      weight += w;
      if (tokens.has(t)) {
        hit += w;
        matched.push(t);
      }
    }
    const score = hit / weight;
    // Two distinct shared words, or one distinctive proper noun ("Brightwater", "CardioPredict").
    const distinctive = matched.some((t) => proper.has(t) && t.length >= 7);
    if ((matched.length >= 2 || distinctive) && score >= 0.34) scored.push({ title: g.title, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]?.score ?? 0;
  return { score: Math.round(Math.min(1, best) * 100) / 100, goalTitles: scored.slice(0, 5).map((s) => cut(s.title, 200)), pillarNames: [] };
}

/** Dated, confident asks first: they make the best summary and next step. */
function taskRank(t: ExtractedTaskT): number {
  return (t.dueDate ? 1 : 0) + t.confidence;
}

function bestTask(tasks: ExtractedTaskT[]): ExtractedTaskT | undefined {
  return [...tasks].sort((a, b) => taskRank(b) - taskRank(a))[0];
}

const URGENCY_ORDER = { IMMEDIATE: 0, TODAY: 1, THIS_WEEK: 2, LATER: 3 } as const;

function urgencyFor(run: Run, due: string | null): keyof typeof URGENCY_ORDER {
  if (due) {
    const days = daysFrom(due, run.now, run.input.timezone);
    if (days <= 0) return "IMMEDIATE";
    if (days <= 1) return "TODAY";
    if (days <= 7) return "THIS_WEEK";
    return "LATER";
  }
  const rel = run.input.classification.relevance;
  return rel === "CRITICAL" ? "TODAY" : rel === "HIGH" ? "THIS_WEEK" : "LATER";
}

function dueLabel(due: string | null, dueText: string | null): string {
  if (due) return ` by ${formatDayShort(due)}`;
  return dueText ? ` (${dueText})` : "";
}

function recommendedActions(run: Run): IntelligenceExtraction["recommendedActions"] {
  const out = run.out;
  const actions: IntelligenceExtraction["recommendedActions"] = [];
  const cp = counterpart(run);
  const who = cp ? `${cp.name}${cp.company ? ` (${cp.company})` : ""}` : null;
  for (const t of [...out.tasks.filter((x) => x.ownerIsCeo)].sort((a, b) => taskRank(b) - taskRank(a)).slice(0, 2)) {
    actions.push({
      action: cut(`${t.title}${dueLabel(t.dueDate, t.dueText)}${who && run.kind === "email" ? ` and reply to ${cp!.name}` : ""}`, 300),
      why: cut(who ? `${who} asked you directly${t.dueText ? ` (${t.dueText})` : ""}.` : `Action item assigned to you${t.dueText ? ` (${t.dueText})` : ""}.`, 400),
      urgency: urgencyFor(run, t.dueDate),
    });
  }
  for (const t of out.tasks.filter((x) => !x.ownerIsCeo && !x.ownerName).slice(0, 1)) {
    actions.push({ action: cut(`Assign an owner for “${t.title}”`, 300), why: "Action item without an owner.", urgency: urgencyFor(run, t.dueDate) === "IMMEDIATE" ? "TODAY" : "THIS_WEEK" });
  }
  for (const c of out.commitments.filter((x) => x.direction !== "INBOUND" && x.owedByName === run.ceoName).slice(0, 2)) {
    const to = c.owedToName && !c.title.includes(firstNameOf(c.owedToName)) ? ` for ${c.owedToName}` : "";
    actions.push({ action: cut(`${c.title}${to}${dueLabel(c.dueDate, c.dueText)}`, 300), why: cut(`You committed to this${c.owedToName ? ` to ${c.owedToName}` : ""}.`, 400), urgency: urgencyFor(run, c.dueDate) });
  }
  for (const d of out.decisions.filter((x) => x.status === "NEEDED").slice(0, 1)) {
    actions.push({ action: cut(`${d.title}${d.deadline ? ` by ${formatDayShort(d.deadline)}` : ""}`, 300), why: cut(`${cp?.name ?? "Someone"} needs your decision.`, 400), urgency: urgencyFor(run, d.deadline) });
  }
  for (const r of out.risks.filter((x) => x.severity >= 4).slice(0, 1)) {
    actions.push({ action: cut(`Address: ${r.title}`, 300), why: cut(`${r.category.toLowerCase()} risk, severity ${r.severity}/5.`, 400), urgency: "TODAY" });
  }
  for (const c of out.commitments.filter((x) => x.direction === "INBOUND").slice(0, 1)) {
    actions.push({ action: cut(`Track ${c.owedByName ?? "their"} commitment: ${c.title}${dueLabel(c.dueDate, c.dueText)}`, 300), why: "Owed to CytoHub; follow up if it slips.", urgency: "LATER" });
  }
  for (const m of out.meetingRequests.slice(0, 1)) {
    actions.push({ action: cut(`Propose times: ${m.title}`, 300), why: cut(`${m.withName ?? "They"} asked to meet.`, 400), urgency: "THIS_WEEK" });
  }
  return actions.sort((a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency]).slice(0, 5);
}

function summarize(run: Run): string {
  const { input, out } = run;
  const cp = counterpart(run);
  const who = cp ? `${cp.name}${cp.company ? ` (${cp.company})` : ""}` : run.sender?.name ?? null;
  const parts: string[] = [];
  const ceoTask = bestTask(out.tasks.filter((t) => t.ownerIsCeo));
  const outbound = out.commitments.find((c) => c.owedByName === run.ceoName);
  const inbound = out.commitments.find((c) => c.direction === "INBOUND" || (c.direction === "INTERNAL" && c.owedByName !== run.ceoName));
  const made = out.decisions.find((d) => d.status === "MADE");
  const needed = out.decisions.find((d) => d.status === "NEEDED");
  const dueOfT = (d: string | null, t: string | null) => (d ? ` by ${formatDayShort(d)}` : t ? ` ${t}` : "");

  if (run.kind === "email") {
    if (run.fromCeo && outbound) parts.push(`You committed to ${lcFirst(outbound.title)}${outbound.owedToName ? ` for ${outbound.owedToName}` : ""}${dueOfT(outbound.dueDate, outbound.dueText)}.`);
    else if (ceoTask && who) parts.push(`${who} asks you to ${lcFirst(ceoTask.title)}${dueOfT(ceoTask.dueDate, ceoTask.dueText)}.`);
    else if (needed && who) parts.push(`${who} needs your decision: ${lcFirst(needed.title)}.`);
    else if (inbound) parts.push(`${inbound.owedByName ?? who ?? "They"} will ${lcFirst(inbound.title)}${dueOfT(inbound.dueDate, inbound.dueText)}.`);
    else if (made) parts.push(`${made.decidedByName ?? who ?? "The team"} decided: ${lcFirst(made.title)}.`);
    else parts.push(`${run.fromCeo ? `You wrote to ${run.recipients[0]?.name ?? "the thread"}` : `${who ?? "Someone"} wrote`} about “${cut(input.email?.threadSubject || input.title, 100)}”.`);
  } else if (run.kind === "event") {
    const ev = input.event!;
    const others = ev.attendees.filter((a) => a.email.toLowerCase() !== input.ceo.email?.toLowerCase());
    parts.push(`${input.title} on ${formatDayShort(run.eventDay!)} with ${others.length} other attendee${others.length === 1 ? "" : "s"}${run.primaryCompany ? ` (${run.primaryCompany})` : ""}${ev.status === "CANCELLED" ? " — cancelled" : ""}.`);
    if (ceoTask) parts.push(`Prepare: ${lcFirst(ceoTask.title)}.`);
  } else if (run.kind === "notes") {
    const owners = [...new Set(out.tasks.map((t) => (t.ownerIsCeo ? "you" : t.ownerName)).filter(Boolean))];
    parts.push(`Notes from ${input.meeting?.title ?? input.title}: ${out.tasks.length} action item${out.tasks.length === 1 ? "" : "s"}${owners.length ? ` (${owners.slice(0, 4).join(", ")})` : ""}, ${out.decisions.filter((d) => d.status === "MADE").length} decision${out.decisions.length === 1 ? "" : "s"}.`);
  } else {
    const label = input.document?.docType && input.document.docType !== "OTHER" ? input.document.docType.toLowerCase().replace(/_/g, " ") : "document";
    parts.push(`${capitalize(label)} “${cut(input.title, 100)}”${input.document?.author ? ` by ${input.document.author}` : ""}${input.document && input.document.version > 1 ? ` (version ${input.document.version})` : ""}.`);
    const fact = out.facts.find((f) => f.kind === "MONEY") ?? out.facts[0];
    if (fact) parts.push(`${fact.label}: ${fact.value}.`);
  }

  const extras: string[] = [];
  if (out.opportunities[0]) extras.push(lcFirst(out.opportunities[0].title));
  if (out.risks[0]) extras.push(`a risk (${lcFirst(out.risks[0].title.split(":")[0])})`);
  if (needed && !parts[0].includes("decision")) extras.push(`a pending decision (${lcFirst(needed.title)})`);
  if (extras.length && parts.length < 2) parts.push(`Also: ${extras.slice(0, 2).join("; ")}.`);
  return cut(parts.join(" "), 1200);
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export function extractWithRules(input: ExtractionInput, now: Date): IntelligenceExtraction {
  const run = buildRun(input, now);
  const out = run.out;
  const text = input.text ?? "";
  const all = splitSentences(text);

  // Stop at the signature / quoted history in email.
  let sentences = all;
  if (run.kind === "email") {
    const stop = all.findIndex((s) => SIGN_OFF.test(s.text.trim()) || QUOTE_HEADER.test(s.text.trim()));
    if (stop >= 0) sentences = all.slice(0, stop);
  }
  const greeting = detectGreeting(run, sentences);

  let inActionSection = false;
  for (const s of sentences) {
    if (s === greeting) continue;
    const ev = evidenceOf(s);
    const header = /^(?:action items?|next steps?|todos?|to-dos?|follow[- ]ups?)\s*:?\s*$/i.test(s.text.trim());
    if (header) {
      inActionSection = true;
      continue;
    }
    if (!ev) continue;
    const lineStart = text.lastIndexOf("\n", s.start - 1) + 1;
    const rawLine = text.slice(lineStart, s.end);
    const isListItem = /^\s*(?:[-*•–]|\d{1,2}[.)]|\[[ xX]?\])/.test(rawLine);
    if (inActionSection && !isListItem && /:\s*$/.test(s.text)) inActionSection = false;

    if (run.kind === "notes" && ruleNotesLine(run, s, ev, inActionSection && isListItem, rawLine)) continue;
    if (run.kind === "event") ruleEventAsk(run, s, ev);
    if (run.kind === "document") ruleContract(run, s, ev);

    let handled = false;
    if (run.kind === "email" || run.kind === "notes") {
      if (!run.fromCeo || run.kind === "email") handled = ruleCommitment(run, s, ev);
      if (!handled && run.kind === "email") handled = ruleRequest(run, s, ev);
    }
    ruleFollowUp(run, s, ev);
    ruleMeetingRequest(run, s, ev);
    ruleDecisions(run, s, ev, run.kind === "notes");
    ruleRisk(run, s, ev);
    ruleOpportunity(run, s, ev);
    ruleFacts(run, s, ev);
    if (!handled) ruleDeadlineOnly(run, s, ev);
  }

  const cls = input.classification;
  out.ceoRelevance = { level: cls.relevance, score: cls.relevanceScore, category: cls.category, reasons: cls.reasons.slice(0, 6).map((r) => cut(r, 200)) };
  out.strategicRelevance = strategicRelevance(run);
  out.meetingRelevance = {
    isMeetingRelated: run.kind === "event" || run.kind === "notes" || Boolean(input.meeting) || out.meetingRequests.length > 0,
    meetingTitle: input.meeting?.title ? cut(input.meeting.title, 200) : run.kind === "event" ? cut(input.title, 200) : null,
  };
  out.activityTags = cls.activityTags.filter((t): t is (typeof ACTIVITY_TAGS)[number] => (ACTIVITY_TAGS as readonly string[]).includes(t)).slice(0, 6);
  out.entities = entities(run);
  out.relationships = relationships(run, out.entities);
  out.recommendedActions = recommendedActions(run);
  out.summary = summarize(run);
  return out;
}

