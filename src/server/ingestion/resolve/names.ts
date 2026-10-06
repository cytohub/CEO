/**
 * Name, email and domain normalization for entity resolution. Pure — no
 * database access — so the matching rules are unit-testable and shared by the
 * resolver, the writer (owner / company lookups) and entity merges.
 */

// ─── Text basics ─────────────────────────────────────────────────────────────

/** Letters NFD does not decompose (ø, æ, ß…) plus the usual combining marks. */
const SPECIAL_LETTERS: Record<string, string> = {
  ø: "o",
  Ø: "O",
  æ: "ae",
  Æ: "AE",
  œ: "oe",
  Œ: "OE",
  ß: "ss",
  đ: "d",
  Đ: "D",
  ł: "l",
  Ł: "L",
  þ: "th",
  Þ: "Th",
  ı: "i",
};

export function stripAccents(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[øØæÆœŒßđĐłŁþÞı]/g, (c) => SPECIAL_LETTERS[c] ?? c);
}

export function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function titleCase(word: string): string {
  return word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word;
}

// ─── People ──────────────────────────────────────────────────────────────────

const PERSON_PREFIX = /^(dr|prof|professor|mr|mrs|ms|miss|mx|sir|dame|herr|frau|mme|mlle)\.?\s+/;
const PERSON_SUFFIX = /[\s,]+(phd|ph\.?\s?d\.?|md|m\.d\.?|mba|msc|m\.sc\.?|bsc|dphil|pharmd|jr|sr|ii|iii|iv|esq|frcp|facc)\.?$/;

/**
 * Canonical matching form of a person's name: accents and titles removed,
 * lower-case, "Last, First" swapped, punctuation dropped.
 *   "Dr. Henrik Sørensen, PhD" → "henrik sorensen"
 */
