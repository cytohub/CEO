/**
 * Sessions: opaque 256-bit tokens in an httpOnly cookie; only the SHA-256
 * hash is stored. Idle timeout slides with activity; absolute lifetime caps
 * every session. Revocation is immediate (sign-out, deactivation, password change).
 *
 * A user whose password someone else chose (admin create or reset) must
 * replace it first: until then getViewer() treats them as signed out, so
 * every page, action and route fails closed, and requirePage() sends them to
 * PASSWORD_CHANGE_PATH. Only that page, its action and sign-out read the
 * pending session (getSessionViewer).
 */
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Sensitivity, UserRole } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { randomToken, sha256 } from "./crypto";
import { type Capability, ROLE_CAPABILITIES, ROLE_CLEARANCE, homePathFor } from "./rbac";
import { REQUEST_PATH_HEADER } from "./request-path";

const SECURE = process.env.SESSION_COOKIE_SECURE ? process.env.SESSION_COOKIE_SECURE === "true" : process.env.NODE_ENV === "production";
/** `__Host-` binds the cookie to this exact origin (requires Secure + Path=/). */
export const SESSION_COOKIE = SECURE ? "__Host-cytohub_session" : "cytohub_session";
export const SESSION_COOKIE_NAMES = ["__Host-cytohub_session", "cytohub_session"] as const;

const IDLE_TIMEOUT_MS = 12 * 3_600_000;
const ABSOLUTE_LIFETIME_MS = 7 * 24 * 3_600_000;
const TOUCH_INTERVAL_MS = 5 * 60_000;

export const PASSWORD_CHANGE_PATH = "/account/password";

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
  /** Signed in with a password someone else chose; nothing else is allowed until it is changed. */
  mustChangePassword: boolean;
}

export class AuthError extends Error {
  constructor(message = "Please sign in again.") {
    super(message);
    this.name = "AuthError";
  }
}

export class PasswordChangeRequiredError extends AuthError {
  constructor() {
    super("Choose a new password to continue.");
    this.name = "PasswordChangeRequiredError";
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
    include: { user: { select: { id: true, email: true, name: true, role: true, personId: true, timezone: true, active: true, mustChangePassword: true } } },
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
    mustChangePassword: u.mustChangePassword,
  };
}

/**
 * The session's user even while a password change is pending. Only for the
 * password change page and action, sign-in and sign-out. Cached per request.
 */
export const getSessionViewer = cache(loadViewer);

/** The signed-in user for this request, or null (also null while a password change is pending). */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const viewer = await getSessionViewer();
  return viewer && !viewer.mustChangePassword ? viewer : null;
});

export function can(viewer: Pick<Viewer, "capabilities"> | null | undefined, capability: Capability): boolean {
  return Boolean(viewer?.capabilities.includes(capability));
}

/** For server actions and route handlers: throws AuthError / ForbiddenError. */
export async function requireViewer(): Promise<Viewer> {
  const viewer = await getSessionViewer();
  if (!viewer) throw new AuthError();
  if (viewer.mustChangePassword) throw new PasswordChangeRequiredError();
  return viewer;
}

export async function requireCapability(capability: Capability): Promise<Viewer> {
  const viewer = await requireViewer();
  if (!can(viewer, capability)) throw new ForbiddenError(capability);
  return viewer;
}

/** Where to return after sign-in: the requested URL (from the proxy), else the page's own path. */
async function returnPath(fallback: string): Promise<string> {
  const requested = (await headers()).get(REQUEST_PATH_HEADER);
  return requested?.startsWith("/") && !requested.startsWith("//") ? requested : fallback;
}

/** For pages: redirects to sign-in, or to the viewer's home when not permitted. */
export async function requirePage(capability?: Capability, path = "/"): Promise<Viewer> {
  const viewer = await getSessionViewer();
  if (!viewer) redirect(`/login?next=${encodeURIComponent(await returnPath(path))}`);
  if (viewer.mustChangePassword) redirect(`${PASSWORD_CHANGE_PATH}?next=${encodeURIComponent(await returnPath(path))}`);
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
