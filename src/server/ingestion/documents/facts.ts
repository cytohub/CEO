/**
 * Deterministic key-fact extraction and version diffing for documents.
 *
 * Pulls the figures a CEO tracks across versions — money (raise, valuation,
 * ARR, contract value, burn…), runway and terms, labelled dates (close,
 * signature, launch, deadline…), labelled percentages, model metrics (AUC,
 * sensitivity…) and counts with units (donor hearts, sites, customers) —
 * each with a stable key so two versions can be compared:
 *
 *   "Raise amount changed from $35M to $40M"  → HIGH (fundraising, +14%)
 *   "Runway changed from 16.6 to 15.9 months" → MEDIUM (financial, −4%)
 *
 * Rules only: no model calls, same input → same output. Labels come from the
 * words next to each figure (closest keyword wins; text cut at neighbouring
 * figures so "ARR $4.7M, burn $1.2M" labels both correctly). Table rows are
 * read with their column headers.
 */
import { z } from "zod";

export type FactKind = "money" | "date" | "percent" | "metric" | "count" | "duration";
export type FactCategory = "fundraising" | "financial" | "contract" | "timeline" | "scientific" | "operational" | "other";
export type Significance = "HIGH" | "MEDIUM" | "LOW";

export interface KeyFact {
  /** Stable identity across versions ("raise_amount", "metric:holdout_auc", "amount:dataset scale-up"). */
  key: string;
  label: string;
  kind: FactKind;
  category: FactCategory;
  /** Normalized display value ("$40M", "16.6 months", "2026-12-18", "0.88"). */
  value: string;
  /** Comparable number: amount, months, percent points, metric, count, or days since epoch for full dates. */
  numeric: number | null;
  /** Verbatim line the fact came from (≤ 200 chars). */
  evidence: string;
}

export interface SignificantChange {
  key: string;
  label: string;
  kind: FactKind;
  category: FactCategory;
  change: "changed" | "added" | "removed";
  from: string | null;
  to: string | null;
  /** Relative change in percent for numeric facts. */
  deltaPct: number | null;
  /** Shift in days for full dates. */
  deltaDays: number | null;
  significance: Significance;
}

interface Rule {
  key: string;
  label: string;
  category: FactCategory;
  re: RegExp;
  /** Weak cue ("by", "meeting"): used only when no specific rule matches nearby. */
  generic?: boolean;
  /** Strong cue ("term sheet"): wins whenever it appears in the clause, however far. */
  dominant?: boolean;
}

// ─── Label rules (more specific first: ties on distance go to the earlier rule) ─────

const MONEY_RULES: Rule[] = [
  { key: "pre_money", label: "Pre-money valuation", category: "fundraising", re: /\bpre-?money\b/gi },
  { key: "post_money", label: "Post-money valuation", category: "fundraising", re: /\bpost-?money\b/gi },
  { key: "valuation", label: "Valuation", category: "fundraising", re: /\bvaluation\b/gi },
  { key: "arr", label: "ARR", category: "financial", re: /\b(ARR|annual recurring revenue)\b/g },
  { key: "burn", label: "Monthly burn", category: "financial", re: /\b(net burn|burn rate|burn)\b/gi },
  { key: "cash", label: "Cash on hand", category: "financial", re: /\b(cash on hand|cash balance|cash)\b/gi },
  { key: "raise_amount", label: "Raise amount", category: "fundraising", re: /\b(rais(?:e|es|ed|ing)|round|series [a-f]|fundrais\w*|financing|use of funds|first close|committed)\b/gi },
  { key: "revenue", label: "Revenue", category: "financial", re: /\brevenues?\b/gi },
  { key: "bookings", label: "Bookings", category: "financial", re: /\bbookings\b/gi },
  { key: "budget", label: "Budget", category: "financial", re: /\bbudget(?:ed)?\b/gi },
  { key: "liability_cap", label: "Liability cap", category: "contract", re: /\bliability cap\b/gi },
  { key: "service_credits", label: "Service credits", category: "contract", re: /\b(service credits?|penalt(?:y|ies)|liquidated damages)\b/gi },
  { key: "price", label: "Price", category: "financial", re: /\b(price|pricing|per compound|per seat|per user|list price)\b/gi },
  { key: "contract_value", label: "Contract value", category: "contract", re: /\b(contract|agreement|MSA|SOW|statement of work|TCV|ACV|subscription|license fee|annual fee|fees?)\b/gi },
  { key: "proposal_value", label: "Proposal value", category: "contract", re: /\b(proposal|proposed|quote|quoted|study|pilot)\b/gi },
  { key: "deal_value", label: "Deal value", category: "contract", re: /\b(deal|opportunity|renewal|expansion)\b/gi },
  { key: "compensation", label: "Compensation", category: "other", re: /\b(salary|base pay|OTE|compensation|bonus|sign-on)\b/gi },
];

