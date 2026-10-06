/**
 * Guarded zip access for OOXML packages (docx / pptx / xlsx).
 *
 * The central directory is read first without inflating anything, so a zip
 * bomb is rejected on its declared sizes before a single byte is expanded.
 * fflate inflates each selected entry into a buffer of exactly the declared
 * size, so an entry that lies about its size cannot grow past it either.
 * Entry names that try to escape the archive root are rejected outright even
 * though nothing is ever written to disk: a package that contains them is not
 * a document anyone produced by accident.
 */
import { unzipSync } from "fflate";
import { MAX_ZIP_ENTRIES, MAX_ZIP_UNCOMPRESSED_BYTES, formatBytes } from "./limits";

export class ArchiveError extends Error {
  constructor(
    message: string,
    public reason: "corrupt" | "too_many_entries" | "too_large" | "unsafe_path",
  ) {
    super(message);
    this.name = "ArchiveError";
  }
}

export interface ZipEntryInfo {
  name: string;
  compressedSize: number;
  size: number;
}

export interface ZipLimits {
  maxEntries?: number;
  maxUncompressedBytes?: number;
}

export function isUnsafeEntryName(name: string): boolean {
  if (!name || name.length > 1024) return true;
  if (name.includes("\0") || name.includes("\\")) return true;
  if (name.startsWith("/") || /^[a-zA-Z]:/.test(name)) return true;
  return name.split("/").some((part) => part === "..");
}

function toUint8(bytes: Uint8Array | Buffer): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

/** Lists entries (no inflation) and enforces the archive guards. Throws ArchiveError. */
export function listZipEntries(bytes: Uint8Array | Buffer, limits: ZipLimits = {}): ZipEntryInfo[] {
  const maxEntries = limits.maxEntries ?? MAX_ZIP_ENTRIES;
  const maxTotal = limits.maxUncompressedBytes ?? MAX_ZIP_UNCOMPRESSED_BYTES;
  const entries: ZipEntryInfo[] = [];
  let total = 0;
  try {
    unzipSync(toUint8(bytes), {
      filter(file) {
        if (entries.length >= maxEntries) throw new ArchiveError(`Archive has more than ${maxEntries.toLocaleString("en-US")} entries`, "too_many_entries");
        if (isUnsafeEntryName(file.name)) throw new ArchiveError("Archive contains an unsafe entry path", "unsafe_path");
        total += file.originalSize;
        if (total > maxTotal) throw new ArchiveError(`Archive expands to more than ${formatBytes(maxTotal)}`, "too_large");
        entries.push({ name: file.name, compressedSize: file.size, size: file.originalSize });
        return false;
      },
    });
  } catch (error) {
    if (error instanceof ArchiveError) throw error;
    throw new ArchiveError(`Not a readable zip archive (${error instanceof Error ? error.message : "unknown error"})`, "corrupt");
  }
  return entries;
}

/**
 * Inflates only the entries `wanted` selects, after the guards passed.
 * Returns name → bytes.
 */
export function readZipEntries(bytes: Uint8Array | Buffer, wanted: (name: string) => boolean, limits: ZipLimits = {}): Record<string, Uint8Array> {
  const data = toUint8(bytes);
  listZipEntries(data, limits);
  try {
    return unzipSync(data, { filter: (file) => wanted(file.name) });
  } catch (error) {
    throw new ArchiveError(`Archive entry could not be read (${error instanceof Error ? error.message : "unknown error"})`, "corrupt");
  }
}

const utf8 = new TextDecoder("utf-8");

export function entryText(entries: Record<string, Uint8Array>, name: string): string | null {
  const bytes = entries[name];
  if (!bytes) return null;
  return utf8.decode(bytes).replace(/^﻿/, "");
}

/** Office macro containers (docm/xlsm/pptm) carry a vbaProject.bin part. */
export function hasMacros(entries: ZipEntryInfo[]): boolean {
  return entries.some((e) => /(^|\/)vbaProject\.bin$/i.test(e.name) || (/activeX/i.test(e.name) && /\.bin$/i.test(e.name)));
}
