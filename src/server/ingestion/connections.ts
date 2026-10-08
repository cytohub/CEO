/**
 * Connection lifecycle used by Settings → Integrations, OAuth callbacks and
 * sync jobs:
 *
 * - getProviderContext: what an adapter runs with. For LIVE connections it
 *   decrypts the stored token set, refreshes it when it expires within two
 *   minutes (or after a 401), and persists the re-encrypted result. Revoked
 *   grants surface as ProviderAuthError (connection → NEEDS_REAUTH).
 * - createDemoConnection: a DEMO connection over the sample CytoHub world.
 * - disconnectConnection: stop webhooks, forget credentials, optionally
 *   delete the ingested source items (never the intelligence derived from
 *   them — provenance snapshots survive by design).
 */
import { Prisma, type SourceConnection } from "@/generated/prisma/client";
import type { SourceKind, SourceProvider } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { SOURCE_PROVIDERS } from "@/lib/intelligence";
import { BRAIN_SOURCE_KEY, CONNECTOR_DEFINITIONS } from "@/server/brain/connectors";
import { audit } from "@/server/security/audit";
import { decryptJson, encryptJson } from "@/server/security/crypto";
import { PROVIDER_SCOPES, type StoredCredentials, refreshCredentials, revokeCredentials, storedCredentialsSchema, vendorOf } from "./providers/oauth";
import { getWebhookSubscriber } from "./providers/registry";
import { DEMO_ACCOUNT_EMAIL } from "./providers/mock/world";
import type { RefreshableProviderContext } from "./providers/http";
import { ProviderAuthError, type ProviderContext } from "./types";

/** Refresh access tokens this long before they expire. */
const REFRESH_MARGIN_MS = 2 * 60_000;

export function connectionSettings(conn: Pick<SourceConnection, "settings">): Record<string, unknown> {
  const s = conn.settings;
  return s && typeof s === "object" && !Array.isArray(s) ? (s as Record<string, unknown>) : {};
}

/** BrainSource catalog row for a provider, created from the connector catalog on first use. */
export async function brainSourceIdFor(provider: SourceProvider): Promise<string | null> {
  const key = BRAIN_SOURCE_KEY[provider];
  const row = await db.brainSource.findUnique({ where: { key }, select: { id: true } });
  if (row) return row.id;
  const def = CONNECTOR_DEFINITIONS.find((c) => c.key === key);
  if (!def) return null;
  const created = await db.brainSource.upsert({
    where: { key },
    create: { key, name: def.name, category: def.category, description: def.description },
    update: {},
    select: { id: true },
  });
  return created.id;
}

