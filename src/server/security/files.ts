/**
 * Upload validation for files people add to the command center.
 *
 * Defense in depth, in order: sanitized filename → extension allowlist →
 * size → content sniffing that must agree with the extension. The browser's
 * declared MIME type is never trusted (it is derived from the extension on the
 * client); it is only used to reject uploads that announce themselves as
 * something dangerous. Executables, scripts, HTML and SVG (script carriers),
 * macro-enabled Office files and archives that fail the zip-bomb guard are
 * rejected no matter what they are called.
 */
import type { DocumentFormat } from "@/generated/prisma/enums";
import { CANONICAL_MIME, IMAGE_MIME, extensionOf, hasPdfSignature, isExecutable, isHtmlMarkup, isSvgMarkup, looksLikeText } from "@/server/ingestion/documents/formats";
import { MAX_DOCUMENT_BYTES, formatBytes } from "@/server/ingestion/documents/limits";
import { ArchiveError, hasMacros, listZipEntries } from "@/server/ingestion/documents/zip";
import { UPLOAD_MAX_BYTES } from "@/lib/upload-limit";

export const UPLOAD_EXTENSIONS = ["pdf", "docx", "pptx", "xlsx", "csv", "txt", "md", "markdown", "png", "jpg", "jpeg", "webp"] as const;
export type UploadExtension = (typeof UPLOAD_EXTENSIONS)[number];

/** For <input accept>: extensions plus their MIME types. */
export const UPLOAD_ACCEPT = [
  ...UPLOAD_EXTENSIONS.map((e) => `.${e}`),
  CANONICAL_MIME.PDF,
  CANONICAL_MIME.DOCX,
  CANONICAL_MIME.PPTX,
  CANONICAL_MIME.XLSX,
  "text/csv",
  "text/plain",
  "text/markdown",
  IMAGE_MIME.PNG,
  IMAGE_MIME.JPEG,
  IMAGE_MIME.WEBP,
].join(",");

/** Direct uploads: the document limit, or lower where the host caps request bodies (see src/lib/upload-limit.ts). */
export const MAX_UPLOAD_BYTES = Math.min(MAX_DOCUMENT_BYTES, UPLOAD_MAX_BYTES);
const MAX_FILENAME_LENGTH = 180;

export type UploadValidation =
  | { ok: true; format: DocumentFormat; mimeType: string; safeName: string; extension: UploadExtension; sizeBytes: number }
  | { ok: false; reason: string };

/**
 * Basename only, no control / bidi-override characters (they disguise
 * extensions: "invoice‮fdp.exe"), no leading dots, length capped with
 * the extension preserved.
 */
export function sanitizeFilename(name: string): string {
  let base = (name ?? "").split(/[\\/]/).pop() ?? "";
  base = base
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, "")
    .replace(/[<>:"|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "");
  if (!base) return "upload";
  if (base.length <= MAX_FILENAME_LENGTH) return base;
  const ext = extensionOf(base);
  const suffix = ext && ext.length <= 10 ? `.${ext}` : "";
  return `${base.slice(0, MAX_FILENAME_LENGTH - suffix.length).trimEnd()}${suffix}`;
}

const DANGEROUS_DECLARED = /^(application\/(x-msdownload|x-ms-installer|x-msdos-program|x-executable|x-elf|x-mach-binary|x-sh|x-bat|java-archive|x-java-archive|vnd\.microsoft\.portable-executable|javascript|ecmascript|x-httpd-php|xhtml\+xml)|text\/(html|javascript|x-sh|x-python)|image\/svg\+xml)$/i;

const EXT_FORMAT: Record<UploadExtension, DocumentFormat> = {
  pdf: "PDF",
  docx: "DOCX",
  pptx: "PPTX",
  xlsx: "XLSX",
  csv: "CSV",
  txt: "TXT",
  md: "MARKDOWN",
  markdown: "MARKDOWN",
  png: "IMAGE",
  jpg: "IMAGE",
  jpeg: "IMAGE",
  webp: "IMAGE",
};

const OOXML_MAIN_PART: Partial<Record<UploadExtension, string>> = { docx: "word/document.xml", pptx: "ppt/presentation.xml", xlsx: "xl/workbook.xml" };

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  return bytes.length >= sig.length && sig.every((b, i) => bytes[i] === b);
}

