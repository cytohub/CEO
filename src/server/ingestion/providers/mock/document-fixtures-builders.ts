/**
 * Generators for real document bytes used by the demo document provider and
 * the parser tests: minimal OOXML packages (docx / pptx / xlsx) zipped with
 * fflate, a small hand-written PDF writer (Helvetica, WinAnsi text objects)
 * and a valid PNG. Output is deterministic for the same input (fixed zip
 * timestamps, no creation dates), so re-syncing unchanged fixtures yields
 * byte-identical files and exercises the "unchanged" path.
 */
import { zipSync, zlibSync } from "fflate";

const enc = new TextEncoder();
const ZIP_MTIME = new Date("2026-01-01T00:00:00Z");

export function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function zip(files: Record<string, string | Uint8Array>): Buffer {
  const data: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(files)) data[name] = typeof content === "string" ? enc.encode(content) : content;
  return Buffer.from(zipSync(data, { level: 6, mtime: ZIP_MTIME }));
}

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function relsXml(rels: { id: string; type: string; target: string }[]): string {
  return `${XML_DECL}<Relationships xmlns="${REL_NS}">${rels.map((r) => `<Relationship Id="${r.id}" Type="${OFFICE_REL}/${r.type}" Target="${r.target}"/>`).join("")}</Relationships>`;
}

function coreProps(title: string, author: string | null): string {
  return `${XML_DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xmlEscape(title)}</dc:title>${author ? `<dc:creator>${xmlEscape(author)}</dc:creator>` : ""}</cp:coreProperties>`;
}

// ─── DOCX ────────────────────────────────────────────────────────────────────

export type DocxBlock = string | { heading: string; level?: 1 | 2 | 3 } | { table: string[][] } | { bullets: string[] };

export interface DocxSpec {
  title: string;
  author?: string | null;
  header?: string;
  footer?: string;
  body: DocxBlock[];
}

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/** A paragraph; "\t" becomes <w:tab/>, "\n" becomes <w:br/>, "**x**" a bold run. */
function wParagraph(text: string, style?: string): string {
  const runs: string[] = [];
  text.split(/(\*\*[^*]+\*\*)/).forEach((chunk) => {
    if (!chunk) return;
    const bold = chunk.startsWith("**") && chunk.endsWith("**");
    const body = bold ? chunk.slice(2, -2) : chunk;
    const pieces = body.split(/(\t|\n)/).map((p) => (p === "\t" ? "<w:tab/>" : p === "\n" ? "<w:br/>" : p ? `<w:t xml:space="preserve">${xmlEscape(p)}</w:t>` : ""));
    runs.push(`<w:r>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}${pieces.join("")}</w:r>`);
  });
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>` : "";
  return `<w:p>${pPr}${runs.join("")}</w:p>`;
}

function wBlock(block: DocxBlock): string {
  if (typeof block === "string") return wParagraph(block);
  if ("heading" in block) return wParagraph(block.heading, `Heading${block.level ?? 1}`);
  if ("bullets" in block) return block.bullets.map((b) => wParagraph(`• ${b}`, "ListParagraph")).join("");
  const rows = block.table
    .map((row) => `<w:tr>${row.map((cell) => `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>${cell.split("\n").map((line) => wParagraph(line)).join("")}</w:tc>`).join("")}</w:tr>`)
    .join("");
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr>${rows}</w:tbl>`;
}

