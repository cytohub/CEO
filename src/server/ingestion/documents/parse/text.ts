/**
 * Plain-text family: TXT, Markdown, CSV (RFC 4180) and HTML → text.
 */
import { MAX_CSV_COLS, MAX_CSV_ROWS } from "../limits";
import { decodeEntities, tidyText } from "../xml";
import type { ParsedDocument } from "./types";

/** UTF-8 (BOM stripped) or UTF-16 with a BOM; invalid bytes become U+FFFD rather than failing. */
export function decodeText(bytes: Buffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let text: string;
  if (u8[0] === 0xff && u8[1] === 0xfe) text = new TextDecoder("utf-16le").decode(u8.subarray(2));
  else if (u8[0] === 0xfe && u8[1] === 0xff) text = new TextDecoder("utf-16be").decode(u8.subarray(2));
  else text = new TextDecoder("utf-8").decode(u8);
  return normalizeText(text.replace(/^﻿/, ""));
}

/** Newlines to \n; strip control characters other than tab / newline. */
export function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

export function parsePlainText(bytes: Buffer | Uint8Array, format: "TXT" | "MARKDOWN"): ParsedDocument {
  const text = decodeText(bytes)
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
  return { text, format, parser: format === "MARKDOWN" ? "markdown@1" : "text@1", pageCount: null, warnings: [] };
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

/** Picks the delimiter that occurs most often (outside quotes) in the first line. */
export function detectDelimiter(text: string): string {
  const firstLine: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length && i < 10_000; i++) {
    const c = text[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === "\n") break;
    else if (!quoted) firstLine.push(c);
  }
  const counts = [",", ";", "\t", "|"].map((d) => ({ d, n: firstLine.filter((c) => c === d).length }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].d : ",";
}

/** RFC 4180: quoted fields, "" escapes, delimiters and newlines inside quotes. */
export function parseCsvRows(text: string, opts: { delimiter?: string; maxRows?: number } = {}): { rows: string[][]; truncated: boolean } {
  const delimiter = opts.delimiter ?? detectDelimiter(text);
  const maxRows = opts.maxRows ?? MAX_CSV_ROWS;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const n = text.length;
  const pushRow = () => {
    row.push(field);
    field = "";
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };
  while (i < n) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field === "") {
      quoted = true;
      i++;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
      i++;
    } else if (c === "\n" || c === "\r") {
      pushRow();
      i += c === "\r" && text[i + 1] === "\n" ? 2 : 1;
      if (rows.length >= maxRows) return { rows, truncated: i < n };
    } else {
      field += c;
      i++;
    }
  }
  if (field !== "" || row.length) pushRow();
  return { rows, truncated: false };
}

export function parseCsv(bytes: Buffer | Uint8Array): ParsedDocument {
  const { rows, truncated } = parseCsvRows(decodeText(bytes));
  const warnings: string[] = [];
  if (truncated) warnings.push(`CSV truncated at ${MAX_CSV_ROWS.toLocaleString("en-US")} rows.`);
  let wide = false;
  const lines = rows.map((r) => {
    if (r.length > MAX_CSV_COLS) wide = true;
    const cells = r.slice(0, MAX_CSV_COLS).map((c) => c.replace(/\s*\n\s*/g, " ").replace(/\t/g, " ").trim());
    while (cells.length && !cells[cells.length - 1]) cells.pop();
    return cells.join("\t");
  });
  if (wide) warnings.push(`CSV truncated at ${MAX_CSV_COLS} columns.`);
  return { text: lines.filter(Boolean).join("\n"), format: "CSV", parser: "csv@1", pageCount: null, warnings };
}

// ─── HTML ────────────────────────────────────────────────────────────────────

const EXTRA_ENTITIES: Record<string, string> = {
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™",
  euro: "€",
  pound: "£",
  times: "×",
  deg: "°",
};

export function htmlToText(html: string): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|head|object|iframe)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(td|th)\s*>/gi, "\t")
    .replace(/<\/?(p|div|section|article|header|footer|aside|nav|main|h[1-6]|ul|ol|li|tr|table|thead|tbody|blockquote|pre|hr|dl|dt|dd|figure|figcaption|form)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  s = s.replace(/&([a-zA-Z]+);/g, (whole, name: string) => EXTRA_ENTITIES[name.toLowerCase()] ?? whole);
  s = decodeEntities(s).replace(/ /g, " ");
  // Block tags open and close with newlines; markup structure is not paragraph structure, so collapse runs.
  return tidyText(
    normalizeText(s)
      .split("\n")
      .map((l) => l.replace(/[ \t]+/g, (m) => (m.includes("\t") ? "\t" : " ")).trim())
      .filter(Boolean)
      .join("\n"),
  );
}

export function parseHtml(bytes: Buffer | Uint8Array): ParsedDocument {
  return { text: htmlToText(decodeText(bytes)), format: "HTML", parser: "html@1", pageCount: null, warnings: [] };
}
