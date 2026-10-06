/**
 * CEO Priority Score.
 *
 * Ranks work by what matters most for CytoHub *and* what requires the CEO
 * personally — never by deadline alone. Pure and deterministic so the Brain,
 * the UI and tests all agree on the same number.
 *
 *   score = Σ weightᵢ · factorᵢ/5         (0–100, weights sum to 100)
 *           × modifiers (manual priority, goal health, delegability, blocked)
 *           + slippage bonus (repeatedly postponed work resurfaces)
 */
import type { GoalStatus, MilestoneStatus, Priority, TaskStatus } from "@/generated/prisma/enums";
import { daysBetween } from "@/lib/dates";

export const FACTOR_KEYS = [
  "strategic",
  "urgency",
  "revenue",
  "fundraising",
  "customer",
  "scientific",
  "risk",
  "dependency",
  "uniqueness",
  "deadline",
  "opportunity",
] as const;

export type FactorKey = (typeof FACTOR_KEYS)[number];
export type PriorityWeights = Record<FactorKey, number>;

export const FACTOR_META: Record<FactorKey, { label: string; description: string; derived: boolean }> = {
  strategic: { label: "Strategic impact", description: "How much this moves CytoHub's strategic pillars.", derived: false },
  urgency: { label: "Urgency", description: "Time pressure from the due date (or the linked milestone).", derived: true },
  revenue: { label: "Revenue impact", description: "Effect on bookings, ARR or pharma contracts.", derived: false },
  fundraising: { label: "Fundraising impact", description: "Effect on the current raise or investor relationships.", derived: false },
  customer: { label: "Customer impact", description: "Effect on customer success, retention or expansion.", derived: false },
  scientific: { label: "Scientific impact", description: "Effect on the science, data and therapeutic programs.", derived: false },
  risk: { label: "Risk", description: "Downside if this slips or goes wrong.", derived: false },
  dependency: { label: "Dependency", description: "Work, people or milestones waiting on this.", derived: true },
  uniqueness: { label: "CEO uniqueness", description: "Whether only the CEO can do this. Delegable work ranks lower.", derived: false },
  deadline: { label: "Deadline firmness", description: "Hard external commitments outrank soft internal dates.", derived: true },
  opportunity: { label: "Opportunity cost", description: "Value lost for every day this waits.", derived: false },
};

export const DEFAULT_WEIGHTS: PriorityWeights = {
  strategic: 16,
  urgency: 12,
  revenue: 10,
  fundraising: 10,
  customer: 7,
  scientific: 6,
  risk: 8,
  dependency: 7,
  uniqueness: 13,
  deadline: 5,
  opportunity: 6,
};

export interface ScoreInput {
  status: TaskStatus;
  priority: Priority;
  strategicImpact: number;
  revenueImpact: number;
  fundraisingImpact: number;
  customerImpact: number;
  scientificImpact: number;
  riskLevel: number;
  ceoUniqueness: number;
  opportunityCost: number;
  dueDate: Date | null;
  hardDeadline: boolean;
  postponeCount: number;
  /** Open tasks that depend on this one. */
  blocksCount: number;
  milestone?: { title: string; dueDate: Date; status: MilestoneStatus } | null;
  goal?: { title: string; status: GoalStatus } | null;
}

export interface FactorScore {
  key: FactorKey;
  label: string;
  value: number; // 0–5
  weight: number;
  points: number; // contribution to the base score
}

export interface ScoreModifier {
  label: string;
  /** Multiplier (e.g. 1.08) or additive points when `kind` is "points". */
  value: number;
  kind: "multiplier" | "points";
}

export interface ScoreBreakdown {
  score: number;
  base: number;
  factors: FactorScore[];
  modifiers: ScoreModifier[];
  drivers: FactorKey[];
  requiresCeo: boolean;
  delegable: boolean;
  rationale: string;
}

const clamp5 = (n: number) => Math.max(0, Math.min(5, n));

export function urgencyFromDays(days: number | null): number {
  if (days === null) return 0.5;
  if (days <= 0) return 5;
  if (days === 1) return 4.5;
  if (days <= 3) return 4;
  if (days <= 7) return 3;
  if (days <= 14) return 2;
  if (days <= 30) return 1;
  return 0.5;
}

export function normalizeWeights(weights: Partial<PriorityWeights> | null | undefined): PriorityWeights {
  const merged = { ...DEFAULT_WEIGHTS, ...(weights ?? {}) };
  const total = FACTOR_KEYS.reduce((s, k) => s + Math.max(0, merged[k]), 0);
  if (total <= 0) return { ...DEFAULT_WEIGHTS };
  const out = {} as PriorityWeights;
  for (const k of FACTOR_KEYS) out[k] = (Math.max(0, merged[k]) / total) * 100;
  return out;
}

