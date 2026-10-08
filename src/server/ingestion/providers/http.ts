/**
 * HTTP client for provider APIs (Google, Microsoft Graph, Dropbox).
 *
 * - Every attempt has a timeout (AbortSignal.timeout, combined with the
 *   caller's signal).
 * - 429 / 5xx / rate-limit 403s and network errors retry with exponential
 *   backoff + jitter, honoring Retry-After. A Retry-After longer than we are
 *   willing to wait inside a job is surfaced as an error so the job queue
 *   reschedules the whole sync instead of holding a worker.
 * - 401 forces one token refresh, then becomes ProviderAuthError (the
 *   connection moves to NEEDS_REAUTH).
 * - JSON responses are validated with zod for the fields the adapter uses.
 *
 * Error messages carry method, host, path and status only — never query
 * strings (delta tokens), bodies or credentials.
 */
import type { z } from "zod";
import { ProviderAuthError, type ProviderContext } from "../types";

export class ProviderHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string | null = null,
    public readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

/** ProviderContext as built by connections.ts: it can also force a token refresh after a 401. */
export type RefreshableProviderContext = ProviderContext & { forceRefreshToken?: () => Promise<string> };

type QueryValue = string | number | boolean | null | undefined | string[];

export interface ProviderRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Record<string, QueryValue>;
  headers?: Record<string, string>;
  /** JSON body (sets Content-Type). */
  json?: unknown;
  /** Raw body (form data, bytes…). */
  body?: string | URLSearchParams | Uint8Array;
  /** Attach `Authorization: Bearer <token>` (default true). Pre-authenticated download URLs set false. */
  auth?: boolean;
  timeoutMs?: number;
  maxRetries?: number;
  /** Base backoff delay; tests shrink it. */
  backoffBaseMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 3;
/** Longer waits are left to the job queue's own backoff. */
const MAX_INLINE_RETRY_AFTER_MS = 30_000;

export function buildUrl(url: string, query?: Record<string, QueryValue>): string {
  if (!query) return url;
  const u = new URL(url);
  for (const [key, value] of Object.entries(query)) {
    if (value == null) continue;
    if (Array.isArray(value)) for (const v of value) u.searchParams.append(key, v);
    else u.searchParams.set(key, String(value));
  }
  return u.toString();
}

/** Retry-After as milliseconds (delta-seconds or HTTP date), or null. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

export function backoffDelay(attempt: number, baseMs = 500): number {
  const exp = baseMs * 2 ** attempt;
  return Math.round(Math.min(20_000, exp) * (0.75 + Math.random() * 0.5));
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (ms <= 0) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
      },
      { once: true },
    );
  });

function describe(method: string, url: string) {
  try {
    const u = new URL(url);
    // Paths can be long (drive item paths); keep the message bounded.
    return `${method} ${u.host}${u.pathname.length > 120 ? `${u.pathname.slice(0, 117)}...` : u.pathname}`;
  } catch {
    return method;
  }
}

/** Provider error code from a JSON error body (Google, Graph, Dropbox, OAuth shapes). */
async function errorCode(res: Response): Promise<string | null> {
  try {
    const text = await res.text();
    if (!text) return null;
    const body = JSON.parse(text) as Record<string, unknown>;
    const err = body.error as unknown;
    if (typeof err === "string") return err.slice(0, 80);
    if (err && typeof err === "object") {
      const e = err as { code?: unknown; status?: unknown; errors?: { reason?: unknown }[]; [".tag"]?: unknown };
      const reason = Array.isArray(e.errors) && typeof e.errors[0]?.reason === "string" ? e.errors[0].reason : null;
      if (reason) return reason.slice(0, 80);
      if (typeof e[".tag"] === "string") return e[".tag"].slice(0, 80);
      if (typeof e.code === "string") return e.code.slice(0, 80);
      if (typeof e.status === "string") return e.status.slice(0, 80);
    }
    if (typeof body.error_summary === "string") return body.error_summary.split("/")[0].slice(0, 80);
    // HubSpot: { "status": "error", "category": "MISSING_SCOPES", … }
    if (typeof body.category === "string") return body.category.slice(0, 80);
    return null;
  } catch {
    return null;
  }
}

const RATE_LIMIT_403 = /rate ?limit|quota|userRateLimitExceeded|rateLimitExceeded|backendError/i;

