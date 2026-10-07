"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/server/security/audit";
import { safeNext } from "@/server/security/next-path";
import { hashPassword, passwordProblem, verifyPassword } from "@/server/security/passwords";
import { homePathFor } from "@/server/security/rbac";
import { LIMITS, rateLimit } from "@/server/security/rate-limit";
import { requestMeta } from "@/server/security/request";
import { PASSWORD_CHANGE_PATH, createSession, destroySession, getSessionViewer, revokeUserSessions } from "@/server/security/session";

const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60_000;

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
  next: z.string().max(500).optional(),
});

export type LoginState = { error?: string; email?: string } | undefined;

export async function login(_prev: LoginState, form: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({ email: form.get("email"), password: form.get("password"), next: form.get("next") ?? undefined });
  if (!parsed.success) return { error: "Enter your email and password." };
  const { email, password, next } = parsed.data;
  const { ip, userAgent } = await requestMeta();

  const [byIp, byAccount] = await Promise.all([
    rateLimit("login-ip", ip ?? "unknown", LIMITS.loginIp),
    rateLimit("login-account", email, LIMITS.loginAccount),
  ]);
  if (!byIp.ok || !byAccount.ok) {
    await audit({ action: "auth.denied", actorLabel: email, outcome: "DENIED", metadata: { reason: "rate_limited" } });
    return { error: `Too many attempts. Try again in ${Math.ceil(Math.max(byIp.retryAfterSec, byAccount.retryAfterSec) / 60)} minutes.`, email };
  }

  const user = await db.user.findUnique({ where: { email } });
  const generic = { error: "That email and password don't match an active account.", email };

  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    await verifyPassword(password, null);
    await audit({ action: "auth.denied", actorLabel: email, outcome: "DENIED", metadata: { reason: "locked" } });
    return { error: "This account is temporarily locked after repeated failed sign-ins. Try again later.", email };
  }

  const valid = await verifyPassword(password, user?.active ? user.passwordHash : null);
  if (!user || !user.active || !valid) {
    if (user) {
      const failures = user.failedLogins + 1;
      const lock = failures >= MAX_FAILURES;
      await db.user.update({
        where: { id: user.id },
        data: { failedLogins: lock ? 0 : failures, lockedUntil: lock ? new Date(Date.now() + LOCKOUT_MS) : user.lockedUntil },
      });
      if (lock) await audit({ action: "auth.lockout", viewer: { userId: user.id, email: user.email }, outcome: "DENIED" });
    }
    await audit({ action: "auth.login", actorLabel: email, outcome: "FAILURE" });
    return generic;
  }

  await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await createSession(user.id, { ip, userAgent });
  await audit({ action: "auth.login", viewer: { userId: user.id, email: user.email }, metadata: user.mustChangePassword ? { passwordChangeRequired: true } : undefined });
  const destination = safeNext(next);
  if (user.mustChangePassword) redirect(`${PASSWORD_CHANGE_PATH}${destination ? `?next=${encodeURIComponent(destination)}` : ""}`);
  redirect(destination ?? homePathFor(user.role));
}

const changeSchema = z.object({
  current: z.string().min(1, "Enter your current password.").max(200),
  password: z.string().max(200, "Use at most 200 characters."),
  confirm: z.string().max(200),
  next: z.string().max(500).optional(),
});

export type PasswordState = { error?: string; field?: "current" | "password" | "confirm" } | undefined;

/**
 * Replace the signed-in user's password — required after an admin chose it,
 * voluntary otherwise. Every other session is revoked and this one rotated,
 * so whoever knew the old password is signed out.
 */
export async function changePassword(_prev: PasswordState, form: FormData): Promise<PasswordState> {
  const viewer = await getSessionViewer();
  if (!viewer) redirect(`/login?next=${encodeURIComponent(PASSWORD_CHANGE_PATH)}`);
  const parsed = changeSchema.safeParse({ current: form.get("current"), password: form.get("password"), confirm: form.get("confirm"), next: form.get("next") ?? undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const { current, password, confirm, next } = parsed.data;

  const limit = await rateLimit("password-change", viewer.userId, LIMITS.passwordChange);
  if (!limit.ok) {
    await audit({ action: "auth.password_change", viewer, outcome: "DENIED", metadata: { reason: "rate_limited" } });
    return { error: `Too many attempts. Try again in ${Math.ceil(limit.retryAfterSec / 60)} minutes.` };
  }
  const user = await db.user.findUnique({ where: { id: viewer.userId }, select: { passwordHash: true } });
  if (!(await verifyPassword(current, user?.passwordHash))) {
    await audit({ action: "auth.password_change", viewer, outcome: "FAILURE", metadata: { reason: "wrong_current_password" } });
    return { error: "That isn’t your current password.", field: "current" };
  }
  const weak = passwordProblem(password);
  if (weak) return { error: weak, field: "password" };
  if (password === current) return { error: "Choose a password different from your current one.", field: "password" };
  if (password !== confirm) return { error: "The new passwords don’t match.", field: "confirm" };

  await db.user.update({
    where: { id: viewer.userId },
    data: { passwordHash: await hashPassword(password), mustChangePassword: false, passwordChangedAt: new Date(), failedLogins: 0, lockedUntil: null },
  });
  await revokeUserSessions(viewer.userId);
  const { ip, userAgent } = await requestMeta();
  await createSession(viewer.userId, { ip, userAgent });
  await audit({ action: "auth.password_change", viewer, metadata: { required: viewer.mustChangePassword, sessionsRevoked: true } });
  redirect(safeNext(next) ?? homePathFor(viewer.role));
}

export async function logout() {
  const viewer = await getSessionViewer();
  await destroySession();
  if (viewer) await audit({ action: "auth.logout", viewer });
  redirect("/login");
}
