/**
 * Small text helpers shared by the extraction stage (mentions, classification,
 * rules extractor, thread summaries). Pure and dependency-free.
 */

/** Consumer mailbox providers: their domains say nothing about the sender's organization. */
export const FREE_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.co.uk", "live.com", "msn.com", "yahoo.com", "yahoo.co.uk", "ymail.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "pm.me", "gmx.com", "gmx.de", "web.de", "mail.com", "zoho.com",
]);

const TWO_LEVEL_TLDS = new Set(["co.uk", "ac.uk", "org.uk", "gov.uk", "com.au", "co.jp", "co.nz", "com.br", "co.in", "com.cn", "co.kr", "com.sg", "co.za", "com.mx"]);
const SUBDOMAIN_NOISE = new Set(["mail", "email", "e", "em", "news", "info", "mx", "smtp", "us", "eu", "uk", "de", "corp", "global", "www", "notifications", "notify", "send", "bounce", "mailer"]);

export function domainOf(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const d = email.slice(at + 1).trim().toLowerCase().replace(/[>\s]+$/, "");
  return d.includes(".") ? d : null;
}

export function isFreeMailDomain(domain: string | null | undefined): boolean {
  if (!domain) return false;
  const d = domain.toLowerCase();
  if (FREE_MAIL_DOMAINS.has(d)) return true;
  // yahoo.fr, hotmail.de, outlook.es…
  return /^(?:yahoo|hotmail|outlook|live|gmail|icloud|aol|gmx|proton(?:mail)?)\.[a-z.]{2,6}$/.test(d);
}

/** The registrable part of a domain: "mail.brightwater.example" → "brightwater.example". */
export function registrableDomain(domain: string): string {
  const labels = domain.toLowerCase().split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const lastTwo = labels.slice(-2).join(".");
  const keep = TWO_LEVEL_TLDS.has(lastTwo) ? 3 : 2;
  return labels.slice(-keep).join(".");
}

/** A readable organization name guessed from a domain: "aster-cloud.com" → "Aster Cloud". */
export function companyNameFromDomain(domain: string): string {
  const labels = domain.toLowerCase().split(".").filter(Boolean);
  const lastTwo = labels.slice(-2).join(".");
  const body = labels.slice(0, TWO_LEVEL_TLDS.has(lastTwo) ? -2 : -1).filter((l) => !SUBDOMAIN_NOISE.has(l));
  const label = body.at(-1) ?? labels[0] ?? domain;
  return label
    .split(/[-_]+/)
    .filter(Boolean)
    // Short labels are usually acronyms ("gsk", "nhi").
    .map((w) => (w.length <= 3 ? w.toUpperCase() : capitalize(w)))
    .join(" ");
}

/** "karen.liu@x" → "Karen Liu"; "kliu@x" → "Kliu". */
export function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local
    .split(/[._-]+/)
    .filter((p) => p && !/^\d+$/.test(p))
    .map(capitalize)
    .join(" ") || email;
}

const AUTOMATED_LOCAL = /^(?:no-?reply|do-?not-?reply|donotreply|notifications?|notify|alerts?|mailer-daemon|postmaster|bounces?|newsletters?|news|digest|marketing|updates|info|hello|team|support|billing|receipts?|invoices?|calendar-notification|automated)(?:[+._-].*)?$/i;

/** no-reply@, notifications@, newsletter@… */
export function isAutomatedAddress(email: string | null | undefined): boolean {
  if (!email) return false;
  return AUTOMATED_LOCAL.test(email.split("@")[0] ?? "");
}

const HONORIFICS = /^(?:dr|prof|professor|mr|mrs|ms|mx|sir|dame)\.?\s+/i;

/** Lower-cased, honorific- and punctuation-free name used for matching. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(HONORIFICS, "")
    .toLowerCase()
    .replace(/[^a-z0-9@.&\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** First name without honorifics: "Dr. Maya Lindqvist" → "Maya". */
export function firstNameOf(name: string | null | undefined): string {
  if (!name) return "";
  const clean = name.replace(HONORIFICS, "").trim();
  return clean.split(/\s+/)[0] ?? clean;
}

export function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function lcFirst(s: string): string {
  if (!s) return s;
  // Keep acronyms and proper nouns ("NDA", "CardioPredict") as written.
  if (/^[A-Z]{2,}/.test(s) || /^[A-Z][a-z]+[A-Z]/.test(s)) return s;
  return s[0].toLowerCase() + s.slice(1);
}

/** Collapse whitespace and cut at a word boundary. */
export function truncateWords(s: string, max: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}

export const STOPWORDS = new Set(
  (
    "a an the and or but if then so of to in on at by for from with without about into over under as is are was were be been being am do does did done " +
    "have has had having will would shall should can could may might must this that these those it its it's we our ours us you your yours i me my " +
    "he she they them their his her there here what which who whom when where why how all any each both few more most other some such no nor not only " +
    "own same than too very just also up out off again once per via re fw fwd hi hello dear thanks thank best regards please let get got make made " +
    "new next last first one two three year years month months week weeks day days today tomorrow"
  ).split(" "),
);

/** Content tokens (lower-case, light plural stemming) for overlap scoring. */
export function contentTokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9][a-z0-9.+-]*[a-z0-9]|[a-z0-9]/g) ?? [])
    .map((t) => (t.length > 4 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Normalized form for deduplicating titles ("Send the revised data package" ≈ "send revised data package"). */
export function titleKey(s: string): string {
  return contentTokens(s).join(" ");
}

// ─── Money and numbers ───────────────────────────────────────────────────────

const SCALE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, mn: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9 };

/** Money mentions: "$40M", "$2.4 million", "€1.2m", "USD 500K", "40 million dollars". */
export const MONEY_RE =
  /(?:(?:US\$|USD|EUR|GBP|CHF|\$|€|£)\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(k|m|mm|mn|b|bn|thousand|million|billion)?\b|\b(\d+(?:\.\d+)?)\s?(k|m|mm|b|bn|thousand|million|billion)\s+(?:dollars|usd|euros?)\b)/gi;

export function moneyValue(m: RegExpExecArray): number | null {
  const raw = (m[1] ?? m[3] ?? "").replace(/,/g, "");
  const scale = (m[2] ?? m[4] ?? "").toLowerCase();
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return scale ? n * (SCALE[scale] ?? 1) : n;
}

export function firstMoney(text: string): { text: string; value: number } | null {
  MONEY_RE.lastIndex = 0;
  const m = MONEY_RE.exec(text);
  MONEY_RE.lastIndex = 0;
  if (!m) return null;
  const value = moneyValue(m);
  return value == null ? null : { text: m[0].trim(), value };
}
