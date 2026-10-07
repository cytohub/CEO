"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { GrantResource, UserRole } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { USER_ROLES } from "@/lib/intelligence";
import { canShareResource, searchGrantable, userChangeProblem, type GrantableResource, type UserChange } from "@/server/queries/users";
import { getAccessScope } from "@/server/security/access";
import { audit } from "@/server/security/audit";
import { randomToken } from "@/server/security/crypto";
import { hashPassword, passwordProblem } from "@/server/security/passwords";
import { requireViewer, revokeUserSessions, type Viewer } from "@/server/security/session";
import { attemptAs, fail, id, ok, type ActionResult } from "./result";

const revalidateUsers = () => revalidatePath("/settings/users");

/** 144-bit random password, shown once. Grouped so it is easy to read aloud or type. */
function generatePassword(): string {
  const raw = randomToken(18).replace(/[-_]/g, "x");
  return raw.match(/.{1,6}/g)!.join("-");
}

async function activeCeoCount() {
  return db.user.count({ where: { role: "CEO", active: true } });
}

async function checkChange(viewer: Viewer, targetId: string | null, change: UserChange) {
  const target = targetId ? await db.user.findUnique({ where: { id: targetId }, select: { id: true, role: true, active: true, email: true, name: true } }) : null;
  const problem = userChangeProblem({ userId: viewer.userId, role: viewer.role }, target, change, await activeCeoCount());
  return { target, problem };
}

async function denied(viewer: Viewer, action: string, targetId: string | null, problem: string, metadata: Record<string, unknown> = {}) {
  await audit({ action, viewer, outcome: "DENIED", targetType: "User", targetId: targetId ?? undefined, metadata: { ...metadata, reason: problem } });
  return fail(problem);
}

// ─── Users ───────────────────────────────────────────────────────────────────

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(200),
  role: z.enum(UserRole),
  /** Admin-entered password; omitted → a one-time password is generated. */
  password: z.string().max(200).optional(),
});

export async function createUser(input: z.input<typeof createSchema>): Promise<ActionResult<{ id: string; oneTimePassword: string | null }>> {
  return attemptAs("users.manage", async () => {
    const data = createSchema.parse(input);
    const viewer = await requireViewer();
    const { problem } = await checkChange(viewer, null, { kind: "create", role: data.role });
    if (problem) return denied(viewer, "user.create", null, problem, { email: data.email, role: data.role });
    if (data.password) {
      const weak = passwordProblem(data.password);
      if (weak) return fail(weak);
    }
    if (await db.user.findUnique({ where: { email: data.email }, select: { id: true } })) return fail("A user with that email already exists");

    const oneTimePassword = data.password ? null : generatePassword();
    const passwordHash = await hashPassword(data.password ?? oneTimePassword!);
    // Link the account to the matching person in the execution graph when there is an unclaimed one.
    const person = await db.person.findFirst({ where: { email: { equals: data.email, mode: "insensitive" }, user: { is: null } }, select: { id: true } });
    const user = await db.user.create({
      // Whoever created the account knows this password, so the user replaces it at first sign-in.
      data: { name: data.name, email: data.email, role: data.role, passwordHash, mustChangePassword: true, active: true, personId: person?.id ?? null, title: USER_ROLES[data.role].label },
    });
    await audit({ action: "user.create", viewer, targetType: "User", targetId: user.id, metadata: { email: user.email, role: user.role, password: oneTimePassword ? "generated" : "set by admin", linkedPerson: Boolean(person) } });
    revalidateUsers();
    return ok({ id: user.id, oneTimePassword }, `${user.name} added as ${USER_ROLES[user.role].label}`);
  });
}

export async function changeUserRole(userId: string, role: UserRole): Promise<ActionResult> {
  return attemptAs("users.manage", async () => {
    id.parse(userId);
    const next = z.enum(UserRole).parse(role);
    const viewer = await requireViewer();
    const { target, problem } = await checkChange(viewer, userId, { kind: "role", role: next });
    if (problem || !target) return denied(viewer, "user.update", userId, problem ?? "User not found", { role: next });
    await db.user.update({ where: { id: userId }, data: { role: next } });
    // New role, new capabilities: existing sessions must not keep the old ones.
    await revokeUserSessions(userId);
    await audit({ action: "user.update", viewer, targetType: "User", targetId: userId, metadata: { email: target.email, role: { from: target.role, to: next }, sessionsRevoked: true } });
    revalidateUsers();
    return ok(undefined, `${target.name} is now ${USER_ROLES[next].label} — signed out everywhere`);
  });
}

export async function setUserActive(userId: string, active: boolean): Promise<ActionResult> {
  return attemptAs("users.manage", async () => {
    id.parse(userId);
    const next = z.boolean().parse(active);
    const viewer = await requireViewer();
    const { target, problem } = await checkChange(viewer, userId, { kind: next ? "reactivate" : "deactivate" });
    if (problem || !target) return denied(viewer, next ? "user.update" : "user.deactivate", userId, problem ?? "User not found");
    await db.user.update({ where: { id: userId }, data: { active: next, ...(next ? { failedLogins: 0, lockedUntil: null } : {}) } });
    await revokeUserSessions(userId);
    await audit({ action: next ? "user.update" : "user.deactivate", viewer, targetType: "User", targetId: userId, metadata: { email: target.email, active: next, sessionsRevoked: true } });
    revalidateUsers();
    return ok(undefined, next ? `${target.name} reactivated` : `${target.name} deactivated and signed out`);
  });
}

