/**
 * DEMO document adapter: the CytoHub demo drive (document-fixtures.ts) with
 * real PPTX / XLSX / DOCX / PDF / Markdown / CSV / TXT / PNG bytes, revealed
 * over time from the connection's demo anchor (settings.demoAnchor). Serves
 * DEMO-mode Google Drive, OneDrive, SharePoint and Dropbox connections.
 *
 * Cursor { revealedUntil, lastKey? } (see reveal.ts). Each document version
 * carries a versionTag, so an unchanged file is skipped without a download.
 */
import type { DocumentProvider } from "../../types";
import { buildDocumentFixtures } from "./document-fixtures";
import { revealPage } from "./reveal";
import { demoWorld } from "./world";

export const mockDocumentProvider: DocumentProvider = {
  kind: "DOCUMENTS",
  async listChanges(ctx, cursor, opts) {
    const page = revealPage(buildDocumentFixtures(demoWorld(ctx)), cursor, ctx.now, opts.pageSize);
    return { items: page.items, deletedExternalIds: page.deletedExternalIds, cursor: { ...page.cursor }, hasMore: page.hasMore };
  },
};