const DATE_RULES: Rule[] = [
  { key: "term_sheet_date", label: "Term sheet date", category: "fundraising", re: /\bterm sheet\b/gi, dominant: true },
  // Not bare "close": "close the VP Sales hire by Friday" is a deadline, not a closing date.
  { key: "close_date", label: "Close date", category: "fundraising", re: /\b(first close|final close|closing|closes|close date|expected close|target close)\b/gi },
  { key: "signature_date", label: "Signature date", category: "contract", re: /\b(sign|signed|signing|signature|execution|executed|countersign\w*)\b/gi },
  { key: "effective_date", label: "Effective date", category: "contract", re: /\beffective\b/gi },
  { key: "expiry_date", label: "Expiry date", category: "contract", re: /\b(expir\w+|terminat\w+|renewal date|renews?)\b/gi },
  { key: "pre_ind_date", label: "Pre-IND meeting", category: "timeline", re: /\bpre-IND\b/gi, dominant: true },
  { key: "board_meeting", label: "Board meeting", category: "timeline", re: /\bboard (?:meeting|pre-read)\b/gi, dominant: true },
  // Case-sensitive on purpose: "GA" must not match "ga" inside other words' contexts.
  { key: "launch_date", label: "Launch date", category: "timeline", re: /\b([Ll]aunch\w*|GA|[Gg]eneral availability|[Rr]elease[sd]?|[Gg]o-live|[Gg]o live)\b/g },
  { key: "delivery_date", label: "Delivery date", category: "timeline", re: /\b(deliver\w*|readout|handover|report due)\b/gi },
  { key: "start_date", label: "Start date", category: "timeline", re: /\b(start\w*|kick-?off|begin\w*|commence\w*)\b/gi, generic: true },
  { key: "meeting_date", label: "Meeting date", category: "timeline", re: /\b(meeting|call|offsite|steering committee|committee meets)\b/gi, generic: true },
  // "by <date>" is a deadline, "Prepared by Jonas Weber" is not.
  { key: "deadline", label: "Deadline", category: "timeline", re: /\b([Dd]eadline|[Dd]ue|[Nn]o later than|[Uu]ntil|[Bb]y(?!\s+[A-Z][a-z]+\s+[A-Z]))\b/g, generic: true },
];

const PERCENT_RULES: Rule[] = [
  { key: "nrr", label: "Net revenue retention", category: "financial", re: /\b(net revenue retention|net retention|NRR|net dollar retention|NDR)\b/gi },
  { key: "grr", label: "Gross revenue retention", category: "financial", re: /\b(gross revenue retention|gross retention|GRR)\b/gi },
  { key: "gross_margin", label: "Gross margin", category: "financial", re: /\b(gross margin|margin)\b/gi },
  { key: "option_pool", label: "Option pool", category: "fundraising", re: /\boption pool\b/gi },
  { key: "ownership", label: "Ownership", category: "fundraising", re: /\b(equity|ownership|stake|dilution|pro-rata)\b/gi },
  { key: "growth", label: "Growth", category: "financial", re: /\b(growth|YoY|year-over-year|grew)\b/gi },
  { key: "discount", label: "Discount", category: "contract", re: /\b(discount|compute credits|credits)\b/gi },
  { key: "uptime", label: "Uptime commitment", category: "contract", re: /\b(uptime|availability)\b/gi },
  { key: "qc_pass_rate", label: "QC pass rate", category: "scientific", re: /\b(pass rate|QC|quality control|yield)\b/gi },
  { key: "probability", label: "Probability", category: "other", re: /\b(probability|likelihood)\b/gi },
];

const FINANCIAL_CATEGORIES = new Set<FactCategory>(["fundraising", "financial", "contract"]);
const CATEGORY_ORDER: FactCategory[] = ["fundraising", "financial", "contract", "timeline", "scientific", "operational", "other"];
const SIGNIFICANCE_RANK: Record<Significance, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

// ─── Segmentation ────────────────────────────────────────────────────────────

const ABBREVIATION = /\b(vs|e\.g|i\.e|approx|no|dr|mr|ms|mrs|inc|ltd|st|fig|est)$/i;

const BLOCK_START = /^(#|[-*•]\s|\d+[.)]\s|[A-Z]\.\s|Slide \d+$|Sheet: |\|)/;

/**
 * Re-joins visually wrapped lines (PDF text) into paragraphs: a line that does
 * not end a sentence continues on the next one, unless either is a heading,
 * list item or table row.
 */
export function reflowLines(text: string): string {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const prev = out.length ? out[out.length - 1] : "";
    if (line && prev && !/[.:;!?]$/.test(prev) && !prev.includes("\t") && !line.includes("\t") && !BLOCK_START.test(line) && !BLOCK_START.test(prev)) {
      out[out.length - 1] = `${prev} ${line}`;
    } else {
      out.push(line);
    }
  }
  return out.join("\n");
}

/** Lines, with long lines split into sentences. */
export function segmentText(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.length <= 320) {
      out.push(line);
      continue;
    }
    let start = 0;
    for (let i = 0; i < line.length - 2; i++) {
      const c = line[i];
      if ((c === "." || c === "!" || c === "?" || c === ";") && line[i + 1] === " " && /[A-Z0-9$€£"“(]/.test(line[i + 2]) && !ABBREVIATION.test(line.slice(Math.max(start, i - 6), i))) {
        out.push(line.slice(start, i + 1).trim());
        start = i + 2;
      }
    }
    if (start < line.length) out.push(line.slice(start).trim());
  }
  return out.filter(Boolean);
}

