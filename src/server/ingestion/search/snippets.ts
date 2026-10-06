/**
 * Safe snippet highlighting. Snippets are plain text split into parts; the UI
 * renders matches in <mark> elements, so nothing from a source is ever
 * interpreted as HTML.
 */
import { HL_START, HL_STOP } from "./sql";
import type { SnippetPart } from "./types";

/** Parse a ts_headline result (matches wrapped in control characters). */
export function parseHeadline(headline: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  const re = new RegExp(`${HL_START}([^${HL_STOP}]*)${HL_STOP}`, "g");
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(headline))) {
    if (m.index > last) parts.push({ text: headline.slice(last, m.index), match: false });
    if (m[1]) parts.push({ text: m[1], match: true });
    last = m.index + m[0].length;
  }
  if (last < headline.length) parts.push({ text: headline.slice(last), match: false });
  return merge(parts.map((p) => ({ ...p, text: p.text.replace(/[\u0000-\u0008\u000b-\u001f]/g, "") })).filter((p) => p.text));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Split `text` around case-insensitive occurrences of any term. */
export function splitTerms(text: string, terms: string[]): SnippetPart[] {
  const usable = [...new Set(terms.map((t) => t.trim()).filter((t) => t.length >= 2))].sort((a, b) => b.length - a.length);
  if (!usable.length || !text) return text ? [{ text, match: false }] : [];
  const re = new RegExp(`(${usable.map(escapeRe).join("|")})`, "gi");
  return text
    .split(re)
    .map((t, i) => ({ text: t, match: i % 2 === 1 }))
    .filter((p) => p.text.length > 0);
}

/** A window of `text` around the first term match, with ellipses, then highlighted. */
export function excerpt(text: string | null | undefined, terms: string[], max = 220): SnippetPart[] | undefined {
  if (!text) return undefined;
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return undefined;
  let start = 0;
  const lower = flat.toLowerCase();
  for (const t of terms) {
    const i = t.length >= 2 ? lower.indexOf(t.toLowerCase()) : -1;
    if (i >= 0) {
      start = Math.max(0, i - Math.floor(max / 3));
      break;
    }
  }
  let window = flat.slice(start, start + max);
  if (start > 0) window = `…${window.replace(/^\S*\s/, "")}`;
  if (start + max < flat.length) window = `${window.replace(/\s\S*$/, "")}…`;
  return splitTerms(window, terms);
}

function merge(parts: SnippetPart[]): SnippetPart[] {
  const out: SnippetPart[] = [];
  for (const p of parts) {
    const prev = out.at(-1);
    if (prev && prev.match === p.match) prev.text += p.text;
    else out.push({ ...p });
  }
  return out;
}

export function snippetText(parts: SnippetPart[] | undefined): string {
  return parts?.map((p) => p.text).join("") ?? "";
}
