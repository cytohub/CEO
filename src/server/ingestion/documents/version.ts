/**
 * DOCUMENT_PARSE: turn the pending version's raw copy into text, decide
 * whether the content really changed, and record what changed.
 *
 *   pending DocumentVersion (parser "pending", encrypted blob)
 *     ─parse─► text identical to the previous version? → version deleted, changed: false
 *            └► version filled: text, page count, parser, key facts,
 *               significant changes vs the previous version, change summary
 *               Document: currentVersion, keyFacts, contentHash
 *               SourceItem: text (capped) + snippet for extraction and search
 *
 * Downstream (change detection / writer) reads the version through
 * loadDocumentChange(): significantChanges, changeSummary, isSignificant.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { Db, Tx } from "@/lib/db";
import { PermanentJobError } from "../jobs/queue";
import { snippetOf } from "../raw";
import { getRetentionPolicy } from "../retention-policy";
import type { PipelineContext } from "../types";
import { deleteBlobIfUnreferenced, purgeBlob, readBlob } from "./blobs";
import {
  type KeyFact,
  type SignificantChange,
  diffKeyFacts,
  extractKeyFacts,
  isSignificantChange,
  parseKeyFacts,
  parseSignificantChanges,
  summarizeChanges,
  textChangeRatio,
} from "./facts";
import { PENDING_PARSER, detectionFilename } from "./common";
import { MAX_SOURCE_ITEM_CHARS } from "./limits";
import { DocumentParseError, type ParsedDocument, capText, parseDocument } from "./parse";

const json = (v: unknown) => v as Prisma.InputJsonValue;

/** Whitespace-insensitive comparison: a re-saved file with reflowed spacing is not a new version. */
export function sameText(a: string, b: string): boolean {
  const norm = (t: string) => t.replace(/\s+/g, " ").trim();
  return norm(a) === norm(b);
}

const UNIT: Partial<Record<ParsedDocument["format"], "slide" | "page" | "sheet">> = { PPTX: "slide", PDF: "page", XLSX: "sheet" };

export function firstVersionSummary(parsed: Pick<ParsedDocument, "format" | "pageCount" | "text" | "warnings">, facts: KeyFact[]): string {
  const parts: string[] = [];
  const unit = UNIT[parsed.format];
  if (unit && parsed.pageCount) parts.push(`${parsed.pageCount} ${unit}${parsed.pageCount === 1 ? "" : "s"}`);
  parts.push(parsed.text ? `${parsed.text.length.toLocaleString("en-US")} characters` : "no text extracted");
  if (facts.length) parts.push(`${facts.length} key figure${facts.length === 1 ? "" : "s"}`);
  const warning = parsed.warnings[0];
  return `First version ingested: ${parts.join(", ")}.${warning ? ` ${warning.replace(/\.?$/, ".")}` : ""}`;
}

