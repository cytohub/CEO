import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { zipSync } from "fflate";
import { buildDocx, buildPdf, buildPng, buildPptx, buildXlsx } from "@/server/ingestion/providers/mock/document-fixtures-builders";
import { MAX_UPLOAD_BYTES, sanitizeFilename, validateUpload } from "./files";

const ok = (filename: string, bytes: Buffer, declaredType?: string) => {
  const r = validateUpload({ filename, bytes, declaredType });
  assert.equal(r.ok, true, r.ok ? "" : r.reason);
  return r as Extract<typeof r, { ok: true }>;
};
const rejected = (filename: string, bytes: Buffer, pattern: RegExp, declaredType?: string) => {
  const r = validateUpload({ filename, bytes, declaredType });
  assert.equal(r.ok, false, `${filename} should be rejected`);
  if (!r.ok) assert.match(r.reason, pattern);
};

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 "), Buffer.alloc(8)]);

describe("validateUpload — accepted files", () => {
  it("accepts every allowed format when the contents match", () => {
    assert.equal(ok("board.pdf", buildPdf({ title: "t", pages: [["x"]] })).mimeType, "application/pdf");
    assert.equal(ok("msa.docx", buildDocx({ title: "t", body: ["x"] })).format, "DOCX");
    assert.equal(ok("deck.pptx", buildPptx({ title: "t", slides: [{ title: "x" }] })).format, "PPTX");
    assert.equal(ok("model.xlsx", buildXlsx({ title: "t", sheets: [{ name: "S", rows: [["x"]] }] })).format, "XLSX");
    assert.equal(ok("data.csv", Buffer.from("a,b\n1,2")).mimeType, "text/csv");
    assert.equal(ok("notes.txt", Buffer.from("hello")).format, "TXT");
    assert.equal(ok("plan.md", Buffer.from("# Plan\n<div>inline html is fine in markdown</div>")).format, "MARKDOWN");
    assert.equal(ok("plan.markdown", Buffer.from("# Plan")).format, "MARKDOWN");
    assert.equal(ok("whiteboard.png", buildPng()).mimeType, "image/png");
    assert.equal(ok("photo.JPG", jpeg).mimeType, "image/jpeg");
    assert.equal(ok("photo.jpeg", jpeg).extension, "jpeg");
    assert.equal(ok("scan.webp", webp).mimeType, "image/webp");
  });

  it("ignores a generic declared type (browsers send octet-stream)", () => {
    ok("deck.pptx", buildPptx({ title: "t", slides: [{ title: "x" }] }), "application/octet-stream");
  });
});

describe("validateUpload — rejected files", () => {
  it("rejects extensions outside the allowlist", () => {
    rejected("tool.exe", Buffer.from("hello"), /not supported/);
    rejected("page.html", Buffer.from("<p>x</p>"), /not supported/);
    rejected("image.svg", Buffer.from("<svg/>"), /not supported/);
    rejected("macro.docm", buildDocx({ title: "t", body: ["x"] }), /not supported/);
    rejected("archive.zip", Buffer.from(zipSync({ "a.txt": new Uint8Array(1) })), /not supported/);
    rejected("noextension", Buffer.from("hello"), /not supported/);
  });

  it("rejects contents that do not match the extension", () => {
    rejected("report.pdf", Buffer.from("just text pretending to be a PDF"), /do not match/);
    rejected("report.pdf", buildDocx({ title: "t", body: ["x"] }), /do not match/);
    rejected("deck.pptx", buildDocx({ title: "t", body: ["x"] }), /do not match/);
    rejected("photo.png", jpeg, /do not match/);
    rejected("notes.txt", buildPng(), /do not match/);
    rejected("data.csv", Buffer.from([0x00, 0x01, 0x02, 0x00]), /do not match/);
  });

  it("rejects executables, scripts, HTML and SVG whatever they are called", () => {
    rejected("notes.txt", Buffer.concat([Buffer.from("MZ"), Buffer.alloc(100)]), /Executable/);
    rejected("report.pdf", Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0, 0]), /Executable/);
    rejected("notes.txt", Buffer.from("#!/bin/sh\nrm -rf /"), /Scripts/);
    rejected("notes.txt", Buffer.from("<!DOCTYPE html><html><script>alert(1)</script></html>"), /HTML and SVG/);
    rejected("notes.md", Buffer.from('<?xml version="1.0"?><svg onload="alert(1)"/>'), /HTML and SVG/);
    rejected("notes.txt", Buffer.from("hello"), /not allowed/, "application/x-msdownload");
    rejected("data.csv", Buffer.from("a,b"), /not allowed/, "text/html");
  });

  it("rejects macro-enabled, damaged and bomb Office files", () => {
    const withMacros = Buffer.from(zipSync({ "[Content_Types].xml": new Uint8Array(1), "word/document.xml": new Uint8Array(1), "word/vbaProject.bin": new Uint8Array(4) }));
    rejected("letter.docx", withMacros, /Macro-enabled/);
    const docx = buildDocx({ title: "t", body: ["x"] });
    rejected("letter.docx", docx.subarray(0, docx.length - 30), /damaged/);
    const bomb = Buffer.from(zipSync({ "[Content_Types].xml": new Uint8Array(1), "xl/workbook.xml": new Uint8Array(101 * 1024 * 1024) }, { level: 1 }));
    rejected("model.xlsx", bomb, /rejected: Archive expands/);
    const traversal = Buffer.from(zipSync({ "[Content_Types].xml": new Uint8Array(1), "ppt/presentation.xml": new Uint8Array(1), "../evil": new Uint8Array(1) }));
    rejected("deck.pptx", traversal, /unsafe entry path/);
  });

  it("rejects empty and oversized files", () => {
    rejected("empty.txt", Buffer.alloc(0), /empty/);
    rejected("huge.txt", Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0x61), /limit is 25\.0 MB/);
  });
});

describe("sanitizeFilename", () => {
  it("strips paths, control and bidi characters, and leading dots", () => {
    assert.equal(sanitizeFilename("../../etc/passwd.txt"), "passwd.txt");
    assert.equal(sanitizeFilename("C:\\Users\\ceo\\Deck v7.pptx"), "Deck v7.pptx");
    assert.equal(sanitizeFilename("invoice\u202Efdp.exe"), "invoicefdp.exe");
    assert.equal(sanitizeFilename("  ..hidden\u0000name.md  "), "hiddenname.md");
    assert.equal(sanitizeFilename('a<b>:"c|d?e*.txt'), "a_b___c_d_e_.txt");
    assert.equal(sanitizeFilename(""), "upload");
    assert.equal(sanitizeFilename("..."), "upload");
  });

  it("caps the length and keeps the extension", () => {
    const name = sanitizeFilename(`${"x".repeat(400)}.docx`);
    assert.equal(name.length, 180);
    assert.ok(name.endsWith(".docx"));
  });

  it("a bidi-disguised executable is rejected by extension", () => {
    const r = validateUpload({ filename: "report\u202Efdp.exe", bytes: Buffer.from("x") });
    assert.equal(r.ok, false);
  });
});