export function normalizePersonName(input: string): string {
  let s = input.replace(/<[^>]*>/g, " ").replace(/\([^)]*\)/g, " ").replace(/["“”]/g, " ");
  s = collapse(stripAccents(s).toLowerCase());
  // Suffixes first so "Sørensen, PhD" is not mistaken for "Last, First".
  for (let i = 0; i < 3 && PERSON_SUFFIX.test(s); i++) s = s.replace(PERSON_SUFFIX, "").trim();
  const comma = /^([^,]+),\s*([^,]+)$/.exec(s);
  if (comma) s = `${comma[2]} ${comma[1]}`;
  for (let i = 0; i < 3 && PERSON_PREFIX.test(s); i++) s = s.replace(PERSON_PREFIX, "");
  s = s.replace(/['’`]/g, "").replace(/[^a-z0-9 -]/g, " ").replace(/-/g, " ");
  return collapse(s);
}

export function firstNameKey(normalizedName: string): string {
  return normalizedName.split(" ")[0] ?? "";
}

/** True when a display name is a plausible human name (not an address or a role mailbox). */
export function isNameLike(display: string | null | undefined): display is string {
  if (!display) return false;
  const s = display.trim();
  if (!s || s.includes("@") || s.length > 80) return false;
  return /[A-Za-zÀ-ÿ]/.test(s);
}

/** "henrik.sorensen" → "Henrik Sorensen"; "j_doe+cytohub" → "J Doe". */
export function prettifyLocalPart(local: string): string {
  const base = local.split("+")[0] ?? local;
  const parts = base
    .split(/[._-]+/)
    .map((p) => p.replace(/\d+/g, ""))
    .filter(Boolean);
  return parts.length ? parts.map(titleCase).join(" ") : titleCase(base);
}

/** Display name for a new person: the header display name, else the prettified address. */
export function personDisplayName(displayName: string | null | undefined, email: string): string {
  if (isNameLike(displayName)) {
    const cleaned = collapse(displayName.replace(/^["']|["']$/g, "").replace(/\([^)]*\)/g, ""));
    // "Sorensen, Henrik" → "Henrik Sorensen" (keeps original casing and accents).
    const comma = /^([^,]+),\s*([^,]+)$/.exec(cleaned);
    if (comma && !PERSON_SUFFIX.test(`x ${comma[2]}`)) return `${comma[2]} ${comma[1]}`;
    return cleaned;
  }
  return prettifyLocalPart(email.split("@")[0] ?? email);
}

// ─── Email & domains ─────────────────────────────────────────────────────────

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase().replace(/^mailto:/, "");
}

export function domainOf(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const d = email.slice(at + 1).trim().toLowerCase().replace(/\.$/, "");
  return d || null;
}

/** Candidate lookup keys for a domain: itself, then parents ("eu.mail.acme.com" → "mail.acme.com" → "acme.com"). */
export function domainLookupKeys(domain: string): string[] {
  const labels = domain.toLowerCase().split(".").filter(Boolean);
  const keys: string[] = [];
  for (let i = 0; i <= labels.length - 2; i++) keys.push(labels.slice(i).join("."));
  return keys;
}

const SECOND_LEVEL = new Set(["co", "com", "ac", "org", "net", "gov", "edu", "ltd", "plc"]);

/** The organization label of a domain: "mail.brightwater.co.uk" → "brightwater". */
export function registrableLabel(domain: string): string {
  const labels = domain.toLowerCase().split(".").filter(Boolean);
  if (labels.length <= 1) return labels[0] ?? domain;
  let end = labels.length - 1; // drop the TLD
  if (end >= 2 && SECOND_LEVEL.has(labels[end - 1]) && labels[end].length === 2) end -= 1;
  return labels[end - 1] ?? labels[0];
}

const DOMAIN_SUFFIX_WORDS = ["ventures", "venture", "capital", "partners", "therapeutics", "biosciences", "bioscience", "biologics", "pharma", "health", "labs", "bio", "fund", "group"];

/** Split a run-together label at known organization words: "atlasbiopartners" → ["atlas", "bio", "partners"]. */
function splitLabel(word: string): string[] {
  const out: string[] = [];
  let rest = word;
  for (let i = 0; i < 3; i++) {
    const hit = DOMAIN_SUFFIX_WORDS.find((w) => rest.length > w.length + 2 && rest.endsWith(w));
    if (!hit) break;
    out.unshift(hit);
    rest = rest.slice(0, -hit.length);
  }
  return [rest, ...out];
}

/** "brightwater-tx.example" → "Brightwater Tx"; "orbitventures.example" → "Orbit Ventures". */
export function prettifyDomain(domain: string): string {
  return registrableLabel(domain)
    .split(/[-_]+/)
    .filter(Boolean)
    .flatMap(splitLabel)
    .map(titleCase)
    .join(" ");
}

/** A name as used in conversation: honorifics dropped ("Dr. Henrik Sørensen" → "Henrik Sørensen"). */
export function conversationalName(name: string): string {
  let s = collapse(name);
  for (let i = 0; i < 3; i++) s = s.replace(/^(dr|prof|professor|mr|mrs|ms|miss|mx|sir|dame)\.?\s+/i, "");
  s = s.replace(/,?\s+(phd|ph\.d\.|md|m\.d\.|mba)\.?$/i, "");
  return s || name;
}

const FREE_MAIL_EXACT = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "mail.com",
  "zoho.com",
  "fastmail.com",
  "hey.com",
  "qq.com",
  "163.com",
  "126.com",
  "web.de",
  "t-online.de",
  "orange.fr",
  "free.fr",
  "comcast.net",
  "verizon.net",
  "att.net",
]);
const FREE_MAIL_LABELS = new Set(["yahoo", "ymail", "hotmail", "outlook", "live", "gmx", "yandex", "libero", "laposte", "btinternet"]);

/** Consumer mailbox providers: their domain says nothing about an organization. */
export function isFreeMailDomain(domain: string | null | undefined): boolean {
  if (!domain) return false;
  const d = domain.toLowerCase();
  if (FREE_MAIL_EXACT.has(d)) return true;
  return FREE_MAIL_LABELS.has(registrableLabel(d));
}

/** Role and robot mailboxes never become people. */
export function isRoleMailbox(email: string): boolean {
  const local = (email.split("@")[0] ?? "").toLowerCase();
  return /^(no-?reply|do-?not-?reply|donotreply|notifications?|notify|mailer-daemon|postmaster|bounces?|alerts?|news(letter)?s?|updates?|marketing|info|support|hello|team|admin|billing|invoices?|calendar|accounts?|security|help|contact|sales|careers|jobs|events?)([+._-].*)?$/.test(local);
}

// ─── Companies ───────────────────────────────────────────────────────────────

const LEGAL_SUFFIX = /\s+(inc|incorporated|ltd|limited|llc|llp|lp|gmbh|ag|sa|sas|sarl|plc|corp|corporation|co|nv|bv|srl|spa|kk|oy|ab|as|a s|pty|pte|kgaa|se)$/;

/**
 * Canonical matching form of an organization name: lower-case, accents and
 * punctuation removed, "&" → "and", leading "the" and legal suffixes dropped.
 *   "The Brightwater Therapeutics, Inc." → "brightwater therapeutics"
 *   "Merck & Co."                        → "merck"
 */
export function normalizeCompanyName(input: string): string {
  let s = stripAccents(input).toLowerCase();
  s = s.replace(/&/g, " and ").replace(/\+/g, " and ");
  s = s.replace(/['’`]/g, "").replace(/[^a-z0-9 ]/g, " ");
  s = collapse(s).replace(/^the\s+/, "");
  for (let i = 0; i < 3; i++) {
    const next = s.replace(LEGAL_SUFFIX, "").replace(/\s+and$/, "").trim();
    if (next === s || !next) break;
    s = next;
  }
  return s;
}

/** Generic words that do not identify an organization on their own. */
export const GENERIC_ORG_WORDS = new Set([
  "pharma",
  "pharmaceutical",
  "pharmaceuticals",
  "pharmaceutica",
  "bio",
  "biotech",
  "biologics",
  "bioscience",
  "biosciences",
  "biopharma",
  "therapeutics",
  "sciences",
  "science",
  "life",
  "health",
  "healthcare",
  "medical",
  "oncology",
  "labs",
  "laboratories",
  "laboratory",
  "ventures",
  "venture",
  "capital",
  "partners",
  "fund",
  "funds",
  "investments",
  "holdings",
  "group",
  "global",
  "international",
  "instruments",
  "technologies",
  "technology",
  "systems",
  "solutions",
  "cloud",
  "institute",
  "university",
  "hospital",
  "foundation",
  "research",
  "and",
  "company",
]);

/** The distinctive head of a company name: "Helix Capital Partners" → "helix", "Nordic Heart Institute" → "nordic heart". */
export function companyCoreName(normalized: string): string {
  const words = normalized.split(" ").filter(Boolean);
  while (words.length > 1 && GENERIC_ORG_WORDS.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

/** Short conversational name: "Lumen Biologics" → "Lumen", "Granite Peak Capital" → "Granite Peak". */
export function companyShortName(name: string): string {
  const words = collapse(name.replace(/[,.]+/g, " ")).split(" ");
  while (words.length > 1 && (GENERIC_ORG_WORDS.has(words[words.length - 1].toLowerCase()) || LEGAL_SUFFIX.test(` ${words[words.length - 1].toLowerCase()}`))) words.pop();
  return words.join(" ");
}

const INVESTOR_NAME = /\b(capital|ventures?|partners|fund|funds|investments?|vc|equity|holdings|angels?)\b/i;
const INVESTOR_DOMAIN = /(capital|ventures?|vc$|^vc|partners|fund|invest|equity|angels?)/i;

/** Name or domain words that suggest an investment firm. */
export function looksLikeInvestor(name: string | null | undefined, domain: string | null | undefined): boolean {
  if (name && INVESTOR_NAME.test(name)) return true;
  if (domain && INVESTOR_DOMAIN.test(registrableLabel(domain))) return true;
  return false;
}

// ─── Similarity ──────────────────────────────────────────────────────────────

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return a.length ? 1 : 0;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatch = new Array<boolean>(a.length).fill(false);
  const bMatch = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - range);
    const hi = Math.min(b.length - 1, i + range);
    for (let j = lo; j <= hi; j++) {
      if (bMatch[j] || a[i] !== b[j]) continue;
      aMatch[i] = bMatch[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatch[i]) continue;
    while (!bMatch[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const m = matches;
  const jaro = (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3;
  let prefix = 0;
  while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

function ratio(a: string, b: string): number {
  if (!a.length && !b.length) return 0;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

/**
 * Token-set similarity (fuzzywuzzy-style) on already-normalized names: word
 * order and repeated words do not matter, and a name that extends another
 * ("aurelius" / "aurelius pharma") scores high. A shared part made only of
 * generic words ("pharma") is capped so it never looks like a match.
 */
export function tokenSetSimilarity(a: string, b: string): number {
  const A = new Set(a.split(" ").filter(Boolean));
  const B = new Set(b.split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  const inter = [...A].filter((t) => B.has(t)).sort();
  const onlyA = [...A].filter((t) => !B.has(t)).sort();
  const onlyB = [...B].filter((t) => !A.has(t)).sort();
  const s1 = inter.join(" ");
  const s2 = collapse(`${s1} ${onlyA.join(" ")}`);
  const s3 = collapse(`${s1} ${onlyB.join(" ")}`);
  const best = Math.max(inter.length ? ratio(s1, s2) : 0, inter.length ? ratio(s1, s3) : 0, ratio(s2, s3));
  if (inter.length && inter.every((t) => GENERIC_ORG_WORDS.has(t))) return Math.min(best, 0.5);
  return best;
}

/** Fuzzy-match rule for organization names (both normalized). */
export function isFuzzyCompanyMatch(a: string, b: string): { match: boolean; score: number } {
  if (!a || !b) return { match: false, score: 0 };
  const jw = jaroWinkler(a, b);
  const ts = tokenSetSimilarity(a, b);
  return { match: jw >= 0.93 || ts >= 0.9, score: Math.max(jw, ts) };
}
