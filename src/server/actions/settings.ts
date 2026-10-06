"use server";

import { z } from "zod";
import { FocusArea } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { FOCUS_AREA_ORDER, PILLAR_COLORS } from "@/lib/domain";
import { getConnector } from "@/server/brain/connectors";
import { DEFAULT_WEIGHTS, FACTOR_KEYS, FACTOR_META, normalizeWeights, type FactorKey, type PriorityWeights } from "@/server/brain/scoring";
import { logActivity, rescore, revalidateAll } from "@/server/mutations";
import { getPriorityWeights, setSetting, type BrainThresholds } from "@/server/settings";
import { attempt, fail, id, ok, type ActionResult } from "./result";

// ─── Profile ─────────────────────────────────────────────────────────────────

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const profileSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  title: z.string().trim().min(1, "Title is required").max(120),
  timezone: z.string().trim().min(1).max(64).refine(isValidTimezone, "Unknown timezone"),
});

export async function updateProfile(input: z.input<typeof profileSchema>): Promise<ActionResult> {
  return attempt(async () => {
    const data = profileSchema.parse(input);
    const user = await db.user.findFirst({ orderBy: { createdAt: "asc" } });
    if (!user) return fail("No CEO user found");
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data });
      if (user.personId) await tx.person.update({ where: { id: user.personId }, data: { name: data.name, title: data.title } });
    });
    revalidateAll();
    return ok(undefined, user.timezone !== data.timezone ? `Profile saved · “today” now follows ${data.timezone}` : "Profile saved");
  });
}

// ─── Strategic pillars ───────────────────────────────────────────────────────

const pillarColor = z.enum(PILLAR_COLORS);
const pillarSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  description: z.string().trim().max(500).nullable().optional(),
  color: pillarColor,
});

