/**
 * XLSX → text: every sheet as "Sheet: <name>" followed by tab-separated rows.
 * Shared strings, inline strings, formula results, booleans and numbers are
 * read; number formats are applied for dates, percentages and currency so a
 * model reads "$19,100,000" and "2026-12-18" rather than raw serials.
 */
import { MAX_SHEET_COLS, MAX_SHEET_ROWS } from "../limits";
import { attr, xmlEvents } from "../xml";
import { entryText, readZipEntries } from "../zip";
import { parseRelationships } from "./pptx";
import { DocumentParseError, type ParsedDocument } from "./types";

export function parseSharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  const strings: string[] = [];
  let current: string[] | null = null;
  let inText = false;
  let phoneticDepth = 0;
  for (const ev of xmlEvents(xml)) {
    if (ev.kind === "text") {
      if (current && inText && phoneticDepth === 0) current.push(ev.text);
    } else if (ev.kind === "open") {
      if (ev.name === "si") current = [];
      else if (ev.name === "t") inText = !ev.selfClosing;
      else if (ev.name === "rPh" && !ev.selfClosing) phoneticDepth++;
    } else if (ev.name === "si") {
      strings.push((current ?? []).join(""));
      current = null;
    } else if (ev.name === "t") {
      inText = false;
    } else if (ev.name === "rPh") {
      phoneticDepth = Math.max(0, phoneticDepth - 1);
    }
  }
  return strings;
}

export interface CellStyles {
  /** cellXfs index → number format code ("" for General). */
  formats: string[];
}

const BUILTIN_FORMATS: Record<number, string> = {
  0: "",
  1: "0",
  2: "0.00",
  3: "#,##0",
  4: "#,##0.00",
  9: "0%",
  10: "0.00%",
  14: "yyyy-mm-dd",
  15: "d-mmm-yy",
  16: "d-mmm",
  17: "mmm-yy",
  18: "h:mm AM/PM",
  19: "h:mm:ss AM/PM",
  20: "h:mm",
  21: "h:mm:ss",
  22: "yyyy-mm-dd h:mm",
  45: "mm:ss",
  46: "[h]:mm:ss",
  47: "mmss.0",
};

export function parseStyles(xml: string | null): CellStyles {
  if (!xml) return { formats: [] };
  const custom = new Map<number, string>();
  const formats: string[] = [];
  let inCellXfs = false;
  for (const ev of xmlEvents(xml)) {
    if (ev.kind === "open") {
      if (ev.name === "numFmt") {
        const id = Number(attr(ev.attrs, "numFmtId"));
        const code = attr(ev.attrs, "formatCode");
        if (Number.isFinite(id) && code != null) custom.set(id, code);
      } else if (ev.name === "cellXfs" && !ev.selfClosing) {
        inCellXfs = true;
      } else if (ev.name === "xf" && inCellXfs) {
        const id = Number(attr(ev.attrs, "numFmtId") ?? 0);
        formats.push(custom.get(id) ?? BUILTIN_FORMATS[id] ?? "");
      }
    } else if (ev.kind === "close" && ev.name === "cellXfs") {
      inCellXfs = false;
    }
  }
  return { formats };
}

/** Removes quoted literals, escapes and [color]/[locale] sections before inspecting a format code. */
function formatSkeleton(code: string): string {
  return code
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/\[[^\]]*\]/g, "");
}

function decimalsOf(code: string): number {
  const m = /\.(0+)/.exec(formatSkeleton(code));
  return m ? m[1].length : 0;
}

function trimNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toPrecision(12)));
}

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

export function formatCellNumber(value: number, code: string, date1904 = false): string {
  if (!code) return trimNumber(value);
  const skeleton = formatSkeleton(code).toLowerCase();
  if (/[dmyhs]/.test(skeleton.replace(/am\/pm|a\/p/g, "")) && !/[#0?]/.test(skeleton)) {
    const serial = date1904 ? value + 1462 : value;
    if (serial < 0 || serial > 2_958_465) return trimNumber(value);
    const d = new Date(EXCEL_EPOCH_MS + Math.round(serial * 86_400_000));
    const iso = d.toISOString();
    const hasDate = /[dy]/.test(skeleton) || /m{3,}/.test(skeleton);
    const hasTime = /[hs]/.test(skeleton);
    if (hasDate && hasTime) return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
    if (hasTime) return iso.slice(11, 16);
    return iso.slice(0, 10);
  }
  const decimals = decimalsOf(code);
  if (skeleton.includes("%")) return `${(value * 100).toFixed(decimals)}%`;
  const currency = /[$€£]/.exec(code.replace(/\[\$([$€£])[^\]]*\]/g, "$1"));
  const grouped = /#,##0|0,0/.test(skeleton);
  if (currency || grouped) {
    const body = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    const sign = value < 0 ? "-" : "";
    return currency ? `${sign}${currency[0]}${body}` : `${sign}${body}`;
  }
  if (/^0(\.0+)?$/.test(skeleton.trim())) return value.toFixed(decimals);
  return trimNumber(value);
}

/** "BC12" → 54 (zero-based column index). */
export function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? "";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