interface Segment {
  /** What rules read: the line, or "row label — column header: cell" for table cells. */
  text: string;
  /** Verbatim source line (evidence). */
  evidence: string;
  /** Table row label, used to name figures no rule recognizes. */
  rowLabel?: string;
}

/** "| a | b |" Markdown table rows → cells (null for separator rows, undefined for other lines). */
function markdownCells(line: string): string[] | null | undefined {
  if (!/^\|.*\|$/.test(line)) return undefined;
  if (/^\|[\s:|-]+\|$/.test(line)) return null;
  return line.slice(1, -1).split("|").map((c) => c.trim());
}

/**
 * Table rows (tab-separated, or Markdown pipes) under a header row become one
 * virtual sentence per cell, "row label — column header: value", so figures
 * pick up their column header as context instead of a neighbouring cell's.
 */
function buildSegments(text: string): Segment[] {
  const out: Segment[] = [];
  let header: string[] | null = null;
  for (const line of segmentText(text)) {
    const evidence = line.length > 200 ? `${line.slice(0, 199)}…` : line;
    const md = markdownCells(line);
    if (md === null) continue;
    const cells = md ?? (line.includes("\t") ? line.split("\t").map((c) => c.trim()) : null);
    if (!cells || /^(Sheet: |Slide \d+$)/.test(line)) {
      header = null;
      out.push({ text: line, evidence });
      continue;
    }
    if (!cells.some((c) => /\d/.test(c))) {
      header = cells;
      out.push({ text: cells.join(" · "), evidence });
      continue;
    }
    if (!header || header.length < 2 || cells.length < 2) {
      out.push({ text: cells.join(" "), evidence });
      continue;
    }
    for (let c = 1; c < cells.length; c++) {
      if (!cells[c] || !/\d/.test(cells[c])) continue;
      out.push({ text: `${cells[0]} — ${header[c] ?? ""}: ${cells[c]}`, evidence, rowLabel: cells[0] });
    }
  }
  return out;
}

// ─── Value parsing ───────────────────────────────────────────────────────────

