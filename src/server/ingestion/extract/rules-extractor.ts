/**
 * Deterministic intelligence extractor — always available, and what runs when
 * Claude is not configured. Produces the same IntelligenceExtraction contract
 * as the Claude path, sentence by sentence, with every item's evidence being
 * the exact sentence it came from (so validateExtraction keeps it unchanged).
 *
 * Point of view: "the CEO" is input.ceo. In messages the CEO did not write,
 * requests addressed to them become tasks with ownerIsCeo; in messages the CEO
 * wrote, first-person promises become OUTBOUND commitments (or CEO tasks when
 * made to the team) and requests to others become tasks for the recipient.
 *
 * Confidence is calibrated to the writer's gate (≥ 0.80 written, 0.55–0.80
 * review, < 0.55 dropped on quiet sources):
 *   0.82–0.92  explicit: a direct request with a concrete object, a first-person
 *              promise with a concrete object, an explicit decision ask, a risk
 *              or opportunity stated in strong terms
 *   0.60–0.75  hedged or implicit ("I can probably…", "might", CEO one of many)
 *   < 0.50     weak (courtesy offers, delegations the CEO made himself)
 * Items whose object is only a pronoun or a vague phrase ("Bring both",
 * "Make time in the morning") are resolved from the previous sentence when
 * possible, and otherwise not emitted at all.
 *
 * Everything shown to the CEO (titles, summary, recommended actions) is
 * phrased as a short noun phrase or imperative via phrasing.ts — never a raw
 * source fragment; the verbatim sentence stays in `evidence`/`description`.
 */
import type { CeoCategory, DocumentType, FocusArea, OpportunityKind } from "@/generated/prisma/enums";
import { dayKeyInTz } from "@/lib/dates";
import {
  type ExtractedCommitmentT,
  type ExtractedDecisionT,
  type ExtractedFactT,
  type ExtractedOpportunityT,
  type ExtractedTaskT,
  type IntelligenceExtraction,
  ACTIVITY_TAGS,
  RISK_CATEGORIES,
  emptyExtraction,
} from "../extraction-schema";
import type { ExtractionInput, Participant } from "../types";
import { type ResolvedDate, daysFrom, findDates } from "./dates";
import { scanSignatures, scanTextMentions } from "./mentions";
import { dayShort, dueWords, durationIn, lowerFirst, sentenceCase, shortCompany, subjectTopic, tidy, withArticle, withDue } from "./phrasing";
import { type Sentence, clipEvidence, splitSentences } from "./sentences";
import { ACTION_VERBS, BOILERPLATE, actionTitle, fitTitle, hasPronounObject, leadVerb, startsWithActionVerb, weakObject } from "./titles";
import {
  MONEY_RE,
  capitalize,
  companyNameFromDomain,
  contentTokens,
  domainOf,
  firstMoney,
  firstNameOf,
  isFreeMailDomain,
  moneyValue,
  nameFromEmail,
  normalizeName,
  registrableDomain,
  titleKey,
  truncateWords,
} from "./text";

type RiskCategory = (typeof RISK_CATEGORIES)[number];

/** Calibrated confidence levels (see header). */
const CONF = { explicit: 0.86, dated: 0.03, implicit: 0.76, hedged: 0.66, weak: 0.48, delegated: 0.45 } as const;

interface Party {
  name: string;
  first: string;
  email: string | null;
  company: string | null;
  internal: boolean;
  isCeo: boolean;
}

/** Side information for CEO-facing phrasing (not part of the output). */
interface ItemMeta {
  /** The action with its articles, for running text ("send the revised data package"). */
  phrase?: string;
  /** Who asked (requests) — name and company. */
  asker?: Party | null;
  /** The asker also wants the CEO to confirm the date ("Please confirm you can meet that date"). */
  confirm?: boolean;
  /** Why a decision is needed by its deadline ("to secure the booth"). */
  purpose?: string | null;
  /** The CEO promised it to the team (task instead of commitment). */
  promisedTo?: string | null;
}

interface RiskDraft {
  rule: RiskRule;
  sentence: string;
  evidence: string;
  party: string | null;
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
  docType: DocumentType | null;
  /** CSV/XLSX: rows are not sentences. */
  tabular: boolean;
  /** Thread subject (or item title) without Re:/Fwd: and label prefixes. */
  subject: string;
  /** Event start as the CEO's calendar day. */
  eventDay: string | null;
  sentences: Sentence[];
  idx: number;
  meta: WeakMap<object, ItemMeta>;
  risks: RiskDraft[];
  /** "Options:" list items in this message (attached to the decision asked for). */
  options: string[];
  recommendation: string | null;
  seen: Set<string>;
}

// ─── Lexicon ─────────────────────────────────────────────────────────────────

