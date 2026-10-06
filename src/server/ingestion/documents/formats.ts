/**
 * Document format detection: file extension, declared MIME type and magic
 * bytes. Bytes win over names for binary formats (a ".pdf" that is really a
 * Word file is parsed as Word); names decide between the plain-text formats,
 * which have no signature.
 */
import type { DocumentFormat } from "@/generated/prisma/enums";
import { ArchiveError, listZipEntries } from "./zip";

export type SniffedKind =
  | "EMPTY"
  | "PDF"
  | "DOCX"
  | "PPTX"
  | "XLSX"
  | "ZIP"
  | "OLE"
  | "PNG"
  | "JPEG"
  | "GIF"
  | "WEBP"
  | "EXECUTABLE"
  | "HTML"
  | "SVG"
  | "TEXT"
  | "BINARY";

export const CANONICAL_MIME: Record<Exclude<DocumentFormat, "IMAGE">, string> = {
  PDF: "application/pdf",
  DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  PPTX: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  XLSX: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  CSV: "text/csv",
  TXT: "text/plain",
  MARKDOWN: "text/markdown",
  HTML: "text/html",
  OTHER: "application/octet-stream",
};

export const IMAGE_MIME = { PNG: "image/png", JPEG: "image/jpeg", GIF: "image/gif", WEBP: "image/webp" } as const;
export type ImageMediaType = (typeof IMAGE_MIME)[keyof typeof IMAGE_MIME];

const EXTENSION_FORMAT: Record<string, DocumentFormat> = {
  pdf: "PDF",
  docx: "DOCX",
  pptx: "PPTX",
  xlsx: "XLSX",
  csv: "CSV",
  txt: "TXT",
  text: "TXT",
  md: "MARKDOWN",
  markdown: "MARKDOWN",
  html: "HTML",
  htm: "HTML",
  png: "IMAGE",
  jpg: "IMAGE",
  jpeg: "IMAGE",
  gif: "IMAGE",
  webp: "IMAGE",
};

const MIME_FORMAT: Record<string, DocumentFormat> = {
  "application/pdf": "PDF",
  [CANONICAL_MIME.DOCX]: "DOCX",
  [CANONICAL_MIME.PPTX]: "PPTX",
  [CANONICAL_MIME.XLSX]: "XLSX",
  "text/csv": "CSV",
  "application/csv": "CSV",
  "text/plain": "TXT",
  "text/markdown": "MARKDOWN",
  "text/x-markdown": "MARKDOWN",
  "text/html": "HTML",
  "image/png": "IMAGE",
  "image/jpeg": "IMAGE",
  "image/gif": "IMAGE",
  "image/webp": "IMAGE",
};

export function extensionOf(filename: string | null | undefined): string | null {
  if (!filename) return null;
  const base = filename.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return null;
  return base.slice(dot + 1).toLowerCase();
}

export function formatFromExtension(ext: string | null): DocumentFormat | null {
  return ext ? (EXTENSION_FORMAT[ext] ?? null) : null;
}

export function formatFromMime(mime: string | null | undefined): DocumentFormat | null {
  if (!mime) return null;
  return MIME_FORMAT[mime.split(";")[0].trim().toLowerCase()] ?? null;
}

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[offset + i] !== sig[i]) return false;
  return true;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let s = "";
  for (let i = start; i < Math.min(end, bytes.length); i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/** PDF signature anywhere in the first KB (the spec tolerates leading junk). */
export function hasPdfSignature(bytes: Uint8Array): boolean {
  return ascii(bytes, 0, 1024).includes("%PDF-");
}

export function isExecutable(bytes: Uint8Array): boolean {
  if (startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46])) return true; // ELF
  if (startsWith(bytes, [0x00, 0x61, 0x73, 0x6d])) return true; // WebAssembly
  const magic = bytes.length >= 4 ? ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0 : 0;
  if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(magic)) return true; // Mach-O / fat / Java class
  if (startsWith(bytes, [0x4d, 0x5a])) {
    // DOS/PE: "MZ" plus binary header bytes (a text file may legitimately start with "MZ").
    for (let i = 2; i < Math.min(64, bytes.length); i++) if (bytes[i] === 0) return true;
  }
  return false;
}

const utf8Fatal = new TextDecoder("utf-8", { fatal: true });

/** Heuristic text check: no NUL bytes and valid UTF-8 (or a UTF-16 BOM) in the first 64 KB. */
export function looksLikeText(bytes: Uint8Array): boolean {
  if (startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff])) return true;
  const head = bytes.subarray(0, 64 * 1024);
  for (let i = 0; i < Math.min(head.length, 8192); i++) if (head[i] === 0) return false;
  try {
    // stream: true tolerates a multi-byte character cut at the 64 KB boundary.
    utf8Fatal.decode(head, { stream: head.length < bytes.length });
    return true;
  } catch {
    return false;
  }
}

function leadingMarkup(bytes: Uint8Array): string {
  let s = new TextDecoder("utf-8").decode(bytes.subarray(0, 2048)).replace(/^﻿/, "").trimStart().toLowerCase();
  // Skip an XML declaration and comments.
  for (let k = 0; k < 5; k++) {
    if (s.startsWith("<?xml")) s = s.slice(s.indexOf("?>") + 2).trimStart();
    else if (s.startsWith("<!--")) s = s.slice(s.indexOf("-->") + 3).trimStart();
    else break;
  }
  return s;
}