const MONEY_RE =
  /(?:(US\$|USD|EUR|GBP|€|£|\$)\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(\+)?(\s?(?:billion|million|thousand|bn|mm|[kmb])\b)?|(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s?(billion|million|thousand|bn|mm|[kmb])?\s?(USD|EUR|GBP|dollars|euros)\b)/gi;
const PERCENT_RE = /(\d{1,3}(?:\.\d+)?)\s?(%|percent\b)/gi;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_NAME = "(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const DATE_PATTERNS: { re: RegExp; parse: (m: RegExpExecArray) => { value: string; numeric: number | null } | null }[] = [
  { re: /\b(20\d{2})-(\d{2})-(\d{2})\b/g, parse: (m) => isoDay(+m[1], +m[2], +m[3]) },
  { re: /\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/g, parse: (m) => isoDay(+m[3], +m[1], +m[2]) },
  { re: new RegExp(`\\b${MONTH_NAME}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d{2}))?\\b`, "gi"), parse: (m) => monthDay(m[1], +m[2], m[3] ? +m[3] : null) },
  { re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_NAME}\\.?,?\\s+(20\\d{2})\\b`, "gi"), parse: (m) => monthDay(m[2], +m[1], +m[3]) },
  { re: new RegExp(`\\b(?:(early|mid|late)-)?${MONTH_NAME}\\s+(20\\d{2})\\b`, "gi"), parse: (m) => monthYear(m[2], +m[3], m[1]) },
  { re: /\b(Q[1-4]|H[12])\s?(?:FY\s?)?(20\d{2}|'?\d{2})\b/g, parse: (m) => period(m[1], m[2]) },
];

function monthIndex(name: string): number {
  return MONTHS.indexOf(name.slice(0, 3).toLowerCase());
}

function isoDay(y: number, m: number, d: number): { value: string; numeric: number } | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = Date.UTC(y, m - 1, d);
  if (new Date(t).getUTCDate() !== d) return null;
  return { value: new Date(t).toISOString().slice(0, 10), numeric: Math.round(t / 86_400_000) };
}

function monthDay(name: string, d: number, y: number | null) {
  const m = monthIndex(name);
  if (m < 0) return null;
  if (y == null) return d >= 1 && d <= 31 ? { value: `--${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`, numeric: null } : null;
  return isoDay(y, m + 1, d);
}

function monthYear(name: string, y: number, part?: string) {
  const m = monthIndex(name);
  if (m < 0) return null;
  return { value: `${part ? `${part.toLowerCase()}-` : ""}${y}-${String(m + 1).padStart(2, "0")}`, numeric: null };
}

function period(p: string, y: string) {
  const year = y.replace("'", "");
  return { value: `${year.length === 2 ? `20${year}` : year}-${p.toUpperCase()}`, numeric: null };
}

const SCALE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9 };

function trimDecimals(n: number, digits: number): string {
  return n.toFixed(digits).replace(/\.?0+$/, "");
}

export function formatMoney(amount: number, symbol = "$"): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}${symbol}${trimDecimals(abs / 1e9, 2)}B`;
  if (abs >= 1e6) return `${sign}${symbol}${trimDecimals(abs / 1e6, 2)}M`;
  if (abs >= 1e4) return `${sign}${symbol}${trimDecimals(abs / 1e3, 1)}K`;
  return `${sign}${symbol}${abs.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function currencySymbol(token: string | undefined): string {
  const t = (token ?? "$").toUpperCase();
  if (t === "€" || t === "EUR" || t === "EUROS") return "€";
  if (t === "£" || t === "GBP") return "£";
  return "$";
}

// ─── Labelling ───────────────────────────────────────────────────────────────

interface Span {
  start: number;
  end: number;
}

/** The rule whose keyword sits closest to the figure (before it, or right after it); specific cues beat generic ones. */
function pickRule(rules: Rule[], before: string, after: string): Rule | null {
  for (const rule of rules) {
    if (!rule.dominant) continue;
    rule.re.lastIndex = 0;
    const hit = rule.re.test(before);
    rule.re.lastIndex = 0;
    if (hit) return rule;
  }
  return closestRule(rules.filter((r) => !r.generic), before, after) ?? closestRule(rules.filter((r) => r.generic), before, after);
}

function closestRule(rules: Rule[], before: string, after: string): Rule | null {
  let best: { rule: Rule; distance: number } | null = null;
  for (const rule of rules) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let lastEnd = -1;
    while ((m = rule.re.exec(before))) lastEnd = m.index + m[0].length;
    if (lastEnd >= 0) {
      const distance = before.length - lastEnd;
      if (!best || distance < best.distance) best = { rule, distance };
    }
    rule.re.lastIndex = 0;
    const a = rule.re.exec(after);
    rule.re.lastIndex = 0;
    if (a && a.index <= 24) {
      const distance = a.index + 0.5;
      if (!best || distance < best.distance) best = { rule, distance };
    }
  }
  return best?.rule ?? null;
}

const QUALIFIER_STOP = new Set(["the", "a", "an", "of", "to", "for", "and", "or", "in", "on", "at", "with", "by", "is", "are", "was", "be", "our", "we", "amount", "value", "total", "usd", "share", "pct", "percent", "percentage", "approx", "approximately", "about", "—", "-"]);

/** Up to three meaningful words before the figure, for facts without a known label. */
function qualifierOf(before: string): string | null {
  const words = before
    .replace(/[^A-Za-z0-9\- ]+/g, " ")
    .split(/\s+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w && !QUALIFIER_STOP.has(w) && !/^\d+$/.test(w));
  const q = words.slice(-3).join(" ");
  return q.length >= 3 ? q : null;
}

/** Clause boundaries: a label never reaches across "; " or a sentence end. */
const CLAUSE_END = /[;]|\.\s/g;

function rowQualifier(label: string): string | null {
  const q = label.replace(/[*_`]/g, "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 60);
  return q.length >= 2 ? q : null;
}

function windowBefore(text: string, start: number, spans: Span[], size = 70): string {
  let from = Math.max(0, start - size);
  for (const s of spans) if (s.end <= start && s.end > from) from = s.end;
  const slice = text.slice(from, start);
  let cut = 0;
  CLAUSE_END.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CLAUSE_END.exec(slice))) cut = m.index + m[0].length;
  return slice.slice(cut);
}

function windowAfter(text: string, end: number, spans: Span[], size = 40): string {
  let to = Math.min(text.length, end + size);
  for (const s of spans) if (s.start >= end && s.start < to) to = s.start;
  const slice = text.slice(end, to);
  CLAUSE_END.lastIndex = 0;
  const m = CLAUSE_END.exec(slice);
  return m ? slice.slice(0, m.index) : slice;
}

function overlaps(spans: Span[], s: Span): boolean {
  return spans.some((o) => s.start < o.end && o.start < s.end);
}

// ─── Extraction ──────────────────────────────────────────────────────────────

const METRIC_RE =
  /\b(ROC[- ]?AUC|AUROC|AUC|accuracy|sensitivity|specificity|precision|recall|F1(?:[- ]score)?|PPV|NPV|concordance)\b\s*(?:\([^)]{0,24}\)\s*)?(?:of|=|:|at|was|is|reached|improved to|of only)?\s*(≥|>=|>|≤|<=|<)?\s*(0?\.\d+|1\.0+|\d{1,3}(?:\.\d+)?\s?%)/gi;
const METRIC_LABEL: Record<string, string> = { auroc: "AUC", "roc-auc": "AUC", "roc auc": "AUC", rocauc: "AUC", auc: "AUC", f1: "F1 score", "f1-score": "F1 score", "f1 score": "F1 score", ppv: "PPV", npv: "NPV" };
const COUNT_RE =
  /\b(\d{1,3}(?:,\d{3})+|\d+)(\+)?\s+(?:new\s+|additional\s+|active\s+|paying\s+|more\s+)?(donor hearts?|human hearts?|hearts|hospital sites?|tissue sites?|sourcing sites?|sites|pharma customers?|customers|compounds|patients|employees|FTEs?|studies|recordings|samples|slides|investors|redlines)\b/gi;
