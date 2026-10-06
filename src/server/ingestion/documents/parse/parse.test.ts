import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { zipSync } from "fflate";
import { buildDocx, buildPdf, buildPng, buildPptx, buildXlsx, excelSerial } from "@/server/ingestion/providers/mock/document-fixtures-builders";
import { MAX_DOCUMENT_BYTES } from "../limits";
import { DocumentParseError, capText, parseDocument } from "./index";
import { OCR_UNAVAILABLE } from "./image";
import { decodeText, detectDelimiter, htmlToText, parseCsvRows } from "./text";
import { columnIndex, formatCellNumber } from "./xlsx";

const noOcr = { ocr: null } as const;

async function rejects(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => e instanceof DocumentParseError && e.code === code);
}

describe("parseDocument — PDF (unpdf)", () => {
  it("extracts text from every page of a generated PDF", async () => {
    const pdf = buildPdf({
      title: "Board pre-read",
      pages: [
        ["# Series B timeline", "Target raise: $40M led by a top-tier investor — first close (December).", "Runway 16.6 months at current burn."],
        ["# Risks", "Hold-out AUC 0.88 vs 0.90 target."],
      ],
    });
    const r = await parseDocument(pdf, { filename: "pre-read.pdf", ...noOcr });
    assert.equal(r.format, "PDF");
    assert.equal(r.parser, "unpdf@1");
    assert.equal(r.pageCount, 2);
    assert.match(r.text, /Target raise: \$40M led by a top-tier investor — first close \(December\)\./);
    assert.match(r.text, /Hold-out AUC 0\.88 vs 0\.90 target\./);
    // Pages are separated by a blank line.
    assert.match(r.text, /current burn\.\n\nRisks/);
  });

  it("rejects a corrupt PDF permanently", async () => {
    const bad = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(200, 0x41)]);
    await rejects(parseDocument(bad, { filename: "x.pdf" }), "corrupt");
  });
});

describe("parseDocument — DOCX", () => {
  const docx = buildDocx({
    title: "MSA",
    header: "CONFIDENTIAL — DRAFT v5",
    footer: "Privileged & Confidential",
    body: [
      { heading: "7. Data rights" },
      "7.3 **Derivative models.**\tBrightwater requests a license.\nSecond line in the same paragraph.",
      { table: [["Clause", "Status"], ["7.3", "Open"], ["11.2", "Open\nliability cap"]] },
      { bullets: ["CytoHub will deliver reports within 10 business days.", "Escaped <tags> & ampersands"] },
    ],
  });

  it("reads paragraphs, runs, tabs, breaks, tables, headers and footers", async () => {
    const r = await parseDocument(docx, { filename: "msa.docx" });
    assert.equal(r.format, "DOCX");
    const lines = r.text.split("\n");
    assert.equal(lines[0], "CONFIDENTIAL — DRAFT v5");
    assert.ok(lines.includes("7.3 Derivative models.\tBrightwater requests a license."));
    assert.ok(lines.includes("Second line in the same paragraph."));
    assert.ok(lines.includes("Clause\tStatus"));
    assert.ok(lines.includes("11.2\tOpen liability cap"), "multi-paragraph cell stays on its row");
    assert.ok(lines.includes("• Escaped <tags> & ampersands"));
    assert.equal(lines[lines.length - 1], "Privileged & Confidential");
  });

  it("ignores tab-stop definitions and tracked deletions", async () => {
    const xml =
      '<?xml version="1.0"?><w:document xmlns:w="w"><w:body><w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t>Kept</w:t></w:r><w:del><w:r><w:delText>Deleted</w:delText></w:r></w:del><w:r><w:instrText>PAGE</w:instrText></w:r></w:p></w:body></w:document>';
    const bytes = Buffer.from(zipSync({ "[Content_Types].xml": new TextEncoder().encode("<Types/>"), "word/document.xml": new TextEncoder().encode(xml) }));
    const r = await parseDocument(bytes, { filename: "t.docx" });
    assert.equal(r.text, "Kept");
  });

  it("rejects a truncated Word file", async () => {
    await rejects(parseDocument(docx.subarray(0, Math.floor(docx.length / 2)), { filename: "msa.docx" }), "corrupt");
  });
});

