/**
 * DOCX → text: body paragraphs, runs, tabs and breaks, tables as rows of
 * tab-separated cells, plus page headers and footers. Tracked deletions
 * (w:delText) and field instructions (w:instrText) are not document text.
 */
import { readZipEntries, entryText } from "../zip";
import { tidyText, xmlEvents } from "../xml";
import { DocumentParseError, type ParsedDocument } from "./types";

export function docxXmlToText(xml: string): string {
  const out: string[] = [];
  let inText = false;
  let tabsDepth = 0;
  let cellDepth = 0;

  for (const ev of xmlEvents(xml)) {
    if (ev.kind === "text") {
      if (inText) out.push(ev.text);
      continue;
    }
    const name = ev.name;
    if (ev.kind === "open") {
      switch (name) {
        case "w:t":
          inText = !ev.selfClosing;
          break;
        case "w:tabs":
          if (!ev.selfClosing) tabsDepth++;
          break;
        case "w:tab":
          // w:tab inside w:tabs is a tab-stop definition, not a tab character.
          if (tabsDepth === 0) out.push("\t");
          break;
        case "w:br":
        case "w:cr":
          out.push("\n");
          break;
        case "w:noBreakHyphen":
          out.push("-");
          break;
        case "w:tc":
          if (!ev.selfClosing) cellDepth++;
          break;
        case "w:tbl":
          out.push("\n");
          break;
      }
      continue;
    }
    switch (name) {
      case "w:t":
        inText = false;
        break;
      case "w:tabs":
        tabsDepth = Math.max(0, tabsDepth - 1);
        break;
      case "w:p":
        out.push(cellDepth > 0 ? " " : "\n");
        break;
      case "w:tc":
        cellDepth = Math.max(0, cellDepth - 1);
        out.push("\t");
        break;
      case "w:tr": {
        // Drop the separator after the last cell.
        while (out.length && (out[out.length - 1] === "\t" || out[out.length - 1] === " ")) out.pop();
        out.push("\n");
        break;
      }
      case "w:tbl":
        out.push("\n");
        break;
    }
  }
  return tidyText(
    out
      .join("")
      .replace(/ +\t/g, "\t")
      .split("\n")
      .map((l) => l.replace(/[ \t]+$/, ""))
      .join("\n"),
  );
}

const partNumber = (name: string) => Number(/(\d+)\.xml$/.exec(name)?.[1] ?? 0);

export function parseDocx(bytes: Buffer | Uint8Array): ParsedDocument {
  const entries = readZipEntries(bytes, (n) => n === "word/document.xml" || /^word\/(header|footer)\d*\.xml$/.test(n));
  const documentXml = entryText(entries, "word/document.xml");
  if (documentXml == null) throw new DocumentParseError("Word document has no word/document.xml part", "corrupt");
  const body = docxXmlToText(documentXml);

  const collect = (prefix: "header" | "footer") => {
    const seen = new Set<string>();
    const texts: string[] = [];
    const names = Object.keys(entries)
      .filter((n) => n.startsWith(`word/${prefix}`))
      .sort((a, b) => partNumber(a) - partNumber(b));
    for (const n of names) {
      const t = docxXmlToText(entryText(entries, n) ?? "");
      // Different first-page / even-page headers usually repeat the same text.
      if (t && !seen.has(t) && !body.includes(t)) {
        seen.add(t);
        texts.push(t);
      }
    }
    return texts.join("\n");
  };

  const header = collect("header");
  const footer = collect("footer");
  const text = [header, body, footer].filter(Boolean).join("\n\n");
  return { text, format: "DOCX", parser: "ooxml-docx@1", pageCount: null, warnings: [] };
}
