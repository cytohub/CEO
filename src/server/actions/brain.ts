"use server";

import { z } from "zod";
import { InsightStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { runBrainRefresh, type RefreshOutcome } from "@/server/brain/refresh";
import { flattenForCommandBar, searchForViewer } from "@/server/ingestion/search";
import { RESULT_TYPES, type SearchResultType } from "@/server/ingestion/search/types";
import { getCeoContext } from "@/server/context";
import { logActivity, revalidateAll } from "@/server/mutations";
import { requireCapability } from "@/server/security/session";
import { attemptAs, fail, ok, type ActionResult } from "./result";

export async function runDailyRefresh(): Promise<ActionResult<RefreshOutcome>> {
  return attemptAs("cockpit.view", async () => {
    const running = await db.brainRefresh.findFirst({ where: { status: "RUNNING", startedAt: { gt: new Date(Date.now() - 5 * 60_000) } } });
    if (running) return fail("A refresh is already running.");
    const outcome = await runBrainRefresh({ trigger: "MANUAL" });
    revalidateAll();
    if (outcome.status === "FAILED") return fail(`Refresh failed: ${outcome.error ?? "unknown error"}`);
    return ok(outcome, `Brain refreshed · ${outcome.insightsCreated} new insights`);
  });
}

export interface CommandSearchHit {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle?: string;
  href: string;
}

export interface CommandSearchResult {
  hits: CommandSearchHit[];
  /** One-line answer for questions (null for plain keyword searches). */
  answer: string | null;
  error?: string;
}

/**
 * Command bar type-ahead over universal search: same planner, same access
 * filters and rate limit as the Search page (no Claude, to stay fast).
 */
export async function searchBrain(query: string, types?: SearchResultType[]): Promise<CommandSearchResult> {
  const viewer = await requireCapability("search.use");
  const q = z.string().max(200).parse(query).trim();
  const filter = z.array(z.enum(RESULT_TYPES as unknown as [SearchResultType, ...SearchResultType[]])).max(20).optional().parse(types);
  if (q.length < 2) return { hits: [], answer: null };
  const outcome = await searchForViewer(viewer, q, { source: "command-bar", limitPerType: filter ? 12 : 4, types: filter, synthesize: false, claudePlanner: false });
  if (!outcome.ok) return { hits: [], answer: null, error: outcome.error };
  const res = outcome.response;
  return {
    hits: flattenForCommandBar(res, 12).map((r) => ({ type: r.type, id: r.id, title: r.title, subtitle: r.subtitle, href: r.href })),
    answer: res.plan.intent === "keyword" || res.plan.intent === "list" ? null : res.answer.text,
  };
}

export async function markBriefReviewed(): Promise<ActionResult> {
  return attemptAs("cockpit.view", async () => {
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
  return attemptAs("brain.view", async () => {
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
