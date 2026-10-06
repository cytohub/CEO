/**
 * OAuth 2.0 (authorization code + PKCE + state) for Google, Microsoft 365
 * and Dropbox.
 *
 * - Least privilege: each connection asks only for the read scope of the one
 *   provider being connected (plus identity), never a combined grant.
 * - The state, PKCE verifier and target are sealed with AES-256-GCM into an
 *   httpOnly, SameSite=Lax cookie scoped to the vendor's callback path; the
 *   callback compares state in constant time and rejects expired flows.
 * - Tokens never appear in URLs or logs; they are stored encrypted on the
 *   SourceConnection by the callback route (see connections.ts for refresh).
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { SourceProvider } from "@/generated/prisma/enums";
import { SOURCE_PROVIDERS } from "@/lib/intelligence";
import { decryptJson, encryptJson, randomToken, safeEqual, sha256 } from "@/server/security/crypto";
import { ProviderAuthError } from "../types";

export type OAuthVendor = "google" | "microsoft" | "dropbox";

export const OAUTH_VENDORS: OAuthVendor[] = ["google", "microsoft", "dropbox"];

/** Read-only scopes per provider. Google adds `openid email` to identify the account. */
export const PROVIDER_SCOPES: Record<SourceProvider, string[]> = {
  GMAIL: ["openid", "email", "https://www.googleapis.com/auth/gmail.readonly"],
  GOOGLE_CALENDAR: ["openid", "email", "https://www.googleapis.com/auth/calendar.readonly"],
  GOOGLE_DRIVE: ["openid", "email", "https://www.googleapis.com/auth/drive.readonly"],
  OUTLOOK_MAIL: ["offline_access", "User.Read", "Mail.Read"],
  OUTLOOK_CALENDAR: ["offline_access", "User.Read", "Calendars.Read"],
  ONEDRIVE: ["offline_access", "User.Read", "Files.Read.All"],
  SHAREPOINT: ["offline_access", "User.Read", "Sites.Read.All"],
  DROPBOX: ["files.metadata.read", "files.content.read", "account_info.read"],
  LOCAL_UPLOAD: [],
  CYTOHUB_INTERNAL: [],
};

export const VENDOR_ENV: Record<OAuthVendor, string[]> = {
  google: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  microsoft: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"],
  dropbox: ["DROPBOX_APP_KEY", "DROPBOX_APP_SECRET"],
};

export function vendorOf(provider: SourceProvider): OAuthVendor | null {
  return SOURCE_PROVIDERS[provider].oauth;
}

/** URL slug for a provider: OUTLOOK_MAIL ⇄ "outlook-mail". */
export function providerSlug(provider: SourceProvider): string {
  return provider.toLowerCase().replace(/_/g, "-");
}

export function providerFromSlug(slug: string): SourceProvider | null {
  const key = slug.trim().toUpperCase().replace(/-/g, "_");
  return key in SOURCE_PROVIDERS ? (key as SourceProvider) : null;
}

export interface VendorConfig {
  vendor: OAuthVendor;
  configured: boolean;
  missingEnv: string[];
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
}

