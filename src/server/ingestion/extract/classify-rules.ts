/**
 * Pure classification rules: CEO category, relevance, sensitivity, meeting
 * category, document type and activity tags from facts gathered by
 * classify.ts (database lookups). Kept free of I/O so it can be unit-tested.
 */
import type {
  CeoCategory,
  CompanyType,
  DocumentFormat,
  DocumentType,
  EventStatus,
  MeetingCategory,
  MentionRole,
  MessageDirection,
  PersonType,
  Relevance,
  ResponseStatus,
  Sensitivity,
  SourceItemKind,
} from "@/generated/prisma/enums";
import { ACTIVITY_TAGS } from "../extraction-schema";
import type { Classification } from "../types";
import { findDates } from "./dates";
import { splitSentences } from "./sentences";
import { firstMoney } from "./text";

export interface CompanyFacts {
  id: string;
  name: string;
  type: CompanyType;
}

export interface PersonFacts {
  id: string;
  name: string;
  type: PersonType;
  title: string | null;
  department: string | null;
  isCeo: boolean;
  company: CompanyFacts | null;
}

export interface ParticipantFacts {
  email: string | null;
  name: string;
  role: MentionRole;
  person: PersonFacts | null;
  /** The participant's organization (their Person.company, else matched by email domain). */
  company: CompanyFacts | null;
  /** CytoHub team (Person.type TEAM, or an unknown address on the CEO's domain). */
  internal: boolean;
  isCeo: boolean;
}

export interface ClassifyFacts {
  kind: SourceItemKind;
  title: string;
  text: string;
  occurredAt: Date;
  timezone: string;
  ceoFirstName: string;
  defaultSensitivity: Sensitivity;
  participants: ParticipantFacts[];
  /** Known companies named in the content (not participants). */
  mentionedCompanies: CompanyFacts[];
  email?: {
    direction: MessageDirection;
    isAutomated: boolean;
    fromEmail: string;
    labels: string[];
    ceoInTo: boolean;
    ceoInCc: boolean;
    recipientCount: number;
    /** The CEO has written in this thread before (or wrote this message). */
    ceoInThread: boolean;
    attachmentNames: string[];
  };
  event?: { status: EventStatus; ceoResponse: ResponseStatus | null; isRecurring: boolean; attendeeCount: number; ceoIsOrganizer: boolean };
  document?: { path: string | null; format: DocumentFormat; mimeType: string };
}

// ─── Lexicon ─────────────────────────────────────────────────────────────────