interface SheetRender {
  rows: string[];
  truncatedRows: boolean;
  truncatedCols: boolean;
}

export function renderSheet(xml: string, shared: string[], styles: CellStyles, date1904: boolean, caps = { rows: MAX_SHEET_ROWS, cols: MAX_SHEET_COLS }): SheetRender {
  const rows: string[] = [];
  let truncatedRows = false;
  let truncatedCols = false;
  let row: string[] | null = null;
  let col = 0;
  let cell: { type: string; style: number; col: number } | null = null;
  let value: string[] = [];
  let inValue = false;
  let inInlineText = false;

  const finishRow = () => {
    if (!row) return;
    while (row.length && !row[row.length - 1]) row.pop();
    if (row.length) {
      if (rows.length >= caps.rows) truncatedRows = true;
      else rows.push(row.join("\t"));
    }
    row = null;
  };

  for (const ev of xmlEvents(xml)) {
    if (truncatedRows) break;
    if (ev.kind === "text") {
      if (cell && (inValue || inInlineText)) value.push(ev.text);
      continue;
    }
    if (ev.kind === "open") {
      switch (ev.name) {
        case "row":
          finishRow();
          row = [];
          col = 0;
          break;
        case "c": {
          const ref = attr(ev.attrs, "r");
          const at = ref ? columnIndex(ref) : col;
          col = at + 1;
          cell = { type: attr(ev.attrs, "t") ?? "n", style: Number(attr(ev.attrs, "s") ?? 0), col: at };
          value = [];
          break;
        }
        case "v":
          inValue = !ev.selfClosing;
          break;
        case "t":
          inInlineText = !ev.selfClosing && cell?.type === "inlineStr";
          break;
      }
      continue;
    }
    switch (ev.name) {
      case "v":
        inValue = false;
        break;
      case "t":
        inInlineText = false;
        break;
      case "c": {
        if (cell && row) {
          const raw = value.join("");
          let text = "";
          if (cell.type === "s") text = shared[Number(raw)] ?? "";
          else if (cell.type === "inlineStr" || cell.type === "str") text = raw;
          else if (cell.type === "b") text = raw === "1" ? "TRUE" : "FALSE";
          else if (cell.type === "e") text = raw;
          else if (raw !== "") {
            const n = Number(raw);
            text = Number.isFinite(n) ? formatCellNumber(n, styles.formats[cell.style] ?? "", date1904) : raw;
          }
          text = text.replace(/[\t\r\n]+/g, " ").trim();
          if (cell.col >= caps.cols) {
            if (text) truncatedCols = true;
          } else if (text) {
            while (row.length < cell.col) row.push("");
            row[cell.col] = text;
          }
        }
        cell = null;
        break;
      }
      case "row":
        finishRow();
        break;
    }
  }
  finishRow();
  return { rows, truncatedRows, truncatedCols };
}

export function parseXlsx(bytes: Buffer | Uint8Array): ParsedDocument {
  const entries = readZipEntries(
    bytes,
    (n) => n === "xl/workbook.xml" || n === "xl/_rels/workbook.xml.rels" || n === "xl/sharedStrings.xml" || n === "xl/styles.xml" || /^xl\/worksheets\/[^/]+\.xml$/.test(n),
  );
  const workbook = entryText(entries, "xl/workbook.xml");
  if (!workbook) throw new DocumentParseError("Workbook has no xl/workbook.xml part", "corrupt");
  const rels = parseRelationships(entryText(entries, "xl/_rels/workbook.xml.rels"), "xl");
  const shared = parseSharedStrings(entryText(entries, "xl/sharedStrings.xml"));
  const styles = parseStyles(entryText(entries, "xl/styles.xml"));

  let date1904 = false;
  const sheets: { name: string; path: string }[] = [];
  for (const ev of xmlEvents(workbook)) {
    if (ev.kind !== "open") continue;
    if (ev.name === "workbookPr") date1904 = /^(1|true)$/.test(attr(ev.attrs, "date1904") ?? "");
    if (ev.name === "sheet") {
      const rid = attr(ev.attrs, "r:id");
      const target = rid ? rels.get(rid)?.target : null;
      if (target && entries[target]) sheets.push({ name: attr(ev.attrs, "name") ?? `Sheet ${sheets.length + 1}`, path: target });
    }
  }

  const warnings: string[] = [];
  const blocks: string[] = [];
  for (const sheet of sheets) {
    const r = renderSheet(entryText(entries, sheet.path) ?? "", shared, styles, date1904);
    if (r.truncatedRows) warnings.push(`Sheet "${sheet.name}" truncated at ${MAX_SHEET_ROWS.toLocaleString("en-US")} rows.`);
    if (r.truncatedCols) warnings.push(`Sheet "${sheet.name}" truncated at ${MAX_SHEET_COLS} columns.`);
    blocks.push([`Sheet: ${sheet.name}`, ...r.rows].join("\n"));
  }
  return { text: blocks.join("\n\n"), format: "XLSX", parser: "ooxml-xlsx@1", pageCount: sheets.length, warnings };
}
