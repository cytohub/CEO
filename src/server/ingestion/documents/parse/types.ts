import type { DocumentFormat } from "@/generated/prisma/enums";
import type { ImageMediaType } from "../formats";

export interface ParsedDocument {
  text: string;
  format: DocumentFormat;
  /** Parser id + version, stored on DocumentVersion.parser (e.g. "ooxml-docx@1"). */
  parser: string;
  /** Pages (PDF), slides (PPTX) or sheets (XLSX). */
  pageCount?: number | null;
  warnings: string[];
  /** Text was cut at the extraction limit. */
  truncated?: boolean;
}

/** Image → text transcription (Claude vision). Returns null when unavailable or refused. */
export type OcrFunction = (image: Buffer, mediaType: ImageMediaType) => Promise<string | null>;

export interface ParseOptions {
  mimeType?: string | null;
  filename?: string | null;
  timeoutMs?: number;
  maxChars?: number;
  /** Override OCR (tests); defaults to Claude vision when configured. Pass null to disable. */
  ocr?: OcrFunction | null;
}

export type ParseErrorCode = "too_large" | "unsupported" | "corrupt" | "encrypted" | "archive" | "timeout" | "empty";

/** A parse failure. Everything except "timeout" is permanent: retrying the same bytes cannot help. */
export class DocumentParseError extends Error {
  constructor(
    message: string,
    public code: ParseErrorCode,
  ) {
    super(message);
    this.name = "DocumentParseError";
  }

  get permanent(): boolean {
    return this.code !== "timeout";
  }
}
