/**
 * Which files the document pipeline can read. Adapters skip everything else
 * up front (images, videos, archives, executables) so a large drive does not
 * flood the queue with items that would only be parsed into nothing.
 */

const EXTENSION_MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
};

const SUPPORTED_MIME = new Set([...Object.values(EXTENSION_MIME), "text/x-markdown", "application/csv"]);

/** Google Workspace files are exported to the matching Office format. */
export const GOOGLE_EXPORTS: Record<string, { mimeType: string; extension: string }> = {
  "application/vnd.google-apps.document": { mimeType: EXTENSION_MIME.docx, extension: "docx" },
  "application/vnd.google-apps.spreadsheet": { mimeType: EXTENSION_MIME.xlsx, extension: "xlsx" },
  "application/vnd.google-apps.presentation": { mimeType: EXTENSION_MIME.pptx, extension: "pptx" },
};

export function extensionOf(filename: string): string {
  const m = filename.toLowerCase().match(/\.([a-z0-9]{1,10})$/);
  return m ? m[1] : "";
}

/** Normalized MIME type for a file: trust the extension for the formats we parse (providers often send octet-stream). */
export function documentMimeType(filename: string, mimeType: string | null | undefined): string {
  const ext = extensionOf(filename);
  if (EXTENSION_MIME[ext]) return EXTENSION_MIME[ext];
  return (mimeType ?? "application/octet-stream").split(";")[0].trim().toLowerCase();
}

/** PDF, Office (docx/pptx/xlsx), CSV, plain text and Markdown. */
export function isSupportedDocument(filename: string, mimeType: string | null | undefined): boolean {
  if (EXTENSION_MIME[extensionOf(filename)]) return true;
  return SUPPORTED_MIME.has(documentMimeType(filename, mimeType));
}

/** Upper bound for a single download (provider exports are capped lower anyway). */
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
