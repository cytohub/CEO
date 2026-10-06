/**
 * Reveal-over-time for demo fixtures.
 *
 * Each fixture version becomes visible at `revealAt` (demo anchor + offset).
 * A sync returns every version revealed after the cursor and at or before
 * `now`, oldest first, so later syncs see only what is new: new messages, a
 * rescheduled meeting (same externalId, new start), a changed RSVP, an email
 * deleted upstream. That makes incremental sync, deduplication and change
 * detection behave exactly as with a live account.
 *
 * Cursor: { revealedUntil: ISO, lastKey? } — (revealAt, key) of the last
 * version delivered; lastKey is present only while paging.
 */
import { z } from "zod";
import type { SyncCursor } from "../../types";

export interface Revealable<T> {
  /** Unique per version. */
  key: string;
  /** Provider id; several versions may share it. */
  externalId: string;
  revealAt: Date;
  /** null = deleted upstream at revealAt. */
  item: T | null;
}

/** A type alias (not an interface) so it is assignable to SyncCursor. */
export type MockCursor = {
  revealedUntil: string;
  lastKey?: string;
};

const cursorSchema = z.object({ revealedUntil: z.string(), lastKey: z.string().optional() });

export function parseMockCursor(cursor: SyncCursor | null): MockCursor | null {
  if (!cursor) return null;
  const parsed = cursorSchema.safeParse(cursor);
  if (!parsed.success || Number.isNaN(Date.parse(parsed.data.revealedUntil))) return null;
  return parsed.data;
}

function compare(a: { at: number; key: string }, b: { at: number; key: string }) {
  return a.at - b.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

export interface RevealPage<T> {
  items: T[];
  deletedExternalIds: string[];
  cursor: MockCursor;
  hasMore: boolean;
}

export function revealPage<T>(fixtures: Revealable<T>[], cursor: SyncCursor | null, now: Date, pageSize: number): RevealPage<T> {
  const state = parseMockCursor(cursor);
  // Without lastKey, everything revealed up to revealedUntil has been delivered.
  const after = state ? { at: Date.parse(state.revealedUntil), key: state.lastKey ?? "￿" } : { at: -Infinity, key: "" };
  const limit = Math.max(1, pageSize);

  const pending = fixtures
    .filter((f) => f.revealAt.getTime() <= now.getTime() && compare({ at: f.revealAt.getTime(), key: f.key }, after) > 0)
    .sort((a, b) => compare({ at: a.revealAt.getTime(), key: a.key }, { at: b.revealAt.getTime(), key: b.key }));

  const page = pending.slice(0, limit);
  const hasMore = pending.length > limit;

  // Several versions of one item on the same page: only the latest counts.
  const latest = new Map<string, Revealable<T>>();
  for (const f of page) latest.set(f.externalId, f);
  const items: T[] = [];
  const deletedExternalIds: string[] = [];
  for (const f of latest.values()) {
    if (f.item === null) deletedExternalIds.push(f.externalId);
    else items.push(f.item);
  }

  const last = page[page.length - 1];
  let next: MockCursor;
  if (hasMore && last) next = { revealedUntil: last.revealAt.toISOString(), lastKey: last.key };
  else if (state && Date.parse(state.revealedUntil) > now.getTime()) next = { revealedUntil: state.revealedUntil };
  else next = { revealedUntil: now.toISOString() };
  return { items, deletedExternalIds, cursor: next, hasMore };
}
