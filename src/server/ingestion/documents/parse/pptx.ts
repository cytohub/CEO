/**
 * PPTX → text: slides in presentation order (sldIdLst → relationships), with
 * "Slide N" headings, DrawingML paragraphs and tables, and speaker notes.
 * Falls back to numeric file order when the presentation part is unusable.
 */
import { attr, tidyText, xmlEvents } from "../xml";
import { entryText, readZipEntries } from "../zip";
import { DocumentParseError, type ParsedDocument } from "./types";

/** DrawingML text body → text. `skipFields` drops a:fld (slide numbers on notes pages). */
export function drawingMlToText(xml: string, opts: { skipFields?: boolean } = {}): string {
  const out: string[] = [];
  let inText = false;
  let fieldDepth = 0;
  let cellDepth = 0;
  for (const ev of xmlEvents(xml)) {
    if (ev.kind === "text") {
      if (inText && !(opts.skipFields && fieldDepth > 0)) out.push(ev.text);
      continue;
    }
    if (ev.kind === "open") {
      if (ev.name === "a:t") inText = !ev.selfClosing;
      else if (ev.name === "a:br") out.push("\n");
      else if (ev.name === "a:fld" && !ev.selfClosing) fieldDepth++;
      else if (ev.name === "a:tc" && !ev.selfClosing) cellDepth++;
      continue;
    }
    switch (ev.name) {
      case "a:t":
        inText = false;
        break;
      case "a:fld":
        fieldDepth = Math.max(0, fieldDepth - 1);
        break;
      case "a:p":
        // Paragraphs inside a table cell stay on the row's line.
        out.push(cellDepth > 0 ? " " : "\n");
        break;
      case "a:tc":
        cellDepth = Math.max(0, cellDepth - 1);
        while (out.length && out[out.length - 1] === " ") out.pop();
        out.push("\t");
        break;
      case "a:tr":
        while (out.length && (out[out.length - 1] === "\t" || out[out.length - 1] === " ")) out.pop();
        out.push("\n");
        break;
    }
  }
  return tidyText(
    out
      .join("")
      .split("\n")
      .map((l) => l.replace(/[ \t]+$/, ""))
      .join("\n"),
  );
}

/** Relationship id → absolute part name, resolved against the source part's folder. */
export function parseRelationships(xml: string | null, baseDir: string): Map<string, { target: string; type: string }> {
  const rels = new Map<string, { target: string; type: string }>();
  if (!xml) return rels;
  for (const ev of xmlEvents(xml)) {
    if (ev.kind !== "open" || !ev.name.endsWith("Relationship")) continue;
    const id = attr(ev.attrs, "Id");
    const target = attr(ev.attrs, "Target");
    if (!id || !target || attr(ev.attrs, "TargetMode") === "External") continue;
    rels.set(id, { target: resolvePartPath(baseDir, target), type: attr(ev.attrs, "Type") ?? "" });
  }
  return rels;
}

export function resolvePartPath(baseDir: string, target: string): string {
  const parts = target.startsWith("/") ? [] : baseDir.split("/").filter(Boolean);
  for (const seg of target.replace(/^\//, "").split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

const slideNumber = (name: string) => Number(/slide(\d+)\.xml$/.exec(name)?.[1] ?? 0);

export function parsePptx(bytes: Buffer | Uint8Array): ParsedDocument {
  const entries = readZipEntries(
    bytes,
    (n) =>
      n === "ppt/presentation.xml" ||
      n === "ppt/_rels/presentation.xml.rels" ||
      /^ppt\/slides\/slide\d+\.xml$/.test(n) ||
      /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(n) ||
      /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n),
  );
  const warnings: string[] = [];
  const slideFiles = Object.keys(entries).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  if (!entryText(entries, "ppt/presentation.xml")) throw new DocumentParseError("Presentation has no ppt/presentation.xml part", "corrupt");

  // Presentation order: p:sldIdLst lists r:id references in display order.
  let order: string[] = [];
  const rels = parseRelationships(entryText(entries, "ppt/_rels/presentation.xml.rels"), "ppt");
  for (const ev of xmlEvents(entryText(entries, "ppt/presentation.xml") ?? "")) {
    if (ev.kind === "open" && ev.name === "p:sldId") {
      const rid = attr(ev.attrs, "r:id");
      const target = rid ? rels.get(rid)?.target : null;
      if (target && entries[target]) order.push(target);
    }
  }
  if (order.length !== slideFiles.length) {
    if (order.length) warnings.push("Slide order could not be fully resolved; using file order.");
    order = [...slideFiles].sort((a, b) => slideNumber(a) - slideNumber(b));
  }

  const blocks: string[] = [];
  order.forEach((slidePath, i) => {
    const text = drawingMlToText(entryText(entries, slidePath) ?? "");
    const slideRels = parseRelationships(entryText(entries, slidePath.replace(/slides\/(slide\d+\.xml)$/, "slides/_rels/$1.rels")), "ppt/slides");
    const notesPath = [...slideRels.values()].find((r) => r.type.endsWith("/notesSlide"))?.target;
    const notes = notesPath ? drawingMlToText(entryText(entries, notesPath) ?? "", { skipFields: true }) : "";
    const parts = [`Slide ${i + 1}`];
    if (text) parts.push(text);
    if (notes) parts.push(`Speaker notes: ${notes}`);
    blocks.push(parts.join("\n"));
  });

  return { text: blocks.join("\n\n"), format: "PPTX", parser: "ooxml-pptx@1", pageCount: order.length, warnings };
}
