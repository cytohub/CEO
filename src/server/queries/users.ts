/**
 * Users & access: accounts, roles and explicit access grants.
 *
 * The account rules live here (pure, unit-tested) so the table shows only the
 * actions the server will accept, and actions/users.ts enforces the same rules.
 */
import type { GrantResource, UserRole } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { SOURCE_PROVIDERS } from "@/lib/intelligence";
import { documentWhere, emailThreadWhere, getAccessScope, sourceItemWhere, type AccessScope } from "@/server/security/access";
import type { Viewer } from "@/server/security/session";

// ─── Rules ───────────────────────────────────────────────────────────────────

export type UserChange =
  | { kind: "create"; role: UserRole }
  | { kind: "role"; role: UserRole }
  | { kind: "deactivate" }
  | { kind: "reactivate" }
  | { kind: "reset_password" }
  | { kind: "unlock" };

export interface RuleActor {
  userId: string;
  role: UserRole;
}

export interface RuleTarget {
  id: string;
  role: UserRole;
  active: boolean;
}

/**
 * Why a change to an account is not allowed, or null when it is. Pure.
 *   • Only the CEO grants, removes, resets or deactivates CEO access.
 *   • Nobody changes their own role, deactivates or resets themselves here
 *     (prevents accidental lock-out and self-promotion).
 *   • At least one active CEO always remains.
 */
export function userChangeProblem(actor: RuleActor, target: RuleTarget | null, change: UserChange, activeCeoCount: number): string | null {
  const actorIsCeo = actor.role === "CEO";
  if (change.kind === "create") {
    if (change.role === "CEO" && !actorIsCeo) return "Only the CEO can grant the CEO role.";
    return null;
  }
  if (!target) return "User not found.";
  const self = target.id === actor.userId;
  const targetIsCeo = target.role === "CEO";
  const lastActiveCeo = targetIsCeo && target.active && activeCeoCount <= 1;

  switch (change.kind) {
    case "role":
      if (change.role === target.role) return "That is already this user’s role.";
      if (self) return "You can’t change your own role.";
      if ((change.role === "CEO" || targetIsCeo) && !actorIsCeo) return "Only the CEO can grant or remove the CEO role.";
      if (targetIsCeo && lastActiveCeo) return "There must always be at least one active CEO.";
      return null;
    case "deactivate":
      if (!target.active) return "This account is already deactivated.";
      if (self) return "You can’t deactivate your own account.";
      if (targetIsCeo && !actorIsCeo) return "Only the CEO can deactivate a CEO account.";
      if (lastActiveCeo) return "There must always be at least one active CEO.";
      return null;
    case "reactivate":
      if (target.active) return "This account is already active.";
      if (targetIsCeo && !actorIsCeo) return "Only the CEO can reactivate a CEO account.";
      return null;
    case "reset_password":
      if (self) return "You can’t reset your own password here.";
      if (targetIsCeo && !actorIsCeo) return "Only the CEO can reset a CEO’s password.";
      return null;
    case "unlock":
      return null;
  }
}

// ─── Users ───────────────────────────────────────────────────────────────────

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  lastLoginAt: Date | null;
  lockedUntil: Date | null;
  locked: boolean;
  failedLogins: number;
  createdAt: Date;
  isSelf: boolean;
  activeSessions: number;
  hasPassword: boolean;
  /** Actions the server will accept for this row (same rules as the actions). */
  allowed: { changeRole: boolean; deactivate: boolean; reactivate: boolean; resetPassword: boolean; unlock: boolean };
  /** Roles this viewer may assign to this user. */
  assignableRoles: UserRole[];
}

const ROLES: UserRole[] = ["CEO", "EXECUTIVE", "TEAM_MEMBER", "ADMIN", "ADVISOR"];

export async function getUsers(viewer: Pick<Viewer, "userId" | "role">): Promise<{ users: UserRow[]; activeCeos: number; creatableRoles: UserRole[] }> {
  const now = new Date();
  const users = await db.user.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      lastLoginAt: true,
      lockedUntil: true,
      failedLogins: true,
      createdAt: true,
      passwordHash: true,
      _count: { select: { sessions: { where: { revokedAt: null, expiresAt: { gt: now } } } } },
    },
  });
  const activeCeos = users.filter((u) => u.role === "CEO" && u.active).length;
  const actor = { userId: viewer.userId, role: viewer.role };
  const rows = users.map((u): UserRow => {
    const target = { id: u.id, role: u.role, active: u.active };
    const assignableRoles = ROLES.filter((r) => !userChangeProblem(actor, target, { kind: "role", role: r }, activeCeos));
    const locked = Boolean(u.lockedUntil && u.lockedUntil > now);
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      active: u.active,
      lastLoginAt: u.lastLoginAt,
      lockedUntil: u.lockedUntil,
      locked,
      failedLogins: u.failedLogins,
      createdAt: u.createdAt,
      isSelf: u.id === viewer.userId,
      activeSessions: u._count.sessions,
      hasPassword: Boolean(u.passwordHash),
      allowed: {
        changeRole: assignableRoles.length > 0,
        deactivate: !userChangeProblem(actor, target, { kind: "deactivate" }, activeCeos),
        reactivate: !userChangeProblem(actor, target, { kind: "reactivate" }, activeCeos),
        resetPassword: !userChangeProblem(actor, target, { kind: "reset_password" }, activeCeos),
        unlock: locked || u.failedLogins > 0,
      },
      assignableRoles,
    };
  });
  const creatableRoles = ROLES.filter((r) => !userChangeProblem(actor, null, { kind: "create", role: r }, activeCeos));
  return { users: rows, activeCeos, creatableRoles };
}