export function buildDocx(spec: DocxSpec): Buffer {
  const files: Record<string, string> = {
    "[Content_Types].xml": `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>${spec.header ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : ""}${spec.footer ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : ""}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    "_rels/.rels": `${XML_DECL}<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_REL}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    "docProps/core.xml": coreProps(spec.title, spec.author ?? null),
  };
  const docRels: { id: string; type: string; target: string }[] = [];
  let sectRefs = "";
  if (spec.header) {
    files["word/header1.xml"] = `${XML_DECL}<w:hdr xmlns:w="${W_NS}">${wParagraph(spec.header)}</w:hdr>`;
    docRels.push({ id: "rIdHeader1", type: "header", target: "header1.xml" });
    sectRefs += '<w:headerReference w:type="default" r:id="rIdHeader1"/>';
  }
  if (spec.footer) {
    files["word/footer1.xml"] = `${XML_DECL}<w:ftr xmlns:w="${W_NS}">${wParagraph(spec.footer)}</w:ftr>`;
    docRels.push({ id: "rIdFooter1", type: "footer", target: "footer1.xml" });
    sectRefs += '<w:footerReference w:type="default" r:id="rIdFooter1"/>';
  }
  files["word/_rels/document.xml.rels"] = relsXml(docRels);
  files["word/document.xml"] =
    `${XML_DECL}<w:document xmlns:w="${W_NS}" xmlns:r="${OFFICE_REL}"><w:body>${spec.body.map(wBlock).join("")}` +
    `<w:sectPr>${sectRefs}<w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`;
  return zip(files);
}

// ─── PPTX ────────────────────────────────────────────────────────────────────

export interface PptxSlide {
  title: string;
  bullets?: string[];
  table?: string[][];
  notes?: string;
}

export interface PptxSpec {
  title: string;
  author?: string | null;
  slides: PptxSlide[];
}

const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main";

function aParagraphs(lines: string[]): string {
  return lines.map((l) => `<a:p><a:r><a:rPr lang="en-US"/><a:t>${xmlEscape(l)}</a:t></a:r></a:p>`).join("");
}

