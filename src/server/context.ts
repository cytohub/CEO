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
 * Resolve the CEO (single-tenant today; becomes the authenticated user once
 * auth is added). Throws a descriptive error when the database is unseeded.
 */
export async function loadCeoContext(client: Db | Tx = db, now: Date = new Date()): Promise<CeoContext> {
  const user = await client.user.findFirst({ orderBy: { createdAt: "asc" }, include: { person: true } });
  if (!user || !user.personId) {
    throw new Error("No CEO user found. Run `npm run db:seed` to load the CytoHub workspace.");
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