/** Perform a request with timeouts, retries and token refresh. Returns the OK response. */
export async function providerFetch(ctx: RefreshableProviderContext, url: string, opts: ProviderRequestOptions = {}): Promise<Response> {
  const method = opts.method ?? "GET";
  const full = buildUrl(url, opts.query);
  const label = describe(method, full);
  const auth = opts.auth ?? true;
  const maxRetries = opts.maxRetries ?? DEFAULT_RETRIES;
  const base = opts.backoffBaseMs ?? 500;
  let token = auth ? await ctx.getAccessToken() : null;
  let refreshed = false;

  for (let attempt = 0; ; attempt++) {
    const headers = new Headers(opts.headers);
    if (token) headers.set("authorization", `Bearer ${token}`);
    let body: BodyInit | undefined;
    if (opts.json !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(opts.json);
    } else if (opts.body !== undefined) {
      body = opts.body as BodyInit;
    }
    const timeout = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;

    let res: Response;
    try {
      res = await fetch(full, { method, headers, body, signal, redirect: "follow" });
    } catch (error) {
      if (ctx.signal?.aborted) throw error;
      if (attempt < maxRetries) {
        await sleep(backoffDelay(attempt, base), ctx.signal);
        continue;
      }
      const reason = error instanceof Error ? (error.name === "TimeoutError" ? "timed out" : error.message) : "network error";
      throw new ProviderHttpError(`${label} failed: ${reason}`, 0, "network");
    }

    if (res.status === 401 && auth) {
      await res.body?.cancel().catch(() => {});
      if (!refreshed && ctx.forceRefreshToken) {
        refreshed = true;
        token = await ctx.forceRefreshToken();
        attempt--;
        continue;
      }
      throw new ProviderAuthError(`${label} was rejected (401): access token invalid or revoked`);
    }

    const retryable = res.status === 429 || res.status >= 500;
    if (!res.ok && (retryable || res.status === 403)) {
      const code = await errorCode(res);
      const rateLimited = retryable || (res.status === 403 && code !== null && RATE_LIMIT_403.test(code));
      if (rateLimited) {
        const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
        if (retryAfter != null && retryAfter > MAX_INLINE_RETRY_AFTER_MS) {
          throw new ProviderHttpError(`${label} → ${res.status}: rate limited, retry after ${Math.ceil(retryAfter / 1000)}s`, res.status, code, retryAfter);
        }
        if (attempt < maxRetries) {
          await sleep(retryAfter ?? backoffDelay(attempt, base), ctx.signal);
          continue;
        }
      }
      throw new ProviderHttpError(`${label} → ${res.status}${code ? ` (${code})` : ""}`, res.status, code);
    }
    if (!res.ok) {
      const code = await errorCode(res);
      throw new ProviderHttpError(`${label} → ${res.status}${code ? ` (${code})` : ""}`, res.status, code);
    }
    return res;
  }
}

/** JSON request validated against a zod schema. */
export async function providerJson<S extends z.ZodType>(ctx: RefreshableProviderContext, url: string, schema: S, opts: ProviderRequestOptions = {}): Promise<z.infer<S>> {
  const res = await providerFetch(ctx, url, { ...opts, headers: { accept: "application/json", ...opts.headers } });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new ProviderHttpError(`${describe(opts.method ?? "GET", url)} returned invalid JSON`, res.status, "invalid_json");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const paths = parsed.error.issues
      .slice(0, 3)
      .map((i) => i.path.join(".") || "(root)")
      .join(", ");
    throw new ProviderHttpError(`${describe(opts.method ?? "GET", url)} returned an unexpected shape (${paths})`, res.status, "invalid_response");
  }
  return parsed.data;
}

/** Binary download. Enforces a size cap so a huge file cannot exhaust memory. */
export async function providerBuffer(ctx: RefreshableProviderContext, url: string, opts: ProviderRequestOptions & { maxBytes?: number } = {}): Promise<Buffer> {
  const res = await providerFetch(ctx, url, { timeoutMs: 120_000, ...opts });
  const max = opts.maxBytes ?? 100 * 1024 * 1024;
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > max) {
    await res.body?.cancel().catch(() => {});
    throw new ProviderHttpError(`${describe(opts.method ?? "GET", url)}: file larger than ${Math.round(max / 1024 / 1024)} MB`, 413, "too_large");
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > max) throw new ProviderHttpError(`${describe(opts.method ?? "GET", url)}: file larger than ${Math.round(max / 1024 / 1024)} MB`, 413, "too_large");
  return buf;
}

/** Request whose response body is irrelevant (unsubscribe, revoke). */
export async function providerSend(ctx: RefreshableProviderContext, url: string, opts: ProviderRequestOptions = {}): Promise<void> {
  const res = await providerFetch(ctx, url, opts);
  await res.body?.cancel().catch(() => {});
}

/** Run `fn` over items with bounded concurrency, preserving order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Only follow provider-issued paging links to the provider's own API host (cursors are stored data). */
export function assertHost(url: string, allowed: string[]): string {
  const host = new URL(url).host.toLowerCase();
  if (!allowed.includes(host)) throw new ProviderHttpError(`Refusing to follow a paging link to ${host}`, 0, "bad_host");
  return url;
}