function shape(id: number, name: string, lines: string[]): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xmlEscape(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${aParagraphs(lines)}</p:txBody></p:sp>`;
}

function slideTable(rows: string[][]): string {
  const tr = rows.map((r) => `<a:tr h="370840">${r.map((c) => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${aParagraphs([c])}</a:txBody></a:tc>`).join("")}</a:tr>`).join("");
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="9" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblGrid/>${tr}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

export function buildPptx(spec: PptxSpec): Buffer {
  const overrides: string[] = ['<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'];
  const files: Record<string, string> = {
    "_rels/.rels": `${XML_DECL}<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_REL}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    "docProps/core.xml": coreProps(spec.title, spec.author ?? null),
  };
  overrides.push('<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>');
  const presRels: { id: string; type: string; target: string }[] = [];
  const sldIds: string[] = [];
  spec.slides.forEach((slide, i) => {
    const k = i + 1;
    presRels.push({ id: `rId${k + 10}`, type: "slide", target: `slides/slide${k}.xml` });
    sldIds.push(`<p:sldId id="${255 + k}" r:id="rId${k + 10}"/>`);
    overrides.push(`<Override PartName="/ppt/slides/slide${k}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`);
    const shapes = [shape(2, "Title", [slide.title])];
    if (slide.bullets?.length) shapes.push(shape(3, "Content", slide.bullets));
    if (slide.table) shapes.push(slideTable(slide.table));
    files[`ppt/slides/slide${k}.xml`] =
      `${XML_DECL}<p:sld xmlns:a="${A_NS}" xmlns:r="${OFFICE_REL}" xmlns:p="${P_NS}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapes.join("")}</p:spTree></p:cSld></p:sld>`;
    const slideRels: { id: string; type: string; target: string }[] = [];
    if (slide.notes) {
      slideRels.push({ id: "rId1", type: "notesSlide", target: `../notesSlides/notesSlide${k}.xml` });
      overrides.push(`<Override PartName="/ppt/notesSlides/notesSlide${k}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`);
      files[`ppt/notesSlides/notesSlide${k}.xml`] =
        `${XML_DECL}<p:notes xmlns:a="${A_NS}" xmlns:r="${OFFICE_REL}" xmlns:p="${P_NS}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>` +
        `${shape(2, "Notes Placeholder", slide.notes.split("\n"))}` +
        `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Slide Number"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:fld id="{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}" type="slidenum"><a:t>${k}</a:t></a:fld></a:p></p:txBody></p:sp>` +
        `</p:spTree></p:cSld></p:notes>`;
    }
    files[`ppt/slides/_rels/slide${k}.xml.rels`] = relsXml(slideRels);
  });
  files["ppt/_rels/presentation.xml.rels"] = relsXml(presRels);
  files["ppt/presentation.xml"] =
    `${XML_DECL}<p:presentation xmlns:a="${A_NS}" xmlns:r="${OFFICE_REL}" xmlns:p="${P_NS}"><p:sldIdLst>${sldIds.join("")}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
  files["[Content_Types].xml"] =
    `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides.join("")}</Types>`;
  return zip(files);
}

// ─── XLSX ────────────────────────────────────────────────────────────────────

export type XlsxFormat = "currency" | "currency2" | "percent" | "date" | "decimal1" | "integer";
export type XlsxCell = string | number | null | { value: number; format: XlsxFormat } | { inline: string };

export interface XlsxSpec {
  title: string;
  author?: string | null;
  sheets: { name: string; rows: XlsxCell[][] }[];
}

/** cellXfs index per format (index 0 = General). */
const XLSX_STYLE: Record<XlsxFormat, number> = { currency: 1, currency2: 2, percent: 3, date: 4, decimal1: 5, integer: 6 };

function colName(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function buildXlsx(spec: XlsxSpec): Buffer {
  const shared: string[] = [];
  const sharedIndex = new Map<string, number>();
  const sst = (s: string) => {
    let i = sharedIndex.get(s);
    if (i === undefined) {
      i = shared.length;
      shared.push(s);
      sharedIndex.set(s, i);
    }
    return i;
  };

  const files: Record<string, string> = {
    "_rels/.rels": `${XML_DECL}<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_REL}/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    "docProps/core.xml": coreProps(spec.title, spec.author ?? null),
    "xl/styles.xml":
      `${XML_DECL}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0"/><numFmt numFmtId="165" formatCode="&quot;$&quot;#,##0.00"/><numFmt numFmtId="166" formatCode="0.0"/></numFmts>` +
      `<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`,
  };
  const overrides: string[] = [
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>',
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
  ];
  const wbRels: { id: string; type: string; target: string }[] = [];
  const sheetEls: string[] = [];
  spec.sheets.forEach((sheet, si) => {
    const k = si + 1;
    wbRels.push({ id: `rId${k}`, type: "worksheet", target: `worksheets/sheet${k}.xml` });
    sheetEls.push(`<sheet name="${xmlEscape(sheet.name)}" sheetId="${k}" r:id="rId${k}"/>`);
    overrides.push(`<Override PartName="/xl/worksheets/sheet${k}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
    const rows = sheet.rows
      .map((row, ri) => {
        const cells = row
          .map((cell, ci) => {
            const ref = `${colName(ci)}${ri + 1}`;
            if (cell === null || cell === "") return "";
            if (typeof cell === "string") return `<c r="${ref}" t="s"><v>${sst(cell)}</v></c>`;
            if (typeof cell === "number") return `<c r="${ref}"><v>${cell}</v></c>`;
            if ("inline" in cell) return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(cell.inline)}</t></is></c>`;
            return `<c r="${ref}" s="${XLSX_STYLE[cell.format]}"><v>${cell.value}</v></c>`;
          })
          .join("");
        return `<row r="${ri + 1}">${cells}</row>`;
      })
      .join("");
    files[`xl/worksheets/sheet${k}.xml`] = `${XML_DECL}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
  });
  wbRels.push({ id: `rId${spec.sheets.length + 1}`, type: "styles", target: "styles.xml" });
  wbRels.push({ id: `rId${spec.sheets.length + 2}`, type: "sharedStrings", target: "sharedStrings.xml" });
  files["xl/_rels/workbook.xml.rels"] = relsXml(wbRels);
  files["xl/workbook.xml"] =
    `${XML_DECL}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${OFFICE_REL}"><workbookPr/><sheets>${sheetEls.join("")}</sheets></workbook>`;
  files["xl/sharedStrings.xml"] =
    `${XML_DECL}<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared.map((s) => `<si><t xml:space="preserve">${xmlEscape(s)}</t></si>`).join("")}</sst>`;
  files["[Content_Types].xml"] =
    `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides.join("")}</Types>`;
  return zip(files);
}

