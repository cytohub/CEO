/**
 * parseDocument: bytes → plain text for every supported format.
 *
 * Pure with respect to the database. Format comes from magic bytes first and
 * the filename / MIME type second (see ../formats.ts). Inputs above the size
 * limit, archives that fail the zip-bomb guard, encrypted or corrupt files
 * raise DocumentParseError; async parsers (PDF, OCR) are bounded by a timeout.
 * Synchronous parsers cannot be interrupted, which is why the archive guards
 * bound their work up front.
 */
import { claudeEnabled, transcribeImageText } from "@/server/ai/claude";
import { detectFormat, imageMediaTypeOf } from "../formats";
import { MAX_DOCUMENT_BYTES, MAX_EXTRACTED_CHARS, PARSE_TIMEOUT_MS, formatBytes } from "../limits";
import { ArchiveError } from "../zip";
import { parseDocx } from "./docx";
import { parseImage } from "./image";
import { parsePdf } from "./pdf";
import { parsePptx } from "./pptx";
import { normalizeText, parseCsv, parseHtml, parsePlainText } from "./text";
import { DocumentParseError, type OcrFunction, type ParseOptions, type ParsedDocument } from "./types";
import { parseXlsx } from "./xlsx";

export { DocumentParseError, type ParsedDocument, type ParseOptions } from "./types";

function defaultOcr(): OcrFunction | null {
  return claudeEnabled() ? (image, mediaType) => transcribeImageText(image, mediaType) : null;
}

/** Cut at the limit on a line boundary when one is near. */
export function capText(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  const cut = text.lastIndexOf("\n", maxChars);
  return { text: text.slice(0, cut > maxChars * 0.9 ? cut : maxChars).trimEnd(), truncated: true };
}

export async function parseDocument(input: Buffer | Uint8Array, opts: ParseOptions = {}): Promise<ParsedDocument> {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (bytes.length > MAX_DOCUMENT_BYTES) {
    throw new DocumentParseError(`File is ${formatBytes(bytes.length)}; the limit is ${formatBytes(MAX_DOCUMENT_BYTES)}`, "too_large");
  }
  const timeoutMs = opts.timeoutMs ?? PARSE_TIMEOUT_MS;
  const maxChars = opts.maxChars ?? MAX_EXTRACTED_CHARS;
  const detected = detectFormat({ bytes, filename: opts.filename, mimeType: opts.mimeType });
  if (detected.format === "OTHER") throw new DocumentParseError(detected.unsupportedReason ?? "Unsupported file format", "unsupported");

  let parsed: ParsedDocument;
  try {
    switch (detected.format) {
      case "PDF":
        parsed = await parsePdf(bytes, { timeoutMs });
        break;
      case "DOCX":
        parsed = parseDocx(bytes);
        break;
      case "PPTX":
        parsed = parsePptx(bytes);
        break;
      case "XLSX":
        parsed = parseXlsx(bytes);
        break;
      case "CSV":
        parsed = parseCsv(bytes);
        break;
      case "HTML":
        parsed = parseHtml(bytes);
        break;
      case "MARKDOWN":
      case "TXT":
        parsed = parsePlainText(bytes, detected.format);
        break;
      case "IMAGE": {
        const mediaType = imageMediaTypeOf(detected.sniffed);
        if (!mediaType) throw new DocumentParseError("Unsupported image type", "unsupported");
        parsed = await parseImage(bytes, mediaType, opts.ocr === undefined ? defaultOcr() : opts.ocr, { timeoutMs });
        break;
      }
    }
  } catch (error) {
    if (error instanceof DocumentParseError) throw error;
    if (error instanceof ArchiveError) throw new DocumentParseError(error.message, error.reason === "corrupt" ? "corrupt" : "archive");
    throw new DocumentParseError(`Could not parse ${detected.format} file (${error instanceof Error ? error.message.slice(0, 200) : "unknown error"})`, "corrupt");
  }

  const clean = normalizeText(parsed.text).replace(/\n{4,}/g, "\n\n\n").trim();
  const capped = capText(clean, maxChars);
  const warnings = [...parsed.warnings];
  if (capped.truncated) warnings.push(`Text truncated at ${maxChars.toLocaleString("en-US")} characters.`);
  return { ...parsed, text: capped.text, truncated: capped.truncated, warnings };
}
