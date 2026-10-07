/**
 * Fixed-window rate limiter backed by Postgres, so limits hold across
 * serverless instances. One atomic upsert per check.
 */
import { db } from "@/lib/db";

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

export async function rateLimit(scope: string, subject: string, opts: { limit: number; windowSec: number }): Promise<RateLimitResult> {
  const now = Date.now();
  const windowMs = opts.windowSec * 1000;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const key = `${scope}:${subject}:${windowStart}`.slice(0, 300);
  const expiresAt = new Date(windowStart + windowMs);
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitBucket" ("key", "count", "expiresAt") VALUES (${key}, 1, ${expiresAt})
    ON CONFLICT ("key") DO UPDATE SET "count" = "RateLimitBucket"."count" + 1
    RETURNING "count"`;
  const count = Number(rows[0]?.count ?? 1);
  if (Math.random() < 0.02) {
    db.rateLimitBucket.deleteMany({ where: { expiresAt: { lt: new Date(now - 60_000) } } }).catch(() => {});
  }
  return {
    ok: count <= opts.limit,
    remaining: Math.max(0, opts.limit - count),
    retryAfterSec: Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000)),
  };
}

export const LIMITS = {
  loginIp: { limit: 30, windowSec: 15 * 60 },
  loginAccount: { limit: 8, windowSec: 15 * 60 },
  passwordChange: { limit: 10, windowSec: 15 * 60 },
  search: { limit: 120, windowSec: 60 },
  chief: { limit: 30, windowSec: 60 },
  upload: { limit: 30, windowSec: 60 * 60 },
  syncNow: { limit: 20, windowSec: 60 * 60 },
  webhook: { limit: 600, windowSec: 60 },
  oauth: { limit: 20, windowSec: 15 * 60 },
} as const;
