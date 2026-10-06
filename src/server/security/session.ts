/**
 * Sessions: opaque 256-bit tokens in an httpOnly cookie; only the SHA-256
 * hash is stored. Idle timeout slides with activity; absolute lifetime caps
 * every session. Revocation is immediate (sign-out, deactivation, password change).
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Sensitivity, UserRole } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { randomToken, sha256 } from "./crypto";
import { type Capability, ROLE_CAPABILITIES, ROLE_CLEARANCE, homePathFor } from "./rbac";

const SECURE = process.env.SESSION_COOKIE_SECURE ? process.env.SESSION_COOKIE_SECURE === "true" : process.env.NODE_ENV === "production";
/** `__Host-` binds the cookie to this exact origin (requires Secure + Path=/). */
export const SESSION_COOKIE = SECURE ? "__Host-cytohub_session" : "cytohub_session";
export const SESSION_COOKIE_NAMES = ["__Host-cytohub_session", "cytohub_session"] as const;

const IDLE_TIMEOUT_MS = 12 * 3_600_000;
const ABSOLUTE_LIFETIME_MS = 7 * 24 * 3_600_000;
const TOUCH_INTERVAL_MS = 5 * 60_000;

export interface Viewer {
  userId: string;
  sessionId: string;
  email: string;
  name: string;
  role: UserRole;
  personId: string | null;
  timezone: string;
  capabilities: readonly Capability[];
  clearance: Sensitivity | null;
}

export class AuthError extends Error {
  constructor(message = "Please sign in again.") {
    super(message);
    this.name = "AuthError";
  }
}

export class ForbiddenError extends Error {
  constructor(public capability: string, message = "You don't have permission to do that.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export async function createSession(userId: string, meta: { ip?: string | null; userAgent?: string | null } = {}) {
  const token = randomToken(32);
  const now = Date.now();
  await db.session.create({
    data: {
      tokenHash: sha256(token),
      userId,
      expiresAt: new Date(now + IDLE_TIMEOUT_MS),
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 400) ?? null,
    },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: SECURE,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(ABSOLUTE_LIFETIME_MS / 1000),
  });
}

async function readToken(): Promise<string | null> {
  const jar = await cookies();
  for (const name of SESSION_COOKIE_NAMES) {
    const v = jar.get(name)?.value;
    if (v) return v;
  }
  return null;
}

async function loadViewer(): Promise<Viewer | null> {
  const token = await readToken();
  if (!token || token.length > 200) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { select: { id: true, email: true, name: true, role: true, personId: true, timezone: true, active: true } } },
  });
  const now = Date.now();
  if (!session || session.revokedAt || !session.user.active) return null;
  if (session.expiresAt.getTime() <= now || session.createdAt.getTime() + ABSOLUTE_LIFETIME_MS <= now) return null;

  if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db.session
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date(now), expiresAt: new Date(now + IDLE_TIMEOUT_MS) } })
      .catch(() => {});
  }
  const u = session.user;
  return {
    userId: u.id,
    sessionId: session.id,
    email: u.email,
    name: u.name,
    role: u.role,
    personId: u.personId,
    timezone: u.timezone,
    capabilities: ROLE_CAPABILITIES[u.role],
    clearance: ROLE_CLEARANCE[u.role],
  };
}

/** The signed-in user for this request, or null. Cached per request. */
export const getViewer = cache(loadViewer);

export function can(viewer: Pick<Viewer, "capabilities"> | null | undefined, capability: Capability): boolean {
  return Boolean(viewer?.capabilities.includes(capability));
}

/** For server actions and route handlers: throws AuthError / ForbiddenError. */
export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) throw new AuthError();
  return viewer;
}

export async function requireCapability(capability: Capability): Promise<Viewer> {
  const viewer = await requireViewer();
  if (!can(viewer, capability)) throw new ForbiddenError(capability);
  return viewer;
}

/** For pages: redirects to sign-in, or to the viewer's home when not permitted. */
export async function requirePage(capability?: Capability, path = "/"): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect(`/login?next=${encodeURIComponent(path)}`);
  if (capability && !can(viewer, capability)) {
    const home = homePathFor(viewer.role);
    redirect(home === path ? "/forbidden" : `${home}${home.includes("?") ? "&" : "?"}denied=1`);
  }
  return viewer;
}

export async function destroySession() {
  const token = await readToken();
  if (token) {
    await db.session.updateMany({ where: { tokenHash: sha256(token), revokedAt: null }, data: { revokedAt: new Date() } });
  }
  const jar = await cookies();
  for (const name of SESSION_COOKIE_NAMES) jar.delete(name);
}

/** Revoke every session of a user (deactivation, role or password change). */
export async function revokeUserSessions(userId: string) {
  await db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}