// ─── Grants ──────────────────────────────────────────────────────────────────

export const RESTRICTED_LABEL = "Restricted item";

export interface GrantRow {
  id: string;
  resourceType: GrantResource;
  resourceId: string;
  /** Resolved title (or "Restricted item" when the viewer may not read it). */
  label: string;
  detail: string | null;
  restricted: boolean;
  missing: boolean;
  grantee: { kind: "user"; id: string; name: string; email: string } | { kind: "role"; role: UserRole };
  grantedBy: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  expired: boolean;
}

export interface ResourceLabel {
  label: string;
  detail: string | null;
  restricted: boolean;
  missing: boolean;
}

/** Titles of grantable resources, masked when the viewer's own access does not cover them. */
export async function resolveResourceLabels(scope: AccessScope, refs: { type: GrantResource; id: string }[]): Promise<Map<string, ResourceLabel>> {
  const out = new Map<string, ResourceLabel>();
  const ids = (t: GrantResource) => [...new Set(refs.filter((r) => r.type === t).map((r) => r.id))];
  const [connections, items, readableItems, threads, readableThreads, docs, readableDocs] = await Promise.all([
    db.sourceConnection.findMany({ where: { id: { in: ids("CONNECTION") } }, select: { id: true, label: true, provider: true, accountEmail: true, status: true } }),
    db.sourceItem.findMany({ where: { id: { in: ids("SOURCE_ITEM") } }, select: { id: true, title: true, kind: true, connection: { select: { provider: true } } } }),
    db.sourceItem.findMany({ where: { AND: [{ id: { in: ids("SOURCE_ITEM") } }, sourceItemWhere(scope)] }, select: { id: true } }),
    db.emailThread.findMany({ where: { id: { in: ids("EMAIL_THREAD") } }, select: { id: true, subject: true, messageCount: true } }),
    db.emailThread.findMany({ where: { AND: [{ id: { in: ids("EMAIL_THREAD") } }, emailThreadWhere(scope)] }, select: { id: true } }),
    db.document.findMany({ where: { id: { in: ids("DOCUMENT") } }, select: { id: true, title: true, format: true } }),
    db.document.findMany({ where: { AND: [{ id: { in: ids("DOCUMENT") } }, documentWhere(scope)] }, select: { id: true } }),
  ]);
  const okItems = new Set(readableItems.map((r) => r.id));
  const okThreads = new Set(readableThreads.map((r) => r.id));
  const okDocs = new Set(readableDocs.map((r) => r.id));
  const masked = (detail: string | null): ResourceLabel => ({ label: RESTRICTED_LABEL, detail, restricted: true, missing: false });

  for (const c of connections) {
    // Connection labels are account metadata (no content): always shown.
    out.set(`CONNECTION:${c.id}`, {
      label: c.accountEmail ? `${SOURCE_PROVIDERS[c.provider].label} · ${c.accountEmail}` : c.label,
      detail: c.status === "DISCONNECTED" ? "Disconnected" : SOURCE_PROVIDERS[c.provider].vendor,
      restricted: false,
      missing: false,
    });
  }
  for (const i of items) {
    const detail = `${SOURCE_PROVIDERS[i.connection.provider].label} ${i.kind === "EMAIL_MESSAGE" ? "message" : i.kind === "CALENDAR_EVENT" ? "event" : "document"}`;
    out.set(`SOURCE_ITEM:${i.id}`, okItems.has(i.id) ? { label: i.title, detail, restricted: false, missing: false } : masked(detail));
  }
  for (const t of threads) {
    const detail = `${t.messageCount} message${t.messageCount === 1 ? "" : "s"}`;
    out.set(`EMAIL_THREAD:${t.id}`, okThreads.has(t.id) ? { label: t.subject, detail, restricted: false, missing: false } : masked(detail));
  }
  for (const d of docs) out.set(`DOCUMENT:${d.id}`, okDocs.has(d.id) ? { label: d.title, detail: d.format, restricted: false, missing: false } : masked(d.format));
  for (const r of refs) {
    const key = `${r.type}:${r.id}`;
    if (!out.has(key)) out.set(key, { label: "Deleted resource", detail: null, restricted: false, missing: true });
  }
  return out;
}

