/**
 * Email normalization shared by every mail provider (Gmail, Outlook, demo).
 *
 * Provider adapters hand over the full body; this module decides what the
 * Brain actually reads: the *new* content of a message, without quoted
 * history, signatures or legal footers. The full body stays in the encrypted
 * raw payload, so nothing is lost — extraction just never re-reads (and
 * re-extracts commitments from) the twenty earlier messages quoted below.
 *
 * Everything here is pure and treats content as untrusted text.
 */
import type { MessageDirection } from "@/generated/prisma/enums";
import type { Participant } from "../types";

// ─── HTML → text ─────────────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  sbquo: "‚",
  ldquo: "“",
  rdquo: "”",
  bdquo: "„",
  laquo: "«",
  raquo: "»",
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
  sect: "§",
  para: "¶",
  times: "×",
  divide: "÷",
  plusmn: "±",
  micro: "µ",
  shy: "",
  zwnj: "",
  zwj: "",
  aacute: "á",
  agrave: "à",
  acirc: "â",
  auml: "ä",
  aring: "å",
  aelig: "æ",
  ccedil: "ç",
  eacute: "é",
  egrave: "è",
  ecirc: "ê",
  euml: "ë",
  iacute: "í",
  igrave: "ì",
  icirc: "î",
  iuml: "ï",
  ntilde: "ñ",
  oacute: "ó",
  ograve: "ò",
  ocirc: "ô",
  ouml: "ö",
  oslash: "ø",
  uacute: "ú",
  ugrave: "ù",
  ucirc: "û",
  uuml: "ü",
  szlig: "ß",
  Aring: "Å",
  Auml: "Ä",
  Ouml: "Ö",
  Oslash: "Ø",
  Uuml: "Ü",
  AElig: "Æ",
  Eacute: "É",
};

export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      if (code === 160) return " ";
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    const named = NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()];
    return named ?? match;
  });
}

const BLOCK_TAGS = "p|div|section|article|header|footer|aside|nav|main|h[1-6]|ul|ol|table|thead|tbody|tfoot|tr|blockquote|pre|address|figure|figcaption|center|dl|dt|dd|form|fieldset|hr";

/** Convert an HTML email body to readable plain text. */
export function htmlToText(html: string): string {
  let s = html;
  // Content that is never visible text.
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<(script|style|head|title|template|noscript|xml|svg)\b[\s\S]*?<\/\1\s*>/gi, "");
  s = s.replace(/<(script|style|head)\b[^>]*\/?>/gi, "");
  // Line structure.
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<li\b[^>]*>/gi, "\n- ");
  s = s.replace(/<\/li\s*>/gi, "");
  s = s.replace(/<(td|th)\b[^>]*>/gi, " ");
  s = s.replace(new RegExp(`<\\/?(?:${BLOCK_TAGS})\\b[^>]*>`, "gi"), "\n");
  // Images carry no text worth keeping (tracking pixels, logos).
  s = s.replace(/<img\b[^>]*>/gi, "");
  // Every other tag disappears, keeping its text.
  s = s.replace(/<\/?[a-z][a-z0-9:-]*\b[^>]*>/gi, "");
  s = s.replace(/<\/?[a-z][a-z0-9:-]*>/gi, "");
  s = decodeHtmlEntities(s);
  return tidyText(s);
}

/** Collapse whitespace inside lines, trim lines, and keep at most one blank line in a row. */
export function tidyText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[​‌‍﻿]/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─── Quoted history & signatures ─────────────────────────────────────────────

/** "On Mon, Oct 5, 2026 at 9:14 AM Henrik <henrik@x> wrote:" and common translations. */
const ATTRIBUTION_LINE = [
  /^on\b.{0,300}\bwrote:\s*$/i,
  /^on\b.{0,300}\bwrites:\s*$/i,
  /^le\b.{0,300}\ba écrit\s*:\s*$/i,
  /^am\b.{0,300}\bschrieb.{0,120}:\s*$/i,
  /^el\b.{0,300}\bescribió:\s*$/i,
  /^den\b.{0,300}\bskrev.{0,120}:\s*$/i,
  /^op\b.{0,300}\bschreef.{0,120}:\s*$/i,
];

const SEPARATOR_LINES = [
  /^-{2,}\s*original message\s*-{2,}$/i,
  /^-{2,}\s*reply message\s*-{2,}$/i,
  /^_{10,}$/,
  /^\*?from:\*?\s.+\*?sent:\*?\s.+$/i,
];