export function vendorConfig(vendor: OAuthVendor, env: NodeJS.ProcessEnv = process.env): VendorConfig {
  const missingEnv = VENDOR_ENV[vendor].filter((name) => !env[name]);
  const [idVar, secretVar] = VENDOR_ENV[vendor];
  const base = { vendor, configured: missingEnv.length === 0, missingEnv, clientId: env[idVar] ?? "", clientSecret: env[secretVar] ?? "" };
  switch (vendor) {
    case "google":
      return { ...base, authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth", tokenUrl: "https://oauth2.googleapis.com/token" };
    case "microsoft": {
      // Tenant is a path segment: allow only the documented forms (GUID, domain, common/organizations/consumers).
      const tenant = (env.MICROSOFT_TENANT_ID ?? "common").trim() || "common";
      const safeTenant = /^[a-z0-9.-]{1,100}$/i.test(tenant) ? tenant : "common";
      return {
        ...base,
        authorizeUrl: `https://login.microsoftonline.com/${safeTenant}/oauth2/v2.0/authorize`,
        tokenUrl: `https://login.microsoftonline.com/${safeTenant}/oauth2/v2.0/token`,
      };
    }
    case "dropbox":
      return { ...base, authorizeUrl: "https://www.dropbox.com/oauth2/authorize", tokenUrl: "https://api.dropboxapi.com/oauth2/token" };
  }
}

// ─── PKCE + state ────────────────────────────────────────────────────────────

/** RFC 7636 S256 challenge for a verifier. */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function createPkcePair(): { verifier: string; challenge: string } {
  // 48 random bytes → 64 base64url characters (RFC 7636: 43–128).
  const verifier = randomToken(48);
  return { verifier, challenge: pkceChallenge(verifier) };
}

export const OAUTH_FLOW_TTL_MS = 10 * 60_000;
export const OAUTH_COOKIE_PREFIX = "cytohub_oauth_";

const stateSchema = z.object({
  state: z.string().min(32).max(200),
  verifier: z.string().min(43).max(128),
  provider: z.string(),
  connectionId: z.string().max(100).nullable(),
  userId: z.string().max(100),
  exp: z.number(),
});

export interface OAuthFlowState {
  state: string;
  verifier: string;
  provider: SourceProvider;
  /** Reconnect target; null creates a new connection. */
  connectionId: string | null;
  /** Viewer who started the flow; the callback requires the same viewer. */
  userId: string;
  exp: number;
}

export function newFlowState(input: { provider: SourceProvider; connectionId: string | null; userId: string; now?: number }): { flow: OAuthFlowState; challenge: string } {
  const { verifier, challenge } = createPkcePair();
  const flow: OAuthFlowState = {
    state: randomToken(32),
    verifier,
    provider: input.provider,
    connectionId: input.connectionId,
    userId: input.userId,
    exp: (input.now ?? Date.now()) + OAUTH_FLOW_TTL_MS,
  };
  return { flow, challenge };
}

/** One cookie per flow (keyed by a hash of the state), so parallel connects in two tabs do not clobber each other. */
export function flowCookieName(state: string): string {
  return `${OAUTH_COOKIE_PREFIX}${sha256(`oauth-state:${state}`).slice(0, 16)}`;
}

export function sealFlowState(flow: OAuthFlowState): string {
  return encryptJson(flow);
}

/**
 * Open the sealed cookie and check it belongs to this callback: the state
 * matches (constant time), it has not expired, and it targets this vendor.
 */
export function openFlowState(sealed: string | undefined | null, expected: { state: string; vendor: OAuthVendor; now?: number }): OAuthFlowState | null {
  if (!sealed || sealed.length > 4000) return null;
  let raw: unknown;
  try {
    raw = decryptJson(sealed);
  } catch {
    return null;
  }
  const parsed = stateSchema.safeParse(raw);
  if (!parsed.success) return null;
  const flow = parsed.data;
  if (!safeEqual(flow.state, expected.state)) return null;
  if (flow.exp <= (expected.now ?? Date.now())) return null;
  const provider = flow.provider as SourceProvider;
  if (!(provider in SOURCE_PROVIDERS) || vendorOf(provider) !== expected.vendor) return null;
  return { ...flow, provider };
}

// ─── URLs ────────────────────────────────────────────────────────────────────

export function callbackPath(vendor: OAuthVendor): string {
  return `/api/integrations/${vendor}/callback`;
}

/**
 * Public origin for redirect URIs and webhook callbacks: the first APP_ORIGIN
 * entry, or (outside production) the request's own origin.
 */
export function appOrigin(requestOrigin?: string | null, env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = (env.APP_ORIGIN ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean)[0];
  if (configured) return configured;
  if (requestOrigin && env.NODE_ENV !== "production") return requestOrigin.replace(/\/+$/, "");
  return null;
}

export function redirectUriFor(vendor: OAuthVendor, origin: string): string {
  return `${origin}${callbackPath(vendor)}`;
}

export function authorizationUrl(
  provider: SourceProvider,
  opts: { config: VendorConfig; state: string; challenge: string; redirectUri: string; loginHint?: string | null },
): string {
  const vendor = vendorOf(provider);
  if (!vendor) throw new Error(`${provider} does not use OAuth`);
  const u = new URL(opts.config.authorizeUrl);
  const p = u.searchParams;
  p.set("client_id", opts.config.clientId);
  p.set("response_type", "code");
  p.set("redirect_uri", opts.redirectUri);
  p.set("state", opts.state);
  p.set("code_challenge", opts.challenge);
  p.set("code_challenge_method", "S256");
  const scopes = PROVIDER_SCOPES[provider];
  if (vendor === "google") {
    p.set("scope", scopes.join(" "));
    // Offline access + consent so Google always returns a refresh token for this grant.
    p.set("access_type", "offline");
    p.set("prompt", "consent");
    if (opts.loginHint) p.set("login_hint", opts.loginHint);
  } else if (vendor === "microsoft") {
    p.set("scope", scopes.join(" "));
    p.set("response_mode", "query");
    p.set("prompt", "select_account");
    if (opts.loginHint) p.set("login_hint", opts.loginHint);
  } else {
    p.set("scope", scopes.join(" "));
    p.set("token_access_type", "offline");
  }
  return u.toString();
}

// ─── Tokens ──────────────────────────────────────────────────────────────────

/** What is stored (encrypted) in SourceConnection.credentials. */
export interface StoredCredentials {
  accessToken: string;
  refreshToken: string | null;
  /** ISO timestamp. */
  expiresAt: string | null;
  scope: string | null;
  tokenType: string;
}

export const storedCredentialsSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().nullable(),
  expiresAt: z.string().nullable(),
  scope: z.string().nullable(),
  tokenType: z.string(),
});

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  expires_in: z.coerce.number().optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
  account_id: z.string().optional(),
});