const COUNT_UNIT: [RegExp, string, string, FactCategory][] = [
  [/hearts?/i, "donor_hearts", "Donor hearts", "scientific"],
  [/sites?/i, "sites", "Sites", "operational"],
  [/customers?/i, "customers", "Customers", "operational"],
  [/compounds/i, "compounds", "Compounds", "scientific"],
  [/patients/i, "patients", "Patients", "scientific"],
  [/employees|FTE/i, "headcount", "Headcount", "operational"],
  [/studies/i, "studies", "Studies", "scientific"],
  [/recordings/i, "recordings", "Recordings", "scientific"],
  [/samples/i, "samples", "Samples", "scientific"],
  [/slides/i, "slides", "Slides", "other"],
  [/investors/i, "investors", "Investors", "fundraising"],
  [/redlines/i, "redlines", "Redlines", "contract"],
];

function pushFact(facts: KeyFact[], seen: Set<string>, fact: KeyFact) {
  const id = `${fact.key}|${fact.numeric ?? fact.value.toLowerCase()}`;
  if (seen.has(id)) return;
  seen.add(id);
  facts.push(fact);
}

function extractFromSegment(seg: Segment, facts: KeyFact[], seen: Set<string>) {
  const text = seg.text;
  const evidence = seg.evidence;
  const qualify = (before: string) => (seg.rowLabel ? rowQualifier(seg.rowLabel) : qualifierOf(before));
  const money: (Span & { amount: number; symbol: string; plus: boolean })[] = [];
  const percents: (Span & { value: number })[] = [];
  const dates: (Span & { value: string; numeric: number | null })[] = [];

  MONEY_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MONEY_RE.exec(text))) {
    const num = Number((m[2] ?? m[5]).replace(/,/g, ""));
    const scaleToken = (m[4] ?? m[6] ?? "").trim().toLowerCase();
    if (!Number.isFinite(num)) continue;
    // "5 m" without a currency symbol is a distance, not money; the regex only allows that form with USD/EUR words.
    money.push({ start: m.index, end: m.index + m[0].length, amount: num * (SCALE[scaleToken] ?? 1), symbol: currencySymbol(m[1] ?? m[7]), plus: Boolean(m[3]) });
  }
  PERCENT_RE.lastIndex = 0;
  while ((m = PERCENT_RE.exec(text))) {
    const span = { start: m.index, end: m.index + m[0].length };
    if (!overlaps(money, span)) percents.push({ ...span, value: Number(m[1]) });
  }
  for (const p of DATE_PATTERNS) {
    p.re.lastIndex = 0;
    while ((m = p.re.exec(text))) {
      const span = { start: m.index, end: m.index + m[0].length };
      if (overlaps(money, span) || overlaps(percents, span)) continue;
      const parsed = p.parse(m);
      if (!parsed) continue;
      // Prefer the longer (more specific) match when patterns overlap.
      const clash = dates.findIndex((d) => span.start < d.end && d.start < span.end);
      if (clash >= 0) {
        if (dates[clash].end - dates[clash].start >= span.end - span.start) continue;
        dates.splice(clash, 1);
      }
      dates.push({ ...span, ...parsed });
    }
  }
  const allSpans: Span[] = [...money, ...percents, ...dates];

  // Money
  for (const x of money) {
    const before = windowBefore(text, x.start, allSpans);
    const after = windowAfter(text, x.end, allSpans);
    const rule = pickRule(MONEY_RULES, before, after);
    const value = `${formatMoney(x.amount, x.symbol)}${x.plus ? "+" : ""}`;
    if (rule) {
      pushFact(facts, seen, { key: rule.key, label: rule.label, kind: "money", category: rule.category, value, numeric: x.amount, evidence });
    } else {
      const q = qualify(before);
      if (q) pushFact(facts, seen, { key: `amount:${q}`, label: `Amount (${q})`, kind: "money", category: "other", value, numeric: x.amount, evidence });
    }
  }

  // Percentages
  for (const x of percents) {
    const before = windowBefore(text, x.start, allSpans, 50);
    const after = windowAfter(text, x.end, allSpans, 30);
    if (/\b(ROC[- ]?AUC|AUROC|AUC|accuracy|sensitivity|specificity|precision|recall|F1)\b\W{0,12}$/i.test(before)) continue; // metric, handled below
    const rule = pickRule(PERCENT_RULES, before, after);
    const value = `${trimDecimals(x.value, 2)}%`;
    if (rule) {
      pushFact(facts, seen, { key: rule.key, label: rule.label, kind: "percent", category: rule.category, value, numeric: x.value, evidence });
    } else {
      const q = qualify(before);
      if (q) pushFact(facts, seen, { key: `percent:${q}`, label: `Share (${q})`, kind: "percent", category: /use of funds|allocation|proceeds/i.test(text) ? "fundraising" : "other", value, numeric: x.value, evidence });
    }
  }

  // Dates (labelled only: an unlabelled date is usually a letterhead or a log stamp)
  for (const x of dates) {
    const before = windowBefore(text, x.start, allSpans, 60);
    const after = windowAfter(text, x.end, allSpans, 30);
    const rule = pickRule(DATE_RULES, before, after);
    if (!rule) continue;
    let category = rule.category;
    if (rule.key === "close_date" && !/\b(series|round|raise|investor|financing|term sheet|fundrais\w*)\b/i.test(text)) category = "contract";
    pushFact(facts, seen, { key: rule.key, label: rule.label, kind: "date", category, value: x.value, numeric: x.numeric, evidence });
  }

  // Runway, contract term and study length
  const masked = (s: Span) => overlaps(allSpans, s);
  if (/\brunway\b/i.test(text) && /\bmonths?\b/i.test(text)) {
    const re = /(^|[^\w.$€£])(\d{1,3}(?:\.\d+)?)(\+)?(?![\w%.]|\.\d)/g;
    while ((m = re.exec(text))) {
      const start = m.index + m[1].length;
      const span = { start, end: start + m[2].length + (m[3] ? 1 : 0) };
      const n = Number(m[2]);
      if (masked(span) || n <= 0 || n > 120) continue;
      // Skip "FY26"-style or list numbering "1." by requiring months nearby or a table cell context.
      const near = text.slice(Math.max(0, start - 50), span.end + 14);
      if (!/\bmonths?\b/i.test(near) && !/\brunway\b/i.test(near)) continue;
      pushFact(facts, seen, { key: "runway", label: "Runway", kind: "duration", category: "financial", value: `${trimDecimals(n, 1)}${m[3] ? "+" : ""} months`, numeric: n, evidence });
    }
  }
  const termRe = /\b(\d{1,2})[- ](year|month)s?\b/gi;
  while ((m = termRe.exec(text))) {
    const before = text.slice(Math.max(0, m.index - 40), m.index);
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 24);
    if (!/\b(term|initial term|agreement|MSA|contract)\b/i.test(`${before} ${after}`)) continue;
    const months = Number(m[1]) * (m[2].toLowerCase() === "year" ? 12 : 1);
    pushFact(facts, seen, { key: "contract_term", label: "Contract term", kind: "duration", category: "contract", value: `${m[1]} ${m[2].toLowerCase()}${Number(m[1]) === 1 ? "" : "s"}`, numeric: months, evidence });
  }
  const weeksRe = /\b(\d{1,3})[- ]weeks?\b/gi;
  while ((m = weeksRe.exec(text))) {
    if (!/\b(study|pilot|program|programme|project|engagement)\b/i.test(text)) continue;
    pushFact(facts, seen, { key: "study_duration", label: "Study duration", kind: "duration", category: "contract", value: `${m[1]} weeks`, numeric: Number(m[1]) / 4.345, evidence });
  }

  // Model metrics
  METRIC_RE.lastIndex = 0;
  while ((m = METRIC_RE.exec(text))) {
    const name = m[1];
    const base = METRIC_LABEL[name.toLowerCase()] ?? name[0].toUpperCase() + name.slice(1).toLowerCase();
    const raw = m[3].replace(/\s/g, "");
    const numeric = raw.endsWith("%") ? Number(raw.slice(0, -1)) / 100 : Number(raw);
    if (!Number.isFinite(numeric)) continue;
    const before = text.slice(Math.max(0, m.index - 30), m.index);
    const holdout = /hold-?out|held-?out|validation set|test set/i.test(before) || /hold-?out/i.test(text.slice(m.index, m.index + m[0].length));
    const isTarget = Boolean(m[2]) || /\b(target|threshold|goal|bar)\b\W{0,12}$/i.test(before);
    const keyBase = base.toLowerCase().replace(/\s+/g, "_");
    const label = isTarget ? `${base} target` : `${holdout ? "Hold-out " : ""}${base}`;
    const key = isTarget ? `metric:${keyBase}_target` : `metric:${holdout ? "holdout_" : ""}${keyBase}`;
    pushFact(facts, seen, { key, label, kind: "metric", category: "scientific", value: trimDecimals(numeric, 3), numeric, evidence });
    // "AUC 0.88 vs 0.90 target"
    const tail = text.slice(m.index + m[0].length, m.index + m[0].length + 40);
    const vs = /^\s*(?:vs\.?|versus|against|compared (?:to|with))\s+(?:an?\s+|the\s+)?(?:target\s+(?:of\s+)?)?(0?\.\d+|\d{1,3}(?:\.\d+)?%)(\s*target)?/i.exec(tail);
    if (!isTarget && vs && (vs[2] || /target/i.test(vs[0]))) {
      const t = vs[1].endsWith("%") ? Number(vs[1].slice(0, -1)) / 100 : Number(vs[1]);
      if (Number.isFinite(t)) pushFact(facts, seen, { key: `metric:${keyBase}_target`, label: `${base} target`, kind: "metric", category: "scientific", value: trimDecimals(t, 3), numeric: t, evidence });
    }
  }

  // Counts with units: "410 donor hearts", or a table cell "Donor hearts: 410"
  const cellCount = /^(.*) — ([^:]+): (\d{1,3}(?:,\d{3})+|\d+)$/.exec(text);
  if (cellCount) {
    const unit = COUNT_UNIT.find(([re]) => re.test(cellCount[2]));
    if (unit && /^(donor hearts?|hearts|sites|customers|compounds|patients|employees|FTEs?|studies|recordings|samples|investors)$/i.test(cellCount[2].trim())) {
      const n = Number(cellCount[3].replace(/,/g, ""));
      pushFact(facts, seen, { key: unit[1], label: unit[2], kind: "count", category: unit[3], value: n.toLocaleString("en-US"), numeric: n, evidence });
    }
  }
  COUNT_RE.lastIndex = 0;
  while ((m = COUNT_RE.exec(text))) {
    const span = { start: m.index, end: m.index + m[1].length };
    if (masked(span)) continue;
    const n = Number(m[1].replace(/,/g, ""));
    const unit = COUNT_UNIT.find(([re]) => re.test(m![3]));
    if (!unit || !Number.isFinite(n)) continue;
    pushFact(facts, seen, { key: unit[1], label: unit[2], kind: "count", category: unit[3], value: `${n.toLocaleString("en-US")}${m[2] ?? ""}`, numeric: n, evidence });
  }
}

