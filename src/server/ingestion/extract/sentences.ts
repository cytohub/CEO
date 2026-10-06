/**
 * Sentence segmentation for the rules extractor.
 *
 * Every returned sentence is an exact substring of the input (`text ===
 * source.slice(start, end)`), so it can be used verbatim as extraction
 * evidence. Handles abbreviations (Dr., e.g., Inc., a.m.), initials, decimals,
 * bullets / numbered lists / checkboxes (one sentence per item) and
 * hard-wrapped prose (a single newline inside a long line is not a break).
 */

export interface Sentence {
  text: string;
  start: number;
  end: number;
}

/** Words that end with a period without ending the sentence (lower-case, without the final dot). */
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "mx", "dr", "prof", "sr", "jr", "st", "mt", "inc", "ltd", "co", "corp", "llc", "plc", "bros", "vs", "e.g", "i.e", "eg", "ie",
  "a.m", "p.m", "approx", "est", "dept", "div", "no", "nos", "fig", "figs", "al", "cf", "ca", "vol", "ref", "refs", "ph.d", "m.d", "b.sc", "m.sc",
  "u.s", "u.k", "e.u", "s.a", "a.g", "n.v", "b.v", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  "mon", "tue", "tues", "wed", "thu", "thur", "thurs", "fri", "sat", "sun", "ext", "tel", "attn", "re", "fwd", "min", "max", "incl", "excl",
]);

const BULLET = /^(?:[-*•–·▪◦]\s+|\d{1,2}[.)]\s+|[a-z][.)]\s+|\[[ xX]?\]\s+|-\s*\[[ xX]?\]\s+)/;
const TERMINAL = /[.!?…:]["')\]]*$/;

function isAbbreviation(source: string, dotIndex: number): boolean {
  let i = dotIndex - 1;
  while (i >= 0 && /[A-Za-z.]/.test(source[i])) i--;
  const word = source.slice(i + 1, dotIndex).toLowerCase();
  if (!word) return false;
  if (ABBREVIATIONS.has(word)) return true;
  // Single-letter initials ("J. Smith") and dotted acronyms ("U.S.A").
  if (/^[a-z]$/.test(word) && /[A-Z]/.test(source[dotIndex - 1])) return true;
  return /^(?:[a-z]\.)+[a-z]$/.test(word);
}

/** Split one logical block (no hard line breaks) at sentence punctuation. */
function splitBlock(source: string, start: number, end: number, out: Sentence[]) {
  let s = start;
  let i = start;
  while (i < end) {
    const ch = source[i];
    if (ch === "." || ch === "!" || ch === "?" || ch === "…") {
      // Consume runs like "?!", "..." and closing quotes/brackets.
      let j = i + 1;
      while (j < end && /[.!?…]/.test(source[j])) j++;
      while (j < end && /["')\]’”]/.test(source[j])) j++;
      const rest = source.slice(j, Math.min(end, j + 8));
      const followedByBreak = !rest.trim() || /^\s+["'(\[“‘]?[\p{Lu}\d]/u.test(rest);
      const decimal = ch === "." && /\d/.test(source[i - 1] ?? "") && /\d/.test(source[i + 1] ?? "");
      const abbrev = ch === "." && j === i + 1 && isAbbreviation(source, i);
      if (followedByBreak && !decimal && !abbrev) {
        push(source, s, j, out);
        s = j;
      }
      i = j;
      continue;
    }
    i++;
  }
  push(source, s, end, out);
}

/** Skip list markers ("- ", "1. ", "- [ ] ") so a sentence starts at its first word (still a substring). */
function skipMarkers(source: string, start: number, end: number): number {
  let a = start;
  while (a < end && /\s/.test(source[a])) a++;
  for (let m = BULLET.exec(source.slice(a, end)); m && end - a > m[0].length; m = BULLET.exec(source.slice(a, end))) a += m[0].length;
  return a;
}

function push(source: string, start: number, end: number, out: Sentence[]) {
  let a = start;
  let b = end;
  while (a < b && /\s/.test(source[a])) a++;
  while (b > a && /\s/.test(source[b - 1])) b--;
  a = skipMarkers(source, a, b);
  const text = source.slice(a, b);
  if (!/[\p{L}\p{N}]/u.test(text)) return;
  out.push({ text, start: a, end: b });
}

/**
 * Split text into sentences. Blank lines and list items are hard breaks; a
 * single newline is a break unless it looks like a soft wrap (long line with
 * no terminal punctuation followed by a line starting in lower case).
 */
export function splitSentences(source: string): Sentence[] {
  const out: Sentence[] = [];
  if (!source) return out;
  const lines: { start: number; end: number }[] = [];
  let pos = 0;
  for (const raw of source.split("\n")) {
    lines.push({ start: pos, end: pos + raw.length });
    pos += raw.length + 1;
  }

  let blockStart: number | null = null;
  let blockEnd = 0;
  const flush = () => {
    if (blockStart != null) splitBlock(source, skipMarkers(source, blockStart, blockEnd), blockEnd, out);
    blockStart = null;
  };

  for (let k = 0; k < lines.length; k++) {
    const { start, end } = lines[k];
    const line = source.slice(start, end);
    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      continue;
    }
    if (blockStart == null) {
      blockStart = start;
      blockEnd = end;
      continue;
    }
    const prev = source.slice(blockStart, blockEnd).split("\n").pop() ?? "";
    const softWrap = prev.trim().length >= 60 && !TERMINAL.test(prev.trim()) && /^[\p{Ll}(]/u.test(trimmed) && !BULLET.test(trimmed);
    if (softWrap) {
      blockEnd = end;
    } else {
      flush();
      blockStart = start;
      blockEnd = end;
    }
  }
  flush();
  return out;
}

/** Cut a sentence to at most `max` characters at a word boundary (the result is still a prefix substring). */
export function clipEvidence(text: string, max = 600): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd();
}