const SIGN_OFF = /^(?:best(?: regards| wishes)?|kind regards|warm regards|with best regards|regards|thanks(?: again| so much)?|thank you|many thanks|cheers|sincerely|warmly|all the best|talk soon|br)\s*[,!.]?$/i;
const QUOTE_HEADER = /^(?:on .{6,80} wrote:|-{2,}\s*(?:original|forwarded) message\s*-{2,}|from:\s.+|sent:\s.+|>)/i;
const GREETING = /^(?:hi|hello|hey|dear|good (?:morning|afternoon|evening)|morning)\b[\s,]*([^,!:\n]{0,80}?)\s*[,!:]?$/i;
const GROUP_WORDS = /^(?:all|everyone|team|folks|both|both of you|y'all|you two|guys|everybody|there)$/i;

const REQUEST_PATTERNS: { re: RegExp; kind: "please" | "question" | "need" }[] = [
  { re: /(?:^|[,;:—–-]\s*|\b(?:and|also|so|then)\s+)(?:please|pls|kindly)\s+(?:do\s+)?(?:also\s+)?(?:make sure (?:to|that you)\s+)?(\p{L}[\s\S]*)$/iu, kind: "please" },
  { re: /\b(?:could|can|would|will)\s+you\s+(?:please\s+|kindly\s+)?(?:also\s+)?(?:be able to\s+)?(\p{L}[\s\S]*?)\s*\??$/iu, kind: "question" },
  { re: /\b(?:i|we)\s+(?:would\s+|will\s+)?need\s+you\s+to\s+(\p{L}[\s\S]*)$/iu, kind: "need" },
];
/** "I need your approval on X", "We would like your comments on the term sheet by Friday". */
const NEED_YOUR =
  /\b(?:i|we)\s+(?:would\s+|will\s+|still\s+|also\s+)?(?:need|would like|'d like|would love|'d love|would appreciate|'d appreciate)\s+(?:to (?:get|have)\s+)?your\s+(approval|sign-?off|signature|decision|call|feedback|input|thoughts|comments|answer|response|help|review|go-ahead|green light)\s*(?:on|for|about|regarding|with|of)?\s*([\s\S]*)$/i;
const DECISION_KINDS = new Set(["approval", "sign-off", "signoff", "decision", "call", "go-ahead", "green light"]);
const NEED_YOUR_VERB: Record<string, string> = {
  signature: "Sign",
  feedback: "Send feedback on",
  input: "Send input on",
  thoughts: "Share thoughts on",
  comments: "Send comments on",
  answer: "Answer",
  response: "Respond on",
  help: "Help with",
  review: "Review",
};
/** "we need the revised electrophysiology dataset … by Oct 20" (a dated ask). */
const WE_NEED_BY = /\b(?:we|i)\s+(?:will\s+|also\s+|still\s+)?need\s+(?:the\s+|your\s+|a\s+|an\s+)?([^.;?]{4,140}?)\s+(?:by|before|no later than)\s+/i;
/** Imperatives we accept without "please" when the message is clearly addressed to the CEO. */
const BARE_IMPERATIVES = new Set(["send", "share", "forward", "sign", "countersign", "review", "confirm", "approve", "provide", "call", "email", "schedule", "book", "submit", "return", "wire", "pay"]);
/** Genuine hedging, not politeness ("when you have a moment" is polite, not hedged). */
const HEDGE = /\b(?:probably|might|may be able to|hope to|hopefully|try to|let me see if|not sure|if we can|should be able to|aim to|ideally)\b/i;

const COMMITMENT_RE =
  /\b(?:i'll|i will|i'm going to|i am going to|i shall|we'll|we will|we're going to|we are going to|we shall|let me|i can|i'd be happy to|happy to|i promise to|we promise to)\s+(?:also\s+|definitely\s+|personally\s+|then\s+|still\s+|certainly\s+|probably\s+|likely\s+|hopefully\s+|aim to\s+|try to\s+|make sure to\s+)*(\p{L}[\s\S]*)$/iu;
const NOT_COMMITMENT = /^(?:be\b(?!\s+(?:sending|sharing|able to))|need|see|know|let you know if|have to|hear|miss|wait|keep you posted|talk soon|see you|hope|think|assume|let you know whether|ask for)/i;
const CONDITIONAL = /^(?:if|once|when|assuming|provided)\b/i;
/** Org or third-person promises: "Legal will return…", "Granite Peak will take…", "Daniel Kim will ship…". */
const THIRD_PARTY =
  /(?:^|[,;:]\s*|\b(?:and|so|but|that)\s+)((?:our|their)\s+(?:legal(?:\s+team)?|counsel|lawyers|team|finance(?:\s+team)?|procurement|cso|ceo|board|partners|partnership|ic|investment committee)|legal|counsel|procurement|(?:Dr\.|Prof\.)?\s?\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}[\p{L}'’-]+){0,2})\s+(?:will|is going to|plans to|shall)\s+(?:also\s+)?(\p{L}[\s\S]*)$/u;
const NOT_A_PERSON = /^(?:i|we|it|this|that|there|he|she|they|you|our|the|everyone|nobody|someone|ben|which|what|who|each party|either party)$/i;

const FOLLOW_UP_VERB = /\b(?:follow(?:ing)? up(?! (?:call|meeting|email|note|question|session))|circle back|check in|touch base|reconnect)\b/i;
const MEETING_REQUEST =
  /\b(?:(?:can|could|shall|should) we (?:meet|talk|chat|connect|sync|catch up|get together|grab|hop on|jump on|set up|schedule|find|review|go over|walk through|discuss|look at)|(?:can|could) you make (?:some )?time|(?:find|grab) (?:some )?(?:time|\d+ minutes)\b|schedule (?:a|an|some) (?:call|meeting|time|chat|session)|set up (?:a|an|some) (?:call|meeting|time|chat)|are you (?:available|free|around)|do you have (?:time|availability|\d+ minutes)|would you be (?:open|available) (?:to|for) (?:a |an )?(?:[\w-]+ )?(?:call|meeting|chat|discussion|conversation)|(?:i'?d|we'?d) (?:also )?(?:welcome|love|like) (?:a |an )?(?:short |quick |brief )?(?:call|chat|meeting|conversation)|(?:hop|jump) on a (?:quick )?call|grab (?:coffee|lunch|dinner|a coffee)|let'?s (?:meet|talk|connect|find time|set up|schedule|grab))\b/i;
const TIME_RE = /\b\d{1,2}(?::\d{2})?\s?(?:am|pm|a\.m\.|p\.m\.)(?:\s*(?:et|est|edt|pt|pst|pdt|ct|cet|gmt|utc))?\b/gi;

const DECISION_MADE =
  /\b(?:we(?:'ve| have)? (?:now )?decided|we(?:'ve| have)? agreed|it was agreed|(?:the |our |their )?(?:board|ic|investment committee|finance committee|committee|partnership|partners|leadership team|exec team) (?:has |have )?(?:approved|decided|agreed|signed off)|(?:we|they|i)(?: have|'ve)? approved|(?:we|i)(?:'ll| will) go with|(?:we|i)(?:'re| are| am|'m) going (?:to go )?with|signed off on|(?:we|i) chose|(?:we|i)(?:'ve| have) chosen|decision(?: made)?\s*[:\-–]|decided\s*[:\-–]|agreed\s*[:\-–]|final call\s*[:\-–])\s*(?:that\s+|to\s+)?([\s\S]*)$/i;
const DECISION_NEGATED = /\b(?:haven'?t|have not|not yet|no|hasn'?t|has not|yet to)\s+(?:been\s+)?(?:decided|agreed|approved|decision)\b|\bundecided\b/i;
const DECISION_NEEDED =
  /\b(?:need (?:your|a|the) (?:decision|call|go-ahead|green light|approval|sign-?off)|decide (?:by|on|whether|if|between|which)|go\/no[- ]go|your call\b|should we\b|which (?:option|one|way|approach) (?:do you|would you|should we)|do you want (?:us |me )?to\b|want (?:me|us) to\b|would you prefer|awaiting your (?:decision|approval|call)|pending your (?:decision|approval))/i;
const LEAD_IN = /^(?:(?:good|great) news(?: from our side)?\s*[:,!-]\s*|(?:i'?m|we'?re|i am|we are)\s+(?:delighted|happy|pleased|glad|excited|thrilled)\s+to\s+(?:share|confirm|report|say|let you know|announce)\s+(?:that\s+)?|happy to confirm (?:that\s+)?|just to confirm,?\s+|fyi,?\s+|update:\s*)/i;

const OPP_EXPANSION = /\b(?:expand(?:ing|ed)?|expansion (?:of|to|into)|extend(?:ing)? (?:the|our) (?:study|pilot|contract|engagement|program|partnership))\b/i;
const OPP_ADDITIONAL = /\b(?:additional|another|second|follow-on|more) (study|studies|sites?|orders?|projects?|programs?|pilots?|compounds?|assays?|work)\b/i;
const OPP_UPSELL = /\b(?:upsell|cross-sell|add-on|upgrade to)\b/i;
const OPP_INTEREST = /\b(?:interested in|keen (?:on|to)|would (?:love|like) to (?:explore|discuss|learn more about|work together|collaborate|partner))\s*([\s\S]*)$/i;
const OPP_PARTNER = /\b(?:would like to partner|(?:explore|discuss|propose|open to|interested in) (?:a )?(?:partnership|collaboration)|co-develop|joint (?:study|venture|development))\b/i;
const OPP_INTRO = /\b(?:introduce you to|intro(?:duction)? to|connect you with|put you in touch with)\s+([\s\S]*)$/i;
const OPP_CREDITS = /\b(?:credits?|discount(?:ed)?|waive[ds]?|free (?:tier|access|trial))\b/i;
const OPP_PILOT = /\b(?:start|kick off|launch|run|explore|consider|propose|interested in|would like|set up|begin)\b[^.]{0,40}\bpilot\b|\bpilot\b[^.]{0,30}\b(?:proposal|opportunity)\b/i;
const OPP_RFP = /\b(?:RFP|request for proposals?|RFI|tender)\b/;
const OPP_ROUND = /\b(?:lead|co-lead|participate in|join|anchor) (?:the|your) (?:round|series [a-e]|raise)\b|\b(?:send|issue) (?:you |over )?(?:a|the|our) term ?sheet\b/i;
const OPP_INVESTOR = /\b(?:we )?(?:typically |usually |can )?invest (?:\$|between|around|up to)|\b(?:interested in|would like to|keen to) (?:invest|lead|participate|co-invest)\b/i;
const NEGATION_NEAR = /\b(?:not|no longer|won'?t|will not|don'?t|do not|unable|can'?t|cannot|decline[ds]?|pass(?:ed)? on|unlikely|delay(?:ed|ing)?|postpon\w*|pause[ds]?|pausing|cancel\w*|halt\w*|stop\w*|defer\w*|scal(?:e|ing) back)\b/i;

interface RiskRule {
  id: "sla" | "churn" | "breach" | "escalation" | "offer" | "people" | "legal" | "regulatory" | "financial" | "fundraising" | "shortage" | "delay" | "scientific" | "atrisk" | "reputational";
  re: RegExp;
  category: RiskCategory | "CONTEXT";
  severity: number;
  confidence: number;
}
const RISK_RULES: RiskRule[] = [
  { id: "sla", re: /\bmissed (?:the |our |an? )?SLAs?\b|\bSLA (?:miss|breach)\w*|\b(?:below|outside) (?:the |our )?SLA\b/i, category: "CUSTOMER", severity: 4, confidence: 0.86 },
  { id: "churn", re: /\b(?:can(?:'|no)?t recommend (?:the )?renewal|not (?:going to )?renew|won'?t renew|non-renewal|churn|cancel(?:l?ing)? (?:the|our) (?:contract|agreement|subscription|order)|terminat(?:e|ing|ion of) (?:the|our) (?:contract|agreement)|renewal\s*(?:\([^)]*\)\s*)?(?:is\s+)?at risk|moving to a competitor)\b/i, category: "CUSTOMER", severity: 5, confidence: 0.86 },
  { id: "breach", re: /\bbreach(?:ed|es)?\b/i, category: "LEGAL", severity: 5, confidence: 0.84 },
  { id: "escalation", re: /\b(?:escalat(?:e|ed|ing|ion)|unacceptable|very disappointed|frustrat\w*|formal complaint)\b/i, category: "CONTEXT", severity: 4, confidence: 0.84 },
  { id: "offer", re: /\bcompeting offer\b/i, category: "PEOPLE", severity: 4, confidence: 0.86 },
  { id: "people", re: /\b(?:resign(?:ed|ing|ation)|quit(?:ting)?|leaving the company|giving notice|burn(?:ed|t)? out)\b/i, category: "PEOPLE", severity: 4, confidence: 0.8 },
  { id: "legal", re: /\b(?:lawsuit|litigation|legal dispute|infring\w*|cease and desist)\b/i, category: "LEGAL", severity: 4, confidence: 0.8 },
  { id: "regulatory", re: /\b(?:clinical hold|warning letter|fda (?:concern|hold|warning|objection)|non-?compliance|audit finding)\b/i, category: "REGULATORY", severity: 4, confidence: 0.82 },
  { id: "financial", re: /\b(?:runway (?:is )?(?:short|shorter)|cash crunch|over budget|burn (?:is )?(?:up|higher|above)|shortfall|missed (?:the )?(?:revenue|bookings) (?:target|plan))\b/i, category: "FINANCIAL", severity: 4, confidence: 0.8 },
  { id: "fundraising", re: /\b(?:pass(?:ed|ing)? on (?:the|this|our) (?:round|deal|investment|series [a-e])|decline[ds]? to (?:invest|participate|lead)|(?:not|won'?t) (?:be )?(?:able to )?lead)\b/i, category: "FUNDRAISING", severity: 3, confidence: 0.82 },
  { id: "delay", re: /\b(?:(?:will be|is|are|was|were|has been|have been|got|being) (?:delayed|late|pushed (?:back|out)|postponed)|delayed by|slipp(?:ed|ing)|behind schedule|fall(?:ing|en)? behind|running (?:late|behind)|missed (?:the |our |a )?(?:deadline|date|milestone|window)|this delay|the delay (?:affects|will|means|pushes))\b/i, category: "CONTEXT", severity: 3, confidence: 0.84 },
  { id: "shortage", re: /\b(?:shortage|supply (?:issue|constraint|problem)s?|out of stock|backorder(?:ed)?|capacity is tight)\b/i, category: "OPERATIONAL", severity: 3, confidence: 0.82 },
  { id: "scientific", re: /\b(?:failed (?:validation|to replicate|qc)|did(?:n'?t| not) replicate|below (?:the )?(?:target|threshold)|underperform\w*|contaminat\w*|batch failure)\b/i, category: "SCIENTIFIC", severity: 3, confidence: 0.8 },
  { id: "atrisk", re: /\b(?:(?:is|are|now|remains?|looks?) at risk|at risk (?:of|over|because)|blocker|blocked (?:on|by)|jeopardi[sz]\w*|stuck in (?:legal|review|procurement|negotiation))\b/i, category: "CONTEXT", severity: 3, confidence: 0.84 },
  { id: "reputational", re: /\b(?:negative press|bad press|public criticism|negative coverage)\b/i, category: "REPUTATIONAL", severity: 3, confidence: 0.62 },
];
const RISK_NEGATED = /\b(?:no|not|without|never|isn'?t|aren'?t|wasn'?t|no longer|zero)\s+(?:\w+\s+){0,2}(?:delays?|risks?|blockers?|issues?|concerns?|slip\w*|escalat\w*)\b|\bon track\b|\b(?:resolved|mitigated|fixed)\b|\bapolog(?:y|ies|ize)\b/i;
/** Documents whose prose is narrative, not company risk ("pharma pays for it in … delayed approvals"). */
const NO_RISK_DOCS: ReadonlySet<DocumentType> = new Set(["INVESTOR_DECK", "SALES_MATERIAL", "PRODUCT_SPECIFICATION", "PUBLICATION", "FUNDRAISING_MATERIAL", "EMPLOYEE_DOCUMENT", "SCIENTIFIC_DATA_SUMMARY", "FINANCIAL_MODEL"]);
const CONTRACT_DOCS: ReadonlySet<DocumentType> = new Set(["CUSTOMER_CONTRACT", "PARTNERSHIP_AGREEMENT", "NDA", "LEGAL_DOCUMENT"]);

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
  [/\b(?:salary|compensation|base pay|base|ote)\b/i, "Compensation"],
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
  [/\b(?:complete|completion|progress)\b/i, "Progress"],
  [/\bconversion\b/i, "Conversion"],
  [/\b(?:probability|likelihood|chance)\b/i, "Probability"],
  [/\bcredits?\b/i, "Credits"],
  [/\buptime\b/i, "Uptime"],
];
const COUNT_RE =
  /(?<![\d.])\b(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s+(donor hearts?|human hearts?|hearts?|donors?|sites?|hospitals?|customers?|patients?|samples?|compounds?|employees?|hires?|studies|study|assays?|models?|investors?|programs?|months?|weeks?|days?)\b/gi;
const PERCENT_RE = /(?<![\d.])\b(\d+(?:\.\d+)?)\s?(?:%|percent\b)/gi;
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

const clamp = (n: number) => Math.round(Math.min(0.92, Math.max(0.05, n)) * 100) / 100;

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
function anchoredElsewhere(sentence: string, d: ResolvedDate): boolean {
  const after = sentence.slice(d.end, d.end + 24);
  return /^\s+(?:of|after|from|following|upon)\b/i.test(after) && /^(?:within|in)\b/i.test(d.text);
}

function metaOf(run: Run, item: object): ItemMeta {
  let m = run.meta.get(item);
  if (!m) {
    m = {};
    run.meta.set(item, m);
  }
  return m;
}

// ─── Context ─────────────────────────────────────────────────────────────────

function partyFrom(input: ExtractionInput, p: Participant, internalDomains: Set<string>, signatureOrgs: string[]): Party {
  const email = p.email.toLowerCase();
  const ceoEmail = input.ceo.email?.toLowerCase();
  const resolved = input.resolution.people.find((r) => r.email?.toLowerCase() === email);
  const known = input.known.people.find((k) => k.email?.toLowerCase() === email);
  const name = p.name?.trim() || resolved?.label || known?.name || nameFromEmail(email);
  const domain = domainOf(email);
  const reg = domain ? registrableDomain(domain) : null;
  const internal = reg != null && internalDomains.has(reg);
  const companyById = resolved?.companyId ? input.resolution.companies.find((c) => c.id === resolved.companyId)?.label : null;
  let company = companyById ?? known?.company ?? null;
  if (!company && reg && !internal && !isFreeMailDomain(reg)) {
    // "halvorsencapital.example" reads better as the signature's "Halvorsen Capital".
    const label = reg.split(".")[0].replace(/[^a-z]/g, "");
    company = signatureOrgs.find((o) => o.toLowerCase().replace(/[^a-z]/g, "").startsWith(label.slice(0, Math.min(6, label.length)))) ?? companyNameFromDomain(reg);
  }
  return { name, first: firstNameOf(name), email, company: internal ? null : company, internal, isCeo: email === ceoEmail || Boolean(resolved?.isCeo) || Boolean(known?.isCeo) };
}

function buildRun(input: ExtractionInput, now: Date): Run {
  const ceoEmail = input.ceo.email?.toLowerCase() ?? null;
  const internalDomains = new Set<string>();
  const ceoDomain = domainOf(ceoEmail);
  if (ceoDomain && !isFreeMailDomain(ceoDomain)) internalDomains.add(registrableDomain(ceoDomain));
  const signatureOrgs = scanSignatures(input.text).map((s) => s.org).filter((o): o is string => !!o);
  const e = input.email;
  const sender = e ? partyFrom(input, e.from, internalDomains, signatureOrgs) : null;
  const to = e ? e.to.map((p) => partyFrom(input, p, internalDomains, signatureOrgs)) : [];
  const cc = e ? e.cc.map((p) => partyFrom(input, p, internalDomains, signatureOrgs)) : [];
  const fromCeo = Boolean(e && (e.direction === "OUTBOUND" || sender?.isCeo));

  const primary = input.resolution.primaryCompanyId ? input.resolution.companies.find((c) => c.id === input.resolution.primaryCompanyId)?.label ?? null : null;
  const externalParty = [sender, ...to, ...cc].find((p) => p && !p.isCeo && !p.internal && p.company);
  // Documents and notes have no sender: the counterparty is the first known company they name.
  const head = `${input.title}\n${input.text.slice(0, 20_000)}`.toLowerCase();
  const named = !e ? [...input.resolution.companies.map((c) => c.label), ...input.known.companies.map((c) => c.name)].find((n) => n.length >= 3 && head.includes(n.toLowerCase())) ?? null : null;
  const kind: Run["kind"] = input.kind === "MEETING_NOTES" || input.document?.docType === "MEETING_NOTES" ? "notes" : e ? "email" : input.event ? "event" : "document";
  const format = input.document?.format;

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
    docType: input.document?.docType ?? null,
    tabular: format === "CSV" || format === "XLSX",
    subject: subjectTopic(e?.threadSubject ?? input.title),
    eventDay: input.event ? dayKeyInTz(input.event.startsAt, input.timezone) : null,
    sentences: [],
    idx: 0,
    meta: new WeakMap(),
    risks: [],
    options: [],
    recommendation: null,
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

function counterpart(run: Run): Party | null {
  if (run.fromCeo) return run.recipients[0] ?? null;
  return run.sender && !run.sender.isCeo ? run.sender : null;
}

/** "Rachel Moore (Lumen Biologics)" */
function whoLabel(p: Party | null): string | null {
  return p ? `${p.name}${p.company ? ` (${p.company})` : ""}` : null;
}

/** Known company named in a sentence (short form), else the counterpart's company. */
function partyFor(run: Run, text: string): string | null {
  const t = text.toLowerCase();
  const names = [...run.input.resolution.companies.map((c) => c.label), ...run.input.known.companies.map((c) => c.name)];
  for (const n of names) {
    const short = shortCompany(n);
    if (short && short.length >= 3 && (t.includes(n.toLowerCase()) || new RegExp(`\\b${escapeRe(short.toLowerCase())}\\b`).test(t))) return short;
  }
  if (run.kind !== "email") return null; // documents: only what the sentence names
  const external = [run.sender, ...run.recipients].find((p) => p && !p.isCeo && !p.internal && p.company);
  return external ? shortCompany(external.company) : null;
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

function dueOf(run: Run, text: string): { date: string | null; text: string | null; hard: boolean } {
  const dates = findDates(text, run.input.occurredAt, run.input.timezone);
  const d = dates.find((x) => x.hard) ?? dates[0];
  if (!d) return { date: null, text: null, hard: false };
  if (anchoredElsewhere(text, d)) {
    const tail = text.slice(d.index).replace(/[.;!?]+$/, "");
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

function addTask(run: Run, t: Omit<ExtractedTaskT, "focusArea" | "priorityHint" | "companyName"> & { companyName?: string | null }, meta: ItemMeta = {}): ExtractedTaskT | null {
  if (run.out.tasks.length >= 15 || !once(run, `task:${titleKey(t.title)}`)) return null;
  const task: ExtractedTaskT = {
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
  };
  run.out.tasks.push(task);
  run.meta.set(task, meta);
  return task;
}

function addCommitment(run: Run, c: ExtractedCommitmentT, meta: ItemMeta = {}) {
  if (run.out.commitments.length >= 15 || !once(run, `commitment:${c.direction}:${titleKey(c.title)}`)) return;
  const item = { ...c, text: cut(c.text, 1000), confidence: clamp(c.confidence) };
  run.out.commitments.push(item);
  run.meta.set(item, meta);
}

function addDecision(run: Run, d: ExtractedDecisionT, meta: ItemMeta = {}): ExtractedDecisionT | null {
  if (run.out.decisions.length >= 10 || !once(run, `decision:${d.status}:${titleKey(d.title)}`)) return null;
  const item = { ...d, title: cut(d.title, 200), decision: d.decision ? cut(d.decision, 1000) : null, confidence: clamp(d.confidence) };
  run.out.decisions.push(item);
  run.meta.set(item, meta);
  return item;
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

/** Count of extracted items, to tell whether a sentence produced anything. */
function produced(run: Run): number {
  const o = run.out;
  return o.tasks.length + o.commitments.length + o.decisions.length + o.opportunities.length + o.followUps.length + o.meetingRequests.length + run.risks.length;
}

// ─── Context resolution (pronouns, people, subjects) ─────────────────────────

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
  return /^(?:thanks|thank|hi|hello|hey|yes|no|ok|okay|great|also|so|and|but|sure|absolutely|unfortunately|separately|finally|meanwhile|again|overall|perfect|understood|agreed|wonderful)$/i.test(m[1]) ? null : m[1];
}

/** The person "her/him/them" most likely refers to: the last full name mentioned before this sentence (not the sender or the CEO). */
function thirdPartyBefore(run: Run): string | null {
  const before = [run.subject, ...run.sentences.slice(0, run.idx + 1).map((s) => s.text)].join("\n");
  const names = scanTextMentions(before)
    .filter((m) => m.entityType === "PERSON" && /\s/.test(m.text))
    .map((m) => m.text)
    .filter((n) => !isCeoName(run, n) && !sameName(n, run.sender?.name) && !run.recipients.some((r) => sameName(n, r.name)));
  return names.at(-1) ?? null;
}

/** "mutual NDA with Vantage Oncology" → "Vantage mutual NDA". */
function compactNounPhrase(np: string): string {
  let s = np.trim().replace(/^(?:the|our|your|a|an)\s+/i, "");
  // "a clear view of why the human heart dataset is defensible" → "human heart dataset defensibility".
  s = s.replace(/(?:a|an)\s+(?:clear\s+)?(?:view|picture|sense|explanation|understanding)\s+of\s+(?:why|how)\s+(?:the\s+|our\s+)?(.+?)\s+(?:is|are)\s+(\w+)$/i, (_m, noun: string, adj: string) => `${noun} ${adj.replace(/ible$/i, "ibility").replace(/able$/i, "ability")}`);
  const withCo = /^(.{3,40}?)\s+(?:with|from|for)\s+(\p{Lu}[\p{L}&.-]*(?:\s+\p{Lu}[\p{L}&.-]*){0,3})$/u.exec(s);
  if (withCo) s = `${shortCompany(withCo[2]) ?? withCo[2]} ${withCo[1]}`;
  return fitTitle(s.replace(/[.,;:]+$/, ""), 72);
}

/** The thing a pronoun or an object-less verb refers to, from this sentence's prefix or the previous sentences. */
function antecedent(run: Run, prefix: string): string | null {
  const NOUN_WORK = /\b(?:finaliz|prepar|draft|work|review|updat|build|writ)\w*\s+(?:on\s+)?(?:the|our)\s+([\w-]+(?:\s+[\w-]+){0,3}?)(?=[,.;]|\s+and\b|$)/i;
  const p = NOUN_WORK.exec(prefix);
  if (p) return compactNounPhrase(p[1]);
  for (let k = run.idx - 1; k >= Math.max(0, run.idx - 2); k--) {
    const prev = run.sentences[k].text;
    const ready = /^(?:\d+\.\s*)?(?:the|our|your|a|an)\s+(.{3,70}?)\s+(?:is|are)\s+(?:now\s+)?(?:ready|attached|available|done|complete|final|uploaded|enclosed|in the data room)\b/i.exec(prev);
    if (ready) return compactNounPhrase(ready[1]);
    const see = /\b(?:want|wants|need|needs|would like|expect|expects) to see\s+(.{3,90}?)(?:[.;]|$)/i.exec(prev);
    if (see) return compactNounPhrase(see[1]);
    const need = /\b(?:we|i) (?:will |also )?need (?:the |your )?(.{3,80}?)\s+(?:by|before)\b/i.exec(prev);
    if (need) return compactNounPhrase(need[1]);
    const work = NOUN_WORK.exec(prev);
    if (work) return compactNounPhrase(work[1]);
  }
  return null;
}

/** Replace a pronoun object, or fill an object-less verb, with the antecedent; null when there is none. */
function resolveWeak(run: Run, title: string, prefix: string): string | null {
  const np = antecedent(run, prefix);
  if (!np) return null;
  const words = title.split(/\s+/);
  if (hasPronounObject(title)) return fitTitle(`${words[0]} ${np}${words.length > 2 ? ` ${words.slice(2).join(" ")}` : ""}`, 80);
  if (words[1] && /^(?:via|when|by|at|in|before|on|with|for)$/i.test(words[1])) return fitTitle(`${words[0]} ${np} ${words.slice(1).join(" ")}`, 80);
  return null;
}

/** Thread subject as the topic of a decision: "CardioPredict v2: hold-out results and launch scope" → "CardioPredict v2 launch scope". */
function subjectDecisionTopic(subject: string): string {
  const [a, ...rest] = subject.split(/\s*:\s*/);
  if (!rest.length) return subject;
  const b = rest.join(": ");
  const tail = b.split(/\s+and\s+/).at(-1) ?? b;
  return `${a} ${tail}`.trim();
}

/** "Laura Mitchell: competing offer" → "Laura Mitchell" (a subject that leads with a person's name). */
function subjectPerson(subject: string): string | null {
  const m = /^((?:Dr\.|Prof\.)?\s?\p{Lu}[\p{Ll}'’-]+\s+\p{Lu}[\p{Ll}'’-]+)\s*:/u.exec(subject);
  return m ? m[1].trim() : null;
}

// ─── Sentence rules: requests, promises, decisions, meetings ────────────────

/** Split "grant us access to the data room and propose two dates" into two actions. */
function splitCompound(clause: string): string[] {
  const parts: string[] = [];
  let rest = clause;
  for (let guard = 0; guard < 3; guard++) {
    const m = /,?\s+and\s+(?:also\s+)?([a-z]+)\b/gi;
    let split = -1;
    let len = 0;
    for (const x of rest.matchAll(m)) {
      if (x.index! > 8 && ACTION_VERBS.has(x[1].toLowerCase()) && !["have", "get", "let", "make", "work", "go", "be"].includes(x[1].toLowerCase())) {
        split = x.index!;
        len = x[0].length - x[1].length;
        break;
      }
    }
    if (split < 0) break;
    parts.push(rest.slice(0, split));
    rest = rest.slice(split + len);
  }
  parts.push(rest);
  return parts.filter((p) => p.trim().split(/\s+/).length >= 2);
}

const ANAPHORIC_CONFIRM = /^confirm\b(?:.*\b(?:that|the|this) (?:date|deadline|timeline|timing)\b|\s+(?:that\s+)?(?:you|we) can (?:meet|make|hit|do|deliver|commit to)\b)/i;

/** Requests in a message the CEO did not write (or the CEO's requests to others). */
function ruleRequest(run: Run, s: Sentence, ev: string): boolean {
  if (run.kind !== "email") return false;
  const text = s.text.trim();
  if (BOILERPLATE.test(text)) return false;
  // Asks for a decision are decisions, not tasks.
  const ny = NEED_YOUR.exec(text);
  if (ny && DECISION_KINDS.has(ny[1].toLowerCase())) return false;
  if (/\bneed (?:a|the) decision\b/i.test(text)) return false;
  // "If you approve, could you call her yourself to close?" belongs to the decision just asked for.
  if (/^(?:if|once) (?:you|we) (?:approve|agree|sign off|say yes|go ahead)\b/i.test(text)) {
    const d = [...run.out.decisions].reverse().find((x) => x.status === "NEEDED");
    if (d) {
      const follow = actionTitle(text.replace(/^[^,]+,\s*/, ""), { thirdParty: thirdPartyBefore(run), ceoPerspective: true }, 80);
      if (follow) d.decision = cut(`${d.decision ? `${d.decision} ` : ""}If approved: ${lowerFirst(follow)}.`, 1000);
      return true;
    }
  }

  const vocative = vocativeOf(text);
  let clause: string | null = null;
  let kind: "please" | "question" | "need" | "imperative" | "needYour" | "weNeed" = "please";
  let preset: string | null = null;
  let prefix = "";
  for (const p of REQUEST_PATTERNS) {
    const m = p.re.exec(text);
    if (m && startsWithActionVerb(m[1]) && !/^(?:be|have a|feel|see|find|note)\b/i.test(m[1])) {
      clause = m[1];
      kind = p.kind;
      prefix = text.slice(0, m.index);
      break;
    }
  }
  if (!clause && ny) {
    const due = dueOf(run, text);
    const object = ny[2].replace(due.text ? new RegExp(`\\s*${escapeRe(due.text)}.*$`, "i") : /$^/, "").replace(/\s+(?:so that|so we|to (?:announce|secure|meet|hit))\b.*$/i, "").replace(/[.?!]+$/, "");
    preset = `${NEED_YOUR_VERB[ny[1].toLowerCase()] ?? "Respond on"} ${object.replace(/^(?:the|our)\s+/i, "")}`.trim();
    clause = ny[0];
    kind = "needYour";
  }
  if (!clause && !run.fromCeo) {
    const wn = WE_NEED_BY.exec(text);
    if (wn) {
      const what = wn[1].replace(/^(?:one (?:more|additional) (?:thing|request)\s*:\s*)/i, "");
      const verb = /\b(?:data(?:set)?|report|package|results|files?|deck|model|plan|proposal|sow|analysis|summary|slides?|draft)\b/i.test(what) ? "Deliver" : "Provide";
      preset = `${verb} ${what.replace(/^(?:the|our|your)\s+/i, "")}`;
      clause = wn[0];
      kind = "weNeed";
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
  if (/^(?:make|find)\s+(?:some\s+)?time\b|^(?:meet|chat|talk|hop on|jump on)\b/i.test(clause)) return false; // a meeting request

  const owner = requestOwner(run, vocative);
  if (!owner.isCeo && !run.fromCeo) return false; // not addressed to the CEO
  const cp = counterpart(run);
  const senderFirst = run.fromCeo ? run.ceoFirst : cp?.first ?? null;
  const recipientFirst = run.fromCeo ? cp?.first ?? null : run.ceoFirst;
  const third = thirdPartyBefore(run);
  const parts = preset ? [clause] : splitCompound(clause);
  let any = false;

  for (const part of parts) {
    const due = dueOf(run, parts.length === 1 ? text : part);
    const tctx = { dateText: due.text, senderFirst, recipientFirst, thirdParty: third, ceoPerspective: owner.isCeo };
    let title = preset ? (actionTitle(preset, {}, 64) ?? tidy(preset, 64)) : actionTitle(part, tctx);
    if (!title) continue;
    const phraseText = preset ? lowerFirst(title) : lowerFirst(actionTitle(part, { ...tctx, keepArticle: true }, 90) ?? title);

    // "Please confirm you can meet that date": confirmation of the ask just made.
    if (ANAPHORIC_CONFIRM.test(title)) {
      const prev = [...run.out.tasks].reverse().find((t) => t.ownerIsCeo);
      if (prev) {
        metaOf(run, prev).confirm = true;
        prev.confidence = clamp(Math.max(prev.confidence, CONF.explicit + (prev.dueDate ? CONF.dated : 0)));
        any = true;
        continue;
      }
    }
    let phrase = phraseText;
    if (weakObject(title)) {
      const resolved = resolveWeak(run, title, prefix);
      if (!resolved) continue; // "Bring both", "Make time in the morning": nothing concrete to do
      title = resolved;
      phrase = lowerFirst(resolved);
    }

    let confidence: number = owner.isCeo ? (owner.explicit ? CONF.explicit : CONF.implicit) : CONF.delegated;
    if (kind === "imperative") confidence -= 0.06;
    if (/^(?:let|tell)\s+\S+\s+(?:know|whether)\b/i.test(title)) confidence = CONF.weak; // courtesy offers ("let me know if you'd like to discuss…")
    if (HEDGE.test(text)) confidence = Math.min(confidence, CONF.hedged);
    if (due.date && confidence >= CONF.implicit) confidence += CONF.dated;

    const asker = run.fromCeo ? null : cp ?? run.sender;
    const task = addTask(
      run,
      {
        title,
        description: run.fromCeo ? `You asked ${cp?.name ?? "them"}: “${cut(text, 400)}”` : `${whoLabel(asker) ?? "They"} asked: “${cut(text, 400)}”`,
        ownerName: owner.name,
        ownerIsCeo: owner.isCeo,
        dueDate: due.date,
        dueText: due.text,
        confidence,
        evidence: ev,
        companyName: cp?.company ?? run.primaryCompany,
      },
      { phrase, asker },
    );
    if (task) any = true;
  }
  return any;
}

/** First-person promises: CEO → OUTBOUND (or a CEO task when promised to the team); others → INBOUND/INTERNAL. */
function ruleCommitment(run: Run, s: Sentence, ev: string): boolean {
  if (run.kind !== "email" && run.kind !== "notes") return false;
  const m = COMMITMENT_RE.exec(s.text);
  if (!m) return false;
  const clause = m[1];
  if (NOT_COMMITMENT.test(clause) || /\?\s*$/.test(s.text)) return false;
  const lead = s.text.slice(0, m.index).trim();
  if (/\b(?:let me know|if you|could you|can you|would you)\b/i.test(lead)) return false;
  if (/^let me know\b/i.test(m[0])) return false;
  const verb = leadVerb(clause);
  if (!ACTION_VERBS.has(verb) && !(verb === "be" && /^be (?:sending|sharing|able to)/i.test(clause))) return false;
  const tentative = /^(?:i can|happy to|i'd be happy to)\b/i.test(m[0]);
  if (tentative && !findDates(s.text, run.input.occurredAt, run.input.timezone).length) return false;

  const cp = counterpart(run);
  // Circle-back promises are follow-ups, not deliverables.
  if (/^(?:circle back|follow up|check in|touch base|reconnect|get back to you)\b/i.test(clause) && !run.fromCeo && cp) {
    const due = dueOf(run, s.text);
    if (due.date) {
      const after = /\bafter (?:the |our |their |it)?\s*([^,.;]{3,40})/i.exec(clause)?.[1];
      const np = /\bafter it\b/i.test(clause) ? antecedentNoun(run, lead) : after;
      addFollowUp(run, `Expect follow-up from ${cp.name}${np ? ` after ${np.replace(/^(?:the|our|their)\s+/i, "the ")}` : ""}`, cp.name, due.date, 0.82, ev);
      return true;
    }
    return false;
  }

  const due = dueOf(run, s.text);
  const senderFirst = run.fromCeo ? run.ceoFirst : cp?.first ?? null;
  const recipientFirst = run.fromCeo ? cp?.first ?? null : run.ceoFirst;
  let title = actionTitle(clause, { dateText: due.text, senderFirst, recipientFirst });
  if (!title) return false;
  let phrase = lowerFirst(actionTitle(clause, { dateText: due.text, senderFirst, recipientFirst, keepArticle: true }, 90) ?? title);
  if (weakObject(title)) {
    const resolved = resolveWeak(run, title, lead);
    if (!resolved) return false;
    title = resolved;
    phrase = lowerFirst(resolved);
  }

  let confidence: number = CONF.explicit + (due.date ? CONF.dated : 0);
  if (HEDGE.test(s.text)) confidence = CONF.hedged;
  else if (CONDITIONAL.test(s.text.trim()) || /\bif\b/i.test(lead)) confidence -= 0.04;
  if (tentative) confidence = Math.min(confidence, 0.72);

  const internalMsg = run.input.email?.direction === "INTERNAL";
  if (run.kind === "notes") {
    addCommitment(run, { direction: run.primaryCompany ? "OUTBOUND" : "INTERNAL", title, text: s.text, owedByName: run.ceoName, owedToName: run.primaryCompany, companyName: run.primaryCompany, dueDate: due.date, dueText: due.text, confidence: confidence - 0.04, evidence: ev }, { phrase });
  } else if (run.fromCeo) {
    const to = run.recipients[0] ?? null;
    if (internalMsg || to?.internal) {
      // A promise to the team is the CEO's own to-do ("I'll sign the Vantage NDA tonight").
      addTask(run, { title, description: `You told ${to?.name ?? "the team"}: “${cut(s.text, 400)}”`, ownerName: run.ceoFirst, ownerIsCeo: true, dueDate: due.date, dueText: due.text, confidence, evidence: ev, companyName: null }, { phrase, promisedTo: to?.name ?? null });
    } else {
      addCommitment(run, { direction: "OUTBOUND", title, text: s.text, owedByName: run.ceoName, owedToName: to?.name ?? null, companyName: to?.company ?? run.primaryCompany, dueDate: due.date, dueText: due.text, confidence, evidence: ev }, { phrase });
    }
  } else if (run.sender) {
    addCommitment(
      run,
      {
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
      },
      { phrase },
    );
  } else {
    return false;
  }
  return true;
}

/** Noun after "after it" in the previous clause: "Our IC offsite is next week, and I'll circle back after it" → "IC offsite". */
function antecedentNoun(run: Run, prefix: string): string | null {
  const m = /\b(?:our|the|their)\s+([\w-]+(?:\s+[\w-]+){0,2}?)\s+(?:is|was|will be)\b/i.exec(prefix);
  return m ? m[1] : null;
}

/** Org and third-party promises: "Legal will return their revised language…", "Daniel Kim will ship…", "CEO will circulate…". */
function ruleThirdParty(run: Run, s: Sentence, ev: string): boolean {
  if (run.kind === "event" || run.tabular) return false;
  const m = THIRD_PARTY.exec(s.text);
  if (!m) return false;
  const subject = m[1].trim().replace(/\s+/g, " ");
  if (NOT_A_PERSON.test(subject) || /^(?:it|this|that|there|which)\b/i.test(subject)) return false;
  const clause = m[2];
  if (!startsWithActionVerb(clause) || /^(?:join|attend|be|find time|make time|coordinate)\b/i.test(clause)) return false;
  const due = dueOf(run, s.text);
  const title = actionTitle(clause, { dateText: due.text, senderFirst: run.sender?.first ?? null });
  if (!title || weakObject(title)) return false;
  const phrase = lowerFirst(actionTitle(clause, { dateText: due.text, keepArticle: true }, 90) ?? title);

  // The CEO named in the third person ("CEO will circulate the final deck") is a CEO task.
  if (isCeoName(run, subject)) {
    if (!due.date) return false;
    addTask(run, { title, description: `From “${cut(run.input.title, 120)}”: ${cut(s.text, 400)}`, ownerName: run.ceoFirst, ownerIsCeo: true, dueDate: due.date, dueText: due.text, confidence: 0.84, evidence: ev }, { phrase });
    return true;
  }

  const orgWord = /^(?:our|their)\b|^(?:legal|counsel|procurement)$/i.test(subject);
  const companyNamed = [...run.input.known.companies.map((c) => c.name), ...run.input.resolution.companies.map((c) => c.label)].find((n) => {
    const short = shortCompany(n);
    return sameName(subject, n) || (short != null && subject.toLowerCase() === short.toLowerCase());
  });
  const external = run.kind === "email" && !run.fromCeo && run.sender && !run.sender.internal;
  if ((orgWord || companyNamed) && external) {
    // "Legal will return their revised language on clause 7.3 by Friday": the sender's organization promises it.
    const org = companyNamed ?? run.sender!.company ?? run.sender!.name;
    let confidence: number = CONF.explicit + (due.date ? CONF.dated : 0);
    if (HEDGE.test(s.text)) confidence = CONF.hedged;
    else if (/\bif\b/i.test(s.text.slice(0, m.index))) confidence -= 0.04;
    addCommitment(run, { direction: "INBOUND", title, text: s.text, owedByName: org, owedToName: run.ceoName, companyName: companyNamed ?? run.sender!.company, dueDate: due.date, dueText: due.text, confidence, evidence: ev }, { phrase });
    return true;
  }

  // A named team member's promise: an INTERNAL commitment, but only when it is dated (undated intentions are noise).
  const person = run.input.known.people.find((p) => !p.isCeo && !p.company && (sameName(p.name, subject) || firstNameOf(p.name) === subject.replace(/^(?:Dr\.|Prof\.)\s*/, "").split(" ")[0]));
  if (!person || !due.date || sameName(person.name, run.sender?.name)) return false;
  const forCo = partyFor(run, clause);
  addCommitment(run, { direction: "INTERNAL", title, text: s.text, owedByName: person.name, owedToName: run.fromCeo ? run.recipients[0]?.name ?? null : run.ceoName, companyName: forCo, dueDate: due.date, dueText: due.text, confidence: 0.84, evidence: ev }, { phrase });
  return true;
}

function ruleFollowUp(run: Run, s: Sentence, ev: string) {
  if (!FOLLOW_UP_VERB.test(s.text) || BOILERPLATE.test(s.text) || run.kind !== "email") return;
  const due = dueOf(run, s.text);
  const withM = /\b(?:with|to)\s+([\p{Lu}][\p{L}'’.-]+(?:\s+[\p{Lu}][\p{L}'’.-]+){0,3})/u.exec(s.text);
  const at = FOLLOW_UP_VERB.exec(s.text)!.index;
  const topic = /\b(?:on|about|regarding|re:?)\s+((?:the\s+)?[\p{L}\d][^,.;!?]{2,60})/iu.exec(s.text.slice(at));
  const cp = counterpart(run);
  const firstPerson = /\b(?:i'll|i will|we'll|we will|let me|i'm going to|we're going to)\b/i.test(s.text);
  if (firstPerson && !run.fromCeo) return; // handled as a promise
  const withName = withM?.[1] ?? cp?.name ?? null;
  if (!withName) return;
  let title = `Follow up with ${withName}`;
  if (topic) title += ` on ${topic[1].replace(/\s+(?:by|on|next|this|before|until)\b.*$/i, "").trim()}`;
  addFollowUp(run, fitTitle(title, 70), withName, due.date, topic || due.date ? 0.82 : CONF.weak, ev);
}

function ruleMeetingRequest(run: Run, s: Sentence, ev: string): boolean {
  if (run.kind !== "email" || run.fromCeo || !MEETING_REQUEST.test(s.text) || run.out.meetingRequests.length >= 5) return false;
  if (/\b\w+ will (?:find|make) time\b/i.test(s.text)) return false;
  const cp = counterpart(run);
  if (!cp || !(run.ceoInTo || run.greeting?.ceo)) return false;
  // What the meeting is about: "to talk through the option pool refresh", or the previous sentence's ask.
  const about = (t: string) =>
    /\bto (?:talk through|discuss|review|walk through|go over|cover|align on|talk about)\s+(?:the\s+)?([^?.,;]{3,50})/i.exec(t)?.[1] ??
    /\b(?:can we|could we|shall we) (?:review|go over|walk through|discuss|look at)\s+(?:the\s+)?([^?.,;]{3,40}?)(?:\s+together)?(?:[?.,;]|\s+before\b|$)/i.exec(t)?.[1] ??
    /\b(?:would like|want|wants|welcome|propose|suggest)s?\s+(?:a|an)\s+((?:[\w-]+\s+){0,3}(?:conversation|call|meeting|chat|discussion|session|walkthrough)(?:\s+before\s+[^.?,;]{3,40})?)/i.exec(t)?.[1] ??
    null;
  const prev = run.sentences[run.idx - 1]?.text ?? "";
  let topic = about(s.text) ?? about(prev);
  // "a short call" says nothing; "scenarios" reads better as the subject's "Runway scenarios".
  if (topic && /^(?:a |an )?(?:(?:short|quick|brief|\d+-minute|\w+-minute)\s+)*(?:call|chat|meeting|conversation|discussion)$/i.test(topic.trim())) topic = null;
  if (topic && topic.trim().split(/\s+/).length <= 2) {
    const last = topic.trim().split(/\s+/).at(-1)!.toLowerCase();
    const seg = run.subject.split(/\s*:\s*/).find((x) => x.toLowerCase().includes(last));
    if (seg) topic = seg;
  }
  const title = fitTitle(`Meeting with ${cp.name} re: ${topic ? topic.replace(/\s+/g, " ").trim() : run.subject}`, 90);
  if (!once(run, `meet:${titleKey(title)}`)) return false;
  const times = [...findDates(s.text, run.input.occurredAt, run.input.timezone).map((d) => d.text), ...(s.text.match(TIME_RE) ?? [])].map((t) => cut(t, 120));
  run.out.meetingRequests.push({ title, withName: cp.name, proposedTimes: [...new Set(times)].slice(0, 5), confidence: 0.84, evidence: ev });
  return true;
}

/** Statement of a decision taken, cleaned for a title: lead-ins, second clauses and time words removed. */
function decisionStatement(run: Run, sentence: string, clause: string, externalOrg: string | null): string {
  if (startsWithActionVerb(clause) && clause.split(/\s+/).length >= 2) {
    let t = actionTitle(clause.split(/\s*;\s*|\s+—\s+|:\s+/)[0], {}, 80) ?? clause;
    // "Go with the limited release" → "Go with the limited release for CardioPredict v2" when the subject names the product.
    const product = /\b(\p{Lu}\p{Ll}+(?:\p{Lu}\p{Ll}*)+(?:\s+v\d+)?)/u.exec(run.subject)?.[1];
    if (product && t.length < 40 && !t.includes(product.split(" ")[0])) t = `${t} for ${product}`;
    return tidy(t, 80);
  }
  let t = sentence.replace(LEAD_IN, "").split(/\s*;\s*|\s+—\s+|:\s+/)[0];
  t = t.replace(/\s+(?:this|yesterday|last)\s+(?:morning|afternoon|evening|night|week)\b|\s+(?:today|yesterday|earlier today)\b/gi, "");
  if (externalOrg) t = t.replace(/^(?:the|our|their)\s+/i, `${externalOrg} `);
  return tidy(t, 80);
}

/** Decisions taken (CytoHub's own) and decisions asked of the CEO. */
function ruleDecisions(run: Run, s: Sentence, ev: string): boolean {
  if (run.tabular) return false;
  const text = s.text.trim();
  const made = DECISION_MADE.exec(text);
  if (made && !DECISION_NEGATED.test(text)) {
    const before = text.slice(0, made.index + 30);
    const externalSender = run.kind === "email" && !run.fromCeo && run.sender && !run.sender.internal;
    const theirs = /\b(?:their|\w+'s)\s+(?:board|committee|finance committee|partnership|ic)\b/i.test(before) || /\bour (?:board|ic|investment committee|finance committee|partnership|partners)\b/i.test(before);
    const org = shortCompany(run.sender?.company ?? run.primaryCompany);
    if (externalSender || (run.kind === "document" && theirs)) {
      // A counterparty's decision is news for the CEO, not a CytoHub decision to record.
      if (org && !run.fromCeo) addFact(run, { label: `${org} decision`, value: decisionStatement(run, text, "", org), kind: "TEXT", numericValue: null, evidence: ev });
      return true;
    }
    if (run.kind === "event") return false;
    const title = decisionStatement(run, text, (made[1] ?? "").trim(), null);
    const board = /\bboard\b/i.test(before);
    const by = board ? "Board" : /\b(?:we|i)\b/i.test(text.slice(0, made.index + 12)) ? (run.fromCeo ? run.ceoName : run.sender?.name ?? null) : null;
    addDecision(run, { title, status: "MADE", decision: text, decidedByName: by, deadline: null, options: [], confidence: run.kind === "notes" || /^(?:decision|decided|agreed)/i.test(text) ? 0.85 : 0.82, evidence: ev });
    return true;
  }

  if (run.fromCeo || run.kind === "event") return false;
  const ny = NEED_YOUR.exec(text);
  const decisionAsk = (ny && DECISION_KINDS.has(ny[1].toLowerCase())) || /\bneed (?:a|the) decision\b/i.test(text) || (DECISION_NEEDED.test(text) && !(DECISION_NEGATED.test(text) && !/\bnot yet\b/i.test(text)));
  if (!decisionAsk) return false;
  const due = dueOf(run, text);
  const purpose = /\bto (secure|lock in|hold|keep|meet|hit|make|catch|avoid|close|get|book|announce)\b([^.;,]{2,50})/i.exec(due.text ? text.slice(text.toLowerCase().indexOf(due.text.toLowerCase()) + due.text.length) : "")?.[0]?.trim() ?? null;
  const approval = ny ? /^(?:approval|sign-?off|go-ahead|green light)$/i.test(ny[1]) : /\b(?:approval|sign-?off)\b/i.test(text);
  const person = subjectPerson(run.subject);

  // The object of the decision, as stated.
  let object: string | null = null;
  if (ny && ny[2].trim()) {
    object = ny[2]
      .replace(due.text ? new RegExp(`\\s*${escapeRe(due.text)}[\\s\\S]*$`, "i") : /$^/, "")
      .replace(/\s+(?:so that|so we|to (?:secure|announce|meet|hit|keep))\b[\s\S]*$/i, "")
      .replace(/[.?!]+$/, "")
      .trim();
  } else {
    const on = /\b(?:decision|call|go-ahead|green light|approval)\s+(?:on|about|for|regarding)\s+((?:[^?.,;(]|\.(?=\d)|\([^)]*\))+)/i.exec(text);
    if (on) object = on[1].replace(due.text ? new RegExp(`\\s*${escapeRe(due.text)}[\\s\\S]*$`, "i") : /$^/, "").trim();
  }
  let title: string | null = null;
  let options: string[] = [];
  let confidence: number = CONF.explicit;
  const should = /\b(?:should we|do you want (?:us |me )?to|want (?:me|us) to|would you prefer (?:we|to|us to)?)\s+([^?]+)/i.exec(text);
  const between = /\bdecide between\s+([^?.;]+)/i.exec(text);
  const goNoGo = /\bgo\/no[- ]go\s+(?:on|for)\s+([^?.,;]+)/i.exec(text);

  if (object) {
    // "the Q4 marketing budget: $180K in total, …" → "Q4 marketing budget ($180K)".
    let x = object.split(/\s*:\s+/)[0].replace(/^(?:the|our|your)\s+/i, "");
    if (person && /^(?:offer|package|offer package|compensation|hire|start date)\b/i.test(x)) x = `${person}'s ${x}`;
    const paren = /\s*\(([^)]*)\)/.exec(x);
    if (paren && x.length > 40) x = x.replace(paren[0], "");
    const money = firstMoney(text);
    if (approval && money && !x.includes(money.text)) x = `${x} (${money.text})`;
    title = approval ? `Approve ${x}` : `Decide on ${x}`;
  } else if (between) {
    options = between[1].split(/\s*(?:,|\bor\b|\band\b)\s*/).map((o) => o.trim()).filter((o) => o.length > 1).slice(0, 6);
    title = `Choose between ${options.join(" and ")}`;
  } else if (goNoGo) {
    title = `Go/no-go on ${goNoGo[1].replace(/\s+(?:by|before|until)\b.*$/i, "").trim()}`;
  } else if (should) {
    const body = should[1].replace(due.text ? new RegExp(`\\s*${escapeRe(due.text)}`, "i") : /$^/, "").trim();
    const parts = body.split(/\s*,?\s+\bor\b\s+/i);
    if (parts.length > 1) options = parts.map((p) => cut(p.replace(/[?.!]+$/, ""), 200)).slice(0, 6);
    title = `${capitalize(body.replace(/[?.!]+$/, ""))}?`;
    confidence = /^(?:do you want|want|would you prefer)/i.test(should[0]) ? 0.68 : 0.72;
  } else {
    // "We need your call by Friday" / "I need a decision by Thursday to secure the booth".
    const open = [...run.out.decisions].reverse().find((d) => d.status === "NEEDED");
    if (open) {
      open.deadline ??= due.date;
      if (purpose) metaOf(run, open).purpose = purpose;
      return true;
    }
    const topic = subjectDecisionTopic(run.subject);
    if (!topic) return false;
    title = /approval/i.test(run.input.email?.threadSubject ?? "") || approval ? `Approve ${topic}` : `Decide on ${topic}`;
    confidence = 0.84;
  }
  const item = addDecision(
    run,
    { title: tidy(title, 90).replace(/\?*$/, title.endsWith("?") ? "?" : ""), status: "NEEDED", decision: null, decidedByName: run.kind === "email" ? run.ceoName : null, deadline: due.date, options, confidence: confidence + (due.date && confidence >= CONF.explicit ? CONF.dated : 0), evidence: ev },
    { purpose, asker: counterpart(run) },
  );
  return Boolean(item);
}

// ─── Risks ───────────────────────────────────────────────────────────────────

function riskCategory(run: Run, text: string): RiskCategory {
  const cat = run.input.classification.category;
  if (/\b(?:renewal|churn|customer|SLA)\b/i.test(text)) return "CUSTOMER";
  if (/\b(?:investor|round|term sheet|series [a-e]|raise)\b/i.test(text) || cat === "INVESTOR" || cat === "FUNDRAISING") return "FUNDRAISING";
  if (cat === "CUSTOMER") return "CUSTOMER";
  if (/\b(?:assay|validation|dataset|donor|model|auc|experiment|lab|tissue)\b/i.test(text) || cat === "SCIENTIFIC_LEADERSHIP") return "SCIENTIFIC";
  if (/\b(?:msa|contract|deal|proposal|pilot|renewal)\b/i.test(text) || cat === "COMMERCIAL_OPPORTUNITY") return "COMMERCIAL";
  if (/\b(?:fda|ind|regulatory)\b/i.test(text)) return "REGULATORY";
  if (/\b(?:hire|candidate|offer|team|headcount)\b/i.test(text) || cat === "RECRUITING") return "PEOPLE";
  if (cat === "LEGAL") return "LEGAL";
  if (cat === "FINANCE") return "FINANCIAL";
  return "OPERATIONAL";
}

function ruleRisk(run: Run, s: Sentence, ev: string, isOption: boolean) {
  if (run.kind === "event" || run.tabular || (run.docType && NO_RISK_DOCS.has(run.docType)) || isOption) return;
  const t = s.text;
  if (RISK_NEGATED.test(t)) return;
  // Questions, requests and hypotheticals describe what might happen, not what is happening.
  const rule = RISK_RULES.find((r) => r.re.test(t));
  if (!rule) return;
  // A customer's conditional threat ("If this continues we will not renew") is still a risk; other hypotheticals are not.
  const threat = rule.id === "churn" || rule.id === "escalation";
  if (/\?\s*$/.test(t) || (!threat && /^(?:if|in case|should)\b/i.test(t.trim())) || /\bscenarios?\b|\bif (?:the|we|it|our)\b[^,]{0,40}\bslips?\b/i.test(t) || /\b(?:please|could you|can you)\b/i.test(t)) return;
  if ((rule.id === "delay" || rule.id === "atrisk") && DECISION_MADE.test(t)) return; // "We've decided to delay X" is a choice
  // In one email, several sentences about the same risk are one risk; documents list separate ones.
  if (run.kind === "email" ? run.risks.some((r) => r.rule.id === rule.id) : run.risks.some((r) => r.sentence === t)) return;
  run.risks.push({ rule, sentence: t, evidence: ev, party: partyFor(run, t) });
}

const ORDINAL = /\b(second|third|fourth|fifth|sixth)\b[^.]{0,30}\b(month|time|quarter|week)s?\b/i;

/** Short detail used when risks merge ("third missed SLA", "shipment delayed ~6 weeks"). */
function riskDetail(d: RiskDraft): string | null {
  const t = d.sentence;
  switch (d.rule.id) {
    case "sla": {
      const o = ORDINAL.exec(t);
      return o ? `${o[1].toLowerCase()} missed SLA` : "missed SLA";
    }
    case "delay": {
      const topic = delayTopic(t);
      const dur = durationIn(t);
      const verb = TENTATIVE_DELAY.test(t) ? "may slip" : "delayed";
      return topic ? `${topic} ${verb}${dur ? ` ${dur}` : ""}` : dur ? `${verb} ${dur}` : null;
    }
    case "escalation":
      return "escalation";
    default:
      return null;
  }
}

/** "may slip", "could be delayed": a possible delay, not one that has happened. */
const TENTATIVE_DELAY = /\b(?:may|might|could|can|would|is likely to|are likely to)\s+(?:still\s+)?(?:slip|be (?:delayed|late|pushed|postponed)|delay)\b/i;

function delayTopic(t: string): string | null {
  const m =
    /\b(?:the|our|their)\s+([\w-]+)(?:\s+of\s+[^,.;]+?)?\s+(?:will be|is|are|was|were|has been|have been|got|is being)\s+(?:delayed|late|pushed|postponed)\b/i.exec(t) ??
    /\b([\w-]+)\s+(?:(?:may|might|could|can|will|would|is likely to|are likely to)\s+(?:still\s+)?)?(?:delay|slip)(?:s|ped|ping)?\b(?!\s+(?:affects|will|means))/i.exec(t);
  const w = m?.[1]?.toLowerCase();
  return w && !/^(?:this|that|the|a|an|it|our|their|of|may|might|could|can|will|would|should|to|not|also|still|likely)$/.test(w) ? w : null;
}

function riskTitle(run: Run, d: RiskDraft): string {
  const t = d.sentence;
  const party = d.party;
  const P = party ?? "";
  switch (d.rule.id) {
    case "sla": {
      const o = ORDINAL.exec(t);
      return tidy(`${P || "Customer"} SLA missed${o ? ` for the ${o[1].toLowerCase()} ${o[2].toLowerCase()} in a row` : ""}`, 70);
    }
    case "churn":
      return tidy(`${P || "Customer"} ${/renew/i.test(t) ? "renewal at risk" : "churn risk"}`, 70);
    case "escalation": {
      const subj = /^(?:re:\s*)*escalation\s*:\s*(.+)$/i.exec(run.input.email?.threadSubject ?? "")?.[1];
      return tidy(`${P || "Customer"} escalation${subj ? `: ${subj}` : ""}`, 70);
    }
    case "offer": {
      const person = scanTextMentions(`${run.subject}\n${t}`).find((m) => m.entityType === "PERSON" && /\s/.test(m.text) && !sameName(m.text, run.sender?.name))?.text ?? subjectPerson(run.subject);
      return tidy(`${person ?? "Candidate"} has a competing offer${/\bdeadline\b/i.test(t) ? " with a deadline" : ""}`, 70);
    }
    case "delay": {
      const topic = delayTopic(t);
      const dur = durationIn(t);
      const cause = /\b(?:because of|due to|owing to)\s+(?:a|an|the)?\s*([^,.;]{3,40}?)(?=\s+(?:at|in|from|with|for|on)\b|[,.;]|$)/i.exec(t)?.[1];
      const impact = /\bdelay (?:affects|will affect|hits|impacts|threatens)\s+(?:our\s+|the\s+)?([^,.;]{3,50}?)(?:\s+for\b|[,.;]|$)/i.exec(t)?.[1];
      const verb = TENTATIVE_DELAY.test(t) ? "may slip" : "delayed";
      if (topic) return tidy(`${P ? `${P} ` : ""}${topic} ${verb}${dur ? ` ${dur}` : ""}${cause ? `: ${cause}` : ""}`, 70);
      if (impact) return tidy(`${P ? `${P} ` : ""}delay affects ${impact}`, 70);
      return tidy(`${P ? `${P} ` : ""}delay${dur ? ` of ${dur}` : ""}`, 70);
    }
    case "shortage": {
      if (/capacity is tight/i.test(t)) return tidy(t.split(/\s*[;:]\s*|\s+—\s+/)[0], 70);
      const np = /\b((?:[\w-]+\s+){0,2}?)(?:shortage|supply (?:issue|constraint|problem))/i.exec(t)?.[1]?.trim();
      return tidy(`${np ? `${capitalize(np.replace(/^(?:a|an|the)\s+/i, ""))} ` : ""}shortage${P ? ` at ${P}` : ""}`, 70);
    }
    case "atrisk": {
      const m = /(?:^|[,;:]\s*)((?:the |our )?[^,;:]{3,60}?)\s+(?:is |are |now |remains? |looks? )?(at risk(?: (?:over|because of|of) [^,.;]{3,50})?|stuck in (?:legal|review|procurement|negotiation))/i.exec(t);
      if (m) return tidy(`${m[1].replace(/^(?:the|our)\s+/i, "")} ${m[2]}`, 70);
      return tidy(`${P ? `${P} ` : ""}deliverable at risk`, 70);
    }
    case "breach":
      return tidy(`${P ? `${P} ` : ""}contract breach risk`, 70);
    case "people":
      return tidy(`Retention risk${P ? ` at ${P}` : ""}`, 70);
    case "legal":
      return tidy(`${P ? `${P} ` : ""}legal dispute risk`, 70);
    case "regulatory":
      return tidy(`Regulatory risk: ${RISK_RULES.find((r) => r.id === "regulatory")!.re.exec(t)?.[0] ?? "compliance"}`, 70);
    case "financial":
      return tidy(`Financial risk: ${RISK_RULES.find((r) => r.id === "financial")!.re.exec(t)?.[0] ?? "budget"}`, 70);
    case "fundraising":
      return tidy(`${P || "Investor"} passed on the round`, 70);
    case "scientific": {
      const product = /\b(\p{Lu}\p{Ll}+(?:\p{Lu}\p{Ll}*)+(?:\s+v\d+)?)/u.exec(t)?.[1];
      return tidy(`${product ?? "Results"} ${RISK_RULES.find((r) => r.id === "scientific")!.re.exec(t)?.[0] ?? "below target"}`, 70);
    }
    default:
      return tidy(`Reputational risk${P ? ` for ${P}` : ""}`, 70);
  }
}

/** Turn this message's risk drafts into risks: one per kind, and a renewal risk absorbs its causes. */
function finalizeRisks(run: Run) {
  const drafts = run.risks;
  if (!drafts.length) return;
  const churn = drafts.find((d) => d.rule.id === "churn");
  const severityBump = run.input.classification.relevance === "CRITICAL" ? 1 : 0;
  const emit = (d: RiskDraft, title: string, severity: number, description: string) => {
    if (run.out.risks.length >= 10 || !once(run, `risk:${titleKey(title)}`)) return;
    run.out.risks.push({
      title: cut(title, 200),
      description: cut(description, 1000),
      category: d.rule.category === "CONTEXT" ? riskCategory(run, d.sentence) : d.rule.category,
      severity: Math.min(5, severity),
      companyName: run.primaryCompany,
      confidence: clamp(d.rule.confidence),
      evidence: d.evidence,
    });
  };
  if (churn) {
    const causes = drafts.filter((d) => d !== churn && ["sla", "delay", "escalation"].includes(d.rule.id));
    const detail = causes.map(riskDetail).find((x) => x && x !== "escalation");
    const title = tidy(`${riskTitle(run, churn)}${detail ? `: ${detail}` : ""}`, 70);
    emit(churn, title, Math.max(churn.rule.severity, ...causes.map((c) => c.rule.severity)) + severityBump, [churn, ...causes].map((d) => d.sentence).join(" "));
    for (const d of drafts) if (d !== churn && !causes.includes(d)) emit(d, riskTitle(run, d), d.rule.severity + severityBump, d.sentence);
    return;
  }
  for (const d of drafts) emit(d, riskTitle(run, d), d.rule.severity + severityBump, d.sentence);
}

// ─── Opportunities and facts ─────────────────────────────────────────────────

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
  if (run.fromCeo || run.kind === "event" || run.tabular) return; // the CEO restating an upside is not a new signal
  const t = s.text;
  const company = run.primaryCompany;
  const short = shortCompany(company);
  const nextMoney = firstMoney(run.sentences[run.idx + 1]?.text ?? "");
  const money = firstMoney(t);
  const base = { description: t, companyName: company, estimatedValue: money && money.value >= 0 ? money.value : null, evidence: ev };
  const negated = (re: RegExp) => {
    const m = re.exec(t);
    if (!m) return false;
    const before = t.slice(Math.max(0, m.index - 40), m.index);
    // "if you would like to discuss…" is the CEO's interest, not theirs.
    return NEGATION_NEAR.test(before) || /\b(?:you|if you)\b[^.]{0,20}$/i.test(before);
  };

  if (OPP_EXPANSION.test(t) && !negated(OPP_EXPANSION)) {
    const obj = expansionObject(t);
    const after = /\bexpan(?:d|sion)\w*\s+((?:to|into)\s+[^,.;]{3,60})/i.exec(t)?.[1];
    addOpportunity(run, { ...base, kind: "EXPANSION", title: obj ? `Potential ${obj.toLowerCase()} expansion` : after ? tidy(`Potential expansion ${after.trim()}`, 70) : "Potential expansion", confidence: 0.85 });
    return;
  }
  const add = OPP_ADDITIONAL.exec(t);
  if (add && !negated(OPP_ADDITIONAL) && /\b(?:discuss|interested|would like|plan|considering|want|exploring|possible|potential|opportunity|request)\b/i.test(t)) {
    addOpportunity(run, { ...base, kind: "EXPANSION", title: `Potential additional ${add[1].toLowerCase()}${short ? ` — ${short}` : ""}`, confidence: 0.85 });
    return;
  }
  if (OPP_UPSELL.test(t)) {
    addOpportunity(run, { ...base, kind: "EXPANSION", title: `Upsell opportunity${short ? ` with ${short}` : ""}`, confidence: 0.62 });
    return;
  }
  if (OPP_CREDITS.test(t) && (money || /\d+%/.test(t) || nextMoney) && /\b(?:offer|provide|give|grant|available|include|extend|approval)\w*\b/i.test(t)) {
    const amount = /\b\d+%/.exec(t)?.[0] ?? money?.text ?? nextMoney?.text ?? "";
    const signBy = /\bif (?:we|you) sign\b/i.test(t) ? dueOf(run, t).date : null;
    const what = /\bcompute\b/i.test(t) ? "compute credits" : /credit/i.test(t) ? "credits" : "discount";
    addOpportunity(run, {
      ...base,
      estimatedValue: money?.value ?? nextMoney?.value ?? null,
      kind: run.input.classification.category === "STRATEGIC_PARTNER" || /\bpartner/i.test(company ?? "") ? "PARTNERSHIP" : "OTHER",
      title: tidy(`${amount ? `${amount} ` : ""}${what}${short ? ` from ${short}` : ""}${signBy ? ` if signed by ${dayShort(signBy).replace(/^\w+, /, "")}` : ""}`, 70),
      confidence: 0.85,
    });
    return;
  }
  if (OPP_ROUND.test(t) && !negated(OPP_ROUND)) {
    const sheet = /term ?sheet/i.test(t);
    addOpportunity(run, { ...base, kind: "FUNDRAISING", title: sheet ? `Potential term sheet${company ? ` from ${company}` : ""}` : `Potential round participation${company ? ` from ${company}` : ""}`, confidence: 0.85 });
    return;
  }
  if (OPP_INVESTOR.test(t) && run.kind === "email") {
    const round = /\bseries ([a-e])\b/i.exec(`${run.subject} ${t}`)?.[1]?.toUpperCase();
    addOpportunity(run, { ...base, kind: "FUNDRAISING", title: tidy(`Potential ${round ? `Series ${round} ` : ""}investor${company ? `: ${company}` : ""}`, 70), confidence: 0.72 });
    return;
  }
  if (OPP_PARTNER.test(t) && !negated(OPP_PARTNER)) {
    addOpportunity(run, { ...base, kind: "PARTNERSHIP", title: `Potential partnership${short ? ` with ${short}` : ""}`, confidence: 0.64 });
    return;
  }
  const intro = OPP_INTRO.exec(t);
  if (intro) {
    // Protect honorific dots ("Dr. Lee") before cutting the name at punctuation.
    const target = intro[1].replace(/\b(Dr|Prof|Mr|Mrs|Ms)\./g, "$1\u0000").split(/[,.;!?(]|\s+(?:who|which|that|at|from|so)\s+/)[0].replace(/\u0000/g, ".").trim();
    const kind: OpportunityKind = /\b(?:fund|ventures|capital|investor|partners|vc)\b/i.test(intro[1]) ? "FUNDRAISING" : /\b(?:pharma|biotech|therapeutics|oncology|head of|vp|director)\b/i.test(intro[1]) ? "COMMERCIAL" : "OTHER";
    if (target.length >= 2) addOpportunity(run, { ...base, kind, title: tidy(`Introduction to ${target}`, 70), confidence: 0.64 });
    return;
  }
  const interest = OPP_INTEREST.exec(t);
  if (interest && !negated(OPP_INTEREST)) {
    const what = interest[1].split(/[,.;!?]|\s+(?:and|but|so|if|once|before)\s+/)[0].trim().replace(/^(?:the|a|an)\s+/i, "");
    if (what.length >= 3) {
      addOpportunity(run, { ...base, kind: opportunityKind(run), title: tidy(`${short ? `${short} interested in` : "Interest in"} ${what}`, 70), confidence: 0.62 });
      return;
    }
  }
  if (OPP_PILOT.test(t) && !negated(/\bpilot\b/i)) {
    addOpportunity(run, { ...base, kind: "COMMERCIAL", title: `Potential pilot${short ? ` with ${short}` : ""}`, confidence: 0.64 });
    return;
  }
  if (OPP_RFP.test(t)) addOpportunity(run, { ...base, kind: "COMMERCIAL", title: `RFP${short ? ` from ${short}` : ""}`, confidence: 0.8 });
}

function labelNear(text: string, index: number, rules: [RegExp, string][], matchLength = 0): string | null {
  const before = text.slice(Math.max(0, index - 70), index);
  const after = text.slice(index + matchLength, index + matchLength + 40);
  if (rules === MONEY_LABELS && /\b(?:pro[- ]rata|invest(?:ment|ing)?|commit(?:ment|ted)?|allocation|cheque)\b/i.test(`${before} ${after}`)) return "Investment amount";
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
  return null; // an unlabeled number tells the CEO nothing
}

function ruleFacts(run: Run, s: Sentence, ev: string) {
  const t = s.text;
  const money = new RegExp(MONEY_RE.source, "gi");
  for (let m = money.exec(t); m; m = money.exec(t)) {
    const value = moneyValue(m);
    const label = labelNear(t, m.index, MONEY_LABELS, m[0].length);
    if (value == null || !label) continue;
    addFact(run, { label, value: m[0].trim(), kind: "MONEY", numericValue: value, evidence: ev });
  }
  const auc = new RegExp(AUC_RE.source, "gi");
  for (let m = auc.exec(t); m; m = auc.exec(t)) {
    const q = m[1]?.trim().toLowerCase().replace("holdout", "hold-out");
    addFact(run, { label: q ? `${capitalize(q)} AUC` : "AUC", value: m[2], kind: "METRIC", numericValue: Number(m[2]), evidence: ev });
  }
  const pct = new RegExp(PERCENT_RE.source, "gi");
  for (let m = pct.exec(t); m; m = pct.exec(t)) {
    const label = labelNear(t, m.index, PERCENT_LABELS, m[0].length);
    if (label) addFact(run, { label, value: m[0].trim(), kind: "PERCENT", numericValue: Number(m[1]), evidence: ev });
  }
  const cnt = new RegExp(COUNT_RE.source, "gi");
  for (let m = cnt.exec(t); m; m = cnt.exec(t)) {
    const unit = m[2].toLowerCase();
    const n = Number(m[1].replace(/,/g, ""));
    let label: string | null = null;
    if (/^(?:months?|weeks?|days?)$/.test(unit)) {
      const ctxt = t.slice(Math.max(0, m.index - 50), m.index + m[0].length + 20);
      const unitLabel = `${unit.replace(/s$/, "")}s`;
      if (/\brunway\b/i.test(ctxt)) label = `Runway (${unitLabel})`;
      else if (/\bexclusivity\b/i.test(ctxt)) label = `Exclusivity (${unitLabel})`;
      else if (/\b(?:turnaround|lead time|timeline|onboarding)\b/i.test(ctxt)) label = `${capitalize(/\b(turnaround|lead time|timeline|onboarding)\b/i.exec(ctxt)![1].toLowerCase())} (${unitLabel})`;
    } else {
      label = capitalize(unit.replace(/^(?:study)$/, "studies").replace(/([^s])$/, "$1s").replace(/ss$/, "s"));
    }
    if (label) addFact(run, { label, value: m[0].trim(), kind: "COUNT", numericValue: n, evidence: ev });
  }
}

// ─── Meeting notes, calendar, contracts, explicit deadlines ─────────────────

/** "Action: Maya to send the deck by Oct 9", "- [ ] Jonas to update the model", "Decision: …", "Risk: …". */
function ruleNotesLine(run: Run, s: Sentence, ev: string, inActionSection: boolean, rawLine: string): boolean {
  const t = s.text.trim();
  const decision = /^(?:decision|decided|agreed)\s*[:\-–]\s*(.+)$/i.exec(t);
  if (decision) {
    addDecision(run, { title: actionTitle(decision[1], {}, 80) ?? tidy(decision[1], 80), status: "MADE", decision: decision[1], decidedByName: null, deadline: null, options: [], confidence: 0.85, evidence: ev });
    return true;
  }
  const risk = /^(?:risk|concern|blocker|issue)\s*[:\-–]\s*(.+)$/i.exec(t);
  if (risk) {
    const rule = RISK_RULES.find((r) => r.re.test(risk[1])) ?? RISK_RULES.find((r) => r.id === "atrisk")!;
    const title = rule.id === "shortage" || rule.id === "delay" ? riskTitle(run, { rule, sentence: risk[1], evidence: ev, party: partyFor(run, risk[1]) }) : tidy(risk[1], 70);
    if (run.out.risks.length < 10 && once(run, `risk:${titleKey(title)}`)) {
      run.out.risks.push({
        title,
        description: risk[1],
        category: rule.category !== "CONTEXT" ? rule.category : riskCategory(run, risk[1]),
        severity: rule.severity,
        companyName: run.primaryCompany,
        confidence: 0.84,
        evidence: ev,
      });
    }
    return true;
  }
  const follow = /^(?:follow[- ]?ups?)\s*[:\-–]\s*(.+)$/i.exec(t);
  if (follow) {
    const due = dueOf(run, follow[1]);
    const title = actionTitle(follow[1], { dateText: due.text });
    if (title && !weakObject(title)) addFollowUp(run, title, null, due.date, 0.84, ev);
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
  if (!title || weakObject(title)) return false;
  const ownerIsCeo = isCeoName(run, owner);
  addTask(
    run,
    {
      title,
      description: `Action item from ${run.input.meeting?.title ?? run.input.title}`,
      ownerName: ownerIsCeo ? run.ceoFirst : owner,
      ownerIsCeo,
      dueDate: due.date,
      dueText: due.text,
      // An explicit action item with an owner is reliable; without one it needs a human.
      confidence: owner ? CONF.explicit + (due.date ? CONF.dated : 0) : 0.62,
      evidence: ev,
    },
    { phrase: lowerFirst(actionTitle(body, { dateText: due.text, keepArticle: true }, 90) ?? title) },
  );
  return true;
}

/** Calendar descriptions: "Please bring the updated pipeline", "prepare the Q3 numbers" → CEO prep task due at the event. */
function ruleEventAsk(run: Run, s: Sentence, ev: string) {
  const m = /\b(?:please|pls|kindly|could you|can you|you(?:'ll| will) need to|be ready to|come prepared to)\s+(?:also\s+)?(bring|prepare|review|read|send|share|come with|have|circulate|update|be ready to|look over)\b([\s\S]*)$/i.exec(s.text);
  if (!m || !run.eventDay) return;
  let title = actionTitle(`${m[1]}${m[2]}`);
  if (!title) return;
  if (weakObject(title)) {
    title = resolveWeak(run, title, s.text.slice(0, m.index));
    if (!title) return;
  }
  const meeting = cut(run.input.title, 100);
  addTask(
    run,
    { title, description: `Preparation for “${meeting}”`, ownerName: run.ceoFirst, ownerIsCeo: true, dueDate: inWindow(run.eventDay, run.now) ? run.eventDay : null, dueText: cut(`before ${meeting}`, 120), confidence: CONF.explicit, evidence: ev },
    { phrase: lowerFirst(actionTitle(`${m[1]}${m[2]}`, { keepArticle: true }, 90) ?? title) },
  );
}

/** Contract language with a dated obligation: "CytoHub shall deliver … by …" (OUTBOUND), "<Customer> shall pay …" (INBOUND). */
function ruleContract(run: Run, s: Sentence, ev: string) {
  if (!run.docType || !CONTRACT_DOCS.has(run.docType)) return;
  const m = /^(.{2,80}?)\s+(?:shall|will|agrees to|must|is obligated to|undertakes to)\s+(?:promptly\s+|also\s+)?(\p{L}[\s\S]*)$/iu.exec(s.text.trim());
  if (!m || !startsWithActionVerb(m[2])) return;
  const subject = m[1].replace(/^(?:\d+(?:\.\d+)*\s+|\(?[a-z]\)\s+)/i, "").trim();
  if (/\b(?:each|both|either|neither) part(?:y|ies)\b|\bthe parties\b/i.test(subject)) return;
  const ours = /\bcytohub\b|\b(?:service )?provider\b|\bsupplier\b|\blicensor\b/i.test(subject);
  const known = [...run.input.resolution.companies.map((c) => c.label), ...run.input.known.companies.map((c) => c.name)].find((n) => subject.toLowerCase().includes(n.toLowerCase()));
  const theirs = known || /\b(?:customer|client|sponsor|licensee|partner|company|purchaser|buyer)\b/i.test(subject);
  if (!ours && !theirs) return;
  const due = dueOf(run, s.text);
  // Standing terms ("within 10 business days of compound receipt") are service levels, not one-off commitments.
  if (!due.date) return;
  if (due.text && /^(?:within|in)\b/i.test(due.text)) return;
  const title = actionTitle(m[2], { dateText: due.text });
  if (!title || weakObject(title)) return;
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
    confidence: 0.84,
    evidence: ev,
  });
}

/** Only explicit deadline statements ("The pre-read is due Oct 20"), and only when nothing else came from the sentence. */
function ruleDeadlineOnly(run: Run, s: Sentence, ev: string) {
  if (run.tabular || run.kind === "event" || run.docType === "EMPLOYEE_DOCUMENT") return;
  const t = s.text;
  const due = dueOf(run, t);
  if (!due.date || !due.hard) return;
  const what =
    /^(?:the\s+|our\s+)?(.{3,60}?)\s+(?:is|are|was|will be)\s+due\b/i.exec(t)?.[1] ?? /\bdeadline\s+(?:for|on|to)\s+(?:the\s+)?(.{3,60}?)\s+(?:is|by|on|:)/i.exec(t)?.[1] ?? null;
  if (!what || run.out.deadlines.length >= 15 || !once(run, `deadline:${due.date}:${titleKey(what)}`)) return;
  run.out.deadlines.push({ what: tidy(what, 120), date: due.date, hard: true, confidence: 0.75, evidence: ev });
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

// ─── Recommended actions ─────────────────────────────────────────────────────

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

const SEND_VERBS = /^(?:send|share|forward|provide|deliver|return|resend|submit|circulate|bring)\b/i;
const REPLY_VERBS = /^(?:confirm|answer|respond|tell|let|advise|clarify|explain|approve)\b/i;

function action(run: Run, text: string, why: string, urgency: keyof typeof URGENCY_ORDER) {
  return { action: tidy(text, 110), why: tidy(why, 160).replace(/([^.!?])$/, "$1."), urgency };
}

function recommendedActions(run: Run): IntelligenceExtraction["recommendedActions"] {
  const out = run.out;
  const tz = run.input.timezone;
  const acts: IntelligenceExtraction["recommendedActions"] = [];
  const cp = counterpart(run);

  for (const t of [...out.tasks.filter((x) => x.ownerIsCeo && x.confidence >= 0.55)].sort((a, b) => taskRank(b) - taskRank(a)).slice(0, 2)) {
    const meta = run.meta.get(t) ?? {};
    const asker = meta.asker ?? null;
    const when = dueWords(t.dueDate, run.now, tz);
    const obj = t.title.replace(/^\S+\s+/, "");
    let text: string;
    if (meta.confirm && asker) text = `Confirm to ${asker.name} you can ${lowerFirst(t.title)} ${when}`;
    else if (asker && SEND_VERBS.test(t.title)) text = withDue(`${t.title.split(" ")[0]} ${obj} to ${asker.name}`, when);
    else if (asker && REPLY_VERBS.test(t.title)) text = withDue(`Reply to ${asker.name} to ${lowerFirst(t.title)}`, when);
    else text = withDue(t.title, when);
    const why = meta.promisedTo
      ? `You told ${meta.promisedTo} you would`
      : asker
        ? `${whoLabel(asker)} asked you${meta.confirm ? " to confirm the date" : ""}`
        : run.kind === "event"
          ? `Prep for ${cut(run.input.title, 80)}`
          : run.kind === "notes"
            ? `Your action item from ${cut(run.input.meeting?.title ?? run.input.title, 80)}`
            : `Assigned to you in ${cut(run.input.title, 80)}`;
    acts.push(action(run, text, why, urgencyFor(run, t.dueDate)));
  }
  for (const d of out.decisions.filter((x) => x.status === "NEEDED").slice(0, 1)) {
    const meta = run.meta.get(d) ?? {};
    const when = dueWords(d.deadline, run.now, tz);
    const base = d.title.replace(/\?$/, "");
    const text = /^Approve\b/.test(base) ? withDue(`Approve or decline ${base.replace(/^Approve\s+/, "")}`, when) : /\?$/.test(d.title) ? withDue(`Decide: ${lowerFirst(base)}`, when) : withDue(base, when);
    const who = meta.asker?.name ?? cp?.name ?? "The team";
    acts.push(action(run, text, `${who} needs your decision${meta.purpose ? ` ${meta.purpose}` : ""}`, urgencyFor(run, d.deadline)));
  }
  for (const c of out.commitments.filter((x) => x.direction !== "INBOUND" && x.owedByName === run.ceoName).slice(0, 2)) {
    const to = c.owedToName && !c.title.includes(firstNameOf(c.owedToName)) ? (SEND_VERBS.test(c.title) ? ` to ${c.owedToName}` : ` for ${c.owedToName}`) : "";
    acts.push(action(run, withDue(`${c.title}${to}`, dueWords(c.dueDate, run.now, tz)), `You promised it${c.owedToName ? ` to ${c.owedToName}` : ""}`, urgencyFor(run, c.dueDate)));
  }
  const majorRisk = out.risks.filter((r) => r.severity >= 4)[0];
  if (majorRisk) {
    const contact = cp && !cp.internal ? cp.name : null;
    let text: string;
    if (/\b(?:renewal|churn|SLA|escalation)\b/i.test(majorRisk.title) && contact) text = `Call ${contact} today and commit to a dated recovery plan`;
    else if (/competing offer/i.test(majorRisk.title) && out.decisions.some((d) => d.status === "NEEDED")) text = "";
    else if (/competing offer/i.test(majorRisk.title)) text = `Decide on the offer before the competing deadline`;
    else if (/\bdelay/i.test(majorRisk.title) && contact) text = `Ask ${contact} for a firm date and interim options`;
    else if (/\brenewal at risk\b/i.test(majorRisk.title)) text = `Name an owner for the ${majorRisk.title.replace(/\s+renewal at risk.*$/i, "")} renewal recovery plan`;
    else text = `Assign a mitigation owner for “${majorRisk.title}”`;
    if (text) acts.push(action(run, text, majorRisk.title, "TODAY"));
  }
  for (const c of out.commitments.filter((x) => x.direction === "INBOUND").slice(0, 1)) {
    const by = c.owedByName ?? cp?.name ?? "them";
    const when = dueWords(c.dueDate, run.now, tz) || (c.dueText ?? "");
    let text: string;
    if (SEND_VERBS.test(c.title) || /^(?:return|issue)\b/i.test(c.title)) {
      const obj = (run.meta.get(c)?.phrase ?? lowerFirst(c.title))
        .replace(/^(?:send|share|deliver|provide|return|issue|have|resend|circulate)\s+/i, "")
        .replace(/^(?:their|its|his|her|our)\s+/i, "the ")
        .replace(/\s+(?:back|over)$/i, "");
      text = withDue(`Watch for ${obj} from ${by}`, when);
    } else {
      text = withDue(`Track ${by}'s commitment to ${lowerFirst(c.title)}`, when);
    }
    acts.push(action(run, text, `${by} committed to it; follow up if it slips`, "LATER"));
  }
  for (const m of out.meetingRequests.slice(0, 1)) {
    const topic = /\bre:\s*(.+)$/i.exec(m.title)?.[1];
    acts.push(action(run, `Propose times to ${m.withName ?? "them"}${topic ? ` for ${lowerFirst(topic)}` : ""}`, `${m.withName ?? "They"} asked to meet`, "THIS_WEEK"));
  }
  for (const t of out.tasks.filter((x) => !x.ownerIsCeo && !x.ownerName).slice(0, 1)) {
    acts.push(action(run, `Assign an owner for “${t.title}”`, "Action item without an owner", urgencyFor(run, t.dueDate) === "IMMEDIATE" ? "TODAY" : "THIS_WEEK"));
  }
  return acts.sort((a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency]).slice(0, 5);
}

// ─── Summary ─────────────────────────────────────────────────────────────────

function summarize(run: Run): string {
  const { input, out } = run;
  const cp = counterpart(run);
  const who = whoLabel(cp) ?? run.sender?.name ?? null;
  const parts: string[] = [];
  const ceoTask = bestTask(out.tasks.filter((t) => t.ownerIsCeo && t.confidence >= 0.55));
  const outbound = out.commitments.find((c) => c.owedByName === run.ceoName);
  const inbound = out.commitments.find((c) => c.direction === "INBOUND" || (c.direction === "INTERNAL" && c.owedByName !== run.ceoName));
  const made = out.decisions.find((d) => d.status === "MADE");
  const needed = out.decisions.find((d) => d.status === "NEEDED");
  const risk = out.risks[0];
  const opp = out.opportunities[0];
  const phrase = (x: object, title: string) => run.meta.get(x)?.phrase ?? lowerFirst(title);
  const by = (d: string | null, t: string | null) => (d ? ` by ${dayShort(d)}` : t ? ` ${t}` : "");
  const topic = run.subject || input.title;

  if (run.kind === "email") {
    if (run.fromCeo) {
      const promised = out.tasks.find((t) => t.ownerIsCeo && run.meta.get(t)?.promisedTo);
      if (outbound) parts.push(`You committed to ${phrase(outbound, outbound.title)}${outbound.owedToName ? ` for ${outbound.owedToName}` : ""}${by(outbound.dueDate, outbound.dueText)}.`);
      else if (promised) parts.push(`You told ${run.meta.get(promised)!.promisedTo} you'll ${phrase(promised, promised.title)}${by(promised.dueDate, promised.dueText)}.`);
      else if (made) parts.push(`You decided: ${lowerFirst(made.title)}.`);
      else if (out.tasks[0]) parts.push(`You asked ${run.recipients[0]?.name ?? "the team"} to ${phrase(out.tasks[0], out.tasks[0].title)}.`);
      else parts.push(`You replied to ${run.recipients[0]?.name ?? "the thread"} about ${topic}.`);
    } else if (ceoTask && who) {
      parts.push(`${who} asks you to ${phrase(ceoTask, ceoTask.title)}${by(ceoTask.dueDate, ceoTask.dueText)}.`);
    } else if (needed && who) {
      parts.push(`${who} needs your decision${needed.deadline ? ` by ${dayShort(needed.deadline)}` : ""}: ${lowerFirst(needed.title)}`.replace(/([^?])$/, "$1."));
    } else if (out.meetingRequests[0] && who) {
      const t = /\bre:\s*(.+)$/i.exec(out.meetingRequests[0].title)?.[1];
      parts.push(`${who} asks to meet${t ? ` about ${lowerFirst(t)}` : ""}.`);
    } else if (inbound) {
      parts.push(`${inbound.owedByName ?? who ?? "They"} will ${phrase(inbound, inbound.title)}${by(inbound.dueDate, inbound.dueText)}.`);
    } else if (risk && who) {
      parts.push(`${who} raises a risk: ${risk.title}.`);
    } else if (opp && who) {
      parts.push(`${who} signals ${withArticle(lowerFirst(opp.title))}.`);
    } else if (made && who) {
      parts.push(`${who}: ${lowerFirst(made.title)}.`);
    } else if (who) {
      const copied = run.ceoInCc && !run.ceoInTo;
      parts.push(`${who} wrote${copied && run.recipients[0] ? ` to ${run.recipients[0].name}` : ""} about ${topic}${copied ? "; you're copied" : ""}.`);
    } else {
      parts.push(`Message about ${topic}.`);
    }
  } else if (run.kind === "event") {
    const ev = input.event!;
    const others = ev.attendees.filter((a) => a.email.toLowerCase() !== input.ceo.email?.toLowerCase());
    parts.push(`${input.title} on ${dayShort(run.eventDay!)} with ${others.length} other attendee${others.length === 1 ? "" : "s"}${run.primaryCompany ? ` (${run.primaryCompany})` : ""}${ev.status === "CANCELLED" ? " — cancelled" : ""}.`);
    if (ceoTask) parts.push(`Prepare: ${phrase(ceoTask, ceoTask.title)}.`);
  } else if (run.kind === "notes") {
    const owners = [...new Set(out.tasks.map((t) => (t.ownerIsCeo ? "you" : t.ownerName)).filter(Boolean))];
    const nMade = out.decisions.filter((d) => d.status === "MADE").length;
    parts.push(`Notes from ${input.meeting?.title ?? input.title}: ${out.tasks.length} action item${out.tasks.length === 1 ? "" : "s"}${owners.length ? ` (${owners.slice(0, 4).join(", ")})` : ""}, ${nMade} decision${nMade === 1 ? "" : "s"}.`);
  } else {
    const label = input.document?.docType && input.document.docType !== "OTHER" ? input.document.docType.toLowerCase().replace(/_/g, " ").replace(/\bnda\b/, "NDA") : "document";
    parts.push(`${capitalize(label)} “${cut(input.title, 100)}”${input.document?.author ? ` by ${input.document.author}` : ""}${input.document && input.document.version > 1 ? ` (version ${input.document.version})` : ""}.`);
    const fact = out.facts.find((f) => f.kind === "MONEY") ?? out.facts.find((f) => f.kind !== "TEXT");
    if (fact) parts.push(`${fact.label}: ${fact.value}.`);
  }

  if (parts.length < 2) {
    const first = parts[0] ?? "";
    if (needed && !first.includes(lowerFirst(needed.title))) parts.push(`Also needs your decision: ${lowerFirst(needed.title)}`.replace(/([^?])$/, "$1."));
    else if (risk && !first.includes(risk.title)) parts.push(`Risk: ${risk.title}.`);
    else if (opp && !first.includes(lowerFirst(opp.title))) parts.push(`Also signals ${withArticle(lowerFirst(opp.title))}.`);
    else if (inbound && !first.includes(phrase(inbound, inbound.title))) parts.push(`${inbound.owedByName ?? "They"} will ${phrase(inbound, inbound.title)}${by(inbound.dueDate, inbound.dueText)}.`);
  }
  return cut(parts.map((p) => sentenceCase(p.replace(/\s+([,.;:!?])/g, "$1").replace(/\.\.$/, "."))).join(" "), 1200);
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
  run.sentences = sentences;
  const greeting = detectGreeting(run, sentences);

  // "Options:" lists and recommendations feed the decision asked for in the same message.
  let inOptions = false;
  const optionIdx = new Set<number>();
  sentences.forEach((s, i) => {
    const t = s.text.trim();
    if (/^options\s*:?$/i.test(t)) {
      inOptions = true;
      return;
    }
    const line = text.slice(text.lastIndexOf("\n", s.start - 1) + 1, s.end);
    if (inOptions && /^\s*(?:\d{1,2}[.)]|[-*•]|[a-c][.)])\s*/.test(line)) {
      optionIdx.add(i);
      if (run.options.length < 6) run.options.push(cut(t.replace(/[.;]+$/, ""), 200));
    } else if (inOptions) inOptions = false;
    if (/\b(?:the team|we|i)\s+recommends?\s+option\b/i.test(t)) run.recommendation = t;
  });

  let inActionSection = false;
  for (let i = 0; i < sentences.length; i++) {
    run.idx = i;
    const s = sentences[i];
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
    const before = produced(run);

    if (run.kind === "notes" && ruleNotesLine(run, s, ev, inActionSection && isListItem, rawLine)) continue;
    if (run.kind === "event") ruleEventAsk(run, s, ev);
    if (run.kind === "document") ruleContract(run, s, ev);

    if (!optionIdx.has(i)) {
      const decided = ruleDecisions(run, s, ev);
      if (!decided && (run.kind === "email" || run.kind === "notes")) {
        if (!ruleCommitment(run, s, ev) && !ruleThirdParty(run, s, ev) && !ruleRequest(run, s, ev)) ruleMeetingRequest(run, s, ev);
      } else if (!decided && run.kind === "document") {
        ruleThirdParty(run, s, ev);
      }
      if (produced(run) === before) ruleFollowUp(run, s, ev);
    }
    ruleRisk(run, s, ev, optionIdx.has(i));
    ruleOpportunity(run, s, ev);
    ruleFacts(run, s, ev);
    if (produced(run) === before) ruleDeadlineOnly(run, s, ev);
  }

  // Attach the "Options:" list and the team's recommendation to the decision asked for.
  const needed = out.decisions.find((d) => d.status === "NEEDED");
  if (needed) {
    if (!needed.options.length && run.options.length) needed.options = run.options.slice(0, 6);
    if (run.recommendation) needed.decision = cut(`${run.recommendation}${needed.decision ? ` ${needed.decision}` : ""}`, 1000);
  }
  finalizeRisks(run);

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