export async function getGrants(viewer: Viewer): Promise<GrantRow[]> {
  const now = new Date();
  const [grants, scope] = await Promise.all([
    db.accessGrant.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        id: true,
        resourceType: true,
        resourceId: true,
        role: true,
        createdAt: true,
        expiresAt: true,
        user: { select: { id: true, name: true, email: true } },
        grantedBy: { select: { name: true, email: true } },
      },
    }),
    getAccessScope(viewer),
  ]);
  const labels = await resolveResourceLabels(
    scope,
    grants.map((g) => ({ type: g.resourceType, id: g.resourceId })),
  );
  return grants.map((g) => {
    const l = labels.get(`${g.resourceType}:${g.resourceId}`)!;
    return {
      id: g.id,
      resourceType: g.resourceType,
      resourceId: g.resourceId,
      ...l,
      grantee: g.user ? { kind: "user", id: g.user.id, name: g.user.name, email: g.user.email } : { kind: "role", role: g.role ?? "ADVISOR" },
      grantedBy: g.grantedBy ? g.grantedBy.name || g.grantedBy.email : null,
      createdAt: g.createdAt,
      expiresAt: g.expiresAt,
      expired: Boolean(g.expiresAt && g.expiresAt <= now),
    };
  });
}

export interface GrantableResource {
  id: string;
  label: string;
  detail: string | null;
}

/** Resources the viewer may share: only what their own access covers, so a grant can never widen the granter's reach. */
export async function searchGrantable(viewer: Viewer, type: GrantResource, q: string): Promise<GrantableResource[]> {
  const scope = await getAccessScope(viewer);
  const term = q.trim();
  const take = 12;
  switch (type) {
    case "CONNECTION": {
      const rows = await db.sourceConnection.findMany({
        where: {
          status: { not: "DISCONNECTED" },
          ...(scope.all ? {} : { id: { in: scope.connectionIds } }),
          ...(term ? { OR: [{ label: { contains: term, mode: "insensitive" } }, { accountEmail: { contains: term, mode: "insensitive" } }] } : {}),
        },
        orderBy: { createdAt: "asc" },
        take,
        select: { id: true, label: true, provider: true, accountEmail: true },
      });
      return rows.map((c) => ({ id: c.id, label: c.accountEmail ? `${SOURCE_PROVIDERS[c.provider].label} · ${c.accountEmail}` : c.label, detail: SOURCE_PROVIDERS[c.provider].vendor }));
    }
    case "EMAIL_THREAD": {
      const rows = await db.emailThread.findMany({
        where: { AND: [emailThreadWhere(scope), term ? { subject: { contains: term, mode: "insensitive" } } : {}] },
        orderBy: { lastMessageAt: "desc" },
        take,
        select: { id: true, subject: true, messageCount: true, lastMessageAt: true },
      });
      return rows.map((t) => ({ id: t.id, label: t.subject, detail: `${t.messageCount} message${t.messageCount === 1 ? "" : "s"}` }));
    }
    case "DOCUMENT": {
      const rows = await db.document.findMany({
        where: { AND: [documentWhere(scope), term ? { title: { contains: term, mode: "insensitive" } } : {}] },
        orderBy: { updatedAt: "desc" },
        take,
        select: { id: true, title: true, format: true, currentVersion: true },
      });
      return rows.map((d) => ({ id: d.id, label: d.title, detail: `${d.format} · v${d.currentVersion}` }));
    }
    case "SOURCE_ITEM": {
      const rows = await db.sourceItem.findMany({
        where: { AND: [sourceItemWhere(scope), term ? { title: { contains: term, mode: "insensitive" } } : {}] },
        orderBy: { occurredAt: "desc" },
        take,
        select: { id: true, title: true, kind: true, connection: { select: { provider: true } } },
      });
      return rows.map((i) => ({ id: i.id, label: i.title, detail: SOURCE_PROVIDERS[i.connection.provider].label }));
    }
  }
}

/** True when the viewer's own access covers the resource (required before sharing it). */
export async function canShareResource(scope: AccessScope, type: GrantResource, id: string): Promise<boolean> {
  if (scope.all) {
    // Unrestricted viewers can share anything that exists.
    const exists =
      type === "CONNECTION"
        ? await db.sourceConnection.count({ where: { id } })
        : type === "EMAIL_THREAD"
          ? await db.emailThread.count({ where: { id } })
          : type === "DOCUMENT"
            ? await db.document.count({ where: { id } })
            : await db.sourceItem.count({ where: { id } });
    return exists > 0;
  }
  switch (type) {
    case "CONNECTION":
      return scope.connectionIds.includes(id);
    case "EMAIL_THREAD":
      return (await db.emailThread.count({ where: { AND: [{ id }, emailThreadWhere(scope)] } })) > 0;
    case "DOCUMENT":
      return (await db.document.count({ where: { AND: [{ id }, documentWhere(scope)] } })) > 0;
    case "SOURCE_ITEM":
      return (await db.sourceItem.count({ where: { AND: [{ id }, sourceItemWhere(scope)] } })) > 0;
  }
}

export async function getGrantees(): Promise<{ id: string; name: string; email: string; role: UserRole; active: boolean }[]> {
  return db.user.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }], select: { id: true, name: true, email: true, role: true, active: true } });
}
