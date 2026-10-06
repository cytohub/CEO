/**
 * Test helpers for provider adapters: a fake ProviderContext and a fetch
 * stub that routes requests to handlers by method + URL. Test-only.
 */
import type { ProviderConnection } from "../types";
import type { RefreshableProviderContext } from "./http";

export interface RecordedRequest {
  method: string;
  url: URL;
  headers: Headers;
  body: string | null;
}

type Handler = (req: RecordedRequest) => Response | Promise<Response>;

export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
}

/** Replace globalThis.fetch; returns the request log and a restore function. */
export function stubFetch(route: (req: RecordedRequest) => Response | Promise<Response> | null): { requests: RecordedRequest[]; restore: () => void } {
  const original = globalThis.fetch;
  const requests: RecordedRequest[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const body = init?.body == null ? null : typeof init.body === "string" ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : String(init.body);
    const req: RecordedRequest = { method: (init?.method ?? "GET").toUpperCase(), url, headers: new Headers(init?.headers), body };
    requests.push(req);
    const res = await route(req);
    if (!res) return new Response(JSON.stringify({ error: { code: "not_stubbed" } }), { status: 404 });
    return res;
  }) as typeof fetch;
  return { requests, restore: () => (globalThis.fetch = original) };
}

/** Route table: first matching [method, regex] wins. */
export function routes(table: [string, RegExp, Handler][]): (req: RecordedRequest) => Promise<Response> | Response | null {
  return (req) => {
    for (const [method, re, handler] of table) {
      if (req.method === method && re.test(`${req.url.host}${req.url.pathname}`)) return handler(req);
    }
    return null;
  };
}

export function fakeContext(overrides: Partial<ProviderConnection> = {}, opts: { now?: Date; token?: string; refreshed?: string } = {}): RefreshableProviderContext & { refreshCount: number } {
  const ctx = {
    connection: { id: "conn_test", provider: "GMAIL", mode: "LIVE", accountEmail: "ceo@cytohub.example", settings: {}, ...overrides } as ProviderConnection,
    now: opts.now ?? new Date("2026-10-06T14:00:00Z"),
    refreshCount: 0,
    log: () => {},
    async getAccessToken() {
      return opts.token ?? "access-token";
    },
    async forceRefreshToken() {
      ctx.refreshCount++;
      return opts.refreshed ?? "refreshed-token";
    },
  };
  return ctx;
}
