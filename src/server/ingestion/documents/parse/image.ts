/**
 * Images (whiteboard photos, scans, screenshots): text comes from Claude
 * vision when it is configured. Without it the document is still ingested
 * (searchable by title, linked as a resource) with empty text and a warning.
 */
import type { ImageMediaType } from "../formats";
import { MAX_OCR_IMAGE_BYTES, formatBytes } from "../limits";
import { DocumentParseError, type OcrFunction, type ParsedDocument } from "./types";

export const OCR_UNAVAILABLE = "OCR requires Claude";

export async function parseImage(bytes: Buffer, mediaType: ImageMediaType, ocr: OcrFunction | null, opts: { timeoutMs: number }): Promise<ParsedDocument> {
  const base = { format: "IMAGE" as const, pageCount: 1 };
  if (!ocr) return { ...base, text: "", parser: "image@1", warnings: [OCR_UNAVAILABLE] };
  if (bytes.length > MAX_OCR_IMAGE_BYTES) {
    return { ...base, text: "", parser: "image@1", warnings: [`Image is ${formatBytes(bytes.length)}; OCR accepts images up to ${formatBytes(MAX_OCR_IMAGE_BYTES)}.`] };
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const text = await Promise.race([
      ocr(bytes, mediaType),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new DocumentParseError("Image transcription timed out", "timeout")), opts.timeoutMs);
      }),
    ]);
    if (text == null) return { ...base, text: "", parser: "claude-vision@1", warnings: ["Image transcription was unavailable; the image is stored without text."] };
    return { ...base, text: text.trim(), parser: "claude-vision@1", warnings: text.trim() ? [] : ["No legible text found in the image."] };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