const tokenErrorSchema = z.object({ error: z.string().optional(), error_description: z.string().optional() });

export class OAuthTokenError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "OAuthTokenError";
  }
}

/** Errors that mean the grant is gone: the user has to reconnect. */
const REVOKED_CODES = new Set(["invalid_grant", "unauthorized_client", "access_denied", "interaction_required", "consent_required", "invalid_token"]);

async function tokenRequest(config: VendorConfig, params: Record<string, string>, fetchImpl: typeof fetch = fetch): Promise<StoredCredentials & { accountId: string | null }> {
  const body = new URLSearchParams({ ...params, client_id: config.clientId, client_secret: config.clientSecret });
  let res: Response;
  try {
    res = await fetchImpl(config.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new OAuthTokenError(`${config.vendor} token endpoint unreachable: ${error instanceof Error ? error.name : "network error"}`, "network");
  }
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = tokenErrorSchema.safeParse(json);
    const code = (err.success && err.data.error) || `http_${res.status}`;
    // error_description can echo request details; keep only the code.
    throw new OAuthTokenError(`${config.vendor} token request failed (${code})`, code);
  }
  const parsed = tokenResponseSchema.safeParse(json);
  if (!parsed.success) throw new OAuthTokenError(`${config.vendor} token response was malformed`, "invalid_response");
  const t = parsed.data;
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? null,
    expiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000).toISOString() : null,
    scope: t.scope ?? null,
    tokenType: t.token_type ?? "Bearer",
    accountId: t.account_id ?? null,
  };
}

export async function exchangeCode(
  provider: SourceProvider,
  opts: { code: string; verifier: string; redirectUri: string; config?: VendorConfig; fetchImpl?: typeof fetch },
): Promise<StoredCredentials & { accountId: string | null }> {
  const vendor = vendorOf(provider);
  if (!vendor) throw new Error(`${provider} does not use OAuth`);
  const config = opts.config ?? vendorConfig(vendor);
  return tokenRequest(config, { grant_type: "authorization_code", code: opts.code, code_verifier: opts.verifier, redirect_uri: opts.redirectUri }, opts.fetchImpl);
}

/**
 * Refresh an access token. Revoked / expired grants become ProviderAuthError
 * (connection → NEEDS_REAUTH); other failures stay retryable.
 */
