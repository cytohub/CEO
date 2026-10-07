import { NextResponse, type NextRequest } from "next/server";
import { REQUEST_PATH_HEADER, pathOf } from "@/server/security/request-path";

/**
 * Coarse gate in front of the app: requests without a session cookie go to
 * sign-in (pages) or get 401 (APIs). This is NOT the security boundary — every
 * page, server action and route handler re-validates the session and checks
 * capabilities on the server (see src/server/security/session.ts).
 *
 * Excluded: the sign-in page, static assets, cron endpoints (bearer secret)
 * and provider webhooks (signature / channel-token verified).
 */
const SESSION_COOKIES = ["__Host-cytohub_session", "cytohub_session"];

export function proxy(request: NextRequest) {
  const path = pathOf(request.nextUrl);
  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (hasSession) {
    // The cookie may still turn out to be expired or revoked: tell the server which page this is, so sign-in can return to it.
    const headers = new Headers(request.headers);
    headers.set(REQUEST_PATH_HEADER, path);
    return NextResponse.next({ request: { headers } });
  }

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL("/login", request.url);
  if (path !== "/") url.searchParams.set("next", path);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/((?!login|forbidden|api/brain/refresh|api/ingestion/tick|api/webhooks/|_next/static|_next/image|favicon.ico|icon|apple-icon|.*\\.(?:png|svg|ico|jpg|jpeg|webp|txt)$).*)",
  ],
};