export function scoreTask(input: ScoreInput, today: Date, weights: PriorityWeights = DEFAULT_WEIGHTS): ScoreBreakdown {
  const w = normalizeWeights(weights);

  const dueDays = input.dueDate ? daysBetween(today, input.dueDate) : null;
  const msDays = input.milestone ? daysBetween(today, input.milestone.dueDate) : null;
  // A task feeding a milestone inherits some of the milestone's time pressure.
  const effectiveDays =
    dueDays === null ? (msDays === null ? null : msDays + 7) : msDays === null ? dueDays : Math.min(dueDays, msDays + 7);

  const milestoneAtRisk = input.milestone && ["AT_RISK", "BLOCKED"].includes(input.milestone.status);
  const dependency = clamp5(
    input.blocksCount * 1.5 + (msDays !== null && msDays <= 14 ? 2 : msDays !== null && msDays <= 30 ? 1 : 0) + (milestoneAtRisk ? 1 : 0),
  );

  const values: Record<FactorKey, number> = {
    strategic: clamp5(input.strategicImpact),
    urgency: urgencyFromDays(effectiveDays),
    revenue: clamp5(input.revenueImpact),
    fundraising: clamp5(input.fundraisingImpact),
    customer: clamp5(input.customerImpact),
    scientific: clamp5(input.scientificImpact),
    risk: clamp5(input.riskLevel),
    dependency,
    uniqueness: clamp5(input.ceoUniqueness),
    deadline: input.hardDeadline ? 5 : input.dueDate ? 2 : 0,
    opportunity: clamp5(input.opportunityCost),
  };

  const factors: FactorScore[] = FACTOR_KEYS.map((key) => ({
    key,
    label: FACTOR_META[key].label,
    value: values[key],
    weight: Math.round(w[key] * 10) / 10,
    points: Math.round(((w[key] * values[key]) / 5) * 10) / 10,
  }));
  const base = factors.reduce((s, f) => s + f.points, 0);

  const modifiers: ScoreModifier[] = [];
  const priorityMult: Record<Priority, number> = { P0: 1.1, P1: 1.04, P2: 1, P3: 0.85 };
  if (input.priority !== "P2") {
    modifiers.push({ label: `Manual priority ${input.priority}`, value: priorityMult[input.priority], kind: "multiplier" });
  }
  if (input.goal && (input.goal.status === "AT_RISK" || input.goal.status === "OFF_TRACK")) {
    modifiers.push({ label: `Supports an ${input.goal.status === "OFF_TRACK" ? "off-track" : "at-risk"} goal`, value: 1.05, kind: "multiplier" });
  }
  const delegable = input.ceoUniqueness <= 2;
  if (delegable) modifiers.push({ label: "Delegable — CEO not uniquely required", value: 0.85, kind: "multiplier" });
  if (input.status === "BLOCKED") modifiers.push({ label: "Blocked", value: 0.93, kind: "multiplier" });
  if (input.status === "WAITING") modifiers.push({ label: "Waiting on others", value: 0.8, kind: "multiplier" });
  if (input.postponeCount >= 3) {
    modifiers.push({ label: `Postponed ${input.postponeCount}× — decide: do, delegate or drop`, value: 3, kind: "points" });
  }

  let score = base;
  for (const m of modifiers) score = m.kind === "multiplier" ? score * m.value : score + m.value;
  score = Math.max(0, Math.min(100, Math.round(score * 10) / 10));

  const drivers = [...factors]
    .filter((f) => f.value >= 3)
    .sort((a, b) => b.points - a.points)
    .slice(0, 3)
    .map((f) => f.key);

  return {
    score,
    base: Math.round(base * 10) / 10,
    factors,
    modifiers,
    drivers,
    requiresCeo: input.ceoUniqueness >= 4,
    delegable,
    rationale: buildRationale(input, drivers, dueDays, values),
  };
}

function buildRationale(
  input: ScoreInput,
  drivers: FactorKey[],
  dueDays: number | null,
  values: Record<FactorKey, number>,
): string {
  const phrases: string[] = [];
  for (const d of drivers) {
    switch (d) {
      case "strategic":
        phrases.push(input.goal ? `high strategic leverage on “${input.goal.title}”` : "high strategic leverage");
        break;
      case "urgency":
        if (dueDays !== null && dueDays < 0) phrases.push(`${-dueDays} day${dueDays === -1 ? "" : "s"} overdue`);
        else if (dueDays === 0) phrases.push("due today");
        else if (dueDays !== null && dueDays <= 7) phrases.push(`due in ${dueDays} day${dueDays === 1 ? "" : "s"}`);
        else if (input.milestone) phrases.push(`feeds “${input.milestone.title}”`);
        break;
      case "revenue":
        phrases.push("material revenue impact");
        break;
      case "fundraising":
        phrases.push("directly moves the raise");
        break;
      case "customer":
        phrases.push("customer relationship at stake");
        break;
      case "scientific":
        phrases.push("advances the science");
        break;
      case "risk":
        phrases.push("significant downside if it slips");
        break;
      case "dependency":
        phrases.push(input.blocksCount > 0 ? `unblocks ${input.blocksCount} other item${input.blocksCount === 1 ? "" : "s"}` : "a milestone depends on it");
        break;
      case "uniqueness":
        phrases.push("requires you personally");
        break;
      case "deadline":
        phrases.push("hard external deadline");
        break;
      case "opportunity":
        phrases.push("value decays with every day of delay");
        break;
    }
  }
  if (phrases.length === 0) phrases.push("steady contribution to company goals");
  let text = phrases.join(", ");
  text = text.charAt(0).toUpperCase() + text.slice(1) + ".";
  if (values.uniqueness <= 2) text += " Consider delegating.";
  if (input.postponeCount >= 3) text += ` Postponed ${input.postponeCount} times.`;
  return text;
}