export async function resetUserPassword(userId: string): Promise<ActionResult<{ oneTimePassword: string }>> {
  return attemptAs("users.manage", async () => {
    id.parse(userId);
    const viewer = await requireViewer();
    const { target, problem } = await checkChange(viewer, userId, { kind: "reset_password" });
    if (problem || !target) return denied(viewer, "user.password_reset", userId, problem ?? "User not found");
    const oneTimePassword = generatePassword();
    await db.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(oneTimePassword), mustChangePassword: true, failedLogins: 0, lockedUntil: null } });
    await revokeUserSessions(userId);
    await audit({ action: "user.password_reset", viewer, targetType: "User", targetId: userId, metadata: { email: target.email, sessionsRevoked: true } });
    revalidateUsers();
    return ok({ oneTimePassword }, `Password reset for ${target.name} — they’ll choose a new one at next sign-in`);
  });
}

export async function unlockUser(userId: string): Promise<ActionResult> {
  return attemptAs("users.manage", async () => {
    id.parse(userId);
    const viewer = await requireViewer();
    const { target, problem } = await checkChange(viewer, userId, { kind: "unlock" });
    if (problem || !target) return denied(viewer, "user.update", userId, problem ?? "User not found");
    await db.user.update({ where: { id: userId }, data: { failedLogins: 0, lockedUntil: null } });
    await audit({ action: "user.update", viewer, targetType: "User", targetId: userId, metadata: { email: target.email, unlocked: true } });
    revalidateUsers();
    return ok(undefined, `${target.name} unlocked`);
  });
}

// ─── Access grants ───────────────────────────────────────────────────────────

const grantSchema = z
  .object({
    resourceType: z.enum(GrantResource),
    resourceId: z.string().min(1).max(64),
    userId: z.string().min(1).max(64).nullable().optional(),
    role: z.enum(UserRole).nullable().optional(),
    expiresAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Expiry must be a date")
      .nullable()
      .optional(),
  })
  .refine((g) => Boolean(g.userId) !== Boolean(g.role), "Choose either a user or a role");

export async function createGrant(input: z.input<typeof grantSchema>): Promise<ActionResult<{ id: string }>> {
  return attemptAs("users.manage", async () => {
    const g = grantSchema.parse(input);
    const viewer = await requireViewer();
    // End of the chosen day (UTC) so "expires on Oct 9" includes Oct 9.
    const expiresAt = g.expiresAt ? new Date(`${g.expiresAt}T23:59:59.999Z`) : null;
    if (expiresAt && expiresAt <= new Date()) return fail("Expiry must be in the future");
    if (g.role === "CEO") return fail("The CEO can already read every source");
    if (g.userId === viewer.userId) return denied(viewer, "grant.create", null, "You can’t grant access to yourself", { resourceType: g.resourceType });
    if (g.userId) {
      const grantee = await db.user.findUnique({ where: { id: g.userId }, select: { role: true, active: true } });
      if (!grantee) return fail("User not found");
      if (grantee.role === "CEO") return fail("The CEO can already read every source");
    }
    // A grant can never reach further than the granter's own access.
    const scope = await getAccessScope(viewer);
    if (!(await canShareResource(scope, g.resourceType, g.resourceId))) {
      return denied(viewer, "grant.create", null, "You can only share sources you can read yourself", { resourceType: g.resourceType, resourceId: g.resourceId });
    }
    const duplicate = await db.accessGrant.findFirst({
      where: { resourceType: g.resourceType, resourceId: g.resourceId, userId: g.userId ?? null, role: g.role ?? null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      select: { id: true },
    });
    if (duplicate) return fail("That access is already granted");
    const grant = await db.accessGrant.create({
      data: { resourceType: g.resourceType, resourceId: g.resourceId, userId: g.userId ?? null, role: g.role ?? null, grantedById: viewer.userId, expiresAt },
    });
    await audit({
      action: "grant.create",
      viewer,
      targetType: "AccessGrant",
      targetId: grant.id,
      metadata: { resourceType: g.resourceType, resourceId: g.resourceId, userId: g.userId ?? null, role: g.role ?? null, expiresAt: expiresAt?.toISOString() ?? null },
    });
    revalidateUsers();
    return ok({ id: grant.id }, "Access granted");
  });
}

export async function revokeGrant(grantId: string): Promise<ActionResult> {
  return attemptAs("users.manage", async () => {
    id.parse(grantId);
    const viewer = await requireViewer();
    const grant = await db.accessGrant.findUnique({ where: { id: grantId } });
    if (!grant) return fail("Grant not found");
    await db.accessGrant.delete({ where: { id: grantId } });
    await audit({
      action: "grant.delete",
      viewer,
      targetType: "AccessGrant",
      targetId: grantId,
      metadata: { resourceType: grant.resourceType, resourceId: grant.resourceId, userId: grant.userId, role: grant.role },
    });
    revalidateUsers();
    return ok(undefined, "Access revoked");
  });
}

export async function searchGrantResources(type: GrantResource, q: string): Promise<ActionResult<GrantableResource[]>> {
  return attemptAs("users.manage", async () => {
    const t = z.enum(GrantResource).parse(type);
    const term = z.string().max(120).parse(q);
    const viewer = await requireViewer();
    return ok(await searchGrantable(viewer, t, term));
  });
}
