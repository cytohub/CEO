/**
 * Roles → capabilities, and role clearance for source content.
 *
 * Pure and client-safe (no database access) so navigation can hide what a
 * viewer cannot open. Enforcement always happens on the server: pages call
 * requirePage(), server actions go through attempt() / requireCapability(),
 * and every read of source content goes through ./access.ts.
 */
import type { Sensitivity, UserRole } from "@/generated/prisma/enums";

export const CAPABILITIES = [
  /** CEO cockpit: Today, Inbox, Daily brief, Top 5, reviews. */
  "cockpit.view",
  /** Company execution graph: tasks, goals, milestones, decisions, commitments, risks… */
  "workspace.view",
  "workspace.edit",
  /** Brain page, insights, threads, documents. */
  "brain.view",
  /** Approve / edit / reject / merge items in the Brain Review Queue. */
  "review.resolve",
  "search.use",
  "chief.use",
  /** Private CEO performance. */
  "performance.view",
  "integrations.manage",
  "settings.manage",
  "users.manage",
  "audit.view",
  "retention.manage",
  "health.view",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const ALL = [...CAPABILITIES];

export const ROLE_CAPABILITIES: Record<UserRole, readonly Capability[]> = {
  CEO: ALL,
  EXECUTIVE: ["workspace.view", "workspace.edit", "brain.view", "review.resolve", "search.use", "health.view"],
  TEAM_MEMBER: ["search.use"],
  ADMIN: ["integrations.manage", "settings.manage", "users.manage", "audit.view", "retention.manage", "health.view", "search.use"],
  ADVISOR: ["search.use"],
};

/** Highest sensitivity a role may read by default (null = only explicit grants). */
export const ROLE_CLEARANCE: Record<UserRole, Sensitivity | null> = {
  CEO: "RESTRICTED",
  EXECUTIVE: "CONFIDENTIAL",
  TEAM_MEMBER: "INTERNAL",
  ADMIN: "INTERNAL",
  ADVISOR: null,
};

const SENSITIVITY_RANK: Record<Sensitivity, number> = { INTERNAL: 1, CONFIDENTIAL: 2, RESTRICTED: 3 };

export function sensitivityLevelsFor(clearance: Sensitivity | null): Sensitivity[] {
  if (!clearance) return [];
  return (Object.keys(SENSITIVITY_RANK) as Sensitivity[]).filter((s) => SENSITIVITY_RANK[s] <= SENSITIVITY_RANK[clearance]);
}

export function clearanceAllows(clearance: Sensitivity | null, sensitivity: Sensitivity): boolean {
  return clearance != null && SENSITIVITY_RANK[sensitivity] <= SENSITIVITY_RANK[clearance];
}

export function roleCan(role: UserRole, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}

/** Where a viewer lands after sign-in. */
export function homePathFor(role: UserRole): string {
  if (roleCan(role, "cockpit.view")) return "/";
  if (roleCan(role, "workspace.view")) return "/tasks";
  if (roleCan(role, "integrations.manage")) return "/settings/integrations";
  return "/search";
}