describe("parseDocument — PPTX", () => {
  it("renders slides in presentation order with headings, tables and speaker notes", async () => {
    const pptx = buildPptx({
      title: "Deck",
      slides: [
        { title: "CytoHub — Series B", bullets: ["Raising $35M"], notes: "Open with the human-data thesis." },
        { title: "Use of funds", table: [["Area", "Share"], ["Dataset", "40%"]] },
      ],
    });
    const r = await parseDocument(pptx, { filename: "deck.pptx" });
    assert.equal(r.format, "PPTX");
    assert.equal(r.pageCount, 2);
    assert.equal(
      r.text,
      ["Slide 1", "CytoHub — Series B", "Raising $35M", "Speaker notes: Open with the human-data thesis.", "", "Slide 2", "Use of funds", "Area\tShare", "Dataset\t40%"].join("\n"),
    );
    assert.doesNotMatch(r.text, /Speaker notes: .*1/, "slide-number field on the notes page is dropped");
  });

  it("orders slides numerically (slide10 after slide9)", async () => {
    const slides = Array.from({ length: 11 }, (_, i) => ({ title: `Title ${i + 1}` }));
    const r = await parseDocument(buildPptx({ title: "Many", slides }), { filename: "many.pptx" });
    const headings = r.text.split("\n").filter((l) => l.startsWith("Slide "));
    assert.deepEqual(headings, slides.map((_, i) => `Slide ${i + 1}`));
    assert.ok(r.text.indexOf("Title 10") > r.text.indexOf("Title 9"));
  });
});

describe("parseDocument — XLSX", () => {
  it("renders sheets with shared strings, inline strings and formatted numbers", async () => {
    const xlsx = buildXlsx({
      title: "Model",
      sheets: [
        {
          name: "Summary",
          rows: [
            ["Metric", "Value"],
            ["Cash on hand", { value: 19_100_000, format: "currency" }],
            ["Runway (months)", { value: 16.6, format: "decimal1" }],
            ["NRR", { value: 1.18, format: "percent" }],
            ["Close", { value: excelSerial(new Date("2026-12-18T00:00:00Z")), format: "date" }],
            [{ inline: "Inline note" }, 0.1 + 0.2],
            [null, null, "Third column"],
          ],
        },
        { name: "Second", rows: [["only", 1]] },
      ],
    });
    const r = await parseDocument(xlsx, { filename: "model.xlsx" });
    assert.equal(r.format, "XLSX");
    assert.equal(r.pageCount, 2);
    assert.equal(
      r.text,
      ["Sheet: Summary", "Metric\tValue", "Cash on hand\t$19,100,000", "Runway (months)\t16.6", "NRR\t118%", "Close\t2026-12-18", "Inline note\t0.3", "\t\tThird column", "", "Sheet: Second", "only\t1"].join("\n"),
    );
  });

  it("formats cells and resolves column letters", () => {
    assert.equal(columnIndex("A1"), 0);
    assert.equal(columnIndex("Z9"), 25);
    assert.equal(columnIndex("AB12"), 27);
    assert.equal(formatCellNumber(46009, "yyyy-mm-dd"), "2025-12-18");
    assert.equal(formatCellNumber(0.255, "0.0%"), "25.5%");
    assert.equal(formatCellNumber(-1234.5, '"$"#,##0.00'), "-$1,234.50");
    assert.equal(formatCellNumber(1234567, "#,##0"), "1,234,567");
    assert.equal(formatCellNumber(3.14159, ""), "3.14159");
  });
});

describe("parseDocument — text formats", () => {
  it("parses CSV with RFC 4180 quoting into tab-separated rows", async () => {
    const csv = 'Site,Notes,Hearts\r\n"Lakeshore, MA","He said ""fine""",141\r\n"Multi\nline",x,3\r\n';
    const r = await parseDocument(Buffer.from(csv), { filename: "d.csv" });
    assert.equal(r.format, "CSV");
    assert.equal(r.text, 'Site\tNotes\tHearts\nLakeshore, MA\tHe said "fine"\t141\nMulti line\tx\t3');
  });

  it("detects semicolon and tab delimiters", () => {
    assert.equal(detectDelimiter("a;b;c\n1;2;3"), ";");
    assert.equal(detectDelimiter("a\tb\n1\t2"), "\t");
    assert.equal(detectDelimiter('"x;y",b,c'), ",");
    assert.deepEqual(parseCsvRows("a,b\n1,2\n3,4\n", { maxRows: 2 }), { rows: [["a", "b"], ["1", "2"]], truncated: true });
  });

  it("decodes UTF-8 with BOM, UTF-16 and normalizes newlines", async () => {
    assert.equal(decodeText(Buffer.from("﻿hello\r\nworld", "utf8")), "hello\nworld");
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("Héllo", "utf16le")]);
    assert.equal(decodeText(utf16), "Héllo");
    const md = await parseDocument(Buffer.from("﻿# Plan\r\n\r\n- item  \r\n"), { filename: "plan.md" });
    assert.equal(md.format, "MARKDOWN");
    assert.equal(md.text, "# Plan\n\n- item");
  });

  it("converts HTML to text without scripts or styles", () => {
    const html = "<html><head><title>x</title><style>p{}</style></head><body><h1>Title</h1><p>One &amp; two&nbsp;&mdash; three</p><script>alert(1)</script><ul><li>A</li><li>B</li></ul><table><tr><td>a</td><td>b</td></tr></table></body></html>";
    assert.equal(htmlToText(html), "Title\nOne & two — three\n- A\n- B\na\tb");
  });
});