export async function refreshCredentials(provider: SourceProvider, current: StoredCredentials, opts: { config?: VendorConfig; fetchImpl?: typeof fetch } = {}): Promise<StoredCredentials> {
  const vendor = vendorOf(provider);
  if (!vendor) throw new Error(`${provider} does not use OAuth`);
  if (!current.refreshToken) throw new ProviderAuthError(`${provider} access expired and no refresh token is stored — reconnect`);
  const config = opts.config ?? vendorConfig(vendor);
  if (!config.configured) throw new ProviderAuthError(`${vendor} OAuth is not configured (${config.missingEnv.join(", ")})`);
  const params: Record<string, string> = { grant_type: "refresh_token", refresh_token: current.refreshToken };
  if (vendor === "microsoft") params.scope = PROVIDER_SCOPES[provider].join(" ");
  try {
    const next = await tokenRequest(config, params, opts.fetchImpl);
    return {
      accessToken: next.accessToken,
      // Google and Dropbox keep the refresh token; Microsoft rotates it.
      refreshToken: next.refreshToken ?? current.refreshToken,
      expiresAt: next.expiresAt,
      scope: next.scope ?? current.scope,
      tokenType: next.tokenType,
    };
  } catch (error) {
    if (error instanceof OAuthTokenError && REVOKED_CODES.has(error.code)) {
      throw new ProviderAuthError(`${provider} access was revoked or expired (${error.code}) — reconnect`);
    }
    throw error;
  }
}

// ─── Identity ────────────────────────────────────────────────────────────────

export interface AccountIdentity {
  email: string | null;
  name: string | null;
  externalAccountId: string | null;
}

const googleUser = z.object({ sub: z.string(), email: z.string().optional(), name: z.string().optional() });
const graphMe = z.object({ id: z.string(), mail: z.string().nullable().optional(), userPrincipalName: z.string().nullable().optional(), displayName: z.string().nullable().optional() });
const dropboxAccount = z.object({ account_id: z.string(), email: z.string().optional(), name: z.object({ display_name: z.string().optional() }).optional() });

/** Who authorized the grant (Google userinfo, Graph /me, Dropbox get_current_account). */
export async function fetchAccountIdentity(provider: SourceProvider, accessToken: string, fetchImpl: typeof fetch = fetch): Promise<AccountIdentity> {
  const vendor = vendorOf(provider);
  const headers = { authorization: `Bearer ${accessToken}`, accept: "application/json" };
  const signal = AbortSignal.timeout(15_000);
  if (vendor === "google") {
    const res = await fetchImpl("https://openidconnect.googleapis.com/v1/userinfo", { headers, signal });
    if (!res.ok) throw new OAuthTokenError(`google userinfo failed (${res.status})`, `http_${res.status}`);
    const u = googleUser.parse(await res.json());
    return { email: u.email?.toLowerCase() ?? null, name: u.name ?? null, externalAccountId: u.sub };
  }
  if (vendor === "microsoft") {
    const res = await fetchImpl("https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName,displayName", { headers, signal });
    if (!res.ok) throw new OAuthTokenError(`graph /me failed (${res.status})`, `http_${res.status}`);
    const u = graphMe.parse(await res.json());
    return { email: (u.mail ?? u.userPrincipalName ?? null)?.toLowerCase() ?? null, name: u.displayName ?? null, externalAccountId: u.id };
  }
  if (vendor === "dropbox") {
    const res = await fetchImpl("https://api.dropboxapi.com/2/users/get_current_account", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: "null",
      signal,
    });
    if (!res.ok) throw new OAuthTokenError(`dropbox get_current_account failed (${res.status})`, `http_${res.status}`);
    const u = dropboxAccount.parse(await res.json());
    return { email: u.email?.toLowerCase() ?? null, name: u.name?.display_name ?? null, externalAccountId: u.account_id };
  }
  throw new Error(`${provider} does not use OAuth`);
}

/** Best-effort revocation at the provider (Microsoft has no per-token revoke for delegated grants). */
export async function revokeCredentials(provider: SourceProvider, creds: StoredCredentials, fetchImpl: typeof fetch = fetch): Promise<void> {
  const vendor = vendorOf(provider);
  const signal = AbortSignal.timeout(10_000);
  if (vendor === "google") {
    const token = creds.refreshToken ?? creds.accessToken;
    await fetchImpl("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal,
    });
  } else if (vendor === "dropbox") {
    await fetchImpl("https://api.dropboxapi.com/2/auth/token/revoke", { method: "POST", headers: { authorization: `Bearer ${creds.accessToken}` }, signal });
  }
}