const KW = {
  fundraising: /\b(?:term ?sheet|series [a-e]\b|(?:the|our|this|next) round\b|lead investor|lead the round|due diligence|diligence|data ?room|investment committee|valuation|pro[- ]rata|cap table|convertible note|safe note|fundrais\w*)\b/i,
  /** Investment committee; case-sensitive so words containing "ic" never match. */
  ic: /\bIC\b/,
  legal: /\b(?:NDA|non-disclosure|MSA|master services agreement|redlines?|redlined|clause|contract|indemnif\w*|liabilit(?:y|ies)|governing law|terms and conditions|data rights|ip assignment|litigation|lawsuit|subpoena|counsel)\b/i,
  escalation: /\b(?:urgent(?:ly)?|escalat\w*|unacceptable|asap|immediately|critical issue|outage|serious concern|very disappointed|frustrat\w*|complain\w*|breach)\b/i,
  personal: /\b(?:dentist|dental|doctor'?s? appointment|pediatrician|my (?:wife|husband|partner|son|daughter|kids?|family)|family (?:dinner|event|trip)|school (?:pickup|play|event|conference)|birthday|anniversary|wedding|vacation|haircut|gym|personal)\b/i,
  scientific: /\b(?:assay|dataset|donor hearts?|cardiomyocyte|electrophysiolog\w*|tissue|validation|experiment\w*|publication|manuscript|preprint|study protocol|auc|hold-out|cohort|biomarker|in vitro|preclinical|toxicolog\w*|arrhythmi\w*|qt prolongation|readout|lab)\b/i,
  recruiting: /\b(?:candidate|interview\w*|offer letter|job offer|the offer|compensation|salary|equity grant|recruit\w*|hiring|reference checks?|start date|competing offer)\b/i,
  compensation: /\b(?:offer letter|compensation|salary|bonus|equity grant|stock options?|severance|termination|performance review|performance improvement|pip\b)/i,
  finance: /\b(?:budget|burn|runway|cash|forecast|p&l|invoice|audit|month-end close|revenue|financial model|bank)\b/i,
  board: /\bboard (?:meeting|deck|pre-?read|call|approval|minutes|of directors|book|update|session|resolution)\b|\bboD\b/i,
  termSheet: /\b(?:term ?sheet|valuation|cap table|pro[- ]rata|liquidation preference|investment committee)\b/i,
  request: /\b(?:please|kindly|could you|can you|would you|will you|need you|need your|let me know|are you able|any chance you|do you have|would it be possible)\b/i,
};

const NOISE = {
  spam: /\b(?:you(?:'ve| have) won|lottery|claim your (?:prize|reward)|wire transfer immediately|crypto (?:opportunity|investment)|verify your account|account (?:suspended|locked)|act now)\b/i,
  marketing: /(?:\b\d{1,2}% off\b|\bwebinar\b|\bsale\b|\bpromo(?:tion)?\b|\bdiscount code\b|\blimited time\b|\bregister now\b|\blast chance\b|\bfree trial\b|\bexclusive offer\b|\bearly bird\b|\bsponsored\b|\bsave your seat\b)/i,
  newsletter: /\b(?:newsletter|digest|weekly (?:roundup|update|briefing|recap)|this week in|edition|issue #?\d+|daily brief(?:ing)?)\b/i,
  notification: /\b(?:receipt|invoice notification|your (?:order|invoice|receipt|statement|subscription)|password reset|reset your password|security alert|new sign-?in|has shared|shared (?:a|an) (?:file|document|folder)|commented on|mentioned you|automatic reply|out of office|delivery status|undeliverable|has been (?:shipped|delivered))\b|^(?:accepted|declined|tentative|invitation|updated invitation):/i,
  unsubscribe: /\bunsubscribe\b|\bmanage (?:your )?(?:email )?preferences\b|\bview (?:this email )?in (?:your )?browser\b/i,
};

const CATEGORY_WEIGHT: Record<CeoCategory, number> = {
  BOARD: 0.7,
  INVESTOR: 0.6,
  FUNDRAISING: 0.6,
  INTERNAL_ESCALATION: 0.6,
  CUSTOMER: 0.55,
  COMMERCIAL_OPPORTUNITY: 0.5,
  LEGAL: 0.5,
  STRATEGIC_PARTNER: 0.45,
  SCIENTIFIC_LEADERSHIP: 0.4,
  FINANCE: 0.4,
  RECRUITING: 0.4,
  EXECUTIVE_TEAM: 0.35,
  MAJOR_VENDOR: 0.3,
  OPERATIONS: 0.3,
  PERSONAL: 0.25,
  OTHER: 0.2,
  NEWSLETTER: 0.05,
  MARKETING: 0.05,
  NOTIFICATION: 0.05,
  SPAM: 0,
};

/** Categories a keyword overlay may replace (person/company-derived categories are kept). */
const WEAK: ReadonlySet<CeoCategory> = new Set(["OTHER", "EXECUTIVE_TEAM", "OPERATIONS", "FINANCE", "MAJOR_VENDOR", "SCIENTIFIC_LEADERSHIP"]);

const SENSITIVITY_RANK: Record<Sensitivity, number> = { INTERNAL: 1, CONFIDENTIAL: 2, RESTRICTED: 3 };

export function relevanceFromScore(score: number): Exclude<Relevance, "NOISE"> {
  if (score >= 0.85) return "CRITICAL";
  if (score >= 0.65) return "HIGH";
  if (score >= 0.4) return "NORMAL";
  return "LOW";
}

// ─── Participants → category ─────────────────────────────────────────────────

interface Candidate {
  category: CeoCategory;
  reason: string;
  rank: number;
  external: boolean;
}

/** Category for a CytoHub team member from title / department. */
export function teamCategory(title: string | null, department: string | null): CeoCategory {
  const t = `${title ?? ""} ${department ?? ""}`;
  if (/\b(?:CFO|chief financial|finance|controller|accounting)\b/i.test(t)) return "FINANCE";
  if (/\b(?:general counsel|legal|counsel|compliance)\b/i.test(t)) return "LEGAL";
  if (/\b(?:people|hr|human resources|talent|recruit\w*)\b/i.test(t)) return "RECRUITING";
  if (/\b(?:CSO|chief scientific|scien\w*|research|translational|biology|lab)\b/i.test(t)) return "SCIENTIFIC_LEADERSHIP";
  return "EXECUTIVE_TEAM";
}

const COMPANY_CATEGORY: Record<CompanyType, { category: CeoCategory; label: string; rank: number }> = {
  INVESTOR: { category: "INVESTOR", label: "Investor", rank: 9 },
  CUSTOMER: { category: "CUSTOMER", label: "Customer", rank: 8 },
  PROSPECT: { category: "COMMERCIAL_OPPORTUNITY", label: "Prospect", rank: 7 },
  PARTNER: { category: "STRATEGIC_PARTNER", label: "Partner", rank: 6 },
  ACADEMIC: { category: "STRATEGIC_PARTNER", label: "Academic partner", rank: 6 },
  VENDOR: { category: "MAJOR_VENDOR", label: "Vendor", rank: 4 },
  COMPETITOR: { category: "OTHER", label: "Competitor", rank: 2 },
  OTHER: { category: "OTHER", label: "Organization", rank: 1.5 },
};

function companyCandidate(c: CompanyFacts, scientific: boolean): Candidate {
  const base = COMPANY_CATEGORY[c.type];
  const category = c.type === "ACADEMIC" && scientific ? "SCIENTIFIC_LEADERSHIP" : base.category;
  return { category, reason: `${base.label}: ${c.name}`, rank: base.rank, external: true };
}

function participantCandidate(p: ParticipantFacts, scientific: boolean): Candidate | null {
  const person = p.person;
  const who = person?.name ?? p.name;
  if (person?.type === "BOARD") return { category: "BOARD", reason: `Board member: ${who}`, rank: 10, external: true };
  if (person?.type === "CANDIDATE") return { category: "RECRUITING", reason: `Candidate: ${who}`, rank: 5, external: true };
  if (person?.type === "TEAM" || (!person && p.internal)) {
    const role = person?.title ? ` (${person.title})` : "";
    return { category: teamCategory(person?.title ?? null, person?.department ?? null), reason: `Team: ${who}${role}`, rank: 3, external: false };
  }
  if (person?.type === "INVESTOR") return { category: "INVESTOR", reason: `Investor: ${p.company?.name ?? who}`, rank: 9, external: true };
  if (p.company) return companyCandidate(p.company, scientific);
  if (person?.type === "CUSTOMER") return { category: "CUSTOMER", reason: `Customer: ${who}`, rank: 8, external: true };
  if (person?.type === "PARTNER") return { category: "STRATEGIC_PARTNER", reason: `Partner: ${who}`, rank: 6, external: true };
  if (person?.type === "ADVISOR") return { category: "STRATEGIC_PARTNER", reason: `Advisor: ${who}`, rank: 5, external: true };
  return { category: "OTHER", reason: "", rank: 1, external: true };
}

const ROLE_BONUS: Partial<Record<MentionRole, number>> = { SENDER: 0.5, ORGANIZER: 0.5, AUTHOR: 0.5, RECIPIENT: 0.2, ATTENDEE: 0.2 };

function pickCategory(f: ClassifyFacts, scientific: boolean): Candidate | null {
  let best: Candidate | null = null;
  let bestScore = -Infinity;
  for (const p of f.participants) {
    if (p.isCeo) continue;
    const c = participantCandidate(p, scientific);
    if (!c) continue;
    const score = c.rank + (ROLE_BONUS[p.role] ?? 0);
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  // Companies named in the content count, a notch below participants.
  for (const co of f.mentionedCompanies) {
    const c = companyCandidate(co, scientific);
    if (c.rank - 2 > bestScore) {
      best = c;
      bestScore = c.rank - 2;
    }
  }
  return best;
}

// ─── Document type ───────────────────────────────────────────────────────────

interface DocRule {
  type: DocumentType;
  title?: RegExp;
  content?: RegExp;
  /** Both title and content must match. */
  both?: boolean;
  formats?: DocumentFormat[];
  conf: number;
}

const DOC_RULES: DocRule[] = [
  { type: "BOARD_DOCUMENT", title: /\bboard\b.*\b(?:pre-?read|deck|book|minutes|meeting|update|pack|materials)\b|\bboD\b/i, conf: 0.9 },
  { type: "NDA", title: /\b(?:NDA|CDA|non-disclosure|confidentiality agreement|mutual nda)\b/i, conf: 0.9 },
  { type: "NDA", content: /\bthis (?:mutual )?(?:non-disclosure|confidentiality) agreement\b/i, conf: 0.75 },
  { type: "FUNDRAISING_MATERIAL", title: /\b(?:term ?sheet|data ?room|investor update|investment memo|cap table)\b/i, conf: 0.85 },
  { type: "INVESTOR_DECK", title: /\b(?:deck|pitch|teaser|presentation)\b/i, content: /\b(?:raise|raising|round|series [a-e]|investment|investors?|use of (?:funds|proceeds))\b/i, both: true, conf: 0.85 },
  { type: "INVESTOR_DECK", title: /\b(?:investor|pitch|fundraising|series [a-e])\b.*\b(?:deck|presentation|slides)\b|\bpitch deck\b/i, conf: 0.85 },
  { type: "FINANCIAL_MODEL", title: /\b(?:model|forecast|budget|projections?|p&l|financials)\b/i, content: /\b(?:runway|burn|cash|ebitda|opex|revenue|arr|headcount)\b/i, both: true, conf: 0.85 },
  { type: "FINANCIAL_MODEL", title: /\b(?:financial model|operating model|budget|forecast)\b/i, formats: ["XLSX", "CSV"], conf: 0.8 },
  { type: "PARTNERSHIP_AGREEMENT", title: /\b(?:partnership|collaboration|research|data[- ]sharing|license|licensing|compute|joint development|services)\b.*\b(?:agreement|contract|mou)\b|\bmou\b/i, conf: 0.8 },
  { type: "CUSTOMER_CONTRACT", title: /\b(?:MSA|master services agreement|agreement|contract|order form|amendment|SOW signed)\b/i, conf: 0.8 },
  { type: "CUSTOMER_PROPOSAL", title: /\b(?:proposal|SOW|statement of work|quote|quotation|price list)\b/i, conf: 0.8 },
  { type: "REGULATORY_DOCUMENT", title: /\b(?:IND|pre-IND|FDA|EMA|regulatory|briefing (?:book|package|document)|510\(k\)|CTA)\b/i, conf: 0.85 },
  { type: "EXPERIMENT_REPORT", title: /\b(?:validation|experiment|assay|study|pilot)\b.*\b(?:report|results|readout|summary)\b|\breadout\b/i, conf: 0.8 },
  { type: "PUBLICATION", title: /\b(?:manuscript|publication|preprint|paper|abstract|poster|journal|submission)\b/i, conf: 0.75 },
  { type: "PRODUCT_SPECIFICATION", title: /\b(?:spec|specification|PRD|API|requirements|roadmap|release notes|design doc)\b/i, conf: 0.75 },
  { type: "MEETING_NOTES", title: /\b(?:minutes|notes|recap|debrief|1:1|one-on-one|stand-?up|sync)\b/i, conf: 0.75 },
  { type: "EMPLOYEE_DOCUMENT", title: /\b(?:handbook|offer letter|offer|compensation|salary|performance review|job description|onboarding|employment agreement|org chart|benefits)\b/i, conf: 0.8 },
  { type: "STRATEGIC_PLAN", title: /\b(?:strategy|strategic plan|operating plan|OKRs?|annual plan|20\d\d plan|roadmap 20\d\d)\b/i, conf: 0.7 },
  { type: "SALES_MATERIAL", title: /\b(?:one-?pager|brochure|sales deck|case study|battlecard|datasheet|capabilities)\b/i, conf: 0.7 },
  // "Memo" names the document's form explicitly, so it outranks topic words ("Memo: pricing proposal").
  { type: "INTERNAL_MEMO", title: /\bmemo\b/i, conf: 0.82 },
  { type: "SCIENTIFIC_DATA_SUMMARY", formats: ["CSV", "XLSX"], content: /\b(?:donor|heart|assay|auc|measurement|sample|concentration|ic50|apd\d*|qt|beat rate|contractil\w*|well|plate)\b/i, conf: 0.7 },
  { type: "SCIENTIFIC_REPORT", title: /\b(?:white ?paper|scientific report|dataset report|technical report|science update)\b/i, conf: 0.7 },
  { type: "LEGAL_DOCUMENT", title: /\b(?:policy|terms|litigation|patent|legal|bylaws|resolution|consent)\b/i, conf: 0.65 },
  // Content-only fallbacks (weaker).
  { type: "CUSTOMER_CONTRACT", content: /\bthis (?:master services )?agreement\b.*\b(?:shall|hereby)\b/i, conf: 0.6 },
  { type: "EXPERIMENT_REPORT", content: /\b(?:methods|results)\b[\s\S]{0,4000}\b(?:assay|donor|auc|validation)\b/i, conf: 0.55 },
  { type: "MEETING_NOTES", content: /^(?:\s*(?:attendees|action items?|next steps|decisions?)\s*:)/im, conf: 0.6 },
  { type: "FINANCIAL_MODEL", content: /\b(?:runway|burn rate|monthly burn)\b/i, formats: ["XLSX", "CSV"], conf: 0.6 },
];

export function detectDocType(title: string, path: string | null, content: string, format: DocumentFormat | null): { type: DocumentType; confidence: number } {
  const name = `${title} ${path?.split("/").pop() ?? ""}`.replace(/[_]+/g, " ");
  const head = content.slice(0, 8000);
  let best: { type: DocumentType; confidence: number } = { type: "OTHER", confidence: 0.3 };
  for (const r of DOC_RULES) {
    if (r.formats && (!format || !r.formats.includes(format))) continue;
    const t = r.title ? r.title.test(name) : null;
    const c = r.content ? r.content.test(head) : null;
    const ok = r.both ? t === true && c === true : r.title ? t === true : c === true;
    if (!ok) continue;
    if (r.conf > best.confidence) best = { type: r.type, confidence: r.conf };
  }
  return best;
}

const DOC_CATEGORY: Partial<Record<DocumentType, CeoCategory>> = {
  INVESTOR_DECK: "FUNDRAISING",
  FUNDRAISING_MATERIAL: "FUNDRAISING",
  FINANCIAL_MODEL: "FINANCE",
  CUSTOMER_PROPOSAL: "COMMERCIAL_OPPORTUNITY",
  CUSTOMER_CONTRACT: "LEGAL",
  NDA: "LEGAL",
  LEGAL_DOCUMENT: "LEGAL",
  PARTNERSHIP_AGREEMENT: "STRATEGIC_PARTNER",
  BOARD_DOCUMENT: "BOARD",
  EXPERIMENT_REPORT: "SCIENTIFIC_LEADERSHIP",
  PUBLICATION: "SCIENTIFIC_LEADERSHIP",
  SCIENTIFIC_REPORT: "SCIENTIFIC_LEADERSHIP",
  SCIENTIFIC_DATA_SUMMARY: "SCIENTIFIC_LEADERSHIP",
  REGULATORY_DOCUMENT: "SCIENTIFIC_LEADERSHIP",
  EMPLOYEE_DOCUMENT: "RECRUITING",
  SALES_MATERIAL: "COMMERCIAL_OPPORTUNITY",
  PRODUCT_SPECIFICATION: "EXECUTIVE_TEAM",
  STRATEGIC_PLAN: "EXECUTIVE_TEAM",
  INTERNAL_MEMO: "EXECUTIVE_TEAM",
  MEETING_NOTES: "EXECUTIVE_TEAM",
};

const DOC_IMPORTANCE: Partial<Record<DocumentType, number>> = {
  INVESTOR_DECK: 0.2,
  FINANCIAL_MODEL: 0.2,
  BOARD_DOCUMENT: 0.2,
  CUSTOMER_CONTRACT: 0.2,
  FUNDRAISING_MATERIAL: 0.2,
  CUSTOMER_PROPOSAL: 0.12,
  PARTNERSHIP_AGREEMENT: 0.12,
  NDA: 0.08,
  REGULATORY_DOCUMENT: 0.12,
  STRATEGIC_PLAN: 0.12,
  EXPERIMENT_REPORT: 0.08,
  PUBLICATION: 0.08,
  SCIENTIFIC_REPORT: 0.06,
  SCIENTIFIC_DATA_SUMMARY: 0.06,
  EMPLOYEE_DOCUMENT: 0.06,
  MEETING_NOTES: 0.05,
};

const DOC_LABEL: Partial<Record<DocumentType, string>> = {
  INVESTOR_DECK: "Investor deck",
  FINANCIAL_MODEL: "Financial model",
  BOARD_DOCUMENT: "Board document",
  CUSTOMER_CONTRACT: "Customer contract",
  FUNDRAISING_MATERIAL: "Fundraising material",
  CUSTOMER_PROPOSAL: "Customer proposal",
  PARTNERSHIP_AGREEMENT: "Partnership agreement",
  NDA: "NDA",
  REGULATORY_DOCUMENT: "Regulatory document",
  STRATEGIC_PLAN: "Strategic plan",
  EXPERIMENT_REPORT: "Experiment report",
  PUBLICATION: "Publication",
};

const RESTRICTED_DOCS: ReadonlySet<DocumentType> = new Set([
  "BOARD_DOCUMENT", "FINANCIAL_MODEL", "EMPLOYEE_DOCUMENT", "INVESTOR_DECK", "FUNDRAISING_MATERIAL", "NDA", "LEGAL_DOCUMENT", "CUSTOMER_CONTRACT", "PARTNERSHIP_AGREEMENT",
]);

// ─── Meeting category ────────────────────────────────────────────────────────

const MEETING_KW: [RegExp, MeetingCategory][] = [
  [/\bboard\b|\bboD\b/i, "BOARD"],
  [/\b(?:dentist|dental|doctor|pediatrician|school|family|kids?|birthday|anniversary|gym|haircut|personal|vacation|wedding)\b/i, "PERSONAL"],
  [/\b(?:interview|candidate|offer|reference check|recruit\w*)\b/i, "RECRUITING"],
  [/\b(?:diligence|term ?sheet|data ?room|fundrais\w*|series [a-e]|pitch|\bIC\b|investment committee)\b/i, "FUNDRAISING"],
  [/\binvestors?\b/i, "INVESTOR"],
  [/\b(?:QBR|quarterly business review|renewal|kick-?off|onboarding|account review|customer)\b/i, "CUSTOMER"],
  [/\b(?:legal|counsel|contract review|nda|msa|redlines?)\b/i, "LEGAL"],
  [/\b(?:finance|budget|month-end|close|audit|forecast)\b/i, "FINANCE"],
  [/\b(?:product|roadmap|sprint|demo|release|launch|cardiopredict)\b/i, "PRODUCT"],
  [/\b(?:science|scientific|data review|assay|readout|lab|dataset|heartready|validation|journal club)\b/i, "SCIENTIFIC"],
  [/\b(?:sales|pipeline review|proposal|pricing)\b/i, "SALES"],
  [/\b(?:partner(?:ship)?|collaboration)\b/i, "PARTNER"],
  [/\b(?:1:1|1-1|one[- ]on[- ]one|stand-?up|all[- ]hands|staff meeting|leadership|exec(?:utive)? team|offsite|weekly sync|team sync)\b/i, "INTERNAL_LEADERSHIP"],
  [/\b(?:lunch|coffee|dinner|drinks|breakfast|meetup|conference|networking|reception)\b/i, "NETWORKING"],
];

export function meetingCategoryFor(f: ClassifyFacts): MeetingCategory {
  const title = f.title;
  const kw = (cat: MeetingCategory) => MEETING_KW.some(([re, c]) => c === cat && re.test(title));
  const others = f.participants.filter((p) => !p.isCeo);
  const external = others.filter((p) => !p.internal);
  const types = new Set(external.map((p) => p.person?.type));
  const companies = new Set(external.map((p) => p.company?.type).filter(Boolean) as CompanyType[]);

  if (kw("BOARD") && (types.has("BOARD") || !external.length || /\bboard (?:meeting|call|session|dinner)\b/i.test(title))) return "BOARD";
  if (kw("PERSONAL") && !companies.size && !types.has("BOARD") && !types.has("INVESTOR")) return "PERSONAL";
  if (types.has("CANDIDATE") || (kw("RECRUITING") && !companies.size)) return "RECRUITING";
  if (types.has("BOARD") && !companies.has("CUSTOMER") && !companies.has("PROSPECT")) return "BOARD";
  if (companies.has("INVESTOR") || types.has("INVESTOR")) return kw("FUNDRAISING") && !/\binvestor\b/i.test(title) ? "FUNDRAISING" : "INVESTOR";
  if (companies.has("CUSTOMER")) return "CUSTOMER";
  if (companies.has("PROSPECT")) return "SALES";
  if (companies.has("ACADEMIC")) return kw("SCIENTIFIC") || KW.scientific.test(title) ? "SCIENTIFIC" : "PARTNER";
  if (companies.has("PARTNER")) return "PARTNER";
  for (const [re, cat] of MEETING_KW) {
    if (!re.test(title)) continue;
    if (cat === "NETWORKING" && !external.length) continue;
    return cat;
  }
  if (external.length) return companies.has("VENDOR") ? "OTHER" : "NETWORKING";
  return others.length ? "INTERNAL_LEADERSHIP" : "OTHER";
}

const MEETING_TO_CATEGORY: Partial<Record<MeetingCategory, CeoCategory>> = {
  INVESTOR: "INVESTOR",
  FUNDRAISING: "FUNDRAISING",
  CUSTOMER: "CUSTOMER",
  BOARD: "BOARD",
  SALES: "COMMERCIAL_OPPORTUNITY",
  PARTNER: "STRATEGIC_PARTNER",
  RECRUITING: "RECRUITING",
  LEGAL: "LEGAL",
  FINANCE: "FINANCE",
  SCIENTIFIC: "SCIENTIFIC_LEADERSHIP",
  INTERNAL_LEADERSHIP: "EXECUTIVE_TEAM",
  PRODUCT: "EXECUTIVE_TEAM",
  PERSONAL: "PERSONAL",
};

const IMPORTANT_MEETINGS: ReadonlySet<MeetingCategory> = new Set(["INVESTOR", "CUSTOMER", "BOARD", "PARTNER", "LEGAL", "SALES", "FUNDRAISING"]);
const SENIOR_TITLE = /\b(?:partner|managing|chief|ceo|cfo|coo|cso|cto|president|founder|vp|vice president|head|director|board)\b/i;

// ─── Activity tags ───────────────────────────────────────────────────────────

type ActivityTag = (typeof ACTIVITY_TAGS)[number];

const TAG_KW: [RegExp, ActivityTag][] = [
  [KW.fundraising, "FUNDRAISING"],
  [/\b(?:customer|pilot|proposal|pricing|renewal|msa|contract|purchase order|deal|expansion|rfp|sales)\b/i, "COMMERCIAL"],
  [KW.scientific, "SCIENTIFIC"],
  [KW.legal, "LEGAL"],
  [/\b(?:soc ?2|operations?|logistics|shipment|supply|vendor|facilit\w*|it security|compliance)\b/i, "OPERATIONAL"],
  [/\b(?:budget|burn|runway|invoice|revenue|arr|forecast|cash|audit)\b/i, "FINANCIAL"],
  [KW.recruiting, "RECRUITING"],
  [/\b(?:cardiopredict|product|release|roadmap|api|platform|feature|cytohub\.ai)\b/i, "PRODUCT"],
  [/\bboard\b/i, "BOARD"],
  [/\b(?:partner(?:ship)?|collaborat\w*|alliance)\b/i, "PARTNERSHIP"],
  [/\b(?:fda|ind\b|pre-ind|regulatory|ema\b|gxp|glp)\b/i, "REGULATORY"],
];

const CATEGORY_TAG: Partial<Record<CeoCategory, ActivityTag>> = {
  INVESTOR: "FUNDRAISING",
  FUNDRAISING: "FUNDRAISING",
  CUSTOMER: "COMMERCIAL",
  COMMERCIAL_OPPORTUNITY: "COMMERCIAL",
  STRATEGIC_PARTNER: "PARTNERSHIP",
  BOARD: "BOARD",
  LEGAL: "LEGAL",
  FINANCE: "FINANCIAL",
  RECRUITING: "RECRUITING",
  SCIENTIFIC_LEADERSHIP: "SCIENTIFIC",
  MAJOR_VENDOR: "OPERATIONAL",
  OPERATIONS: "OPERATIONAL",
};

function activityTags(category: CeoCategory, text: string): ActivityTag[] {
  const tags: ActivityTag[] = [];
  const first = CATEGORY_TAG[category];
  if (first) tags.push(first);
  for (const [re, tag] of TAG_KW) if (!tags.includes(tag) && re.test(text)) tags.push(tag);
  return tags.slice(0, 6);
}

// ─── Noise ───────────────────────────────────────────────────────────────────

function detectNoise(f: ClassifyFacts): { category: CeoCategory; reason: string } | null {
  const e = f.email;
  if (!e || e.direction === "OUTBOUND") return null;
  const head = `${f.title}\n${f.text.slice(0, 4000)}`;
  const labels = e.labels.map((l) => l.toUpperCase());
  const sender = f.participants.find((p) => p.role === "SENDER");
  const automatedAddress = /^(?:no-?reply|do-?not-?reply|donotreply|notifications?|notify|alerts?|mailer-daemon|newsletters?|news|digest|marketing|updates|receipts?|invoices?|calendar-notification)\b/i.test(e.fromEmail.split("@")[0] ?? "");

  let category: CeoCategory | null = null;
  let reason = "";
  if (labels.includes("SPAM") || NOISE.spam.test(head)) [category, reason] = ["SPAM", "Looks like spam"];
  else if (NOISE.marketing.test(f.title) || labels.includes("CATEGORY_PROMOTIONS")) [category, reason] = ["MARKETING", "Marketing email"];
  else if (NOISE.newsletter.test(f.title) || (NOISE.unsubscribe.test(head) && !KW.request.test(head))) [category, reason] = ["NEWSLETTER", "Newsletter or mailing list"];
  else if (NOISE.notification.test(f.title) || labels.includes("CATEGORY_UPDATES") || labels.includes("CATEGORY_SOCIAL") || labels.includes("CATEGORY_FORUMS")) [category, reason] = ["NOTIFICATION", "Automated notification"];
  else if (NOISE.marketing.test(head) && NOISE.unsubscribe.test(head)) [category, reason] = ["MARKETING", "Marketing email"];
  else if (e.isAutomated || automatedAddress) [category, reason] = ["NOTIFICATION", "Automated sender"];
  if (!category) return null;

  // A real person the CEO works with is never noise, whatever the email looks like.
  const known = sender?.person && sender.person.type !== "OTHER" && !automatedAddress;
  if (known && category !== "SPAM") return null;
  return { category, reason };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

function maxSensitivity(a: Sensitivity, b: Sensitivity): Sensitivity {
  return SENSITIVITY_RANK[a] >= SENSITIVITY_RANK[b] ? a : b;
}

function asksCeo(f: ClassifyFacts): boolean {
  const e = f.email;
  if (!e || e.direction === "OUTBOUND") return false;
  const vocative = f.ceoFirstName && new RegExp(`(?:^|\\n)\\s*(?:hi|hello|hey|dear)?\\s*${escapeRe(f.ceoFirstName)}\\b`, "i").test(f.text);
  if (!e.ceoInTo && !vocative) return false;
  return splitSentences(f.text.slice(0, 6000)).some((s) => KW.request.test(s.text) || (/\?\s*$/.test(s.text) && /\byou(?:r)?\b/i.test(s.text)));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function classifyFacts(f: ClassifyFacts): Classification {
  const fullText = `${f.title}\n${f.text.slice(0, 20_000)}`;
  const scientific = KW.scientific.test(fullText);
  const reasons: string[] = [];
  const isEvent = f.kind === "CALENDAR_EVENT";
  const isDoc = Boolean(f.document) || f.kind === "DOCUMENT" || f.kind === "MEETING_NOTES";

  const noise = detectNoise(f);
  if (noise) {
    return {
      relevance: "NOISE",
      relevanceScore: noise.category === "SPAM" ? 0 : 0.05,
      category: noise.category,
      reasons: [noise.reason],
      sensitivity: f.defaultSensitivity,
      isNoise: true,
      meetingCategory: null,
      docType: null,
      docTypeConfidence: null,
      activityTags: [],
    };
  }

  // Document type and meeting category first: they inform the category.
  const doc = isDoc ? (f.kind === "MEETING_NOTES" ? { type: "MEETING_NOTES" as DocumentType, confidence: 0.95 } : detectDocType(f.title, f.document?.path ?? null, f.text, f.document?.format ?? null)) : null;
  const meetingCategory = isEvent ? meetingCategoryFor(f) : null;

  const picked = pickCategory(f, scientific);
  let category: CeoCategory = picked?.category ?? "OTHER";
  if (picked?.reason) reasons.push(picked.reason);
  const strongPick = picked && picked.rank >= 4;

  if (isEvent && meetingCategory && (!strongPick || meetingCategory === "BOARD")) {
    const mapped = MEETING_TO_CATEGORY[meetingCategory];
    if (mapped && (WEAK.has(category) || meetingCategory === "BOARD" || meetingCategory === "PERSONAL")) category = mapped;
  }
  if (doc && doc.type !== "OTHER" && !strongPick) {
    const mapped = DOC_CATEGORY[doc.type];
    if (mapped && WEAK.has(category)) category = mapped;
  }

  // Keyword overlays.
  const others = f.participants.filter((p) => !p.isCeo);
  const allInternal = others.length > 0 ? others.every((p) => p.internal) : !f.mentionedCompanies.length;
  const escalation = KW.escalation.test(fullText);
  // Typed documents keep the category their type implies; keyword overlays refine everything else.
  const typedDoc = doc != null && doc.type !== "OTHER" && doc.type !== "MEETING_NOTES" && doc.type !== "INTERNAL_MEMO";
  if (allInternal && escalation && category !== "BOARD" && !isDoc) {
    category = "INTERNAL_ESCALATION";
  } else if (WEAK.has(category) && KW.board.test(fullText) && !typedDoc) {
    category = "BOARD";
  } else if (WEAK.has(category) && (KW.fundraising.test(fullText) || KW.ic.test(fullText)) && !typedDoc) {
    category = "FUNDRAISING";
    reasons.push("Fundraising");
  } else if (WEAK.has(category) && legalHits(fullText) >= (isDoc ? 2 : 1) && !isEvent && !typedDoc) {
    category = "LEGAL";
  } else if ((category === "OTHER" || (isEvent && meetingCategory === "PERSONAL")) && KW.personal.test(fullText) && !strongPick) {
    category = "PERSONAL";
    reasons.push("Personal");
  } else if (WEAK.has(category) && !typedDoc && /\b(?:candidate|job offer|offer letter|interview)\b/i.test(fullText)) {
    category = "RECRUITING";
  } else if (category === "OTHER" && KW.finance.test(fullText)) {
    category = "FINANCE";
  }
  if (escalation) reasons.push("Escalation language");

  // ── Relevance ──
  let score = CATEGORY_WEIGHT[category];
  const e = f.email;
  if (e) {
    if (e.direction === "OUTBOUND") {
      score += 0.05;
    } else if (e.ceoInTo) {
      score += 0.1;
      reasons.push("Sent to you directly");
    } else if (e.ceoInCc) {
      score -= 0.05;
      reasons.push("You're cc'd");
    }
    if (e.ceoInThread && e.direction !== "OUTBOUND") {
      score += 0.05;
      reasons.push("You're in this thread");
    }
    if (e.recipientCount > 8) score -= 0.05;
    if (e.isAutomated) score -= 0.05;
  }
  if (asksCeo(f)) {
    score += 0.12;
    reasons.push("Asks you directly");
  }
  if (escalation) score += 0.12;

  const due = findDates(f.text.slice(0, 6000), f.occurredAt, f.timezone).find((d) => d.hard) ?? null;
  if (due && !isEvent) {
    score += 0.08;
    reasons.push(`Deadline: ${due.text.replace(/^(?:(?:no|not) later than|by|on|before|until|till|due(?:\s+(?:on|by))?|deadline(?:\s+(?:is|of))?:?)\s+/i, "")}`);
  }
  const money = firstMoney(f.text.slice(0, 6000));
  if (money) {
    score += 0.05;
    reasons.push(`Mentions ${money.text}`);
  }

  if (isEvent && f.event) {
    const seniorExternal = others.filter((p) => !p.internal && p.person?.title && SENIOR_TITLE.test(p.person.title));
    if (seniorExternal.length) {
      score += 0.1;
      reasons.push(`Senior external attendee${seniorExternal.length > 1 ? "s" : ""}: ${seniorExternal.slice(0, 2).map((p) => p.person?.name ?? p.name).join(", ")}`);
    }
    if (meetingCategory && IMPORTANT_MEETINGS.has(meetingCategory)) score += 0.1;
    if (f.event.ceoIsOrganizer) score += 0.03;
    if (f.event.status === "CANCELLED") {
      score -= 0.15;
      reasons.push("Cancelled");
    }
    if (f.event.ceoResponse === "DECLINED") {
      score -= 0.15;
      reasons.push("You declined");
    }
    if (f.event.isRecurring && meetingCategory === "INTERNAL_LEADERSHIP") score -= 0.05;
  }
  if (doc && doc.type !== "OTHER") {
    score += (DOC_IMPORTANCE[doc.type] ?? 0) * doc.confidence;
    const label = DOC_LABEL[doc.type];
    if (label) reasons.push(label);
  }
  score = Math.round(Math.min(1, Math.max(0, score)) * 100) / 100;

  // ── Sensitivity ──
  let sensitivity = f.defaultSensitivity;
  const restricted =
    category === "BOARD" ||
    category === "LEGAL" ||
    category === "FUNDRAISING" ||
    category === "PERSONAL" ||
    (category === "INVESTOR" && KW.termSheet.test(fullText)) ||
    ((category === "RECRUITING" || others.some((p) => p.person?.type === "CANDIDATE")) && (KW.compensation.test(fullText) || /\boffer\b/i.test(fullText))) ||
    KW.compensation.test(f.title) ||
    (doc != null && RESTRICTED_DOCS.has(doc.type) && doc.confidence >= 0.6) ||
    meetingCategory === "BOARD";
  if (restricted) sensitivity = maxSensitivity(sensitivity, "RESTRICTED");

  return {
    relevance: relevanceFromScore(score),
    relevanceScore: score,
    category,
    reasons: dedupe(reasons).slice(0, 8),
    sensitivity,
    isNoise: false,
    meetingCategory,
    docType: doc && f.document ? doc.type : null,
    docTypeConfidence: doc && f.document ? doc.confidence : null,
    activityTags: activityTags(category, fullText),
  };
}

/** Distinct legal terms in the text (one passing "clause" in meeting notes is not a legal matter). */
function legalHits(text: string): number {
  const g = new RegExp(KW.legal.source, "gi");
  return new Set((text.match(g) ?? []).map((m) => m.toLowerCase())).size;
}

function dedupe(list: string[]): string[] {
  return [...new Set(list.filter(Boolean))];
}

