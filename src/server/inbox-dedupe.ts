/**
 * One CEO Inbox item per record. Two producers file items: the ingestion
 * attention engine (fingerprinted by thread or record) and the Daily Brain
 * Refresh analyzers (fingerprinted by insight). Before either creates a new
 * item, it asks whether an item already covers the same record, so a decision
 * never shows up twice under different wording.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db";

export interface InboxRecordLinks {
  decisionId?: string | null;
  taskId?: string | null;
  commitmentId?: string | null;
  riskId?: string | null;
  opportunityId?: string | null;
  dealId?: string | null;
}

/**
 * The most specific record an item is about. People, companies and goals are
 * context shared by many items, so they never make two items duplicates.
 */
export function primaryRecord(links: InboxRecordLinks): { field: keyof InboxRecordLinks; id: string } | null {
  for (const field of ["decisionId", "commitmentId", "taskId", "riskId", "opportunityId", "dealId"] as const) {
    const id = links[field];
    if (id) return { field, id };
  }
  return null;
}

/**
 * The item already filed for the same record: an open or snoozed one first;
 * with `includeResolved`, otherwise the most recently resolved one (so the
 * caller's reopen rules apply instead of filing a fresh item).
 */
export async function findItemForRecord<S extends Prisma.InboxItemSelect>(
  tx: Tx,
  links: InboxRecordLinks,
  select: S,
  opts: { includeResolved?: boolean } = {},
): Promise<Prisma.InboxItemGetPayload<{ select: S }> | null> {
  const primary = primaryRecord(links);
  if (!primary) return null;
  const where: Prisma.InboxItemWhereInput = { [primary.field]: primary.id };
  const open = await tx.inboxItem.findFirst({ where: { ...where, status: { in: ["OPEN", "SNOOZED"] } }, orderBy: { createdAt: "asc" }, select });
  if (open || !opts.includeResolved) return open as Prisma.InboxItemGetPayload<{ select: S }> | null;
  return tx.inboxItem.findFirst({ where, orderBy: [{ resolvedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }], select }) as Promise<Prisma.InboxItemGetPayload<{ select: S }> | null>;
}

/** An open or snoozed inbox item already filed for the same record, if any. */
export function findOpenItemForRecord(tx: Tx, links: InboxRecordLinks): Promise<{ id: string } | null> {
  return findItemForRecord(tx, links, { id: true });
}