describe("parseDocument — images", () => {
  it("returns empty text with a warning when OCR is unavailable", async () => {
    const r = await parseDocument(buildPng(), { filename: "whiteboard.png", ocr: null });
    assert.equal(r.format, "IMAGE");
    assert.equal(r.text, "");
    assert.deepEqual(r.warnings, [OCR_UNAVAILABLE]);
  });

  it("uses the OCR function when provided (bytes and media type passed through)", async () => {
    let seen: string | null = null;
    const r = await parseDocument(buildPng(), {
      filename: "whiteboard.png",
      ocr: async (bytes, mediaType) => {
        seen = `${mediaType}:${bytes.subarray(1, 4).toString("ascii")}`;
        return "Series B narrative\n- dataset moat";
      },
    });
    assert.equal(seen, "image/png:PNG");
    assert.equal(r.parser, "claude-vision@1");
    assert.equal(r.text, "Series B narrative\n- dataset moat");
  });

  it("times out a hanging OCR call", async () => {
    await rejects(parseDocument(buildPng(), { filename: "w.png", timeoutMs: 20, ocr: () => new Promise(() => {}) }), "timeout");
  });
});

describe("parseDocument — limits and bad input", () => {
  it("rejects files over the size limit before parsing", async () => {
    await rejects(parseDocument(Buffer.alloc(MAX_DOCUMENT_BYTES + 1, 0x20), { filename: "big.txt" }), "too_large");
  });

  it("rejects unsupported binaries, legacy Office and plain zips", async () => {
    await rejects(parseDocument(Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0x00]), { filename: "x.pdf" }), "unsupported");
    await rejects(parseDocument(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]), { filename: "old.doc" }), "unsupported");
    await rejects(parseDocument(Buffer.from(zipSync({ "a.txt": new Uint8Array([65]) })), { filename: "a.zip" }), "unsupported");
    // Named .docx but missing the Word parts.
    await rejects(parseDocument(Buffer.from(zipSync({ "a.txt": new Uint8Array([65]) })), { filename: "a.docx" }), "corrupt");
  });

  it("rejects zip bombs and unsafe archives through the Office parsers", async () => {
    // 101 MB of zeros deflates to ~100 KB: the declared size trips the guard before inflation.
    const bomb = Buffer.from(zipSync({ "[Content_Types].xml": new Uint8Array(10), "word/document.xml": new Uint8Array(101 * 1024 * 1024) }, { level: 1 }));
    assert.ok(bomb.length < 1024 * 1024);
    await rejects(parseDocument(bomb, { filename: "bomb.docx" }), "archive");
    const traversal = Buffer.from(zipSync({ "[Content_Types].xml": new Uint8Array(1), "word/document.xml": new Uint8Array(1), "../../etc/evil.xml": new Uint8Array(1) }));
    await rejects(parseDocument(traversal, { filename: "evil.docx" }), "archive");
  });

  it("parses by content when the extension lies", async () => {
    const docx = buildDocx({ title: "x", body: ["Actually Word"] });
    const r = await parseDocument(docx, { filename: "report.pdf", mimeType: "application/pdf" });
    assert.equal(r.format, "DOCX");
    assert.equal(r.text, "Actually Word");
  });

  it("caps extracted text with a warning", async () => {
    const r = await parseDocument(Buffer.from("line\n".repeat(1000)), { filename: "t.txt", maxChars: 100 });
    assert.ok(r.text.length <= 100);
    assert.equal(r.truncated, true);
    assert.match(r.warnings.join(" "), /truncated at 100 characters/);
    assert.deepEqual(capText("abc", 10), { text: "abc", truncated: false });
  });
});
