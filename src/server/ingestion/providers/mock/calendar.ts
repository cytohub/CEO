/**
 * DEMO calendar adapter: the CytoHub demo calendar (calendar-fixtures.ts),
 * revealed over time from the connection's demo anchor and limited to the
 * sync window like a real calendar listing.
 */
import type { CalendarProvider } from "../../types";
import { buildCalendarFixtures } from "./calendar-fixtures";
import { revealPage } from "./reveal";
import { demoWorld } from "./world";

export const mockCalendarProvider: CalendarProvider = {
  kind: "CALENDAR",
  async listChanges(ctx, cursor, opts) {
    const lo = opts.windowStart.getTime();
    const hi = opts.windowEnd.getTime();
    const fixtures = buildCalendarFixtures(demoWorld(ctx)).filter((f) => f.item === null || (f.item.endsAt.getTime() >= lo && f.item.startsAt.getTime() <= hi));
    const page = revealPage(fixtures, cursor, ctx.now, opts.pageSize);
    return { items: page.items, deletedExternalIds: page.deletedExternalIds, cursor: { ...page.cursor }, hasMore: page.hasMore };
  },
};