const HEADER_BLOCK_START = /^\*?(from|von|de|fra)\s*:\*?\s+\S/i;
const HEADER_BLOCK_FIELD = /^\*?(sent|date|to|cc|subject|gesendet|datum|an|betreff|envoyé|objet|à|sendt|emne|til)\s*:\*?\s*/i;

const MOBILE_FOOTER = /^(sent from my (iphone|ipad|android|mobile|samsung|galaxy|pixel)|sent from (outlook|mail) for (ios|android)|get outlook for (ios|android)|sent from outlook|sent via superhuman|sent from my blackberry)\b/i;

const DISCLAIMER_START = /^(confidentiality notice|this (e-?mail|message)( and any (attachments?|files))?( transmitted with it)? (is|are|may be) (confidential|intended)|disclaimer:|the information (contained )?in this (e-?mail|message) is confidential)/i;

const SIGN_OFF = /^((with )?(best|kind|kindest|warm|warmest|many|all the best)( regards| wishes)?|regards|many thanks|thanks|thank you|thanks so much|thanks again|thx|cheers|warmly|sincerely|yours sincerely|yours|with thanks|talk soon|speak soon|br|mvh|med vänliga hälsningar|mit freundlichen grüßen|viele grüße|cordialement)[,.!]*$/i;

function isQuoteLine(line: string) {
  return /^\s*>/.test(line);
}

/** Index of the first line where quoted history starts, or -1. */
function quoteStart(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (ATTRIBUTION_LINE.some((re) => re.test(line))) return i;
    // Gmail wraps long attribution lines: "On Mon, … Henrik Sørensen <" / "henrik@calder.example> wrote:"
    if (/^on\b/i.test(line) && i + 1 < lines.length && /\bwrote:\s*$/i.test(lines[i + 1].trim()) && line.length + lines[i + 1].length < 400) return i;
    if (SEPARATOR_LINES.some((re) => re.test(line))) return i;
    if (HEADER_BLOCK_START.test(line)) {
      // Outlook-style header block: From: … followed closely by Sent:/Date:, To: or Subject:.
      let fields = 0;
      for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
        if (HEADER_BLOCK_FIELD.test(lines[j].trim())) fields++;
      }
      if (fields >= 2) return i;
    }
    if (isQuoteLine(lines[i])) {
      // A run of ">" lines (two or more, or one followed by the end) below the reply is quoted
      // history. Quotes above the reply (bottom-posting) are removed line by line instead.
      const replyAbove = lines.slice(0, i).some((l) => l.trim() && !isQuoteLine(l));
      const next = lines.slice(i + 1).find((l) => l.trim());
      if (replyAbove && (!next || isQuoteLine(next))) return i;
    }
  }
  return -1;
}

/** Name forms a sender signs with: "Henrik", "Henrik Sørensen", "Dr. Henrik Sørensen". */
function senderNameForms(name: string | null | undefined): string[] {
  if (!name) return [];
  const clean = name.replace(/["']/g, "").trim();
  const bare = clean.replace(/^(dr|prof|mr|mrs|ms|mx)\.?\s+/i, "").trim();
  const parts = bare.split(/\s+/).filter(Boolean);
  if (!parts.length || parts.join("").length < 2) return [];
  // "Chen, Sarah" display names.
  const flipped = bare.includes(",") ? bare.split(",").map((s) => s.trim()).reverse().join(" ") : null;
  return [...new Set([clean, bare, parts[0], flipped, flipped?.split(/\s+/)[0]].filter((s): s is string => Boolean(s && s.length >= 2)).map((s) => s.toLowerCase()))];
}

function isNameLine(line: string, forms: string[]): boolean {
  const l = line.replace(/^[-–—~]+\s*/, "").trim().toLowerCase();
  if (!l) return false;
  return forms.some((f) => l === f || l.startsWith(`${f} |`) || l.startsWith(`${f},`) || l.startsWith(`${f} -`) || l.startsWith(`${f} –`));
}

/** Index of the line where the signature starts, or -1. */
function signatureStart(lines: string[], senderName?: string | null): number {
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (raw === "-- " || raw === "--" || line === "--" || line === "—" || line === "-- ") return i;
    if (MOBILE_FOOTER.test(line)) return i;
    if (DISCLAIMER_START.test(line)) return i;
  }
  // A sign-off ("Best regards,") followed only by a few short lines (name, title, phone).
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!SIGN_OFF.test(line)) continue;
    const rest = lines.slice(i + 1).map((l) => l.trim()).filter(Boolean);
    if (rest.length <= 6 && rest.every((l) => l.length <= 80 && !/[?]$/.test(l))) return i;
  }
  // No sign-off phrase: a closing block that starts with the sender's own name ("Michael" / "Michael Grant | Partner").
  const forms = senderNameForms(senderName);
  if (forms.length) {
    const nonEmpty = lines.map((l, i) => ({ l: l.trim(), i })).filter((x) => x.l);
    for (const { l, i } of nonEmpty.slice(-7)) {
      if (i === 0 || !isNameLine(l, forms)) continue;
      const rest = lines.slice(i + 1).map((x) => x.trim()).filter(Boolean);
      if (!(rest.length <= 6 && rest.every((x) => x.length <= 80 && !/[?]$/.test(x)))) continue;
      // Take a closing line just above the name with it ("With best regards," / "Warmly,").
      const prev = [...lines.slice(0, i)].reverse().findIndex((x) => x.trim());
      const prevIndex = prev >= 0 ? i - 1 - prev : -1;
      if (prevIndex > 0) {
        const p = lines[prevIndex].trim();
        if (SIGN_OFF.test(p) || (p.length <= 30 && /,$/.test(p) && !/[.?!]/.test(p))) return prevIndex;
      }
      return i;
    }
  }
  return -1;
}

