/**
 * Request helpers for route handlers: client metadata, same-origin checks
 * (CSRF defense for custom POST routes — server actions are origin-checked by
 * Next.js), and bearer-secret verification for cron endpoints.
 */
import { headers } from "next/headers";
import { safeEqual } from "./crypto";

export async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const h = await headers();
    const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
    return { ip: forwarded || h.get("x-real-ip") || null, userAgent: h.get("user-agent")?.slice(0, 400) ?? null };
  } catch {
    // Outside a request (jobs, scripts).
    return { ip: null, userAgent: null };
  }
}

function allowedOrigins(request: Request): string[] {
  const configured = (process.env.APP_ORIGIN ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  return [...configured, ...(host ? [`${proto}://${host}`] : [])];
}

/**
 * Rejects cross-site state-changing requests. Browsers always send Origin on
 * POST; a missing Origin is only accepted for non-browser clients that also
 * fail the session check, so it is treated as cross-site here.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  return allowedOrigins(request).includes(origin);
}

export function forbiddenResponse(message = "Forbidden") {
  return Response.json({ error: message }, { status: 403 });
}

/** Constant-time check of `Authorization: Bearer <secret>`. */
export function hasBearer(request: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") && safeEqual(header.slice(7), secret);
}
