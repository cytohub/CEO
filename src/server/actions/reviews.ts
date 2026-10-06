"use server";

import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { ReviewType } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { addDays, endOfMonth, formatDay, formatMonth, parseDayInput, startOfMonth, startOfWeek } from "@/lib/dates";
import { getCeoContext } from "@/server/context";
import { logActivity, revalidateAll } from "@/server/mutations";
import { getMonthlyReview, getWeeklyReview, monthlySnapshot, REFLECTION_FIELDS, weeklySnapshot } from "@/server/queries/reviews";
import { attempt, fail, ok, type ActionResult } from "./result";

const reflectionValue = z.string().max(5000, "Keep reflections under 5,000 characters").nullable();

const periodSchema = z.object({
  type: z.enum(ReviewType),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD"),
});

/** Validates the period start and returns the canonical [start, end] for the review type. */
function resolvePeriod(type: ReviewType, periodStart: string): { start: Date; end: Date } | null {
  const day = parseDayInput(periodStart);
  if (!day) return null;
  if (type === "WEEKLY") {
    if (startOfWeek(day).getTime() !== day.getTime()) return null;
    return { start: day, end: addDays(day, 6) };
  }
  if (startOfMonth(day).getTime() !== day.getTime()) return null;
  return { start: day, end: endOfMonth(day) };
}

const saveSchema = periodSchema.extend({
  field: z.enum(REFLECTION_FIELDS),
  value: reflectionValue,
});

/** Autosave one reflection prompt (upserts the Review for the period). */
export async function saveReflection(input: z.input<typeof saveSchema>): Promise<ActionResult<{ savedAt: Date }>> {
  return attempt(async () => {
    const data = saveSchema.parse(input);
    const period = resolvePeriod(data.type, data.periodStart);
    if (!period) return fail(data.type === "WEEKLY" ? "Weekly reviews start on a Monday" : "Monthly reviews start on the 1st");
    const ceo = await getCeoContext();
    if (period.start > ceo.today) return fail("This period hasn’t started yet");
    const value = data.value?.trim() ? data.value.trim() : null;
    const review = await db.review.upsert({
      where: { type_periodStart: { type: data.type, periodStart: period.start } },
      create: { type: data.type, periodStart: period.start, periodEnd: period.end, [data.field]: value },
      update: { [data.field]: value },
    });
    // Reflection text only affects this page; the client keeps its own state, so
    // skip a full revalidation on every blur.
    return ok({ savedAt: review.updatedAt });
  });
}

const completeSchema = periodSchema.extend({
  /** Latest reflection values from the form, saved together with the snapshot. */
  reflection: z
    .object({
      whatWorked: reflectionValue.optional(),
      whatDidnt: reflectionValue.optional(),
      learned: reflectionValue.optional(),
      changeNext: reflectionValue.optional(),
    })
    .optional(),
});

/** Complete a review: freeze a snapshot of the generated sections and log it. */
export async function completeReview(input: z.input<typeof completeSchema>): Promise<ActionResult<{ completedAt: Date }>> {
  return attempt(async () => {
    const data = completeSchema.parse(input);
    const period = resolvePeriod(data.type, data.periodStart);
    if (!period) return fail(data.type === "WEEKLY" ? "Weekly reviews start on a Monday" : "Monthly reviews start on the 1st");
    const ceo = await getCeoContext();
    if (period.start > ceo.today) return fail("This period hasn’t started yet");

    const snapshot = data.type === "WEEKLY" ? weeklySnapshot(await getWeeklyReview(period.start)) : monthlySnapshot(await getMonthlyReview(period.start));
    const reflection: Record<string, string | null> = {};
    for (const f of REFLECTION_FIELDS) {
      const v = data.reflection?.[f];
      if (v !== undefined) reflection[f] = v?.trim() ? v.trim() : null;
    }
    const where = { type_periodStart: { type: data.type, periodStart: period.start } };
    const existing = await db.review.findUnique({ where, select: { completedAt: true } });
    // Re-completing refreshes the snapshot but keeps the original completion date.
    const completedAt = existing?.completedAt ?? new Date();
    const json = snapshot as unknown as Prisma.InputJsonValue;
    await db.review.upsert({
      where,
      create: { type: data.type, periodStart: period.start, periodEnd: period.end, ...reflection, snapshot: json, completedAt },
      update: { ...reflection, snapshot: json, completedAt },
    });
    const kind = data.type === "WEEKLY" ? "weekly" : "monthly";
    const label = data.type === "WEEKLY" ? `week of ${formatDay(period.start)}` : formatMonth(period.start);
    await logActivity(db, {
      type: "REVIEW_COMPLETED",
      summary: existing?.completedAt ? `Updated the ${kind} CEO review snapshot (${label})` : `Completed the ${kind} CEO review (${label})`,
      metadata: { reviewType: data.type, periodStart: data.periodStart, stats: snapshot.stats as Prisma.InputJsonValue },
    });
    revalidateAll();
    return ok({ completedAt }, existing?.completedAt ? "Review snapshot updated" : `${kind === "weekly" ? "Weekly" : "Monthly"} review completed`);
  });
}