/** Excel serial date (1900 system) for a UTC calendar day. */
export function excelSerial(day: Date): number {
  return Math.round((Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

// ─── PDF ─────────────────────────────────────────────────────────────────────

export interface PdfSpec {
  title: string;
  author?: string | null;
  /** Lines per page; long lines are wrapped. A line starting with "# " is set as a heading. */
  pages: string[][];
}

const WIN_ANSI: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "•": 0x95, "–": 0x96, "—": 0x97, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "™": 0x99,
};

/** Encodes to WinAnsi and escapes for a PDF literal string. Unmappable characters become "?". */
function pdfString(s: string): string {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 63;
    let byte: number;
    if (WIN_ANSI[ch] !== undefined) byte = WIN_ANSI[ch];
    else if (cp >= 0x20 && cp <= 0x7e) byte = cp;
    else if (cp >= 0xa0 && cp <= 0xff) byte = cp;
    else if (ch === "≥") {
      out += ">=";
      continue;
    } else byte = 63;
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += `\\${String.fromCharCode(byte)}`;
    else if (byte < 0x20 || byte > 0x7e) out += `\\${byte.toString(8).padStart(3, "0")}`;
    else out += String.fromCharCode(byte);
  }
  return `(${out})`;
}

function wrap(line: string, width: number): string[] {
  if (line.length <= width) return [line];
  const words = line.split(" ");
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > width) {
      out.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) out.push(cur);
  return out;
}

export function buildPdf(spec: PdfSpec): Buffer {
  // Objects: 1 catalog, 2 pages, 3 font (regular), 4 font (bold), 5 info, then per page: page + content.
  const objects: string[] = [];
  const pageIds: number[] = [];
  const base = 6;
  spec.pages.forEach((lines, i) => {
    const pageId = base + i * 2;
    const contentId = pageId + 1;
    pageIds.push(pageId);
    const ops: string[] = ["BT", "/F1 11 Tf", "14 TL", "72 740 Td"];
    let y = 740;
    for (const raw of lines) {
      const heading = raw.startsWith("# ");
      const text = heading ? raw.slice(2) : raw;
      if (heading) ops.push("/F2 13 Tf");
      for (const part of text ? wrap(text, heading ? 80 : 92) : [""]) {
        if (y < 60) break; // keep it simple: content must fit the page
        ops.push(`${pdfString(part)} Tj`, "T*");
        y -= 14;
      }
      if (heading) ops.push("/F1 11 Tf");
    }
    ops.push("ET");
    const stream = ops.join("\n");
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
  });
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  objects[5] = `<< /Title ${pdfString(spec.title)}${spec.author ? ` /Author ${pdfString(spec.author)}` : ""} /Producer (CytoHub demo fixtures) >>`;

  let out = "%PDF-1.4\n%âãÏÓ\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(out, "latin1");
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

// ─── PNG ─────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)])), 0);
  return Buffer.concat([head, Buffer.from(data), crc]);
}

/**
 * A grayscale "whiteboard" image: light background with a few dark marker
 * strokes. Valid PNG (IHDR, IDAT, IEND); no real text, which is exactly what
 * the OCR-unavailable path needs.
 */
export function buildPng(width = 96, height = 64): Buffer {
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const stroke = (y % 16 === 8 && x > 8 && x < width - 12 + ((y * 7) % 9)) || (x === 12 && y > 4 && y < height - 4);
      raw[y * (width + 1) + 1 + x] = stroke ? 40 : 238 - ((x + y) % 7);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk("IHDR", ihdr), pngChunk("IDAT", zlibSync(raw, { level: 9 })), pngChunk("IEND", new Uint8Array(0))]);
}