export async function parseDocumentItem(ctx: PipelineContext, sourceItemId: string): Promise<{ changed: boolean; documentId: string | null; versionId: string | null }> {
  const client = ctx.db;
  const item = await client.sourceItem.findUnique({
    where: { id: sourceItemId },
    select: { id: true, title: true, text: true, document: { select: { id: true, title: true, path: true, mimeType: true } } },
  });
  if (!item?.document) return { changed: false, documentId: null, versionId: null };
  const doc = item.document;

  const pending = await client.documentVersion.findFirst({ where: { documentId: doc.id, parser: PENDING_PARSER }, orderBy: { version: "desc" } });
  if (!pending) {
    // Another job already parsed this version (duplicate or stale job).
    const latest = await client.documentVersion.findFirst({ where: { documentId: doc.id }, orderBy: { version: "desc" }, select: { id: true } });
    ctx.log("DOCUMENT_PARSE", `${item.title}: no pending version`);
    return { changed: false, documentId: doc.id, versionId: latest?.id ?? null };
  }
  const previous = pending.previousVersionId
    ? await client.documentVersion.findUnique({ where: { id: pending.previousVersionId }, select: { id: true, text: true, keyFacts: true, pageCount: true, blobId: true } })
    : null;

  const bytes = pending.blobId ? await readBlob(pending.blobId, client) : null;
  if (!bytes) throw new PermanentJobError("The raw copy of this document is no longer stored; it will be re-downloaded when the file changes at the source.");

  let parsed: ParsedDocument;
  try {
    parsed = await parseDocument(bytes, { mimeType: doc.mimeType, filename: detectionFilename({ title: doc.title, path: doc.path }) });
  } catch (error) {
    // Corrupt, encrypted, unsupported or oversized files fail the same way on every retry.
    if (error instanceof DocumentParseError && error.permanent) throw new PermanentJobError(error.message);
    throw error;
  }
  for (const w of parsed.warnings) ctx.log("DOCUMENT_PARSE", `${item.title}: ${w}`);

  // Same text as the previous version (re-saved file, metadata-only edit): not a new version.
  if (previous && previous.text != null && sameText(previous.text, parsed.text)) {
    await client.$transaction(async (tx: Tx) => {
      await tx.documentVersion.delete({ where: { id: pending.id } });
      // Search keeps working from the previous version's text.
      if (!item.text) await tx.sourceItem.update({ where: { id: item.id }, data: { text: capText(previous.text!, MAX_SOURCE_ITEM_CHARS).text, snippet: snippetOf(previous.text!) } });
    });
    if (pending.blobId && pending.blobId !== previous.blobId) await deleteBlobIfUnreferenced(pending.blobId, client);
    ctx.log("DOCUMENT_PARSE", `${item.title}: bytes changed but text is identical — no new version`);
    return { changed: false, documentId: doc.id, versionId: previous.id };
  }

  const facts = extractKeyFacts(parsed.text, { reflow: parsed.format === "PDF" });
  let changes: SignificantChange[] = [];
  let summary: string;
  let significant = false;
  if (previous) {
    const ratio = previous.text != null ? textChangeRatio(previous.text, parsed.text) : null;
    changes = diffKeyFacts(parseKeyFacts(previous.keyFacts), facts);
    const unit = UNIT[parsed.format] ?? null;
    summary = summarizeChanges(changes, { unit, before: previous.pageCount, after: parsed.pageCount ?? null }, ratio);
    significant = isSignificantChange(changes, ratio);
  } else {
    summary = firstVersionSummary(parsed, facts);
  }

  const itemText = capText(parsed.text, MAX_SOURCE_ITEM_CHARS).text;
  await client.$transaction(async (tx: Tx) => {
    await tx.documentVersion.update({
      where: { id: pending.id },
      data: {
        text: parsed.text,
        textLength: parsed.text.length,
        pageCount: parsed.pageCount ?? null,
        parser: parsed.parser,
        changeSummary: summary.slice(0, 2000),
        significantChanges: json(changes),
        isSignificant: significant,
        keyFacts: json(facts),
      },
    });
    await tx.document.update({
      where: { id: doc.id },
      data: { currentVersion: pending.version, keyFacts: json(facts), contentHash: pending.contentHash, format: parsed.format },
    });
    await tx.sourceItem.update({
      where: { id: item.id },
      data: { text: itemText, snippet: itemText ? snippetOf(itemText) : (parsed.warnings[0] ?? null) },
    });
  });

  // Retention: with raw copies disabled the encrypted original only lives until it is parsed.
  const policy = await getRetentionPolicy(client);
  if (policy.rawDocumentDays === 0 && pending.blobId) await purgeBlob(pending.blobId, { client });

  ctx.log("DOCUMENT_PARSE", `${item.title}: v${pending.version} parsed (${parsed.parser}, ${parsed.text.length} chars${significant ? ", significant change" : ""})`);
  return { changed: true, documentId: doc.id, versionId: pending.id };
}

// ─── Read side for change detection / writer ─────────────────────────────────

export interface DocumentChange {
  documentId: string;
  versionId: string;
  version: number;
  previousVersionId: string | null;
  previousVersion: number | null;
  modifiedAt: Date;
  changeSummary: string | null;
  isSignificant: boolean;
  significantChanges: SignificantChange[];
  keyFacts: KeyFact[];
}

/** One parsed version with its validated change record (null while still pending). */
export async function loadDocumentChange(client: Db | Tx, versionId: string): Promise<DocumentChange | null> {
  const v = await client.documentVersion.findUnique({
    where: { id: versionId },
    select: {
      id: true,
      documentId: true,
      version: true,
      modifiedAt: true,
      parser: true,
      changeSummary: true,
      isSignificant: true,
      significantChanges: true,
      keyFacts: true,
      previousVersion: { select: { id: true, version: true } },
    },
  });
  if (!v || v.parser === PENDING_PARSER) return null;
  return {
    documentId: v.documentId,
    versionId: v.id,
    version: v.version,
    previousVersionId: v.previousVersion?.id ?? null,
    previousVersion: v.previousVersion?.version ?? null,
    modifiedAt: v.modifiedAt,
    changeSummary: v.changeSummary,
    isSignificant: v.isSignificant,
    significantChanges: parseSignificantChanges(v.significantChanges),
    keyFacts: parseKeyFacts(v.keyFacts),
  };
}
