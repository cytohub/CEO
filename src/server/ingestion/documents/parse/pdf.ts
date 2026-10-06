/**
 * PDF → text with unpdf (serverless PDF.js build). Pages are joined with a
 * blank line so evidence quotes never straddle a page break mid-sentence.
 */
import { extractText, getDocumentProxy } from "unpdf";
import { DocumentParseError, type ParsedDocument } from "./types";

type PdfProxy = Awaited<ReturnType<typeof getDocumentProxy>>;

function classify(error: unknown): DocumentParseError {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  if (name === "PasswordException" || /password/i.test(message)) return new DocumentParseError("PDF is password-protected", "encrypted");
  return new DocumentParseError(`PDF could not be read (${message.slice(0, 200)})`, "corrupt");
}

export async function parsePdf(bytes: Buffer | Uint8Array, opts: { timeoutMs: number }): Promise<ParsedDocument> {
  // PDF.js transfers (detaches) the buffer it is given: always pass a copy.
  const data = new Uint8Array(bytes.byteLength);
  data.set(bytes);
  let pdf: PdfProxy | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const work = (async () => {
      pdf = await getDocumentProxy(data, { verbosity: 0, enableXfa: false });
      return extractText(pdf, { mergePages: false });
    })();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new DocumentParseError(`PDF parsing timed out after ${Math.round(opts.timeoutMs / 1000)}s`, "timeout")), opts.timeoutMs);
    });
    const { totalPages, text } = await Promise.race([work, timeout]);
    const pages = (Array.isArray(text) ? text : [text]).map((p) => p.replace(/[ \t]+\n/g, "\n").trim());
    const joined = pages.filter(Boolean).join("\n\n");
    const warnings: string[] = [];
    if (!joined && totalPages > 0) warnings.push("PDF has no text layer (scanned document?) — OCR of PDFs is not enabled.");
    return { text: joined, format: "PDF", parser: "unpdf@1", pageCount: totalPages, warnings };
  } catch (error) {
    if (error instanceof DocumentParseError) throw error;
    throw classify(error);
  } finally {
    if (timer) clearTimeout(timer);
    // Stops any in-flight page work (also after a timeout) and frees the worker memory.
    const proxy = pdf as PdfProxy | null;
    if (proxy) await proxy.loadingTask.destroy().catch(() => {});
  }
}