async function nameTaken(name: string, exceptId?: string) {
  const existing = await db.strategicPillar.findFirst({ where: { name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  return Boolean(existing);
}

async function renumberPillars(orderedIds?: string[]) {
  const ids = orderedIds ?? (await db.strategicPillar.findMany({ orderBy: [{ order: "asc" }, { name: "asc" }], select: { id: true } })).map((p) => p.id);
  await db.$transaction(ids.map((pid, i) => db.strategicPillar.update({ where: { id: pid }, data: { order: i } })));
}

export async function createPillar(input: z.input<typeof pillarSchema>): Promise<ActionResult<{ id: string }>> {
  return attempt(async () => {
    const data = pillarSchema.parse(input);
    if (await nameTaken(data.name)) return fail(`A pillar named “${data.name}” already exists`);
    const last = await db.strategicPillar.findFirst({ orderBy: { order: "desc" }, select: { order: true } });
    const pillar = await db.strategicPillar.create({
      data: { name: data.name, description: data.description || null, color: data.color, order: (last?.order ?? -1) + 1 },
    });
    revalidateAll();
    return ok({ id: pillar.id }, "Pillar created");
  });
}

const pillarPatch = pillarSchema.partial().extend({ active: z.boolean().optional() });

export async function updatePillar(pillarId: string, input: z.input<typeof pillarPatch>): Promise<ActionResult> {
  return attempt(async () => {
    id.parse(pillarId);
    const data = pillarPatch.parse(input);
    const current = await db.strategicPillar.findUnique({ where: { id: pillarId } });
    if (!current) return fail("Pillar not found");
    if (data.name && (await nameTaken(data.name, pillarId))) return fail(`A pillar named “${data.name}” already exists`);
    await db.strategicPillar.update({
      where: { id: pillarId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description || null } : {}),
        ...(data.color !== undefined ? { color: data.color } : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
      },
    });
    revalidateAll();
    const message =
      data.active === false ? `“${current.name}” deactivated — hidden from pickers, links kept` : data.active === true ? `“${current.name}” reactivated` : "Pillar saved";
    return ok(undefined, message);
  });
}

export async function movePillar(pillarId: string, direction: "up" | "down"): Promise<ActionResult> {
  return attempt(async () => {
    id.parse(pillarId);
    z.enum(["up", "down"]).parse(direction);
    const all = await db.strategicPillar.findMany({ orderBy: [{ order: "asc" }, { name: "asc" }], select: { id: true } });
    const ids = all.map((p) => p.id);
    const idx = ids.indexOf(pillarId);
    if (idx === -1) return fail("Pillar not found");
    const swap = direction === "up" ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= ids.length) return ok(undefined);
    [ids[idx], ids[swap]] = [ids[swap], ids[idx]];
    await renumberPillars(ids);
    revalidateAll();
    return ok(undefined, "Order updated");
  });
}

export async function deletePillar(pillarId: string): Promise<ActionResult> {
  return attempt(async () => {
    id.parse(pillarId);
    const pillar = await db.strategicPillar.findUnique({
      where: { id: pillarId },
      include: { _count: { select: { goals: true, milestones: true, tasks: true, decisions: true, metrics: true } } },
    });
    if (!pillar) return fail("Pillar not found");
    const linked = Object.values(pillar._count).reduce((a, b) => a + b, 0);
    if (linked > 0) return fail(`“${pillar.name}” has ${linked} linked item${linked === 1 ? "" : "s"} — deactivate it instead`);
    await db.strategicPillar.delete({ where: { id: pillarId } });
    await renumberPillars();
    revalidateAll();
    return ok(undefined, `“${pillar.name}” deleted`);
  });
}

// ─── CEO attention targets ───────────────────────────────────────────────────

const targetsSchema = z
  .array(
    z.object({
      focusArea: z.enum(FocusArea),
      recommendedPct: z.coerce.number().min(0).max(100),
      rationale: z.string().trim().max(300).nullable().optional(),
    }),
  )
  .min(1)
  .refine((rows) => new Set(rows.map((r) => r.focusArea)).size === rows.length, "Each focus area may appear once");

export async function saveAttentionTargets(rows: z.input<typeof targetsSchema>): Promise<ActionResult> {
  return attempt(async () => {
    const data = targetsSchema.parse(rows);
    const byArea = new Map(data.map((r) => [r.focusArea, r]));
    // Areas not submitted keep their current value in the total.
    const existing = await db.attentionTarget.findMany();
    const total = FOCUS_AREA_ORDER.reduce((s, a) => s + (byArea.get(a)?.recommendedPct ?? existing.find((e) => e.focusArea === a)?.recommendedPct ?? 0), 0);
    if (Math.abs(total - 100) > 0.5) return fail(`Targets must add up to 100% (currently ${Math.round(total * 10) / 10}%)`);
    await db.$transaction(
      data.map((r) =>
        db.attentionTarget.upsert({
          where: { focusArea: r.focusArea },
          create: { focusArea: r.focusArea, recommendedPct: Math.round(r.recommendedPct * 10) / 10, rationale: r.rationale || null },
          update: { recommendedPct: Math.round(r.recommendedPct * 10) / 10, rationale: r.rationale || null },
        }),
      ),
    );
    revalidateAll();
    return ok(undefined, "Attention targets saved");
  });
}

// ─── CEO Priority Score weights ──────────────────────────────────────────────

const weight = z.coerce.number().min(0).max(100);
const weightsSchema = z
  .object({
    strategic: weight,
    urgency: weight,
    revenue: weight,
    fundraising: weight,
    customer: weight,
    scientific: weight,
    risk: weight,
    dependency: weight,
    uniqueness: weight,
    deadline: weight,
    opportunity: weight,
  } satisfies Record<FactorKey, typeof weight>)
  .refine((w) => Object.values(w).some((v) => v > 0), "At least one factor needs weight");

export async function savePriorityWeights(weights: Partial<Record<FactorKey, number>>): Promise<ActionResult<{ rescored: number }>> {
  return attempt(async () => {
    const parsed: PriorityWeights = weightsSchema.parse({ ...DEFAULT_WEIGHTS, ...weights });
    const before = await getPriorityWeights(db);
    const normalized = normalizeWeights(parsed);
    const rounded = Object.fromEntries(FACTOR_KEYS.map((k) => [k, Math.round(normalized[k] * 100) / 100])) as PriorityWeights;
    await setSetting(db, "priorityWeights", rounded);

    const rescored = await db.task.count({ where: { status: { in: ["TODO", "IN_PROGRESS", "WAITING", "BLOCKED", "SOMEDAY"] } } });
    await rescore();

    const changes = FACTOR_KEYS.map((k) => ({ k, from: before[k], to: rounded[k] }))
      .filter((c) => Math.abs(c.from - c.to) >= 0.5)
      .sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from));
    const summary = changes.length
      ? `Priority Score re-weighted: ${changes
          .slice(0, 3)
          .map((c) => `${FACTOR_META[c.k].label} ${Math.round(c.from)}→${Math.round(c.to)}%`)
          .join(", ")}${changes.length > 3 ? ` +${changes.length - 3} more` : ""}`
      : "Priority Score weights saved";
    await logActivity(db, { type: "TASK_PRIORITY_CHANGED", summary, metadata: { kind: "priorityWeights", from: before, to: rounded } as unknown as Prisma.InputJsonValue });
    revalidateAll();
    return ok({ rescored }, `Weights saved · ${rescored} open tasks rescored`);
  });
}

