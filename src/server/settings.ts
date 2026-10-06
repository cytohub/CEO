import type { Db, Tx } from "@/lib/db";
import { DEFAULT_WEIGHTS, normalizeWeights, type PriorityWeights } from "@/server/brain/scoring";

/** Tunable thresholds the Brain uses to decide what deserves CEO attention. */
export interface BrainThresholds {
  /** Open deal with no activity for this many days is "slowing". */
  dealStaleDays: number;
  /** Delegation without an update for this many days needs follow-up. */
  delegationFollowUpDays: number;
  /** Investor in an active raise not contacted for this many days needs follow-up. */
  investorFollowUpDays: number;
  /** Runway (months) below which the Brain raises a risk. */
  runwayAlertMonths: number;
  /** Relative gap between actual and recommended attention that is flagged. */
  attentionTolerance: number;
  /** Trailing window (days) used to measure actual CEO attention. */
  attentionWindowDays: number;
  /** Milestones due within this many days are "due soon". */
  milestoneDueSoonDays: number;
}

export const DEFAULT_THRESHOLDS: BrainThresholds = {
  dealStaleDays: 14,
  delegationFollowUpDays: 5,
  investorFollowUpDays: 10,
  runwayAlertMonths: 18,
  attentionTolerance: 0.35,
  attentionWindowDays: 14,
  milestoneDueSoonDays: 14,
};

type Client = Db | Tx;

async function getSetting<T>(client: Client, key: string): Promise<T | null> {
  const row = await client.appSetting.findUnique({ where: { key } });
  return (row?.value as T | undefined) ?? null;
}

export async function getPriorityWeights(client: Client): Promise<PriorityWeights> {
  const stored = await getSetting<Partial<PriorityWeights>>(client, "priorityWeights");
  return normalizeWeights(stored ?? DEFAULT_WEIGHTS);
}

export async function getThresholds(client: Client): Promise<BrainThresholds> {
  const stored = await getSetting<Partial<BrainThresholds>>(client, "brainThresholds");
  return { ...DEFAULT_THRESHOLDS, ...(stored ?? {}) };
}

export async function setSetting(client: Client, key: string, value: unknown) {
  await client.appSetting.upsert({
    where: { key },
    create: { key, value: value as object },
    update: { value: value as object },
  });
}
