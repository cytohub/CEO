import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { ProviderAuthError } from "../types";
import { providerAvailability } from "./availability";
import {
  OAuthTokenError,
  appOrigin,
  authorizationUrl,
  createPkcePair,
  exchangeCode,
  flowCookieName,
  newFlowState,
  openFlowState,
  pkceChallenge,
  providerFromSlug,
  providerSlug,
  refreshCredentials,
  sealFlowState,
  vendorConfig,
} from "./oauth";
import { json } from "./test-helpers";

const env = {
  GOOGLE_CLIENT_ID: "gid",
  GOOGLE_CLIENT_SECRET: "gsecret",
  MICROSOFT_CLIENT_ID: "mid",
  MICROSOFT_CLIENT_SECRET: "msecret",
  MICROSOFT_TENANT_ID: "contoso.onmicrosoft.com",
  DROPBOX_APP_KEY: "dkey",
  DROPBOX_APP_SECRET: "dsecret",
} as unknown as NodeJS.ProcessEnv;

describe("PKCE", () => {
  it("matches the RFC 7636 test vector", () => {
    assert.equal(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("generates fresh verifiers within the allowed length", () => {
    const a = createPkcePair();
    const b = createPkcePair();
    assert.notEqual(a.verifier, b.verifier);
    assert.ok(a.verifier.length >= 43 && a.verifier.length <= 128);
    assert.match(a.verifier, /^[A-Za-z0-9_-]+$/);
    assert.equal(a.challenge, createHash("sha256").update(a.verifier).digest("base64url"));
  });
});

describe("flow state cookie", () => {
  const now = Date.parse("2026-10-06T14:00:00Z");

  it("round-trips and checks state, expiry and vendor", () => {
    const { flow } = newFlowState({ provider: "GMAIL", connectionId: null, userId: "user_1", now });
    const sealed = sealFlowState(flow);
    assert.ok(!sealed.includes(flow.verifier), "verifier is encrypted");
    assert.deepEqual(openFlowState(sealed, { state: flow.state, vendor: "google", now: now + 60_000 }), flow);
    assert.equal(openFlowState(sealed, { state: `${flow.state}x`, vendor: "google", now }), null, "state mismatch");
    assert.equal(openFlowState(sealed, { state: flow.state, vendor: "microsoft", now }), null, "wrong vendor callback");
    assert.equal(openFlowState(sealed, { state: flow.state, vendor: "google", now: now + 11 * 60_000 }), null, "expired after 10 minutes");
    assert.equal(openFlowState(`${sealed.slice(0, -4)}AAAA`, { state: flow.state, vendor: "google", now }), null, "tampered");
    assert.equal(openFlowState(undefined, { state: flow.state, vendor: "google", now }), null);
  });

  it("uses one cookie per flow", () => {
    assert.notEqual(flowCookieName("a".repeat(43)), flowCookieName("b".repeat(43)));
    assert.match(flowCookieName("a".repeat(43)), /^cytohub_oauth_[0-9a-f]{16}$/);
  });
});

describe("authorization URLs", () => {
  const base = { state: "s".repeat(43), challenge: "c".repeat(43), redirectUri: "https://ceo.cytohub.example/api/integrations/google/callback" };

  it("asks Google only for the connected product's read scope plus identity", () => {
    const u = new URL(authorizationUrl("GOOGLE_CALENDAR", { ...base, config: vendorConfig("google", env), loginHint: "ceo@cytohub.example" }));
    assert.equal(u.origin + u.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(u.searchParams.get("scope"), "openid email https://www.googleapis.com/auth/calendar.readonly");
    assert.equal(u.searchParams.get("code_challenge_method"), "S256");
    assert.equal(u.searchParams.get("access_type"), "offline");
    assert.equal(u.searchParams.get("client_id"), "gid");
    assert.equal(u.searchParams.get("login_hint"), "ceo@cytohub.example");
    assert.equal(u.searchParams.get("client_secret"), null);
  });

  it("uses the Microsoft tenant and Graph scopes", () => {
    const u = new URL(authorizationUrl("SHAREPOINT", { ...base, config: vendorConfig("microsoft", env) }));
    assert.equal(u.origin + u.pathname, "https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/authorize");
    assert.equal(u.searchParams.get("scope"), "offline_access User.Read Sites.Read.All");
    const mail = new URL(authorizationUrl("OUTLOOK_MAIL", { ...base, config: vendorConfig("microsoft", { ...env, MICROSOFT_TENANT_ID: undefined }) }));
    assert.match(mail.pathname, /^\/common\//);
    assert.equal(mail.searchParams.get("scope"), "offline_access User.Read Mail.Read");
  });

  it("requests offline Dropbox tokens with read-only scopes", () => {
    const u = new URL(authorizationUrl("DROPBOX", { ...base, config: vendorConfig("dropbox", env) }));
    assert.equal(u.searchParams.get("token_access_type"), "offline");
    assert.equal(u.searchParams.get("scope"), "files.metadata.read files.content.read account_info.read");
  });

  it("rejects an unsafe tenant value", () => {
    assert.match(vendorConfig("microsoft", { ...env, MICROSOFT_TENANT_ID: "../evil" }).authorizeUrl, /\/common\//);
  });
});

describe("slugs, origins and availability", () => {
  it("maps provider slugs both ways", () => {
    assert.equal(providerSlug("OUTLOOK_MAIL"), "outlook-mail");
    assert.equal(providerFromSlug("google-calendar"), "GOOGLE_CALENDAR");
    assert.equal(providerFromSlug("GMAIL"), "GMAIL");
    assert.equal(providerFromSlug("nope"), null);
  });

  it("prefers APP_ORIGIN and only trusts the request origin outside production", () => {
    assert.equal(appOrigin("http://localhost:3000", { APP_ORIGIN: "https://ceo.cytohub.example/, https://other" } as unknown as NodeJS.ProcessEnv), "https://ceo.cytohub.example");
    assert.equal(appOrigin("http://localhost:3000", { NODE_ENV: "development" } as unknown as NodeJS.ProcessEnv), "http://localhost:3000");
    assert.equal(appOrigin("http://attacker.example", { NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv), null);
  });

  it("reports configuration per provider", () => {
    const none = providerAvailability({} as NodeJS.ProcessEnv);
    assert.deepEqual(none.GMAIL, { configured: false, missingEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"], webhooks: false, demo: true });
    assert.deepEqual(none.OUTLOOK_CALENDAR.missingEnv, ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"]);
    assert.deepEqual(none.LOCAL_UPLOAD, { configured: true, missingEnv: [], webhooks: false, demo: false });
    const all = providerAvailability({ ...env, GOOGLE_PUBSUB_TOPIC: "projects/p/topics/t" } as NodeJS.ProcessEnv);
    assert.equal(all.GMAIL.configured, true);
    assert.equal(all.GMAIL.webhooks, true);
    assert.equal(all.DROPBOX.webhooks, true);
    const prod = providerAvailability({ ...env, NODE_ENV: "production" } as NodeJS.ProcessEnv);
    assert.deepEqual(prod.DROPBOX.missingEnv, ["APP_ORIGIN"]);
  });
});

describe("token endpoint", () => {
  const fetchReturning = (res: Response, seen: { body?: string }[] = []) =>
    (async (_url: unknown, init?: RequestInit) => {
      seen.push({ body: init?.body?.toString() });
      return res;
    }) as typeof fetch;

  it("exchanges the code with the PKCE verifier", async () => {
    const seen: { body?: string }[] = [];
    const t = await exchangeCode("GMAIL", {
      code: "c0de",
      verifier: "v".repeat(64),
      redirectUri: "https://x/cb",
      config: vendorConfig("google", env),
      fetchImpl: fetchReturning(json({ access_token: "at", refresh_token: "rt", expires_in: 3599, scope: "openid https://www.googleapis.com/auth/gmail.readonly", token_type: "Bearer" }), seen),
    });
    const body = new URLSearchParams(seen[0].body);
    assert.equal(body.get("grant_type"), "authorization_code");
    assert.equal(body.get("code_verifier"), "v".repeat(64));
    assert.equal(body.get("client_secret"), "gsecret");
    assert.equal(t.accessToken, "at");
    assert.equal(t.refreshToken, "rt");
    assert.ok(Date.parse(t.expiresAt!) > Date.now() + 3_500_000);
  });

  it("refresh keeps the old refresh token when none is returned, and rotates when one is", async () => {
    const current = { accessToken: "old", refreshToken: "rt-1", expiresAt: null, scope: "s", tokenType: "Bearer" };
    const google = await refreshCredentials("GMAIL", current, { config: vendorConfig("google", env), fetchImpl: fetchReturning(json({ access_token: "new", expires_in: 3600 })) });
    assert.equal(google.refreshToken, "rt-1");
    const seen: { body?: string }[] = [];
    const ms = await refreshCredentials("OUTLOOK_MAIL", current, {
      config: vendorConfig("microsoft", env),
      fetchImpl: fetchReturning(json({ access_token: "new", refresh_token: "rt-2", expires_in: 3600 }), seen),
    });
    assert.equal(ms.refreshToken, "rt-2");
    assert.equal(new URLSearchParams(seen[0].body).get("scope"), "offline_access User.Read Mail.Read");
  });

  it("maps revoked grants to ProviderAuthError and other failures to retryable errors", async () => {
    const current = { accessToken: "old", refreshToken: "rt", expiresAt: null, scope: null, tokenType: "Bearer" };
    await assert.rejects(
      () => refreshCredentials("GMAIL", current, { config: vendorConfig("google", env), fetchImpl: fetchReturning(json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, { status: 400 })) }),
      (e: unknown) => e instanceof ProviderAuthError && !String((e as Error).message).includes("revoked."),
    );
    await assert.rejects(
      () => refreshCredentials("GMAIL", current, { config: vendorConfig("google", env), fetchImpl: fetchReturning(json({ error: "server_error" }, { status: 500 })) }),
      (e: unknown) => e instanceof OAuthTokenError && !(e instanceof ProviderAuthError),
    );
    await assert.rejects(() => refreshCredentials("GMAIL", { ...current, refreshToken: null }, { config: vendorConfig("google", env) }), ProviderAuthError);
  });
});
