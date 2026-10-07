/**
 * First-run setup progress for the CEO's Today page: what a new workspace
 * still needs before CytoHub Brain can brief the CEO. Every step is measured
 * from real data, so it completes itself when the work is done anywhere in
 * the app; the CEO can also hide the checklist.
 */
import type { SourceKind } from "@/generated/prisma/enums";
import { db } from "@/lib/db";

export type SetupStepId = "email" | "calendar" | "documents" | "pillars" | "goals" | "team" | "refresh";

export interface SetupStep {
  id: SetupStepId;
  done: boolean;
}

export interface SetupProgress {
  steps: SetupStep[];
  done: number;
  total: number;
  complete: boolean;
  dismissed: boolean;
}

export const SETUP_DISMISSED_KEY = "setupChecklistDismissedAt";

export async function getSetupProgress(): Promise<SetupProgress> {
  const [connections, documents, pillars, goals, users, refreshes, dismissed] = await Promise.all([
    db.sourceConnection.groupBy({ by: ["kind"], where: { status: { not: "DISCONNECTED" } }, _count: true }),
    db.document.count(),
    db.strategicPillar.count({ where: { active: true } }),
    db.goal.count(),
    db.user.count({ where: { active: true } }),
    db.brainRefresh.count({ where: { status: { in: ["SUCCEEDED", "PARTIAL"] } } }),
    db.appSetting.findUnique({ where: { key: SETUP_DISMISSED_KEY }, select: { key: true } }),
  ]);
  const connected = (kind: SourceKind) => connections.some((c) => c.kind === kind);
  const steps: SetupStep[] = [
    { id: "email", done: connected("EMAIL") },
    { id: "calendar", done: connected("CALENDAR") },
    { id: "documents", done: connected("DOCUMENTS") || documents > 0 },
    { id: "pillars", done: pillars > 0 },
    { id: "goals", done: goals > 0 },
    { id: "team", done: users > 1 },
    { id: "refresh", done: refreshes > 0 },
  ];
  const done = steps.filter((s) => s.done).length;
  return { steps, done, total: steps.length, complete: done === steps.length, dismissed: Boolean(dismissed) };
}