export interface NewContent {
  /** What the sender actually wrote in this message. */
  text: string;
  quotedRemoved: boolean;
  signatureRemoved: boolean;
}

/**
 * Strip quoted history and the signature from a plain-text body. Falls back
 * to the whole body when stripping would leave nothing (e.g. a bare forward).
 */
export function extractNewContent(body: string, opts: { senderName?: string | null } = {}): NewContent {
  const clean = tidyText(body);
  if (!clean) return { text: "", quotedRemoved: false, signatureRemoved: false };
  let lines = clean.split("\n");
  let quotedRemoved = false;
  let signatureRemoved = false;

  const q = quoteStart(lines);
  if (q >= 0) {
    lines = lines.slice(0, q);
    quotedRemoved = true;
  }
  // Interleaved ">" lines that survived (inline replies keep the reply text).
  if (lines.some(isQuoteLine)) {
    lines = lines.filter((l) => !isQuoteLine(l));
    quotedRemoved = true;
  }
  const withoutQuotes = tidyText(lines.join("\n"));
  const s = signatureStart(lines, opts.senderName);
  if (s >= 0) {
    lines = lines.slice(0, s);
    signatureRemoved = true;
  }

  const text = tidyText(lines.join("\n"));
  if (text) return { text, quotedRemoved, signatureRemoved };
  // Only a sign-off was left (e.g. "Thanks,\nJonas"): keep it rather than nothing.
  if (withoutQuotes) return { text: withoutQuotes, quotedRemoved, signatureRemoved: false };
  return { text: clean, quotedRemoved: false, signatureRemoved: false };
}

// ─── Addresses ───────────────────────────────────────────────────────────────

/** Decode RFC 2047 encoded words ("=?UTF-8?B?…?=", "=?iso-8859-1?Q?…?="). */
export function decodeMimeWords(value: string): string {
  return value
    .replace(/(=\?[^?]+\?[bq]\?[^?]*\?=)\s+(?==\?[^?]+\?[bq]\?)/gi, "$1")
    .replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (match, charset: string, enc: string, data: string) => {
      try {
        const bytes =
          enc.toLowerCase() === "b"
            ? Buffer.from(data, "base64")
            : Buffer.from(
                data.replace(/_/g, " ").replace(/=([0-9a-f]{2})/gi, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16))),
                "latin1",
              );
        return decodeBytes(bytes, charset);
      } catch {
        return match;
      }
    });
}

/** Decode bytes in a declared charset, falling back to UTF-8. */
export function decodeBytes(bytes: Buffer, charset?: string | null): string {
  const label = (charset ?? "utf-8").trim().toLowerCase().replace(/^"|"$/g, "") || "utf-8";
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

const EMAIL_RE = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/i;

/** Parse one address: `"Chen, Sarah" <Sarah@Northbridge.example>` → { name: "Chen, Sarah", email: "sarah@northbridge.example" }. */
export function parseAddress(value: string): Participant | null {
  const decoded = decodeMimeWords(value).trim();
  if (!decoded) return null;
  const angle = decoded.match(/^(.*)<\s*([^<>]+?)\s*>\s*$/);
  if (angle) {
    const email = angle[2].trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return null;
    const name = angle[1].trim().replace(/^"(.*)"$/, "$1").replace(/\\(.)/g, "$1").trim();
    return { name: name && name.toLowerCase() !== email ? name : null, email };
  }
  const match = decoded.match(EMAIL_RE);
  if (!match) return null;
  // "sarah@x.example (Sarah Chen)" — legacy comment form.
  const comment = decoded.match(/\(([^)]+)\)/);
  return { name: comment ? comment[1].trim() : null, email: match[0].toLowerCase() };
}

