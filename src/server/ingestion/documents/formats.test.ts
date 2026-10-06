import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { zipSync } from "fflate";
import { buildDocx, buildPdf, buildPng, buildPptx, buildXlsx } from "@/server/ingestion/providers/mock/document-fixtures-builders";
import { openBlob, sealBlob } from "./blobs";
import { canSkipDownload, detectionFilename, versionStampOf, withStamp } from "./common";
import { detectFormat, extensionOf, sniffBytes } from "./formats";
import { displayTitle, resourceTypeFor } from "./resource";
import { ArchiveError, isUnsafeEntryName, listZipEntries, readZipEntries } from "./zip";

const zip = (files: Record<string, Uint8Array>) => Buffer.from(zipSync(files));

describe("sniffBytes / detectFormat", () => {
  it("recognizes every generated fixture format by its bytes", () => {
    assert.equal(sniffBytes(buildPdf({ title: "t", pages: [["x"]] })), "PDF");
    assert.equal(sniffBytes(buildDocx({ title: "t", body: ["x"] })), "DOCX");
    assert.equal(sniffBytes(buildPptx({ title: "t", slides: [{ title: "x" }] })), "PPTX");
    assert.equal(sniffBytes(buildXlsx({ title: "t", sheets: [{ name: "S", rows: [["x"]] }] })), "XLSX");
    assert.equal(sniffBytes(buildPng()), "PNG");
    assert.equal(sniffBytes(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])), "JPEG");
    assert.equal(sniffBytes(Buffer.from("GIF89a....")), "GIF");
    assert.equal(sniffBytes(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")])), "WEBP");
    assert.equal(sniffBytes(Buffer.from("hello, world")), "TEXT");
    assert.equal(sniffBytes(Buffer.from("<!DOCTYPE html><html><body>x</body></html>")), "HTML");
    assert.equal(sniffBytes(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>')), "SVG");
    assert.equal(sniffBytes(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0])), "EXECUTABLE");
    assert.equal(sniffBytes(Buffer.concat([Buffer.from("MZ"), Buffer.alloc(62)])), "EXECUTABLE");
    assert.equal(sniffBytes(Buffer.from("MZ Holdings quarterly report")), "TEXT");
    assert.equal(sniffBytes(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])), "OLE");
    assert.equal(sniffBytes(zip({ "a.txt": new Uint8Array([1]) })), "ZIP");
    assert.equal(sniffBytes(Buffer.alloc(0)), "EMPTY");
  });

  it("lets bytes decide binary formats and names decide text formats", () => {
    const docx = buildDocx({ title: "t", body: ["x"] });
    assert.equal(detectFormat({ bytes: docx, filename: "lies.pdf" }).format, "DOCX");
    assert.equal(detectFormat({ bytes: Buffer.from("a,b\n1,2"), filename: "data.csv" }).format, "CSV");
    assert.equal(detectFormat({ bytes: Buffer.from("a,b\n1,2"), mimeType: "text/csv" }).format, "CSV");
    assert.equal(detectFormat({ bytes: Buffer.from("# Title"), filename: "notes.markdown" }).format, "MARKDOWN");
    assert.equal(detectFormat({ bytes: Buffer.from("plain"), filename: "noext" }).format, "TXT");
    assert.equal(detectFormat({ bytes: buildPng(), filename: "x.jpg" }).mimeType, "image/png");
    const legacy = detectFormat({ bytes: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), filename: "old.doc" });
    assert.equal(legacy.format, "OTHER");
    assert.match(legacy.unsupportedReason ?? "", /Legacy Office/);
  });

  it("extracts extensions and detection filenames", () => {
    assert.equal(extensionOf("Deck v7.PPTX"), "pptx");
    assert.equal(extensionOf(".bashrc"), null);
    assert.equal(extensionOf("folder/file"), null);
    assert.equal(detectionFilename({ title: "Q4 memo", path: "/Leadership/Q4 memo.md" }), "/Leadership/Q4 memo.md");
    assert.equal(detectionFilename({ title: "deck.pptx", path: null }), "deck.pptx");
  });
});

describe("zip guard", () => {
  it("lists entries without inflating and reads selected entries", () => {
    const bytes = zip({ "a.xml": new TextEncoder().encode("<a/>"), "b.bin": new Uint8Array(1000) });
    assert.deepEqual(
      listZipEntries(bytes).map((e) => [e.name, e.size]),
      [
        ["a.xml", 4],
        ["b.bin", 1000],
      ],
    );
    assert.deepEqual(Object.keys(readZipEntries(bytes, (n) => n.endsWith(".xml"))), ["a.xml"]);
  });

  it("rejects archives that expand beyond the limit (declared sizes, before inflating)", () => {
    const bytes = zip({ "big.xml": new Uint8Array(5000) });
    assert.throws(() => listZipEntries(bytes, { maxUncompressedBytes: 4000 }), (e: unknown) => e instanceof ArchiveError && e.reason === "too_large");
  });

  it("rejects archives with too many entries", () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 5_001; i++) files[`f${i}.txt`] = new Uint8Array(0);
    assert.throws(() => listZipEntries(zip(files)), (e: unknown) => e instanceof ArchiveError && e.reason === "too_many_entries");
  });

  it("rejects path traversal and absolute entry names", () => {
    for (const name of ["../evil.xml", "a/../../evil.xml", "/etc/passwd", "C:/x.xml", "a\\..\\b.xml"]) assert.equal(isUnsafeEntryName(name), true, name);
    assert.equal(isUnsafeEntryName("word/document.xml"), false);
    assert.equal(isUnsafeEntryName("a..b.xml"), false);
    assert.throws(() => listZipEntries(zip({ "../evil.xml": new Uint8Array(1) })), (e: unknown) => e instanceof ArchiveError && e.reason === "unsafe_path");
  });

  it("rejects non-zip bytes as corrupt", () => {
    assert.throws(() => listZipEntries(Buffer.from("PK\u0003\u0004 not really")), (e: unknown) => e instanceof ArchiveError && e.reason === "corrupt");
  });
});

