/**
 * The server side of "Connect" in Settings → Integrations: start an OAuth
 * flow, and complete it in the callback by storing encrypted credentials on a
 * SourceConnection (new, or the one being reconnected) and queueing a sync.
 * Route handlers stay thin; everything that touches tokens lives here.
 */
import { Prisma } from "@/generated/prisma/client";
import type { SourceProvider } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { SOURCE_PROVIDERS } from "@/lib/intelligence";
import { audit } from "@/server/security/audit";
import type { Viewer } from "@/server/security/session";
import { brainSourceIdFor, decryptCredentials, sealCredentials } from "../connections";
import { requestSync } from "../scheduler";
import {
  type OAuthFlowState,
  type OAuthVendor,
  OAuthTokenError,
  PROVIDER_SCOPES,
  type StoredCredentials,
  authorizationUrl,
  exchangeCode,
  fetchAccountIdentity,
  newFlowState,
  redirectUriFor,
  vendorConfig,
  vendorOf,
} from "./oauth";

export type OAuthErrorCode =
  | "not_configured"
  | "unknown_provider"
  | "invalid_connection"
  | "invalid_state"
  | "access_denied"
  | "provider_error"
  | "missing_code"
  | "token_exchange_failed"
  | "identity_failed"
  | "insufficient_scope"
  | "rate_limited";

export class OAuthFlowError extends Error {
  constructor(
    public readonly code: OAuthErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "OAuthFlowError";
  }
}

/** Build the provider authorization URL and the flow state to seal into the cookie. */
export async function startOAuthFlow(input: { provider: SourceProvider; viewer: Pick<Viewer, "userId">; origin: string; connectionId: string | null }): Promise<{
  url: string;
  flow: OAuthFlowState;
  vendor: OAuthVendor;
}> {
  const vendor = vendorOf(input.provider);
  if (!vendor) throw new OAuthFlowError("unknown_provider");
  const config = vendorConfig(vendor);
  if (!config.configured) throw new OAuthFlowError("not_configured");

  let loginHint: string | null = null;
  if (input.connectionId) {
    const existing = await db.sourceConnection.findUnique({ where: { id: input.connectionId }, select: { provider: true, accountEmail: true, mode: true } });
    if (!existing || existing.provider !== input.provider) throw new OAuthFlowError("invalid_connection");
    loginHint = existing.mode === "LIVE" ? existing.accountEmail : null;
  }
  const { flow, challenge } = newFlowState({ provider: input.provider, connectionId: input.connectionId, userId: input.viewer.userId });
  const url = authorizationUrl(input.provider, { config, state: flow.state, challenge, redirectUri: redirectUriFor(vendor, input.origin), loginHint });
  return { url, flow, vendor };
}

/** Scopes the provider must have granted for the connection to work (identity scopes excluded). */
function requiredScopes(provider: SourceProvider): string[] {
  return PROVIDER_SCOPES[provider].filter((s) => !["openid", "email", "offline_access", "User.Read"].includes(s));
}

function grantedAll(provider: SourceProvider, granted: string | null): boolean {
  if (!granted) return true; // Not every provider echoes scopes; a missing scope then fails on first use.
  const have = new Set(granted.split(/[\s,]+/).map((s) => s.toLowerCase()));
  return requiredScopes(provider).every((s) => {
    const lower = s.toLowerCase();
    // Graph may return fully-qualified scopes (https://graph.microsoft.com/Mail.Read).
    return have.has(lower) || have.has(`https://graph.microsoft.com/${lower}`);
  });
}

/**
 * Exchange the code (PKCE), identify the account and store the connection.
 * Returns the connection id and whether this was a reconnect.
 */
