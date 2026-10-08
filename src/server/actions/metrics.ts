"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { formatDay, parseDayInput } from "@/lib/dates";
import { formatMetric } from "@/lib/format";
import { syncGoalProgressFromMetrics } from "@/server/brain/goal-progress";
import { DERIVED_METRICS, isDerived } from "@/server/brain/metrics";
import { getCeoContext } from "@/server/context";
import { logActivity, revalidateAll } from "@/server/mutations";
import { attempt, fail, ok, type ActionResult } from "./result";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
// Generous sanity bound: guards against fat-fingered extra digits, not business rules.
const metricNumber = z.number().refine((v) => Number.isFinite(v) && Math.abs(v) < 1e13, "Enter a valid number");

const recordSchema = z.object({
  recordedAt: day,
  value: metricNumber,
  note: z.string().trim().max(500).nullable().optional(),
});

export type RecordMetricInput = z.input<typeof recordSchema>;

/**
 * Record (or correct) a metric value for a calendar day. One value per metric
 * per day: recording on a day that already has a value replaces it.
 */
export async function recordMetricValue(metricId: string, input: RecordMetricInput): Promise<ActionResult<{ replaced: boolean }>> {
  return attempt(async () => {
    const data = recordSchema.parse(input);
    const metric = await db.metric.findUnique({ where: { id: metricId } });
    if (!metric) return fail("Metric not found");
    if (isDerived(metric.sourceKey)) {
      const how = DERIVED_METRICS[metric.sourceKey]?.description;
      return fail(`${metric.name} is derived from live data${how ? ` (${how})` : ""} and can't be recorded by hand`);
    }
    const recordedAt = parseDayInput(data.recordedAt);
    if (!recordedAt) return fail("Pick a valid date");
    const ceo = await getCeoContext();
    if (recordedAt > ceo.today) return fail("Values can only be recorded for today or earlier");

    const existing = await db.metricValue.findUnique({ where: { metricId_recordedAt: { metricId, recordedAt } } });
    const note = data.note ? data.note : null;
    await db.metricValue.upsert({
      where: { metricId_recordedAt: { metricId, recordedAt } },
      create: { metricId, recordedAt, value: data.value, note, source: "manual" },
      // createdAt doubles as "last entered" for the scoreboard's updated label.
      update: { value: data.value, note, source: "manual", createdAt: new Date() },
    });

    const formatted = formatMetric(data.value, metric.unit);
    await logActivity(db, {
      type: "METRIC_RECORDED",
      summary: existing
        ? `${metric.name} corrected for ${formatDay(recordedAt, true)}: ${formatMetric(existing.value, metric.unit)} → ${formatted}`
        : `${metric.name} recorded for ${formatDay(recordedAt, true)}: ${formatted}`,
      goalId: metric.goalId,
      metadata: {
        metricId,
        metricKey: metric.key,
        recordedAt: data.recordedAt,
        value: data.value,
        previousValue: existing?.value ?? null,
        note,
      },
    });
    await syncGoalProgressFromMetrics(db, (await getCeoContext()).today);
    revalidateAll();
    return ok({ replaced: Boolean(existing) }, existing ? `${metric.name} updated for ${formatDay(recordedAt)}` : `${metric.name} recorded`);
  });
}

const targetSchema = z.object({
  target: metricNumber.nullable(),
  targetDate: day.nullable().optional(),
  /** The goal this metric measures (its progress then follows the metric); null unlinks. */
  goalId: z.string().min(1).max(40).nullable().optional(),
});

export type MetricTargetInput = z.input<typeof targetSchema>;

/** Set, change or clear a metric's target. Works for derived metrics too: only their values are computed. */
export async function updateMetricTarget(metricId: string, input: MetricTargetInput): Promise<ActionResult> {
  return attempt(async () => {
    const data = targetSchema.parse(input);
    const metric = await db.metric.findUnique({ where: { id: metricId } });
    if (!metric) return fail("Metric not found");
    const targetDate = data.targetDate === undefined ? undefined : data.targetDate === null ? null : parseDayInput(data.targetDate);
    if (data.targetDate && !targetDate) return fail("Pick a valid target date");
    if (data.goalId && !(await db.goal.findUnique({ where: { id: data.goalId }, select: { id: true } }))) return fail("Goal not found");

    await db.metric.update({
      where: { id: metricId },
      data: {
        target: data.target,
        ...(targetDate !== undefined ? { targetDate } : {}),
        ...(data.target === null ? { targetDate: null } : {}),
        ...(data.goalId !== undefined ? { goalId: data.goalId } : {}),
      },
    });
    await syncGoalProgressFromMetrics(db, (await getCeoContext()).today);

    const from = metric.target === null ? "none" : formatMetric(metric.target, metric.unit);
    const to = data.target === null ? "none" : formatMetric(data.target, metric.unit);
    const by = data.target !== null && targetDate ? ` by ${formatDay(targetDate, true)}` : "";
    await logActivity(db, {
      type: "METRIC_RECORDED",
      summary: data.target === null ? `${metric.name} target cleared` : `${metric.name} target set to ${to}${by}`,
      goalId: metric.goalId,
      metadata: { metricId, metricKey: metric.key, field: "target", from, to, targetDate: data.targetDate ?? null },
    });
    revalidateAll();
    return ok(undefined, data.target === null ? "Target cleared" : "Target updated");
  });
}
