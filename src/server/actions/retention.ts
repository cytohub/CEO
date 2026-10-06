"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { SourceItemKind, SourceProvider, Sensitivity } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { SOURCE_PROVIDERS } from "@/lib/intelligence";
import { createPipelineContext } from "@/server/ingestion/context";
import {
  deleteSourceItemData,
  planSourceDeletion,
  previewRetention,
  retentionPolicySchema,
  runRetentionSweep,
  type RetentionPreviewRow,
  type SourceDeletionPlan,
  type SourceDeletionResult,
} from "@/server/ingestion/retention";
import { getRetentionPolicy } from "@/server/ingestion/retention-policy";
import { RESTRICTED_LABEL } from "@/server/queries/users";
import { canReadSourceItem, getAccessScope, sourceItemWhere } from "@/server/security/access";
import { audit } from "@/server/security/audit";
import { requireViewer } from "@/server/security/session";
import { attemptAs, fail, id, ok, type ActionResult } from "./result";

const revalidateRetention = () => revalidatePath("/settings/retention");

// ─── Policy ──────────────────────────────────────────────────────────────────

export async function saveRetentionPolicy(input: z.input<typeof retentionPolicySchema>): Promise<ActionResult> {
  return attemptAs("retention.manage", async () => {
    const policy = retentionPolicySchema.parse(input);
    const viewer = await requireViewer();
    const before = await getRetentionPolicy(db);
    const changes = Object.fromEntries(
      (Object.keys(policy) as (keyof typeof policy)[]).filter((k) => policy[k] !== before[k]).map((k) => [k, { from: before[k], to: policy[k] }]),
    );
    if (!Object.keys(changes).length) return ok(undefined, "No changes");
    await db.appSetting.upsert({
      where: { key: "retentionPolicy" },
      create: { key: "retentionPolicy", value: policy as unknown as Prisma.InputJsonValue },
      update: { value: policy as unknown as Prisma.InputJsonValue },
    });
    await audit({ action: "retention.update", viewer, targetType: "AppSetting", targetId: "retentionPolicy", metadata: { changes } });
    revalidateRetention();
    return ok(undefined, "Retention policy saved — applies at the next sweep");
  });
}

/** What each rule would purge now under the given (possibly unsaved) policy. */
export async function previewRetentionPolicy(input: z.input<typeof retentionPolicySchema>): Promise<ActionResult<RetentionPreviewRow[]>> {
  return attemptAs("retention.manage", async () => {
    const policy = retentionPolicySchema.parse(input);
    return ok(await previewRetention({ policy }));
  });
}

export async function runRetentionSweepNow(): Promise<ActionResult<Record<string, number>>> {
  return attemptAs("retention.manage", async () => {
    const viewer = await requireViewer();
    const ctx = await createPipelineContext({ trigger: "MANUAL" });
    const counts = await runRetentionSweep(ctx, { actor: { userId: viewer.userId, email: viewer.email } });
    revalidateRetention();
    revalidatePath("/settings/audit");
    const total = Object.entries(counts)
      .filter(([k]) => k !== "referencesRedacted")
      .reduce((s, [, v]) => s + v, 0);
    return ok(counts, total ? `Retention sweep purged ${total} record${total === 1 ? "" : "s"}` : "Retention sweep complete — nothing to purge");
  });
}

// ─── Deletion workflow ───────────────────────────────────────────────────────

export interface DeletionCandidate {
  id: string;
  title: string;
  restricted: boolean;
  kind: SourceItemKind;
  provider: SourceProvider;
  providerLabel: string;
  sensitivity: Sensitivity;
  occurredAt: Date;
  contentPurgedAt: Date | null;
  deletedAtSource: Date | null;
}

/**
 * Find source items. Titles are searched only among items the viewer may read
 * (a title search over restricted items would leak their titles); restricted
 * items are reachable by exact id and appear masked in the recent list.
 */
