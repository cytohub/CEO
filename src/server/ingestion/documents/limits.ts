/**
 * Hard limits for document ingestion and parsing. They bound memory and CPU
 * for hostile or simply huge inputs (zip bombs, 1 GB spreadsheets) so one
 * file can never take the worker down.
 */

/** Largest file we download, store or parse. */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
/** Extracted text kept per document version (longer text is truncated with a warning). */
export const MAX_EXTRACTED_CHARS = 500_000;
/** Text copied onto SourceItem.text for extraction and search. */
export const MAX_SOURCE_ITEM_CHARS = 200_000;
/** Zip guard: declared uncompressed size of all entries together. */
export const MAX_ZIP_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
/** Zip guard: number of entries in the archive. */
export const MAX_ZIP_ENTRIES = 5_000;
/** Async parsers (PDF, OCR) give up after this long. */
export const PARSE_TIMEOUT_MS = 60_000;
/** Spreadsheet rendering caps (per sheet). */
export const MAX_SHEET_ROWS = 2_000;
export const MAX_SHEET_COLS = 60;
/** CSV rendering caps. */
export const MAX_CSV_ROWS = 5_000;
export const MAX_CSV_COLS = 100;
/** Claude vision accepts images up to 5 MB. */
export const MAX_OCR_IMAGE_BYTES = 5 * 1024 * 1024;

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}