function imageKind(bytes: Uint8Array): "png" | "jpeg" | "webp" | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") return "webp";
  return null;
}

export function validateUpload(input: { filename: string; declaredType?: string | null; bytes: Uint8Array | Buffer }): UploadValidation {
  const bytes = input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes);
  const safeName = sanitizeFilename(input.filename);
  const ext = extensionOf(safeName);
  if (!ext || !(UPLOAD_EXTENSIONS as readonly string[]).includes(ext)) {
    return { ok: false, reason: `File type ${ext ? `.${ext} ` : ""}is not supported. Upload PDF, Word, PowerPoint, Excel, CSV, text, Markdown or PNG/JPEG/WebP images.` };
  }
  const extension = ext as UploadExtension;
  if (bytes.length === 0) return { ok: false, reason: "The file is empty." };
  if (bytes.length > MAX_UPLOAD_BYTES) return { ok: false, reason: `The file is ${formatBytes(bytes.length)}; the limit is ${formatBytes(MAX_UPLOAD_BYTES)}.` };
  if (input.declaredType && DANGEROUS_DECLARED.test(input.declaredType.split(";")[0].trim())) {
    return { ok: false, reason: "This kind of file is not allowed." };
  }
  if (isExecutable(bytes)) return { ok: false, reason: "Executable files are not allowed." };

  const format = EXT_FORMAT[extension];
  const mismatch = { ok: false as const, reason: `The file's contents do not match its .${extension} extension.` };

  switch (format) {
    case "PDF":
      if (!hasPdfSignature(bytes)) return mismatch;
      return { ok: true, format, mimeType: CANONICAL_MIME.PDF, safeName, extension, sizeBytes: bytes.length };
    case "DOCX":
    case "PPTX":
    case "XLSX": {
      if (!startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return mismatch;
      let names: string[];
      try {
        const entries = listZipEntries(bytes);
        if (hasMacros(entries)) return { ok: false, reason: "Macro-enabled Office files are not allowed." };
        names = entries.map((e) => e.name);
      } catch (error) {
        if (error instanceof ArchiveError) {
          return { ok: false, reason: error.reason === "corrupt" ? "The Office file is damaged or not a valid document." : `The Office file was rejected: ${error.message}.` };
        }
        throw error;
      }
      if (!names.includes("[Content_Types].xml") || !names.includes(OOXML_MAIN_PART[extension]!)) return mismatch;
      return { ok: true, format, mimeType: CANONICAL_MIME[format], safeName, extension, sizeBytes: bytes.length };
    }
    case "IMAGE": {
      const kind = imageKind(bytes);
      const expected = extension === "jpg" || extension === "jpeg" ? "jpeg" : extension;
      if (kind !== expected) return mismatch;
      return { ok: true, format, mimeType: IMAGE_MIME[kind === "png" ? "PNG" : kind === "jpeg" ? "JPEG" : "WEBP"], safeName, extension, sizeBytes: bytes.length };
    }
    default: {
      // Text formats: must be text, and not a web page or SVG in disguise.
      if (!looksLikeText(bytes)) return mismatch;
      if (isHtmlMarkup(bytes) || isSvgMarkup(bytes)) return { ok: false, reason: "HTML and SVG files are not allowed." };
      if (bytes[0] === 0x23 && bytes[1] === 0x21) return { ok: false, reason: "Scripts are not allowed." }; // "#!"
      const mimeType = format === "CSV" ? CANONICAL_MIME.CSV : format === "MARKDOWN" ? CANONICAL_MIME.MARKDOWN : CANONICAL_MIME.TXT;
      return { ok: true, format, mimeType, safeName, extension, sizeBytes: bytes.length };
    }
  }
}
