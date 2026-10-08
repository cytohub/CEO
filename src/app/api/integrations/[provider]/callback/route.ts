import { NextResponse, type NextRequest } from "next/server";
import { OAUTH_VENDORS, type OAuthVendor, REALM_ID, appOrigin, callbackPath, flowCookieName, openFlowState, providerFromSlug, providerSlug, vendorOf } from "@/server/ingestion/providers/oauth";
import { OAuthFlowError, auditOAuthFailure, completeOAuthFlow } from "@/server/ingestion/providers/oauth-flow";
import { LIMITS, rateLimit } from "@/server/security/rate-limit";
import { can, getViewer } from "@/server/security/session";

export const dynamic = "force-dynamic";

function vendorFromSlug(slug: string): OAuthVendor | null {
  if ((OAUTH_VENDORS as string[]).includes(slug)) return slug as OAuthVendor;
  const provider = providerFromSlug(slug);
  return provider ? vendorOf(provider) : null;
}

/**
 * OAuth redirect target: /api/integrations/<google|microsoft|dropbox|intuit|docusign>/callback.
 * Verifies the sealed state cookie (constant-time state match, expiry, same
 * viewer), exchanges the code with the PKCE verifier, stores encrypted
 * credentials and queues the first sync. Tokens never leave the server.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: slug } = await params;
  const requestOrigin = request.nextUrl.origin;
  const origin = appOrigin(requestOrigin) ?? requestOrigin;
  const vendor = vendorFromSlug(slug);
  const q = request.nextUrl.searchParams;
  const state = q.get("state");
  const cookieName = state && state.length <= 200 ? flowCookieName(state) : null;

  const finish = (query: string) => {
    const res = NextResponse.redirect(new URL(`/settings/integrations?${query}`, origin), 303);
    // The flow cookie is single-use.
    if (cookieName && vendor) res.cookies.set(cookieName, "", { httpOnly: true, sameSite: "lax", path: callbackPath(vendor), maxAge: 0 });
    return res;
  };

  const viewer = await getViewer();
  if (!viewer) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/settings/integrations")}`, requestOrigin), 303);
  if (!can(viewer, "integrations.manage")) return Response.json({ error: "Forbidden" }, { status: 403 });
  const limited = await rateLimit("oauth", viewer.userId, LIMITS.oauth);
  if (!limited.ok) return finish("error=rate_limited");
  if (!vendor) return finish("error=unknown_provider");

  const flow = state && cookieName ? openFlowState(request.cookies.get(cookieName)?.value, { state, vendor }) : null;
  if (!flow || flow.userId !== viewer.userId) {
    await auditOAuthFailure(viewer, { provider: vendor, code: "invalid_state" });
    return finish("error=invalid_state");
  }
  const providerParam = providerSlug(flow.provider);

  const providerError = q.get("error");
  if (providerError) {
    const code = providerError === "access_denied" ? "access_denied" : "provider_error";
    await auditOAuthFailure(viewer, { provider: flow.provider, code, providerError: providerError.replace(/[^a-z0-9_.-]/gi, "") });
    return finish(`error=${code}&provider=${providerParam}`);
  }
  const code = q.get("code");
  if (!code || code.length > 4096) {
    await auditOAuthFailure(viewer, { provider: flow.provider, code: "missing_code" });
    return finish(`error=missing_code&provider=${providerParam}`);
  }

  try {
    const realm = q.get("realmId");
    await completeOAuthFlow({ flow, code, origin, viewer, realmId: realm && REALM_ID.test(realm) ? realm : null });
    return finish(`connected=${providerParam}`);
  } catch (error) {
    const errorCode = error instanceof OAuthFlowError ? error.code : "provider_error";
    if (!(error instanceof OAuthFlowError)) console.error("[oauth] callback failed:", error instanceof Error ? error.name : "error");
    await auditOAuthFailure(viewer, { provider: flow.provider, code: errorCode });
    return finish(`error=${errorCode}&provider=${providerParam}`);
  }
}
