/**
 * Priority inputs for work the Brain extracts. Pure: the CEO Priority Score
 * (src/server/brain/scoring.ts) turns these 0–5 ratings into a rank; this
 * module decides the ratings from the source's category, the companies and
 * money involved, and whether the CEO was asked personally.
 */
import type { CeoCategory, CompanyType, FocusArea, Priority, Relevance } from "@/generated/prisma/enums";

export const FOCUS_BY_CATEGORY: Partial<Record<CeoCategory, FocusArea>> = {
  INVESTOR: "FUNDRAISING",
  FUNDRAISING: "FUNDRAISING",
  CUSTOMER: "CUSTOMERS",
  COMMERCIAL_OPPORTUNITY: "REVENUE",
  STRATEGIC_PARTNER: "PARTNERSHIPS",
  LEGAL: "LEGAL",
  FINANCE: "FINANCE",
  RECRUITING: "RECRUITING",
  SCIENTIFIC_LEADERSHIP: "SCIENCE",
  BOARD: "STRATEGY",
  EXECUTIVE_TEAM: "TEAM",
  INTERNAL_ESCALATION: "OPERATIONS",
  OPERATIONS: "OPERATIONS",
  MAJOR_VENDOR: "OPERATIONS",
};

export function focusAreaFor(category: CeoCategory, hint?: FocusArea | null): FocusArea {
  return hint ?? FOCUS_BY_CATEGORY[category] ?? "OPERATIONS";
}

const HARD = /\b(no later than|deadline|hard (stop|deadline)|must|at the latest|latest by|cut-?off|eod|end of (the )?day|close of business|cob|before the (board|meeting|call|close|signing)|strict(ly)?|non-negotiable|expires?|due (on|by)|without fail|absolutely need)\b/i;

/** Firm external dates ("no later than", "deadline", "must…by") versus soft ones ("sometime next week"). */
export function isHardDeadline(...texts: (string | null | undefined)[]): boolean {
  return texts.some((t) => !!t && HARD.test(t));
}

export function defaultPriority(relevance: Relevance, hint?: Priority | null): Priority {
  if (hint) return hint;
  return relevance === "CRITICAL" || relevance === "HIGH" ? "P1" : "P2";
}

export interface TaskScoreInput {
  category: CeoCategory;
  /** extraction.strategicRelevance.score, 0–1 */
  strategicScore: number;
  goalMatched: boolean;
  companyType: CompanyType | null;
  /** 1–5 */
  companyRelationship: number | null;
  /** Open deal of the company, USD. */
  dealValue: number | null;
  dealType: "SALES" | "FUNDRAISING" | "PARTNERSHIP" | null;
  /** Largest MONEY fact in the source, USD. */
  moneyMax: number | null;
  /** Highest risk severity extracted (1–5). */
  maxRiskSeverity: number | null;
  hard: boolean;
  ownerIsCeo: boolean;
  /** The CEO was asked personally (sole recipient, named, or their own promise). */
  askedPersonally: boolean;
  dueInDays: number | null;
  scientific: boolean;
}

export interface TaskScoresT {
  strategicImpact: number;
  revenueImpact: number;
  fundraisingImpact: number;
  customerImpact: number;
  scientificImpact: number;
  riskLevel: number;
  ceoUniqueness: number;
  opportunityCost: number;
}

const clamp = (n: number, lo = 0, hi = 5) => Math.max(lo, Math.min(hi, Math.round(n)));

const STRATEGIC_FLOOR: Partial<Record<CeoCategory, number>> = {
  INVESTOR: 4,
  FUNDRAISING: 4,
  BOARD: 4,
  CUSTOMER: 3,
  STRATEGIC_PARTNER: 3,
  COMMERCIAL_OPPORTUNITY: 3,
  LEGAL: 3,
  SCIENTIFIC_LEADERSHIP: 3,
  INTERNAL_ESCALATION: 3,
};

function moneyRating(v: number | null): number {
  if (!v || v <= 0) return 0;
  if (v >= 1_000_000) return 5;
  if (v >= 300_000) return 4;
  if (v >= 100_000) return 3;
  return 2;
}

export function taskScores(i: TaskScoreInput): TaskScoresT {
  const strategic = Math.max(1 + 4 * Math.max(0, Math.min(1, i.strategicScore)), STRATEGIC_FLOOR[i.category] ?? 2) + (i.goalMatched ? 1 : 0);

  const commercial = i.category === "CUSTOMER" || i.category === "COMMERCIAL_OPPORTUNITY" || i.companyType === "CUSTOMER" || i.companyType === "PROSPECT";
  const salesValue = i.dealType === "FUNDRAISING" ? null : i.dealValue;
  const revenue = commercial ? Math.max(3, moneyRating(salesValue), moneyRating(i.moneyMax)) : Math.max(0, moneyRating(salesValue) - 1);

  const investor = i.category === "INVESTOR" || i.category === "FUNDRAISING" || i.companyType === "INVESTOR";
  const roundValue = i.dealType === "FUNDRAISING" ? i.dealValue : null;
  const fundraising = investor ? ((roundValue ?? 0) >= 5_000_000 ? 5 : 4) : i.category === "BOARD" ? 3 : 0;

  const customer =
    i.companyType === "CUSTOMER" ? ((i.companyRelationship ?? 3) >= 5 ? 5 : 4) : i.companyType === "PROSPECT" ? 3 : i.category === "CUSTOMER" ? 3 : 0;

  const scientific = i.scientific || i.category === "SCIENTIFIC_LEADERSHIP" ? 3 : 0;
  const risk = (i.maxRiskSeverity ?? 2) + (i.hard ? 1 : 0);

  const uniqueness = i.ownerIsCeo ? (i.askedPersonally ? 5 : 4) : 2;
  const opportunity = Math.max(i.dueInDays != null && i.dueInDays <= 7 ? 3 : 2, moneyRating(i.dealValue) >= 5 ? 4 : 0);

  return {
    strategicImpact: clamp(strategic, 1),
    revenueImpact: clamp(revenue),
    fundraisingImpact: clamp(fundraising),
    customerImpact: clamp(customer),
    scientificImpact: clamp(scientific),
    riskLevel: clamp(risk, 1),
    ceoUniqueness: clamp(uniqueness),
    opportunityCost: clamp(opportunity),
  };
}
