/**
 * Entry point for interactive searches (page, command bar, Chief of Staff):
 * rate-limited per user and audited ("search.query", query length only —
 * never the text, which may itself be sensitive).
 */
import { audit } from "@/server/security/audit";
import { LIMITS, rateLimit } from "@/server/security/rate-limit";
import type { Viewer } from "@/server/security/session";
import { searchBrain } from "./search";
import type { SearchOptions, SearchResponse } from "./types";

export type SearchOutcome = { ok: true; response: SearchResponse } | { ok: false; error: string; retryAfterSec?: number };

export async function searchForViewer(viewer: Viewer, query: string, opts: SearchOptions & { source: "page" | "command-bar" | "chief" }): Promise<SearchOutcome> {
  const q = query.replace(/\s+/g, " ").trim().slice(0, 300);
  const limit = await rateLimit("search", viewer.userId, LIMITS.search);
  if (!limit.ok) {
    await audit({ action: "search.query", viewer, outcome: "DENIED", metadata: { length: q.length, source: opts.source, reason: "rate_limited" } });
    return { ok: false, error: "Too many searches — try again in a moment.", retryAfterSec: limit.retryAfterSec };
  }
  const { source, ...searchOpts } = opts;
  try {
    const response = await searchBrain(viewer, q, searchOpts);
    await audit({ action: "search.query", viewer, metadata: { length: q.length, source, intent: response.plan.intent, results: response.total } });
    return { ok: true, response };
  } catch (error) {
    console.error("[search] failed", error instanceof Error ? error.message : error);
    await audit({ action: "search.query", viewer, outcome: "FAILURE", metadata: { length: q.length, source } });
    return { ok: false, error: "Search failed. Try again." };
  }
}

export { flattenForCommandBar, searchBrain } from "./search";
export type * from "./types";
