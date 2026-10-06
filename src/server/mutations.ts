/**
 * Shared helpers for server actions: activity logging, rescoring and cache
 * invalidation. Every mutation records an Activity so the CEO's history (and
 * tomorrow's Brain refresh) knows what happened.
 */
import { revalidatePath } from "next/cache";
import type { ActivityType, Prisma } from "@/generated/prisma/client";
import { db, type Db, type Tx } from "@/lib/db";
import { rescoreTasks } from "@/server/brain/priorities";
import { getCeoContext } from "@/server/context";
import { getPriorityWeights } from "@/server/settings";

export async function logActivity(
  client: Db | Tx,
  data: {
    type: ActivityType;
    summary: string;
    actor?: string;
    metadata?: Prisma.InputJsonValue;
    taskId?: string | null;
    goalId?: string | null;
    milestoneId?: string | null;
    decisionId?: string | null;
    meetingId?: string | null;
    companyId?: string | null;
    personId?: string | null;
    delegationId?: string | null;
  },
) {
  await client.activity.create({ data: { actor: "CEO", ...data } });
}

export async function rescore(taskIds?: string[]) {
  const ceo = await getCeoContext();
  await rescoreTasks(db, {
    today: ceo.today,
    weights: await getPriorityWeights(db),
    ceoPersonId: ceo.personId,
    now: new Date(),
    taskIds,
  });
}

/** All pages read live data; refresh every route after a mutation. */
export function revalidateAll() {
  revalidatePath("/", "layout");
}
