"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/server/security/audit";
import { verifyPassword } from "@/server/security/passwords";
import { homePathFor } from "@/server/security/rbac";
import { LIMITS, rateLimit } from "@/server/security/rate-limit";
import { requestMeta } from "@/server/security/request";
import { createSession, destroySession, getViewer } from "@/server/security/session";

const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60_000;

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
  next: z.string().max(500).optional(),
});

export type LoginState = { error?: string; email?: string } | undefined;

/** Only same-site relative paths are allowed as post-login destinations. */
function safeNext(next: string | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || next.startsWith("/login")) return null;
  return next;
}

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
  await audit({ action: "auth.login", viewer: { userId: user.id, email: user.email } });
  redirect(safeNext(next) ?? homePathFor(user.role));
}

export async function logout() {
  const viewer = await getViewer();
  await destroySession();
  if (viewer) await audit({ action: "auth.logout", viewer });
  redirect("/login");
}
