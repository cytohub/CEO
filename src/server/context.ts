import { cache } from "react";
import { db, type Db, type Tx } from "@/lib/db";
import { today as todayIn } from "@/lib/dates";

export interface CeoContext {
  userId: string;
  name: string;
  firstName: string;
  title: string;
  /** Person id of the CEO in the execution graph (owner of CEO tasks). */
  personId: string;
  timezone: string;
  /** CEO's current calendar day (00:00 UTC Date). */
  today: Date;
  now: Date;
}

/**
 * Resolve the CEO whose command center this is (single-tenant). This is the
 * subject of the cockpit, not the signed-in viewer — see security/session.ts
 * for the viewer. Throws a descriptive error when the database is unseeded.
 */
export async function loadCeoContext(client: Db | Tx = db, now: Date = new Date()): Promise<CeoContext> {
  const user =
    (await client.user.findFirst({ where: { role: "CEO", active: true }, orderBy: { createdAt: "asc" }, include: { person: true } })) ??
    (await client.user.findFirst({ orderBy: { createdAt: "asc" }, include: { person: true } }));
  if (!user || !user.personId) {
    throw new Error("No CEO user found. Create the CEO account with `npm run db:bootstrap` (or load the demo workspace with `npm run db:seed`).");
  }
  return {
    userId: user.id,
    name: user.name,
    firstName: user.name.split(/\s+/)[0] ?? user.name,
    title: user.title,
    personId: user.personId,
    timezone: user.timezone,
    today: todayIn(user.timezone, now),
    now,
  };
}

/** Request-scoped CEO context for server components and actions. */
export const getCeoContext = cache(() => loadCeoContext());
