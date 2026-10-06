import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { z } from "zod";
import { ProviderAuthError } from "../types";
import { ProviderHttpError, buildUrl, mapLimit, parseRetryAfter, providerBuffer, providerJson } from "./http";
import { fakeContext, json, stubFetch } from "./test-helpers";

const fast = { backoffBaseMs: 1 };
const schema = z.object({ ok: z.boolean() });

describe("providerJson", () => {
  let restore: () => void = () => {};
  afterEach(() => restore());

  it("retries 429 and 5xx with backoff, honoring Retry-After", async () => {
    let calls = 0;
    const stub = stubFetch(() => {
      calls++;
      if (calls === 1) return new Response("{}", { status: 429, headers: { "retry-after": "0" } });
      if (calls === 2) return new Response("{}", { status: 503 });
      return json({ ok: true });
    });
    restore = stub.restore;
    assert.deepEqual(await providerJson(fakeContext(), "https://api.example/x", schema, fast), { ok: true });
    assert.equal(calls, 3);
  });

  it("gives up after maxRetries and surfaces status + provider code", async () => {
    restore = stubFetch(() => json({ error: { code: "serviceUnavailable" } }, { status: 503 })).restore;
    await assert.rejects(
      () => providerJson(fakeContext(), "https://api.example/x?secret=delta", schema, { ...fast, maxRetries: 1 }),
      (e: unknown) => e instanceof ProviderHttpError && e.status === 503 && e.code === "serviceUnavailable" && !e.message.includes("secret=delta"),
    );
  });

  it("does not wait inside a job for a long Retry-After", async () => {
    restore = stubFetch(() => new Response("{}", { status: 429, headers: { "retry-after": "120" } })).restore;
    await assert.rejects(() => providerJson(fakeContext(), "https://api.example/x", schema, fast), (e: unknown) => e instanceof ProviderHttpError && e.retryAfterMs === 120_000);
  });

  it("retries Google rate-limit 403s but not permission 403s", async () => {
    let calls = 0;
    restore = stubFetch(() => {
      calls++;
      return calls === 1 ? json({ error: { errors: [{ reason: "userRateLimitExceeded" }] } }, { status: 403 }) : json({ ok: true });
    }).restore;
    assert.deepEqual(await providerJson(fakeContext(), "https://api.example/x", schema, fast), { ok: true });
    restore();
    calls = 0;
    restore = stubFetch(() => {
      calls++;
      return json({ error: { errors: [{ reason: "insufficientPermissions" }] } }, { status: 403 });
    }).restore;
    await assert.rejects(() => providerJson(fakeContext(), "https://api.example/x", schema, fast), (e: unknown) => e instanceof ProviderHttpError && e.code === "insufficientPermissions");
    assert.equal(calls, 1);
  });

  it("401 forces one token refresh, then becomes ProviderAuthError", async () => {
    const seen: string[] = [];
    const ctx = fakeContext();
    restore = stubFetch((req) => {
      seen.push(req.headers.get("authorization") ?? "");
      return seen.length === 1 ? new Response("", { status: 401 }) : json({ ok: true });
    }).restore;
    assert.deepEqual(await providerJson(ctx, "https://api.example/x", schema, fast), { ok: true });
    assert.deepEqual(seen, ["Bearer access-token", "Bearer refreshed-token"]);
    assert.equal(ctx.refreshCount, 1);

    restore();
    restore = stubFetch(() => new Response("", { status: 401 })).restore;
    await assert.rejects(() => providerJson(fakeContext(), "https://api.example/x", schema, fast), ProviderAuthError);
  });

  it("validates the response shape", async () => {
    restore = stubFetch(() => json({ ok: "yes" })).restore;
    await assert.rejects(() => providerJson(fakeContext(), "https://api.example/x", schema, fast), (e: unknown) => e instanceof ProviderHttpError && e.code === "invalid_response");
  });

  it("retries network errors and times out slow requests", async () => {
    let calls = 0;
    restore = stubFetch(() => {
      calls++;
      if (calls === 1) throw new TypeError("fetch failed");
      return json({ ok: true });
    }).restore;
    assert.deepEqual(await providerJson(fakeContext(), "https://api.example/x", schema, fast), { ok: true });
    restore();
    const original = globalThis.fetch;
    globalThis.fetch = ((_: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)))) as typeof fetch;
    restore = () => (globalThis.fetch = original);
    // AbortSignal.timeout timers are unref'd; keep the loop alive the way a server would.
    const keepAlive = setTimeout(() => {}, 2_000);
    try {
      await assert.rejects(() => providerJson(fakeContext(), "https://api.example/x", schema, { ...fast, timeoutMs: 20, maxRetries: 0 }), /timed out/);
    } finally {
      clearTimeout(keepAlive);
    }
  });
});

describe("providerBuffer", () => {
  let restore: () => void = () => {};
  afterEach(() => restore());
  it("downloads bytes without a bearer token when auth is off, and enforces the size cap", async () => {
    const stub = stubFetch(() => new Response(Buffer.from("hello"), { status: 200 }));
    restore = stub.restore;
    assert.equal((await providerBuffer(fakeContext(), "https://download.example/f", { auth: false })).toString(), "hello");
    assert.equal(stub.requests[0].headers.get("authorization"), null);
    await assert.rejects(() => providerBuffer(fakeContext(), "https://download.example/f", { maxBytes: 3 }), (e: unknown) => e instanceof ProviderHttpError && e.status === 413);
  });
});

describe("helpers", () => {
  it("parses Retry-After seconds and dates", () => {
    assert.equal(parseRetryAfter("3"), 3000);
    assert.equal(parseRetryAfter(new Date(10_000).toUTCString(), 4_000), 6000);
    assert.equal(parseRetryAfter("soon"), null);
    assert.equal(parseRetryAfter(null), null);
  });

  it("builds query strings with repeated params", () => {
    assert.equal(buildUrl("https://x.example/a?b=1", { c: "2", d: ["x", "y"], e: undefined, f: true }), "https://x.example/a?b=1&c=2&d=x&d=y&f=true");
  });

  it("maps with bounded concurrency, preserving order", async () => {
    let active = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 3, 2, 4], 2, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, n));
      active--;
      return n * 10;
    });
    assert.deepEqual(out, [50, 10, 30, 20, 40]);
    assert.equal(peak, 2);
  });
});
