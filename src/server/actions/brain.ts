"use server";

import { z } from "zod";
import { InsightStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { runBrainRefresh, type RefreshOutcome } from "@/server/brain/refresh";
import { searchWorkspace, type SearchHit, type SearchHitType } from "@/server/brain/search";
import { getCeoContext } from "@/server/context";
import { logActivity, revalidateAll } from "@/server/mutations";
import { attempt, fail, ok, type ActionResult } from "./result";

export async function runDailyRefresh(): Promise<ActionResult<RefreshOutcome>> {
  return attempt(async () => {
    const running = await db.brainRefresh.findFirst({ where: { status: "RUNNING", startedAt: { gt: new Date(Date.now() - 5 * 60_000) } } });
    if (running) return fail("A refresh is already running.");
    const outcome = await runBrainRefresh({ trigger: "MANUAL" });
    revalidateAll();
    if (outcome.status === "FAILED") return fail(`Refresh failed: ${outcome.error ?? "unknown error"}`);
    return ok(outcome, `Brain refreshed · ${outcome.insightsCreated} new insights`);
  });
}

export async function searchBrain(query: string, types?: SearchHitType[]): Promise<SearchHit[]> {
  const q = z.string().max(200).parse(query);
  return searchWorkspace(q, { limitPerType: types ? 12 : 5, types });
}

export async function markBriefReviewed(): Promise<ActionResult> {
  return attempt(async () => {
    const ceo = await getCeoContext();
    const now = new Date();
    await db.dailyBrief.updateMany({ where: { date: ceo.today }, data: { reviewedAt: now } });
    await db.dayPlan.upsert({ where: { date: ceo.today }, create: { date: ceo.today, briefReviewedAt: now }, update: { briefReviewedAt: now } });
    await db.brainInsight.updateMany({ where: { status: "NEW", createdAt: { lte: now } }, data: { status: "ACKNOWLEDGED" } });
    revalidateAll();
    return ok(undefined, "Brief marked as reviewed");
  });
}

export async function setInsightStatus(insightId: string, status: InsightStatus): Promise<ActionResult> {
  return attempt(async () => {
    z.enum(InsightStatus).parse(status);
    const insight = await db.brainInsight.update({ where: { id: insightId }, data: { status } });
    if (status === "DISMISSED") {
      await db.inboxItem.updateMany({ where: { insightId, status: { in: ["OPEN", "SNOOZED"] } }, data: { status: "DISMISSED", resolvedAt: new Date(), resolution: "Insight dismissed" } });
    }
    await logActivity(db, { type: "INBOX_RESOLVED", summary: `Insight ${status.toLowerCase()}: ${insight.title}`, actor: "CEO" });
    revalidateAll();
    return ok(undefined);
  });
}