/** `reflow`: join visually wrapped lines first (PDF text). */
export function extractKeyFacts(text: string, opts: { maxFacts?: number; reflow?: boolean } = {}): KeyFact[] {
  const facts: KeyFact[] = [];
  const seen = new Set<string>();
  const max = opts.maxFacts ?? 200;
  for (const seg of buildSegments(opts.reflow ? reflowLines(text) : text)) {
    extractFromSegment(seg, facts, seen);
    if (facts.length >= max) break;
  }
  return facts.slice(0, max);
}

// ─── Stored facts ────────────────────────────────────────────────────────────

const keyFactSchema = z.object({
  key: z.string(),
  label: z.string(),
  kind: z.enum(["money", "date", "percent", "metric", "count", "duration"]),
  category: z.enum(["fundraising", "financial", "contract", "timeline", "scientific", "operational", "other"]),
  value: z.string(),
  numeric: z.number().nullable(),
  evidence: z.string(),
});

/** Validates facts read back from Document.keyFacts / DocumentVersion.keyFacts (bad entries are dropped). */
export function parseKeyFacts(json: unknown): KeyFact[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((f) => {
    const r = keyFactSchema.safeParse(f);
    return r.success ? [r.data] : [];
  });
}

// ─── Diff ────────────────────────────────────────────────────────────────────