describe("blob sealing", () => {
  it("round-trips bytes through AES-256-GCM and never stores plaintext", () => {
    const plain = Buffer.from("Raising $40M — confidential deck bytes");
    const sealed = sealBlob(plain);
    assert.ok(!Buffer.from(sealed).includes(plain), "ciphertext must not contain the plaintext");
    assert.equal(sealed.length, plain.length + 28, "12-byte IV + 16-byte tag");
    assert.deepEqual(openBlob(sealed), plain);
    assert.notDeepEqual(Buffer.from(sealBlob(plain)), Buffer.from(sealed), "fresh IV per seal");
  });

  it("detects tampering", () => {
    const sealed = sealBlob(Buffer.from("payload"));
    sealed[sealed.length - 1] ^= 0xff;
    assert.throws(() => openBlob(sealed));
  });
});

describe("Resource Center mirroring", () => {
  it("maps format and name to a resource type", () => {
    assert.equal(resourceTypeFor("PPTX", "Series B deck.pptx"), "PRESENTATION");
    assert.equal(resourceTypeFor("XLSX", "CytoHub Financial Model FY26–FY28.xlsx"), "FINANCIAL_MODEL");
    assert.equal(resourceTypeFor("XLSX", "Assay results.xlsx"), "DATASET");
    assert.equal(resourceTypeFor("DOCX", "Brightwater MSA v5 (redlined).docx"), "CONTRACT");
    assert.equal(resourceTypeFor("DOCX", "Mutual NDA — Halvorsen Capital.docx"), "CONTRACT");
    assert.equal(resourceTypeFor("CSV", "ephys.csv"), "DATASET");
    assert.equal(resourceTypeFor("PDF", "Dataset validation manuscript.pdf"), "SCIENTIFIC_PAPER");
    assert.equal(resourceTypeFor("MARKDOWN", "Q4 Operating Memo.md"), "DOCUMENT");
  });

  it("strips known document extensions from display titles", () => {
    assert.equal(displayTitle("Brightwater MSA v5 (redlined).docx"), "Brightwater MSA v5 (redlined)");
    assert.equal(displayTitle("Version 2.0 notes"), "Version 2.0 notes");
  });
});

describe("version-stamp skip", () => {
  const modifiedAt = new Date("2026-10-06T13:00:00Z");
  const base = { sourceUpdatedAt: modifiedAt, contentPurgedAt: null, status: "PROCESSED", document: { id: "doc" } };
  const stamped = (tag: string | null) => withStamp({ classification: { relevance: "HIGH" } } as never, versionStampOf({ versionTag: tag, modifiedAt })) as never;

  it("skips only when modified time and version tag both match", () => {
    assert.equal(canSkipDownload({ ...base, stageData: stamped("rev-1") }, { versionTag: "rev-1", modifiedAt }), true);
    assert.equal(canSkipDownload({ ...base, stageData: stamped("rev-1") }, { versionTag: "rev-2", modifiedAt }), false);
    assert.equal(canSkipDownload({ ...base, stageData: stamped("rev-1") }, { versionTag: "rev-1", modifiedAt: new Date(modifiedAt.getTime() + 1000) }), false);
    assert.equal(canSkipDownload({ ...base, stageData: stamped(null) }, { versionTag: null, modifiedAt }), true);
  });

  it("downloads when the stamp is missing, the content was purged or nothing was stored", () => {
    assert.equal(canSkipDownload({ ...base, stageData: null }, { versionTag: "rev-1", modifiedAt }), false);
    assert.equal(canSkipDownload({ ...base, stageData: stamped("rev-1"), contentPurgedAt: new Date() }, { versionTag: "rev-1", modifiedAt }), false);
    assert.equal(canSkipDownload({ ...base, stageData: stamped("rev-1"), document: null }, { versionTag: "rev-1", modifiedAt }), false);
    assert.equal(canSkipDownload({ ...base, stageData: stamped("rev-1"), document: null, status: "SKIPPED" }, { versionTag: "rev-1", modifiedAt }), true, "oversized files are not re-downloaded");
  });

  it("keeps other stage data when stamping", () => {
    const data = stamped("rev-1") as unknown as Record<string, unknown>;
    assert.deepEqual(Object.keys(data).sort(), ["classification", "sourceVersion"]);
  });
});