/** Split an address-list header on commas that are not inside quotes or angle brackets. */
export function parseAddressList(value: string | null | undefined): Participant[] {
  if (!value) return [];
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  let angle = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "\\" && i + 1 < value.length) {
      current += ch + value[++i];
      continue;
    }
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === "<") angle++;
    else if (!quoted && ch === ">") angle = Math.max(0, angle - 1);
    if ((ch === "," || ch === ";") && !quoted && angle === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return dedupeParticipants(parts.map(parseAddress).filter((p): p is Participant => p !== null));
}

/** Lower-case, de-duplicate, and keep the most informative display name. */
export function dedupeParticipants(list: Participant[]): Participant[] {
  const byEmail = new Map<string, Participant>();
  for (const p of list) {
    const email = p.email.trim().toLowerCase();
    if (!email) continue;
    const existing = byEmail.get(email);
    if (!existing) byEmail.set(email, { name: p.name?.trim() || null, email });
    else if (!existing.name && p.name?.trim()) existing.name = p.name.trim();
  }
  return [...byEmail.values()];
}

export function domainOf(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).trim().toLowerCase() || null : null;
}

// ─── Direction & automation ──────────────────────────────────────────────────

export interface DirectionInput {
  from: Participant;
  to: Participant[];
  cc: Participant[];
  bcc?: Participant[];
}

/**
 * OUTBOUND when the connected account (or the CEO) sent it; INTERNAL when
 * every participant is on the account's own domain; otherwise INBOUND.
 */
export function emailDirection(msg: DirectionInput, opts: { accountEmail: string | null; ceoEmail: string | null }): MessageDirection {
  const own = [opts.accountEmail, opts.ceoEmail].filter((e): e is string => Boolean(e)).map((e) => e.toLowerCase());
  const from = msg.from.email.toLowerCase();
  if (own.includes(from)) return "OUTBOUND";
  const ownDomain = domainOf(opts.accountEmail) ?? domainOf(opts.ceoEmail);
  if (ownDomain) {
    const everyone = [msg.from, ...msg.to, ...msg.cc, ...(msg.bcc ?? [])];
    if (everyone.length && everyone.every((p) => domainOf(p.email) === ownDomain)) return "INTERNAL";
  }
  return "INBOUND";
}

const AUTOMATED_SENDER = /(^|[._+-])(no-?reply|do-?not-?reply|donotreply|notifications?|notify|newsletters?|mailer-daemon|postmaster|bounces?|alerts?|digest|news|marketing|updates|calendar-notification)([._+-]|$)/i;

/** Newsletters, bulk mail, auto-replies, notifications and bounces. */
export function isAutomatedEmail(msg: { from: Participant; headers?: Record<string, string> | null }): boolean {
  const h = msg.headers ?? {};
  const header = (name: string) => {
    const v = h[name] ?? h[name.toLowerCase()];
    return typeof v === "string" ? v.trim() : "";
  };
  if (header("list-unsubscribe") || header("list-id")) return true;
  if (/^(bulk|list|junk|auto_reply)$/i.test(header("precedence"))) return true;
  const autoSubmitted = header("auto-submitted");
  if (autoSubmitted && autoSubmitted.toLowerCase() !== "no") return true;
  if (header("x-autoreply") || header("x-autorespond")) return true;
  const local = msg.from.email.toLowerCase().split("@")[0] ?? "";
  return AUTOMATED_SENDER.test(local);
}

/** "Re: Fwd: RE: Subject" → "Subject" (thread subject). */
export function baseSubject(subject: string): string {
  let s = subject.trim();
  for (let i = 0; i < 10; i++) {
    const next = s.replace(/^(re|fw|fwd|aw|wg|sv|vs|tr|r|antw)(\[\d+\])?\s*:\s*/i, "").trim();
    if (next === s) break;
    s = next;
  }
  return s || "(no subject)";
}