function identity(f: KeyFact): string {
  return `${f.kind}:${f.numeric ?? f.value.toLowerCase()}`;
}

function groupByKey(facts: KeyFact[]): Map<string, KeyFact[]> {
  const map = new Map<string, KeyFact[]>();
  for (const f of facts) {
    const list = map.get(f.key) ?? [];
    if (!list.some((x) => identity(x) === identity(f))) list.push(f);
    map.set(f.key, list);
  }
  return map;
}

function significanceOf(c: Omit<SignificantChange, "significance">): Significance {
  const material = FINANCIAL_CATEGORIES.has(c.category);
  if (c.change !== "changed") return material ? "MEDIUM" : "LOW";
  if (c.kind === "date") {
    if (material || c.category === "timeline") return c.deltaDays == null || Math.abs(c.deltaDays) >= 7 ? "HIGH" : "MEDIUM";
    return "MEDIUM";
  }
  if ((c.kind === "money" || c.kind === "duration") && material && c.deltaPct != null) {
    if (Math.abs(c.deltaPct) >= 10) return "HIGH";
    return Math.abs(c.deltaPct) < 1 ? "LOW" : "MEDIUM";
  }
  if (c.deltaPct != null && Math.abs(c.deltaPct) < 1) return "LOW";
  return "MEDIUM";
}

