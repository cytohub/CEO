/**
 * DEMO email adapter: the CytoHub demo mailbox (email-fixtures.ts), revealed
 * over time from the connection's demo anchor. Used for DEMO-mode Gmail and
 * Outlook connections alike.
 */
import type { EmailProvider } from "../../types";
import { buildEmailFixtures } from "./email-fixtures";
import { revealPage } from "./reveal";
import { demoWorld } from "./world";

export const mockEmailProvider: EmailProvider = {
  kind: "EMAIL",
  async listChanges(ctx, cursor, opts) {
    const fixtures = buildEmailFixtures(demoWorld(ctx)).filter((f) => f.item === null || f.item.sentAt.getTime() >= opts.initialSince.getTime());
    const page = revealPage(fixtures, cursor, ctx.now, opts.pageSize);
    return { items: page.items, deletedExternalIds: page.deletedExternalIds, cursor: { ...page.cursor }, hasMore: page.hasMore };
  },
};