// ─── Brain thresholds ────────────────────────────────────────────────────────

const thresholdsSchema = z.object({
  dealStaleDays: z.coerce.number().int().min(1).max(180),
  delegationFollowUpDays: z.coerce.number().int().min(1).max(90),
  investorFollowUpDays: z.coerce.number().int().min(1).max(180),
  runwayAlertMonths: z.coerce.number().min(1).max(60),
  attentionTolerance: z.coerce.number().min(0.05).max(1),
  attentionWindowDays: z.coerce.number().int().min(7).max(90),
  milestoneDueSoonDays: z.coerce.number().int().min(1).max(120),
}) satisfies z.ZodType<BrainThresholds>;

export async function saveThresholds(input: z.input<typeof thresholdsSchema>): Promise<ActionResult> {
  return attempt(async () => {
    const data = thresholdsSchema.parse(input);
    await setSetting(db, "brainThresholds", data);
    revalidateAll();
    return ok(undefined, "Brain thresholds saved · applied on the next refresh");
  });
}

// ─── Brain sources ───────────────────────────────────────────────────────────

export async function setSourceEnabled(key: string, enabled: boolean): Promise<ActionResult> {
  return attempt(async () => {
    z.string().min(1).max(64).parse(key);
    z.boolean().parse(enabled);
    if (key === "workspace") return fail("The CytoHub Workspace source is always on");
    const source = await db.brainSource.findUnique({ where: { key } });
    if (!source) return fail("Source not found");
    const config = (source.config as Record<string, unknown> | null) ?? {};

    if (!enabled) {
      if (source.status === "DISABLED") return ok(undefined);
      await db.brainSource.update({
        where: { key },
        data: { status: "DISABLED", config: { ...config, previousStatus: source.status } as Prisma.InputJsonValue },
      });
      revalidateAll();
      return ok(undefined, `${source.name} disabled — skipped on the next refresh`);
    }

    if (source.status !== "DISABLED") return ok(undefined);
    const { previousStatus, ...rest } = config as { previousStatus?: string } & Record<string, unknown>;
    const sample = rest.mode === "sample";
    const configured = getConnector(key)?.isConfigured() ?? false;
    const restored =
      previousStatus && previousStatus !== "DISABLED" && ["CONNECTED", "NOT_CONNECTED", "ERROR", "SYNCING"].includes(previousStatus)
        ? (previousStatus as "CONNECTED" | "NOT_CONNECTED" | "ERROR" | "SYNCING")
        : sample || configured
          ? "CONNECTED"
          : "NOT_CONNECTED";
    await db.brainSource.update({ where: { key }, data: { status: restored === "SYNCING" ? "CONNECTED" : restored, config: rest as Prisma.InputJsonValue } });
    revalidateAll();
    return ok(undefined, `${source.name} enabled`);
  });
}
