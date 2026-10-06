/**
 * Minimal, allocation-light XML tokenizer for OOXML parts.
 *
 * OOXML is machine-written and well-formed, so a streaming tokenizer is all
 * the text extractors need. No DTDs are processed and only the predefined
 * and numeric entities are decoded, so there is no entity-expansion or
 * external-entity surface at all.
 */

export type XmlEvent =
  | { kind: "open"; name: string; attrs: string; selfClosing: boolean }
  | { kind: "close"; name: string }
  | { kind: "text"; text: string };

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "";
      return String.fromCodePoint(code);
    }
    return NAMED[body] ?? whole;
  });
}

/** Element name without its namespace prefix ("w:t" → "t"). */
export function localName(name: string): string {
  const i = name.indexOf(":");
  return i === -1 ? name : name.slice(i + 1);
}

/** Attribute value from a raw attribute string (prefix-insensitive when `name` has none). */
export function attr(attrs: string, name: string): string | null {
  const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrs))) {
    const key = m[1];
    if (key === name || (!name.includes(":") && localName(key) === name)) return decodeEntities(m[3] ?? m[4] ?? "");
  }
  return null;
}

/** Streams open / close / text events. Comments, PIs, DOCTYPE are skipped; CDATA becomes text. */
export function* xmlEvents(xml: string): Generator<XmlEvent> {
  const n = xml.length;
  let i = 0;
  while (i < n) {
    const lt = xml.indexOf("<", i);
    if (lt === -1) {
      const tail = xml.slice(i);
      if (tail) yield { kind: "text", text: decodeEntities(tail) };
      return;
    }
    if (lt > i) yield { kind: "text", text: decodeEntities(xml.slice(i, lt)) };

    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt + 9);
      const text = xml.slice(lt + 9, end === -1 ? n : end);
      if (text) yield { kind: "text", text };
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (xml.startsWith("<?", lt)) {
      const end = xml.indexOf("?>", lt + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (xml.startsWith("<!", lt)) {
      const end = xml.indexOf(">", lt + 2);
      i = end === -1 ? n : end + 1;
      continue;
    }

    // Find the closing '>' outside quoted attribute values.
    let j = lt + 1;
    let quote = "";
    for (; j < n; j++) {
      const c = xml[j];
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === ">") {
        break;
      }
    }
    if (j >= n) return; // truncated tag: stop quietly
    const body = xml.slice(lt + 1, j);
    i = j + 1;
    if (body[0] === "/") {
      yield { kind: "close", name: body.slice(1).trim() };
      continue;
    }
    const selfClosing = body.endsWith("/");
    const inner = selfClosing ? body.slice(0, -1) : body;
    const ws = inner.search(/\s/);
    const name = ws === -1 ? inner : inner.slice(0, ws);
    const attrs = ws === -1 ? "" : inner.slice(ws + 1);
    yield { kind: "open", name, attrs, selfClosing };
    if (selfClosing) yield { kind: "close", name };
  }
}

/** Collapses runs of spaces and blank lines produced by markup structure. */
export function tidyText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[  ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