export function decryptCredentials(sealed: string | null): StoredCredentials | null {
  if (!sealed) return null;
  try {
    const parsed = storedCredentialsSchema.safeParse(decryptJson(sealed));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function sealCredentials(creds: StoredCredentials): string {
  return encryptJson(creds);
}

function debugLog(connectionId: string) {
  return (message: string) => {
    if (process.env.CYTOHUB_INGEST_DEBUG === "true") console.log(`[provider:${connectionId.slice(-6)}] ${message}`);
  };
}

/** Build the ProviderContext for a connection (token refresh for LIVE connections). */
export async function getProviderContext(connectionId: string, now: Date = new Date()): Promise<ProviderContext> {
  const conn = await db.sourceConnection.findUniqueOrThrow({ where: { id: connectionId } });
  const connection = { id: conn.id, provider: conn.provider, mode: conn.mode, accountEmail: conn.accountEmail, settings: connectionSettings(conn) };
  const log = debugLog(conn.id);

  // Key- and webhook-based sources: the stored key is the bearer token; there is nothing to refresh,
  // so a 401 means the key was revoked (connection → NEEDS_REAUTH, replace the key in Settings).
  const auth = SOURCE_PROVIDERS[conn.provider].auth;
  if (conn.mode === "LIVE" && (auth === "apiKey" || auth === "webhook")) {
    const key = decryptCredentials(conn.credentials)?.accessToken ?? null;
    const ctx: ProviderContext = {
      connection,
      now,
      log,
      async getAccessToken() {
        if (!key) throw new ProviderAuthError(`${SOURCE_PROVIDERS[conn.provider].label} has no key — add it in Settings → Integrations`);
        return key;
      },
    };
    return ctx;
  }

  if (conn.mode === "DEMO" || !vendorOf(conn.provider)) {
    const ctx: ProviderContext = {
      connection,
      now,
      log,
      async getAccessToken() {
        throw new Error(`${conn.provider} ${conn.mode === "DEMO" ? "demo connection" : "source"} has no access token`);
      },
    };
    return ctx;
  }

  let creds = decryptCredentials(conn.credentials);
  // One refresh at a time per context: concurrent requests share the same promise.
  let inflight: Promise<string> | null = null;

  const refresh = (): Promise<string> => {
    if (!inflight) {
      inflight = (async () => {
        if (!creds) throw new ProviderAuthError(`${SOURCE_PROVIDERS[conn.provider].label} is not authorized — reconnect`);
        const next = await refreshCredentials(conn.provider, creds);
        creds = next;
        await db.sourceConnection.update({
          where: { id: conn.id },
          data: { credentials: sealCredentials(next), tokenExpiresAt: next.expiresAt ? new Date(next.expiresAt) : null },
        });
        log("access token refreshed");
        return next.accessToken;
      })().finally(() => {
        inflight = null;
      });
    }
    return inflight;
  };

  const ctx: RefreshableProviderContext = {
    connection,
    now,
    log,
    async getAccessToken() {
      if (!creds) throw new ProviderAuthError(`${SOURCE_PROVIDERS[conn.provider].label} is not authorized — reconnect`);
      // Token lifetimes are real time, independent of the pipeline's (possibly simulated) clock.
      const expiresAt = creds.expiresAt ? Date.parse(creds.expiresAt) : null;
      if (expiresAt !== null && expiresAt - Date.now() < REFRESH_MARGIN_MS) return refresh();
      return creds.accessToken;
    },
    forceRefreshToken: refresh,
  };
  return ctx;
}

// ─── Demo connections ────────────────────────────────────────────────────────

const DEMO_SCOPE_NOTE = "demo: read-only sample data";

/**
 * Create a DEMO-mode connection backed by the mock adapters (sample CytoHub
 * data). `opts.anchor` fixes the demo timeline (defaults to now): fixtures are
 * placed relative to it and revealed as time passes it.
 */
export async function createDemoConnection(
  kind: SourceKind,
  provider: SourceProvider,
  owner: { userId: string },
  /** `actor`: who clicked connect (audited); defaults to the owner. */
  opts: { anchor?: Date; actor?: { userId: string; email: string } } = {},
): Promise<SourceConnection> {
  const meta = SOURCE_PROVIDERS[provider];
  if (meta.kind !== kind) throw new Error(`${meta.label} is not a ${kind.toLowerCase()} source`);
  if (provider === "LOCAL_UPLOAD" || provider === "CYTOHUB_INTERNAL") throw new Error(`${meta.label} has no demo mode`);

  const [user, ceo, brainSourceId] = await Promise.all([
    db.user.findUnique({ where: { id: owner.userId }, select: { id: true, email: true, name: true, timezone: true, role: true } }),
    db.user.findFirst({ where: { role: "CEO", active: true }, orderBy: { createdAt: "asc" }, select: { name: true, timezone: true } }),
    brainSourceIdFor(provider),
  ]);
  if (!user) throw new Error("Owner not found");
  const ceoName = (ceo ?? user).name.trim();
  const anchor = opts.anchor ?? new Date();

  const conn = await db.sourceConnection.create({
    data: {
      kind,
      provider,
      mode: "DEMO",
      label: `${meta.label} · demo`,
      accountEmail: DEMO_ACCOUNT_EMAIL,
      externalAccountId: `demo:${provider.toLowerCase()}`,
      status: "CONNECTED",
      syncFrequency: "HOURLY",
      scopes: [...PROVIDER_SCOPES[provider].filter((s) => !["openid", "email", "offline_access"].includes(s)), DEMO_SCOPE_NOTE],
      settings: {
        demoAnchor: anchor.toISOString(),
        timezone: (ceo ?? user).timezone,
        ceoName,
        ceoFirstName: ceoName.split(/\s+/)[0] ?? ceoName,
        initialDays: 90,
      },
      ownerUserId: user.id,
      brainSourceId,
    },
  });
  if (brainSourceId) await db.brainSource.update({ where: { id: brainSourceId }, data: { status: "CONNECTED", error: null } }).catch(() => {});
  await audit({
    action: "connection.connect",
    viewer: opts.actor ?? { userId: user.id, email: user.email },
    targetType: "SourceConnection",
    targetId: conn.id,
    metadata: { provider, kind, mode: "DEMO", ownerUserId: user.id },
  });
  await db.activity.create({ data: { type: "SOURCE_CONNECTED", summary: `Connected ${conn.label}`, actor: user.name, metadata: { connectionId: conn.id, provider, mode: "DEMO" } } });
  return conn;
}

// ─── Disconnect ──────────────────────────────────────────────────────────────

/** Disconnect: revoke/forget credentials, stop webhooks; optionally delete ingested data per retention. */
export async function disconnectConnection(connectionId: string, opts: { deleteData: boolean; actor: { userId: string; email: string } }): Promise<void> {
  const conn = await db.sourceConnection.findUniqueOrThrow({ where: { id: connectionId } });
  const notes: string[] = [];

  // 1. Best effort at the provider: stop push notifications, revoke the grant.
  if (conn.mode === "LIVE" && conn.credentials) {
    try {
      const ctx = await getProviderContext(conn.id);
      const subscriber = getWebhookSubscriber(conn);
      if (subscriber && conn.webhookChannelId) await subscriber.unsubscribe(ctx, conn.webhookChannelId);
    } catch (error) {
      notes.push(`webhook: ${error instanceof Error ? error.message.slice(0, 200) : "failed"}`);
    }
    const creds = decryptCredentials(conn.credentials);
    // Google/Dropbox revocation kills the whole grant for the account; keep it when another
    // active connection of the same vendor and account still relies on it.
    const vendor = vendorOf(conn.provider);
    const siblings = await db.sourceConnection.count({
      where: {
        id: { not: conn.id },
        mode: "LIVE",
        accountEmail: conn.accountEmail,
        status: { not: "DISCONNECTED" },
        provider: { in: (Object.keys(SOURCE_PROVIDERS) as SourceProvider[]).filter((p) => vendorOf(p) === vendor) },
      },
    });
    if (creds && siblings === 0) {
      await revokeCredentials(conn.provider, creds).catch(() => notes.push("revoke: failed"));
    }
  }

  // 2. Forget credentials and stop scheduling; cancel queued syncs.
  const now = new Date();
  await db.sourceConnection.update({
    where: { id: conn.id },
    data: {
      status: "DISCONNECTED",
      disconnectedAt: now,
      credentials: null,
      tokenExpiresAt: null,
      webhookChannelId: null,
      webhookSecretHash: null,
      webhookExpiresAt: null,
      nextSyncAt: null,
      cursor: Prisma.DbNull,
    },
  });
  await db.ingestionJob.updateMany({
    where: { connectionId: conn.id, status: { in: ["QUEUED", "FAILED"] }, type: { in: ["EMAIL_SYNC", "CALENDAR_SYNC", "DOCUMENT_SYNC", "MEETINGS_SYNC", "BUSINESS_SYNC"] } },
    data: { status: "CANCELLED", dedupeKey: null, completedAt: now },
  });

  // 3. Optionally delete what was ingested. Source items cascade to messages, events,
  // documents and mentions; derived intelligence keeps its SourceReference snapshots.
  let deletedItems = 0;
  if (opts.deleteData) {
    const res = await db.sourceItem.deleteMany({ where: { connectionId: conn.id } });
    deletedItems = res.count;
    await db.emailThread.deleteMany({ where: { connectionId: conn.id } });
    await db.sourceConnection.update({ where: { id: conn.id }, data: { itemsIngested: 0 } });
  }

  // 4. Catalog status: not connected once no active connection uses it.
  if (conn.brainSourceId) {
    const active = await db.sourceConnection.count({ where: { brainSourceId: conn.brainSourceId, status: { not: "DISCONNECTED" } } });
    if (active === 0) await db.brainSource.update({ where: { id: conn.brainSourceId }, data: { status: "NOT_CONNECTED" } }).catch(() => {});
  }

  await audit({
    action: "connection.disconnect",
    viewer: opts.actor,
    targetType: "SourceConnection",
    targetId: conn.id,
    metadata: { provider: conn.provider, mode: conn.mode, deleteData: opts.deleteData, deletedItems, ...(notes.length ? { notes } : {}) },
  });
  const actorUser = await db.user.findUnique({ where: { id: opts.actor.userId }, select: { name: true } });
  await db.activity.create({
    data: {
      type: "SOURCE_DISCONNECTED",
      summary: `Disconnected ${conn.label}${opts.deleteData ? ` and deleted ${deletedItems} ingested item${deletedItems === 1 ? "" : "s"}` : ""}`,
      actor: actorUser?.name ?? opts.actor.email,
      metadata: { connectionId: conn.id, provider: conn.provider, deleteData: opts.deleteData },
    },
  });
}