export async function searchSourceItemsForDeletion(q: string): Promise<ActionResult<DeletionCandidate[]>> {
  return attemptAs("retention.manage", async () => {
    const term = z.string().trim().max(200).parse(q);
    const viewer = await requireViewer();
    const scope = await getAccessScope(viewer);
    const readable = sourceItemWhere(scope);
    const where: Prisma.SourceItemWhereInput = term ? { OR: [{ id: term }, { AND: [readable, { title: { contains: term, mode: "insensitive" } }] }] } : {};
    const rows = await db.sourceItem.findMany({
      where,
      orderBy: { occurredAt: "desc" },
      take: 15,
      select: { id: true, title: true, kind: true, sensitivity: true, occurredAt: true, contentPurgedAt: true, deletedAtSource: true, connection: { select: { provider: true } } },
    });
    const ok_ = new Set(scope.all ? rows.map((r) => r.id) : (await db.sourceItem.findMany({ where: { AND: [{ id: { in: rows.map((r) => r.id) } }, readable] }, select: { id: true } })).map((r) => r.id));
    return ok(
      rows.map((r) => ({
        id: r.id,
        title: ok_.has(r.id) ? r.title : RESTRICTED_LABEL,
        restricted: !ok_.has(r.id),
        kind: r.kind,
        provider: r.connection.provider,
        providerLabel: SOURCE_PROVIDERS[r.connection.provider].label,
        sensitivity: r.sensitivity,
        occurredAt: r.occurredAt,
        contentPurgedAt: r.contentPurgedAt,
        deletedAtSource: r.deletedAtSource,
      })),
    );
  });
}

export type MaskedDeletionPlan = SourceDeletionPlan & { restricted: boolean };

export async function previewSourceItemDeletion(sourceItemId: string): Promise<ActionResult<MaskedDeletionPlan>> {
  return attemptAs("retention.manage", async (): Promise<ActionResult<MaskedDeletionPlan>> => {
    id.parse(sourceItemId);
    const viewer = await requireViewer();
    const plan = await planSourceDeletion(db, sourceItemId);
    if (!plan) return fail("Source item not found");
    const readable = await canReadSourceItem(await getAccessScope(viewer), sourceItemId);
    if (readable) return ok({ ...plan, restricted: false });
    // Derived titles can reveal what a restricted source said: show types and counts only.
    return ok({
      ...plan,
      restricted: true,
      item: { ...plan.item, title: RESTRICTED_LABEL },
      records: plan.records.map((r) => ({ ...r, label: null })),
      reviewItems: { ...plan.reviewItems, pending: plan.reviewItems.pending.map((p) => ({ ...p, title: RESTRICTED_LABEL })) },
    });
  });
}

const deleteSchema = z.object({
  mode: z.enum(["REDACT_CONTENT", "DELETE_DERIVED"]),
  confirmation: z.literal("DELETE", { error: "Type DELETE to confirm" }),
});

export async function deleteSourceItem(sourceItemId: string, input: z.input<typeof deleteSchema>): Promise<ActionResult<SourceDeletionResult>> {
  return attemptAs("retention.manage", async () => {
    id.parse(sourceItemId);
    const { mode } = deleteSchema.parse(input);
    const viewer = await requireViewer();
    const result = await deleteSourceItemData(sourceItemId, mode, { userId: viewer.userId, email: viewer.email });
    revalidateRetention();
    revalidatePath("/", "layout");
    const message =
      mode === "REDACT_CONTENT"
        ? `Content redacted · ${result.referencesRedacted} excerpt${result.referencesRedacted === 1 ? "" : "s"} cleared`
        : `Content redacted · ${result.derivedDeleted} derived record${result.derivedDeleted === 1 ? "" : "s"} and ${result.reviewItemsDeleted} pending review item${result.reviewItemsDeleted === 1 ? "" : "s"} deleted`;
    return ok(result, message);
  });
}

