/**
 * Mirrors ingested documents into the Resource Center, so a synced deck or
 * contract shows up next to the goals, deals and decisions it belongs to.
 */
import type { DocumentFormat, ResourceType } from "@/generated/prisma/enums";
import type { Db, Tx } from "@/lib/db";
import { extensionOf, formatFromExtension } from "./formats";

const CONTRACT_RE = /\b(agreement|contract|msa|nda|sla|sow|statement of work|terms and conditions|term sheet|amendment|addendum|license|licence|master services)\b/i;
const MODEL_RE = /\b(model|forecast|budget|financials?|p&l|cap table|runway|projections?|plan fy|fy\d{2})\b/i;
const NOTES_RE = /\b(meeting notes|minutes|notes from|call notes)\b/i;
const PAPER_RE = /\b(manuscript|preprint|publication|paper)\b/i;

/** Resource type from format and name (decks → PRESENTATION, agreements → CONTRACT, models → FINANCIAL_MODEL…). */
export function resourceTypeFor(format: DocumentFormat, title: string): ResourceType {
  if (format === "PPTX") return "PRESENTATION";
  if (CONTRACT_RE.test(title)) return "CONTRACT";
  if (format === "XLSX") return MODEL_RE.test(title) ? "FINANCIAL_MODEL" : "DATASET";
  if (format === "CSV") return "DATASET";
  if (NOTES_RE.test(title)) return "MEETING_NOTES";
  if (format === "PDF" && PAPER_RE.test(title)) return "SCIENTIFIC_PAPER";
  return "DOCUMENT";
}

/** "Brightwater MSA v5.docx" → "Brightwater MSA v5" (only known document extensions are stripped). */
export function displayTitle(title: string): string {
  const ext = extensionOf(title);
  return ext && formatFromExtension(ext) ? title.slice(0, -(ext.length + 1)).trim() || title : title;
}

/**
 * Links the document to an existing Resource with the same URL (a link the
 * team added by hand before the connector existed) or creates one.
 * Returns the resource id. Runs on a document's first ingest only, so a
 * resource someone deliberately deleted is not resurrected.
 */
export async function mirrorToResourceCenter(
  client: Db | Tx,
  doc: { id: string; title: string; format: DocumentFormat; url: string | null; path: string | null },
  sourceLabel: string,
): Promise<string> {
  if (doc.url) {
    const existing = await client.resource.findFirst({ where: { url: doc.url, document: { is: null } }, select: { id: true } });
    if (existing) {
      await client.document.update({ where: { id: doc.id }, data: { resourceId: existing.id } });
      return existing.id;
    }
  }
  const resource = await client.resource.create({
    data: {
      title: displayTitle(doc.title).slice(0, 300),
      type: resourceTypeFor(doc.format, doc.title),
      url: doc.url,
      description: `Synced from ${sourceLabel}${doc.path ? ` · ${doc.path}` : ""}`.slice(0, 500),
      tags: ["synced", doc.format.toLowerCase()],
      source: "DOCUMENT",
    },
    select: { id: true },
  });
  await client.document.update({ where: { id: doc.id }, data: { resourceId: resource.id } });
  return resource.id;
}

/** Keeps the mirrored resource's title in step with renames, unless someone retitled the resource by hand. */
export async function syncResourceTitle(client: Db | Tx, resourceId: string | null, previousTitle: string, nextTitle: string) {
  if (!resourceId || previousTitle === nextTitle) return;
  await client.resource.updateMany({
    where: { id: resourceId, source: "DOCUMENT", title: { in: [previousTitle, displayTitle(previousTitle)] } },
    data: { title: displayTitle(nextTitle).slice(0, 300) },
  });
}