export function isHtmlMarkup(bytes: Uint8Array): boolean {
  return /^<(!doctype\s+html|html[\s>]|head[\s>]|body[\s>]|script[\s>]|iframe[\s>]|meta[\s>])/.test(leadingMarkup(bytes));
}

export function isSvgMarkup(bytes: Uint8Array): boolean {
  return /^(<!doctype\s+svg[^>]*>\s*)?<svg[\s>]/.test(leadingMarkup(bytes));
}

/** Which OOXML package a zip is, from its part names. Throws ArchiveError for unsafe archives. */
export function ooxmlKind(bytes: Uint8Array): "DOCX" | "PPTX" | "XLSX" | "ZIP" {
  const names = new Set(listZipEntries(bytes).map((e) => e.name));
  if (!names.has("[Content_Types].xml")) return "ZIP";
  if (names.has("word/document.xml")) return "DOCX";
  if (names.has("ppt/presentation.xml")) return "PPTX";
  if (names.has("xl/workbook.xml")) return "XLSX";
  return "ZIP";
}

/** Magic-byte classification. Never throws: unreadable archives come back as "ZIP". */
export function sniffBytes(input: Uint8Array | Buffer): SniffedKind {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length === 0) return "EMPTY";
  if (hasPdfSignature(bytes)) return "PDF";
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) {
    try {
      return ooxmlKind(bytes);
    } catch (error) {
      if (error instanceof ArchiveError) return "ZIP";
      throw error;
    }
  }
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "OLE";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "PNG";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "JPEG";
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") return "GIF";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "WEBP";
  if (isExecutable(bytes)) return "EXECUTABLE";
  if (looksLikeText(bytes)) {
    if (isSvgMarkup(bytes)) return "SVG";
    if (isHtmlMarkup(bytes)) return "HTML";
    return "TEXT";
  }
  return "BINARY";
}

export function imageMediaTypeOf(kind: SniffedKind): ImageMediaType | null {
  return kind === "PNG" || kind === "JPEG" || kind === "GIF" || kind === "WEBP" ? IMAGE_MIME[kind] : null;
}

export interface DetectedFormat {
  format: DocumentFormat;
  mimeType: string;
  sniffed: SniffedKind;
  /** Why the format could not be parsed (format OTHER). */
  unsupportedReason?: string;
}

/** Decide how to parse a file. Bytes decide binary formats; extension / MIME decide text formats. */
export function detectFormat(input: { bytes: Uint8Array | Buffer; filename?: string | null; mimeType?: string | null }): DetectedFormat {
  const sniffed = sniffBytes(input.bytes);
  const byName = formatFromExtension(extensionOf(input.filename)) ?? formatFromMime(input.mimeType);
  switch (sniffed) {
    case "PDF":
    case "DOCX":
    case "PPTX":
    case "XLSX":
      return { format: sniffed, mimeType: CANONICAL_MIME[sniffed], sniffed };
    case "PNG":
    case "JPEG":
    case "GIF":
    case "WEBP":
      return { format: "IMAGE", mimeType: IMAGE_MIME[sniffed], sniffed };
    case "HTML":
      return { format: byName === "MARKDOWN" || byName === "TXT" ? byName : "HTML", mimeType: byName === "MARKDOWN" ? CANONICAL_MIME.MARKDOWN : byName === "TXT" ? CANONICAL_MIME.TXT : CANONICAL_MIME.HTML, sniffed };
    case "TEXT": {
      const format: DocumentFormat = byName === "CSV" || byName === "MARKDOWN" || byName === "HTML" ? byName : "TXT";
      return { format, mimeType: CANONICAL_MIME[format], sniffed };
    }
    case "EMPTY": {
      const format: DocumentFormat = byName && byName !== "IMAGE" ? byName : "TXT";
      return { format, mimeType: CANONICAL_MIME[format], sniffed };
    }
    case "OLE":
      return { format: "OTHER", mimeType: CANONICAL_MIME.OTHER, sniffed, unsupportedReason: "Legacy Office binary formats (.doc, .xls, .ppt) are not supported; save as .docx, .xlsx or .pptx." };
    case "ZIP":
      // Named like an Office file: let the parser report the precise archive problem (corrupt, too large…).
      if (byName === "DOCX" || byName === "PPTX" || byName === "XLSX") return { format: byName, mimeType: CANONICAL_MIME[byName], sniffed };
      return { format: "OTHER", mimeType: "application/zip", sniffed, unsupportedReason: "Zip archive is not an Office document." };
    case "SVG":
      return { format: "OTHER", mimeType: "image/svg+xml", sniffed, unsupportedReason: "SVG images are not supported." };
    case "EXECUTABLE":
      return { format: "OTHER", mimeType: CANONICAL_MIME.OTHER, sniffed, unsupportedReason: "Executable content is never parsed." };
    default:
      return { format: "OTHER", mimeType: CANONICAL_MIME.OTHER, sniffed, unsupportedReason: "Unrecognized binary format." };
  }
}