export async function completeOAuthFlow(input: {
  flow: OAuthFlowState;
  code: string;
  origin: string;
  viewer: Pick<Viewer, "userId" | "email">;
  /** QuickBooks: the company the CEO picked on Intuit's consent screen. */
  realmId?: string | null;
}): Promise<{ connectionId: string; reconnected: boolean }> {
  const { flow, viewer } = input;
  const provider = flow.provider;
  const vendor = vendorOf(provider);
  if (!vendor) throw new OAuthFlowError("unknown_provider");
  const config = vendorConfig(vendor);
  if (!config.configured) throw new OAuthFlowError("not_configured");

  let tokens: Awaited<ReturnType<typeof exchangeCode>>;
  try {
    tokens = await exchangeCode(provider, { code: input.code, verifier: flow.verifier, redirectUri: redirectUriFor(vendor, input.origin), config });
  } catch (error) {
    throw new OAuthFlowError("token_exchange_failed", error instanceof OAuthTokenError ? error.message : "token exchange failed");
  }
  if (!grantedAll(provider, tokens.scope)) throw new OAuthFlowError("insufficient_scope");

  let identity: Awaited<ReturnType<typeof fetchAccountIdentity>>;
  try {
    identity = await fetchAccountIdentity(provider, tokens.accessToken, fetch, { realmId: input.realmId ?? null });
  } catch {
    throw new OAuthFlowError("identity_failed");
  }
  const externalAccountId = identity.externalAccountId ?? tokens.accountId;
  const meta = SOURCE_PROVIDERS[provider];

  // Reconnect target: the connection the flow started from, else an earlier connection of the same account.
  const started = flow.connectionId ? await db.sourceConnection.findUnique({ where: { id: flow.connectionId } }) : null;
  if (flow.connectionId && (!started || started.provider !== provider)) throw new OAuthFlowError("invalid_connection");
  // A demo connection is never upgraded in place (its sample data would mix with real mail): connect alongside it.
  const target =
    started && started.mode === "LIVE"
      ? started
      : externalAccountId
        ? await db.sourceConnection.findFirst({ where: { provider, mode: "LIVE", externalAccountId }, orderBy: { createdAt: "desc" } })
        : null;

  const previous = target ? decryptCredentials(target.credentials) : null;
  const previousSettings = target?.settings && typeof target.settings === "object" && !Array.isArray(target.settings) ? (target.settings as Record<string, unknown>) : {};
  // Account details learned at sign-in (never secrets) join the connection's own settings.
  const settings = identity.settings ? ({ ...previousSettings, ...identity.settings } as Prisma.InputJsonValue) : undefined;
  const credentials: StoredCredentials = {
    accessToken: tokens.accessToken,
    // Some re-consents return no new refresh token; keep the one we have.
    refreshToken: tokens.refreshToken ?? previous?.refreshToken ?? null,
    expiresAt: tokens.expiresAt,
    scope: tokens.scope,
    tokenType: tokens.tokenType,
  };
  const brainSourceId = await brainSourceIdFor(provider);
  const scopes = tokens.scope ? tokens.scope.split(/\s+/).filter(Boolean) : PROVIDER_SCOPES[provider];
  const common = {
    mode: "LIVE" as const,
    status: "CONNECTED" as const,
    accountEmail: identity.email,
    externalAccountId,
    scopes,
    credentials: sealCredentials(credentials),
    tokenExpiresAt: tokens.expiresAt ? new Date(tokens.expiresAt) : null,
    ownerUserId: viewer.userId,
    brainSourceId,
    lastError: null,
    lastErrorAt: null,
    consecutiveFailures: 0,
    disconnectedAt: null,
    nextSyncAt: null,
    ...(settings ? { settings } : {}),
  };

  let connectionId: string;
  let reconnected = false;
  if (target) {
    // A different mailbox / drive behind the same connection must not continue the old cursor.
    const accountChanged = Boolean(target.externalAccountId && externalAccountId && target.externalAccountId !== externalAccountId);
    await db.sourceConnection.update({
      where: { id: target.id },
      data: {
        ...common,
        ...(accountChanged ? { cursor: Prisma.DbNull, label: `${meta.label} · ${identity.email ?? "account"}` } : {}),
      },
    });
    connectionId = target.id;
    reconnected = true;
  } else {
    const created = await db.sourceConnection.create({
      data: { ...common, kind: meta.kind, provider, label: `${meta.label} · ${identity.name && meta.kind === "FINANCE" ? identity.name : (identity.email ?? "account")}`, syncFrequency: "HOURLY" },
    });
    connectionId = created.id;
  }
  if (brainSourceId) await db.brainSource.update({ where: { id: brainSourceId }, data: { status: "CONNECTED", error: null } }).catch(() => {});

  await audit({
    action: reconnected ? "connection.reconnect" : "connection.connect",
    viewer,
    targetType: "SourceConnection",
    targetId: connectionId,
    metadata: { provider, mode: "LIVE", account: identity.email, scopes },
  });
  const user = await db.user.findUnique({ where: { id: viewer.userId }, select: { name: true } });
  await db.activity.create({
    data: {
      type: "SOURCE_CONNECTED",
      summary: `${reconnected ? "Reconnected" : "Connected"} ${meta.label}${identity.email ? ` (${identity.email})` : ""}`,
      actor: user?.name ?? viewer.email,
      metadata: { connectionId, provider, mode: "LIVE" },
    },
  });
  await requestSync(connectionId, "MANUAL");
  return { connectionId, reconnected };
}

/** Record a failed attempt without any token material. */
export async function auditOAuthFailure(viewer: Pick<Viewer, "userId" | "email"> | null, details: { provider?: string | null; code: OAuthErrorCode; providerError?: string | null }) {
  await audit({
    action: "connection.oauth_failed",
    viewer,
    outcome: details.code === "invalid_state" ? "DENIED" : "FAILURE",
    targetType: "SourceProvider",
    targetId: details.provider ?? undefined,
    metadata: { code: details.code, ...(details.providerError ? { providerError: details.providerError.slice(0, 60) } : {}) },
  });
}