/** Fact-level changes between two versions, most significant first. */
export function diffKeyFacts(prev: KeyFact[] | null | undefined, next: KeyFact[]): SignificantChange[] {
  if (!prev) return [];
  const before = groupByKey(prev);
  const after = groupByKey(next);
  const keys = [...new Set([...after.keys(), ...before.keys()])];
  const changes: SignificantChange[] = [];
  for (const key of keys) {
    const a = before.get(key) ?? [];
    const b = after.get(key) ?? [];
    const common = new Set(a.map(identity).filter((id) => b.some((f) => identity(f) === id)));
    const oldOnly = a.filter((f) => !common.has(identity(f)));
    const newOnly = b.filter((f) => !common.has(identity(f)));
    const pairs = Math.min(oldOnly.length, newOnly.length);
    const push = (c: Omit<SignificantChange, "significance">) => changes.push({ ...c, significance: significanceOf(c) });
    for (let i = 0; i < pairs; i++) {
      const from = oldOnly[i];
      const to = newOnly[i];
      const numeric = from.numeric != null && to.numeric != null;
      push({
        key,
        label: to.label,
        kind: to.kind,
        category: to.category,
        change: "changed",
        from: from.value,
        to: to.value,
        deltaPct: numeric && to.kind !== "date" && from.numeric !== 0 ? Math.round(((to.numeric! - from.numeric!) / Math.abs(from.numeric!)) * 1000) / 10 : null,
        deltaDays: numeric && to.kind === "date" ? to.numeric! - from.numeric! : null,
      });
    }
    for (const f of oldOnly.slice(pairs)) push({ key, label: f.label, kind: f.kind, category: f.category, change: "removed", from: f.value, to: null, deltaPct: null, deltaDays: null });
    for (const f of newOnly.slice(pairs)) push({ key, label: f.label, kind: f.kind, category: f.category, change: "added", from: null, to: f.value, deltaPct: null, deltaDays: null });
  }
  return changes
    .map((c, i) => ({ c, i }))
    .sort(
      (x, y) =>
        SIGNIFICANCE_RANK[x.c.significance] - SIGNIFICANCE_RANK[y.c.significance] ||
        (x.c.change === "changed" ? 0 : 1) - (y.c.change === "changed" ? 0 : 1) ||
        CATEGORY_ORDER.indexOf(x.c.category) - CATEGORY_ORDER.indexOf(y.c.category) ||
        x.i - y.i,
    )
    .map((x) => x.c)
    .slice(0, 50);
}

/**
 * Share of text that changed (0–1): sentence multiset overlap weighted by
 * length. Cheap (linear) and stable for long documents.
 */
export function textChangeRatio(a: string, b: string): number {
  const norm = (t: string) => segmentText(t).map((s) => s.replace(/\s+/g, " ").toLowerCase());
  const A = norm(a);
  const B = norm(b);
  const total = A.reduce((n, s) => n + s.length, 0) + B.reduce((n, s) => n + s.length, 0);
  if (!total) return 0;
  const counts = new Map<string, number>();
  for (const s of A) counts.set(s, (counts.get(s) ?? 0) + 1);
  let common = 0;
  for (const s of B) {
    const c = counts.get(s);
    if (c) {
      counts.set(s, c - 1);
      common += s.length;
    }
  }
  return Math.max(0, Math.min(1, 1 - (2 * common) / total));
}

export function describeChange(c: SignificantChange): string {
  if (c.change === "changed") return `${c.label} changed from ${c.from} to ${c.to}.`;
  if (c.change === "added") return `Added: ${c.label} ${c.to}.`;
  return `Removed: ${c.label} ${c.from}.`;
}

export interface StructureChange {
  unit: "slide" | "page" | "sheet" | null;
  before: number | null;
  after: number | null;
}

/** "Raise amount changed from $35M to $40M. 2 slides added; ~12% of text changed." (`ratio` null when the previous text was purged). */
export function summarizeChanges(changes: SignificantChange[], structure: StructureChange, ratio: number | null): string {
  const notable = changes.filter((c) => c.significance !== "LOW");
  const sentences = notable.slice(0, 3).map(describeChange);
  if (notable.length > 3) sentences.push(`${notable.length - 3} more figure change${notable.length - 3 === 1 ? "" : "s"}.`);
  else if (!notable.length && changes.length) sentences.push(`${changes.length} minor figure change${changes.length === 1 ? "" : "s"}.`);

  const tail: string[] = [];
  if (structure.unit && structure.before != null && structure.after != null && structure.after !== structure.before) {
    const d = structure.after - structure.before;
    tail.push(`${Math.abs(d)} ${structure.unit}${Math.abs(d) === 1 ? "" : "s"} ${d > 0 ? "added" : "removed"}`);
  }
  if (ratio != null) tail.push(ratio >= 0.005 ? `~${Math.max(1, Math.round(ratio * 100))}% of text changed` : "minor text edits");
  const t = tail.join("; ");
  if (t) sentences.push(`${t[0].toUpperCase()}${t.slice(1)}.`);
  return sentences.join(" ") || "Content changed.";
}

export function isSignificantChange(changes: SignificantChange[], ratio: number | null): boolean {
  return changes.some((c) => c.significance === "HIGH") || changes.filter((c) => c.significance === "MEDIUM").length >= 2 || (ratio ?? 0) >= 0.3;
}

const significantChangeSchema = z.object({
  key: z.string(),
  label: z.string(),
  kind: z.enum(["money", "date", "percent", "metric", "count", "duration"]),
  category: z.enum(["fundraising", "financial", "contract", "timeline", "scientific", "operational", "other"]),
  change: z.enum(["changed", "added", "removed"]),
  from: z.string().nullable(),
  to: z.string().nullable(),
  deltaPct: z.number().nullable(),
  deltaDays: z.number().nullable(),
  significance: z.enum(["HIGH", "MEDIUM", "LOW"]),
});

/** Validates DocumentVersion.significantChanges read back from the database. */
export function parseSignificantChanges(json: unknown): SignificantChange[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((c) => {
    const r = significantChangeSchema.safeParse(c);
    return r.success ? [r.data] : [];
  });
}
