import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { OAUTH_FLOW_TTL_MS, appOrigin, callbackPath, flowCookieName, providerFromSlug, providerSlug, sealFlowState } from "@/server/ingestion/providers/oauth";
import { OAuthFlowError, auditOAuthFailure, startOAuthFlow } from "@/server/ingestion/providers/oauth-flow";
import { LIMITS, rateLimit } from "@/server/security/rate-limit";
import { can, getViewer } from "@/server/security/session";

export const dynamic = "force-dynamic";

const connectionIdSchema = z.string().regex(/^[a-z0-9]{10,40}$/i);

/**
 * Start connecting a source: GET /api/integrations/<provider>/connect
 * (provider slug: gmail, outlook-mail, google-calendar, outlook-calendar,
 * google-drive, onedrive, sharepoint, dropbox). `?connectionId=` reconnects an
 * existing connection. Redirects to the provider's consent screen; state and
 * the PKCE verifier travel in a sealed, httpOnly cookie scoped to the callback.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: slug } = await params;
  const requestOrigin = request.nextUrl.origin;
  const origin = appOrigin(requestOrigin);
  const back = (query: string) => NextResponse.redirect(new URL(`/settings/integrations?${query}`, origin ?? requestOrigin), 303);

  const viewer = await getViewer();
  if (!viewer) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/settings/integrations")}`, requestOrigin), 303);
  if (!can(viewer, "integrations.manage")) return Response.json({ error: "Forbidden" }, { status: 403 });

  const limited = await rateLimit("oauth", viewer.userId, LIMITS.oauth);
  if (!limited.ok) return back("error=rate_limited");

  const provider = providerFromSlug(slug);
  if (!provider) return back("error=unknown_provider");
  if (!origin) return back(`error=not_configured&provider=${providerSlug(provider)}`);

  const rawConnectionId = request.nextUrl.searchParams.get("connectionId");
  const connectionId = rawConnectionId ? connectionIdSchema.safeParse(rawConnectionId) : null;
  if (connectionId && !connectionId.success) return back("error=invalid_connection");

  try {
    const { url, flow, vendor } = await startOAuthFlow({ provider, viewer, origin, connectionId: connectionId?.data ?? null });
    const res = NextResponse.redirect(url, 303);
    res.cookies.set(flowCookieName(flow.state), sealFlowState(flow), {
      httpOnly: true,
      secure: origin.startsWith("https://"),
      sameSite: "lax",
      path: callbackPath(vendor),
      maxAge: Math.floor(OAUTH_FLOW_TTL_MS / 1000),
    });
    return res;
  } catch (error) {
    const code = error instanceof OAuthFlowError ? error.code : "provider_error";
    if (code !== "not_configured") await auditOAuthFailure(viewer, { provider, code });
    return back(`error=${code}&provider=${providerSlug(provider)}`);
  }
}
