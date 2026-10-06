/**
 * Natural-language query planner (rules engine).
 *
 * Turns "What commitments have I made to investors?" into a QueryPlan:
 * intent, entities (companies with their corporate family, people by name,
 * first name or alias, goals / deals / projects by topic), record types, time
 * range, commitment direction and company-type filters. Pure and synchronous:
 * the caller loads the Lexicon (see lexicon.ts). When the rules are unsure
 * (low confidence) search.ts may ask Claude for a plan (claude-planner.ts);
 * the rules plan is always available as the fallback.
 */
import type { CeoCategory, CompanyType } from "@/generated/prisma/enums";
import { addDays, dayKey } from "@/lib/dates";
import { parseTimeRange } from "./time-range";
import type { EntityKind, PlanEntity, PlanTimeRange, QueryPlan, SearchIntent, SearchResultType } from "./types";

// ─── Lexicon (known entities) ────────────────────────────────────────────────

export interface LexiconCompany {
  id: string;
  name: string;
  type: CompanyType;
  domain: string | null;
  parentId: string | null;
  aliases: string[];
}
export interface LexiconPerson {
  id: string;
  name: string;
  email: string | null;
  companyId: string | null;
  isCeo: boolean;
  aliases: string[];
}
export interface LexiconGoal {
  id: string;
  title: string;
  /** GoalType: COMPANY and ANNUAL goals win ties. */
  type: string;
}
export interface LexiconDeal {
  id: string;
  name: string;
  type: string;
  status: string;
  companyId: string | null;
}
export interface LexiconProject {
  id: string;
  name: string;
  aliases: string[];
}
export interface Lexicon {
  companies: LexiconCompany[];
  people: LexiconPerson[];
  goals: LexiconGoal[];
  deals: LexiconDeal[];
  projects: LexiconProject[];
}

export const EMPTY_LEXICON: Lexicon = { companies: [], people: [], goals: [], deals: [], projects: [] };

// ─── Text helpers ────────────────────────────────────────────────────────────

const FOLD: Record<string, string> = { ø: "o", æ: "ae", œ: "oe", ß: "ss", ł: "l", đ: "d", ð: "d", þ: "th" };

/** Lower-case, fold accents, drop punctuation (keeps "&", "@" and "." inside words so "J&J" and domains survive). */
export function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[øæœßłđðþ]/g, (c) => FOLD[c] ?? c)
    .replace(/[’`]/g, "'")
    .replace(/'s\b/g, "")
    .replace(/[^a-z0-9&@.\s-]/g, " ")
    .replace(/(^|\s)[&.@-]+|[&.@-]+(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface Token {
  norm: string;
  raw: string;
  start: number;
  end: number;
}

/** Word tokens with their character spans in the original query. */
function tokenize(query: string): Token[] {
  const tokens: Token[] = [];
  const re = /[\p{L}\p{N}][\p{L}\p{N}&'’@._-]*/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query))) {
    const raw = m[0].replace(/[.'’_-]+$/, "");
    const norm = normalize(raw).replace(/\s+/g, "");
    if (norm) tokens.push({ norm, raw, start: m.index, end: m.index + raw.length });
  }
  return tokens;
}

const LEGAL_SUFFIXES = new Set(["inc", "incorporated", "ltd", "limited", "llc", "plc", "corp", "corporation", "co", "company", "gmbh", "ag", "sa", "nv", "bv", "ab", "as", "srl", "spa", "lp", "llp"]);
const GENERIC_ORG_WORDS = new Set([
  "ventures",
  "venture",
  "capital",
  "partners",
  "partner",
  "therapeutics",
  "biosciences",
  "bioscience",
  "biologics",
  "pharma",
  "pharmaceutical",
  "pharmaceuticals",
  "fund",
  "funds",
  "bio",
  "health",
  "healthcare",
  "institute",
  "university",
  "hospital",
  "instruments",
  "cloud",
  "oncology",
  "life",
  "science",
  "sciences",
  "labs",
  "lab",
  "laboratories",
  "group",
  "holdings",
  "technologies",
  "technology",
  "systems",
  "medical",
  "biotech",
  "investments",
  "management",
  "the",
  "of",
]);
const HONORIFICS = new Set(["dr", "prof", "professor", "mr", "mrs", "ms", "mx", "sir", "dame"]);

/** Words that look like names but are too common to match on their own without a cue. */
const COMMON_WORDS = new Set([
  "will", "may", "mark", "grant", "hart", "rose", "page", "long", "young", "king", "price", "cash", "lee", "chase", "summer", "april", "june",
  "peak", "series", "data", "heart", "bright", "north", "south", "west", "east", "nordic", "general", "first", "global", "united", "pacific",
]);

/** Words that cue a name right after them ("promise Karen", "with Calder"). */
const CUE_BEFORE = new Set(["promise", "promised", "promises", "owe", "owes", "owed", "with", "to", "from", "about", "for", "told", "asked", "meet", "meeting", "call", "regarding", "re", "and", "on"]);

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "at", "by", "for", "with", "about", "from", "into", "over", "regarding", "re",
  "what", "whats", "which", "who", "whom", "whose", "when", "where", "why", "how", "is", "are", "was", "were", "be", "been", "being", "am",
  "do", "does", "did", "done", "have", "has", "had", "having", "i", "me", "my", "mine", "we", "us", "our", "ours", "you", "your", "they", "them", "their",
  "it", "its", "this", "that", "these", "those", "there", "here", "any", "all", "some", "every", "everything", "anything", "something",
  "show", "list", "find", "give", "tell", "get", "see", "let", "know", "please", "can", "could", "would", "should", "will", "shall", "just", "also",
  "related", "relating", "linked", "connected", "regarding", "happening", "going", "status", "update", "updates", "latest", "new", "news",
  "discussed", "discuss", "discussing", "discussion", "discussions", "talked", "talk", "spoke", "spoken", "conversation", "conversations",
  "commitment", "commitments", "committed", "commit", "promise", "promised", "promises", "owe", "owes", "owed", "made", "make", "making",
  "deadline", "deadlines", "due", "waiting", "wait", "waits", "open", "outstanding", "pending", "overdue",
  "investor", "investors", "customer", "customers", "client", "clients", "partner", "partners", "partnership", "partnerships", "prospect", "prospects",
  "vendor", "vendors", "competitor", "competitors", "vc", "vcs", "funds", "accounts",
  "email", "emails", "thread", "threads", "message", "messages", "meeting", "meetings", "call", "calls", "document", "documents", "doc", "docs",
  "file", "files", "deck", "decks", "decision", "decisions", "risk", "risks", "opportunity", "opportunities", "task", "tasks", "todo", "todos",
  "milestone", "milestones", "goal", "goals", "note", "notes", "insight", "insights", "deal", "deals", "pipeline", "people", "contacts", "records",
  "cytohub", "company", "companies", "team", "since", "last", "past", "next", "coming", "previous", "days", "day", "weeks", "week", "months", "month",
  "today", "tomorrow", "yesterday", "recent", "recently", "lately", "on", "lot", "much", "many", "more", "most", "currently", "now", "still",
]);

/** Grammar words only (no nouns): what is left are the words a keyword search should use. */
const FUNCTION_WORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "at", "by", "for", "with", "about", "from", "into", "over", "regarding", "re",
  "what", "whats", "which", "who", "whom", "whose", "when", "where", "why", "how", "is", "are", "was", "were", "be", "been", "am",
  "do", "does", "did", "have", "has", "had", "i", "me", "my", "we", "us", "our", "you", "your", "they", "them", "their", "it", "its",
  "this", "that", "these", "those", "there", "any", "all", "some", "every", "everything", "anything",
  "show", "list", "find", "give", "tell", "get", "see", "search", "display", "please", "can", "could", "would", "should", "me",
  "open", "recent", "latest", "new", "pending", "related", "linked",
]);

/** Content words of a query (for keyword fallbacks): everything but grammar words. */
export function contentWords(query: string): string[] {
  return tokenize(query)
    .map((t) => t.norm)
    .filter((w) => !FUNCTION_WORDS.has(w) && w.length >= 2);
}

// ─── Entity matching ─────────────────────────────────────────────────────────

interface Candidate {
  kind: EntityKind;
  id: string;
  label: string;
  tokens: string[];
  confidence: number;
  /** Matched only by a partial name (first name, core name) — needs a cue. */
  partial: boolean;
}

/** Same tokenization as queries, so names and queries compare token by token. */
function words(text: string): string[] {
  return tokenize(text).map((t) => t.norm);
}

function companyCandidates(c: LexiconCompany): Candidate[] {
  const out: Candidate[] = [];
  const add = (tokens: string[], confidence: number, partial = false) => {
    if (tokens.length && tokens.join(" ").length >= 2) out.push({ kind: "company", id: c.id, label: c.name, tokens, confidence, partial });
  };
  const full = words(c.name);
  add(full, 1);
  const noLegal = [...full];
  while (noLegal.length > 1 && LEGAL_SUFFIXES.has(noLegal.at(-1)!)) noLegal.pop();
  if (noLegal.length !== full.length) add(noLegal, 1);
  const core = [...noLegal];
  while (core.length > 1 && GENERIC_ORG_WORDS.has(core.at(-1)!)) core.pop();
  if (core.length !== noLegal.length && core.join("").length >= 4 && !STOPWORDS.has(core.join(" "))) add(core, 0.9, core.length === 1);
  if (core.length > 1 && core[0].length >= 5 && !GENERIC_ORG_WORDS.has(core[0]) && !STOPWORDS.has(core[0])) add([core[0]], 0.75, true);
  // Abbreviations: "Johnson & Johnson" → "j&j"; "Nordic Heart Institute" → "nhi".
  const significant = noLegal.filter((w) => w !== "of" && w !== "the");
  if (/\s&\s/.test(c.name) && significant.length >= 2) add([significant.map((w) => w[0]).join("&")], 0.9);
  if (significant.length >= 3) add([significant.map((w) => w[0]).join("")], 0.8, true);
  if (c.domain) {
    add([c.domain.toLowerCase()], 1);
    const label = c.domain.toLowerCase().split(".")[0];
    if (label.length >= 4 && label !== core.join("")) add([label], 0.85, true);
  }
  for (const a of c.aliases) add(words(a), 0.95);
  return out;
}

function personCandidates(p: LexiconPerson): Candidate[] {
  if (p.isCeo) return [];
  const out: Candidate[] = [];
  const add = (tokens: string[], confidence: number, partial = false) => {
    if (tokens.length && tokens.join("").length >= 2) out.push({ kind: "person", id: p.id, label: p.name, tokens, confidence, partial });
  };
  const all = words(p.name).filter((w) => !HONORIFICS.has(w));
  add(all, 1);
  if (all.length > 2) add([all[0], all.at(-1)!], 0.95);
  if (all.length >= 2) {
    add([all[0]], 0.7, true);
    add([all.at(-1)!], 0.6, true);
  }
  if (p.email) add([p.email.toLowerCase()], 1);
  for (const a of p.aliases) add(words(a), 0.9, words(a).length === 1);
  return out;
}

function projectCandidates(p: LexiconProject): Candidate[] {
  return [p.name, ...p.aliases].map((n) => ({ kind: "project" as const, id: p.id, label: p.name, tokens: words(n), confidence: 0.95, partial: false })).filter((c) => c.tokens.length);
}

interface Match extends Candidate {
  startIdx: number;
  endIdx: number;
}

function findMatches(tokens: Token[], candidates: Candidate[]): Match[] {
  const found: Match[] = [];
  const norms = tokens.map((t) => t.norm);
  for (const c of candidates) {
    const n = c.tokens.length;
    for (let i = 0; i + n <= norms.length; i++) {
      let ok = true;
      for (let j = 0; j < n; j++) {
        if (norms[i + j] !== c.tokens[j]) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      let confidence = c.confidence;
      if (c.partial && n === 1) {
        // A lone first name or core company name needs a signal: capitalized
        // mid-sentence, or right after a cue ("promise Karen", "with Calder").
        const tok = tokens[i];
        const capitalized = i > 0 && /^\p{Lu}/u.test(tok.raw);
        const cued = i > 0 && CUE_BEFORE.has(norms[i - 1]);
        const common = COMMON_WORDS.has(tok.norm) || STOPWORDS.has(tok.norm);
        if (common && !cued && !capitalized) continue;
        if (!capitalized && !cued && tok.norm.length < 4) continue;
        if (!capitalized && !cued) confidence *= 0.85;
      }
      found.push({ ...c, confidence, startIdx: i, endIdx: i + n - 1 });
    }
  }
  // Longest span first, then confidence; a token belongs to one span.
  found.sort((a, b) => b.endIdx - b.startIdx - (a.endIdx - a.startIdx) || b.confidence - a.confidence);
  const used = new Set<number>();
  const kept: Match[] = [];
  for (const m of found) {
    let overlaps = false;
    for (let i = m.startIdx; i <= m.endIdx; i++) if (used.has(i)) overlaps = true;
    // Several entities may share the exact same span (two people called Sarah): keep them all.
    const sameSpan = kept.some((k) => k.startIdx === m.startIdx && k.endIdx === m.endIdx);
    if (overlaps && !sameSpan) continue;
    if (kept.some((k) => k.kind === m.kind && k.id === m.id)) continue;
    kept.push(m);
    for (let i = m.startIdx; i <= m.endIdx; i++) used.add(i);
  }
  return kept;
}

/** Ids of a company plus its parent and subsidiaries (one level each way), from the lexicon. */
export function lexiconFamily(lexicon: Lexicon, companyId: string): string[] {
  const c = lexicon.companies.find((x) => x.id === companyId);
  if (!c) return [companyId];
  const root = c.parentId ?? c.id;
  const ids = new Set([companyId, root]);
  for (const x of lexicon.companies) {
    if (x.parentId === root || x.parentId === companyId) ids.add(x.id);
  }
  return [...ids];
}

// ─── Intent, direction, types ────────────────────────────────────────────────

const RE = {
  waiting: /\b(waiting|wait|waits) (on|for)\b/,
  commitments: /\b(commit(ment|ments|ted)?|promis(e|es|ed)|owe[sd]?|owed)\b/,
  deadlines: /\b(deadlines?|due dates?|what(?:'s| is| are)? due|coming due|due (this|next|today|tomorrow|by|on|before|in)|overdue)\b/,
  discussed: /\b(discuss(ed|ing)?|talk(ed|ing)? (about|with|to)|spoke(n)? (with|to)|conversations? with|emails? with|threads? with|correspondence with|been in touch with|heard from)\b/,
  conversationWords: /\b(conversations?|discussions?|emails?|e-mails?|threads?|messages?|correspondence|meetings?|calls?)\b/,
  related: /\b(everything|anything|all (the )?(records|items|info|information|context)?)\b.*\b(related|relating|about|on|with|regarding|for|linked|connected)\b|\b(tell me about|what do we know about|context on|full picture (on|of)|360)\b/,
  status: /\b(what(?:'s| is| are)? (happening|going on|new|the (status|latest|state))|status (of|on)|update on|progress (on|of)|where (are|do) we stand|how(?:'s| is| are) (the |our )?.+ going|latest on)\b/,
  listVerb: /^(show|list|find|get|give|any|open|all|my|recent|latest|which|what|search|pending|outstanding|overdue)\b/,
  open: /\b(open|outstanding|pending|unresolved|unfulfilled|overdue|active|still)\b/,
};

const INBOUND_RE =
  /\b(owe[sd]? (us|me|cytohub)|owed to (us|me|cytohub)|promise[sd]? (us|me|cytohub)|committed to (us|me|cytohub)|commitments? from|(waiting|wait) (on|for) (them|him|her|their|the (investor|customer|partner)s?)|they (promised|owe|committed)|(he|she) (promised|owes|committed)|inbound)\b/;
const OUTBOUND_RE =
  /\b((i|we) (have |had |already )?(promised|promise|committed|owe|made|agreed)|(have|did|do|has) (i|we) (made|promise[sd]?|commit(ted)?|owe|agreed)|i've (made|promised|committed)|we've (made|promised|committed)|(waiting|wait) (on|for) (cytohub|us|me|you)|owe them|commitments? (made )?to|outbound|our commitments|my commitments)\b/;

const COMPANY_TYPE_WORDS: [RegExp, CompanyType[], string][] = [
  [/\b(investors?|vcs?|backers?|funds)\b/, ["INVESTOR"], "Investors"],
  [/\b(customers?|clients?|accounts)\b/, ["CUSTOMER", "PROSPECT"], "Customers"],
  [/\b(prospects?)\b/, ["PROSPECT"], "Prospects"],
  [/\b(partners?|partnerships?)\b/, ["PARTNER", "ACADEMIC"], "Partners"],
  [/\b(vendors?|suppliers?)\b/, ["VENDOR"], "Vendors"],
  [/\b(competitors?)\b/, ["COMPETITOR"], "Competitors"],
];

const CATEGORY_FOR_TYPE: Partial<Record<CompanyType, CeoCategory[]>> = {
  INVESTOR: ["INVESTOR", "FUNDRAISING"],
  CUSTOMER: ["CUSTOMER", "COMMERCIAL_OPPORTUNITY"],
  PROSPECT: ["CUSTOMER", "COMMERCIAL_OPPORTUNITY"],
  PARTNER: ["STRATEGIC_PARTNER"],
  ACADEMIC: ["STRATEGIC_PARTNER"],
  VENDOR: ["MAJOR_VENDOR"],
};

const TYPE_WORDS: [RegExp, SearchResultType[]][] = [
  [/\b(emails?|e-mails?|threads?|messages?|correspondence|conversations?|discussions?)\b/, ["thread"]],
  [/\b(meetings?|calls?)\b/, ["meeting", "event", "notes", "note"]],
  [/\b(documents?|docs?|decks?|files?|contracts?|proposals?|reports?|memos?|presentations?|models?)\b/, ["document", "resource"]],
  [/\bdecisions?\b/, ["decision"]],
  [/\brisks?\b/, ["risk"]],
  [/\bopportunit(y|ies)\b/, ["opportunity"]],
  [/\b(tasks?|to-?dos?|action items?)\b/, ["task"]],
  [/\bmilestones?\b/, ["milestone"]],
  [/\b(goals?|okrs?|objectives?)\b/, ["goal"]],
  [/\bnotes\b/, ["notes", "note"]],
  [/\binsights?\b/, ["insight"]],
  [/\b(deals?|pipeline)\b/, ["deal"]],
  [/\b(people|contacts?)\b/, ["person"]],
  [/\bcompanies\b/, ["company"]],
];

/** "documents about pricing", "recent decisions on hiring": the request starts with a record type. */
function startsWithTypeWord(q: string): boolean {
  const lead = q.replace(/^((the|my|our|all|open|recent|latest|new|pending|any)\s+)+/, "");
  return TYPE_WORDS.some(([re]) => {
    const m = re.exec(lead);
    return m?.index === 0;
  });
}

const CONVERSATION_TYPES: SearchResultType[] = ["thread", "meeting", "notes", "note", "event"];
const DISCUSSED_TYPES: SearchResultType[] = ["thread", "meeting", "notes", "note", "event", "document"];
const DEADLINE_TYPES: SearchResultType[] = ["task", "commitment", "milestone", "decision"];
const STATUS_TYPES: SearchResultType[] = ["goal", "milestone", "deal", "thread", "insight", "commitment", "decision", "risk", "opportunity", "meeting", "document", "notes"];

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Planner ─────────────────────────────────────────────────────────────────

export interface PlanContext {
  /** CEO calendar day (00:00 UTC). */
  today: Date;
}

export function planQuery(rawQuery: string, lexicon: Lexicon, ctx: PlanContext): QueryPlan {
  const query = rawQuery.replace(/\s+/g, " ").trim().slice(0, 300);
  const q = normalize(query);
  const tokens = tokenize(query);
  const explanation: string[] = [];

  // Time range first so its words are not mistaken for entities ("next week").
  const parsedTime = parseTimeRange(query, ctx.today);
  let timeRange: PlanTimeRange | null = parsedTime ? { from: parsedTime.from, to: parsedTime.to, label: parsedTime.label } : null;
  const timeTokenIdx = new Set<number>();
  if (parsedTime?.phrase) {
    const phraseWords = new Set(words(parsedTime.phrase));
    tokens.forEach((t, i) => phraseWords.has(t.norm) && timeTokenIdx.add(i));
  }

  // Entities
  const candidates: Candidate[] = [
    ...lexicon.companies.flatMap(companyCandidates),
    ...lexicon.people.flatMap(personCandidates),
    ...lexicon.projects.flatMap(projectCandidates),
  ];
  const matches = findMatches(
    tokens.map((t, i) => (timeTokenIdx.has(i) ? { ...t, norm: `\u0000${t.norm}` } : t)),
    candidates,
  );
  const entities: PlanEntity[] = matches.map((m) => ({
    kind: m.kind,
    id: m.id,
    label: m.label,
    matched: query.slice(tokens[m.startIdx].start, tokens[m.endIdx].end),
    confidence: Math.round(m.confidence * 100) / 100,
    ...(m.kind === "company" ? { family: true } : {}),
  }));
  // Several people share a first name: keep them, but trust the match less.
  const byMatched = new Map<string, PlanEntity[]>();
  for (const e of entities) byMatched.set(`${e.kind}:${e.matched.toLowerCase()}`, [...(byMatched.get(`${e.kind}:${e.matched.toLowerCase()}`) ?? []), e]);
  for (const group of byMatched.values()) if (group.length > 1) for (const e of group) e.confidence = Math.round((e.confidence / 2) * 100) / 100;
  const consumed = new Set<number>(timeTokenIdx);
  for (const m of matches) for (let i = m.startIdx; i <= m.endIdx; i++) consumed.add(i);

  // Direction
  let direction: QueryPlan["direction"] = null;
  if (INBOUND_RE.test(q)) direction = "INBOUND";
  else if (OUTBOUND_RE.test(q)) direction = "OUTBOUND";

  // Company types and categories
  const companyTypes: CompanyType[] = [];
  const categories: CeoCategory[] = [];
  for (const [re, types, label] of COMPANY_TYPE_WORDS) {
    if (re.test(q)) {
      for (const t of types) if (!companyTypes.includes(t)) companyTypes.push(t);
      explanation.push(label);
    }
  }
  // "Investors" in "Partners" etc. — PROSPECT is implied by customers already.
  for (const t of companyTypes) for (const c of CATEGORY_FOR_TYPE[t] ?? []) if (!categories.includes(c)) categories.push(c);
  if (/\bboard\b/.test(q)) categories.push("BOARD");
  if (/\b(fundrais\w*|raise|series [a-e])\b/.test(q) && companyTypes.length === 0) {
    for (const c of ["FUNDRAISING", "INVESTOR"] as CeoCategory[]) if (!categories.includes(c)) categories.push(c);
  }

  // Record types mentioned
  const mentionedTypes: SearchResultType[] = [];
  for (const [re, types] of TYPE_WORDS) if (re.test(q)) for (const t of types) if (!mentionedTypes.includes(t)) mentionedTypes.push(t);

  const openOnly = RE.open.test(q);
  const hasEntity = entities.length > 0;
  const companies = entities.filter((e) => e.kind === "company");
  const people = entities.filter((e) => e.kind === "person");

  // Residual words (for full-text search and topic matching).
  const residualTokens = tokens.filter((t, i) => !consumed.has(i));
  const residual = residualTokens.map((t) => t.norm).filter((w) => !STOPWORDS.has(w) && !/^\d+$/.test(w));

  // Intent
  let intent: SearchIntent = "keyword";
  if (RE.waiting.test(q) && (direction || companyTypes.length || hasEntity)) intent = "waiting";
  else if (RE.commitments.test(q) || (direction && /\b(promis|owe|commit)/.test(q))) intent = "commitments";
  else if (RE.deadlines.test(q)) intent = "deadlines";
  else if (RE.related.test(q) && hasEntity) intent = "related";
  else if (RE.discussed.test(q) && hasEntity) intent = "discussed";
  else if (RE.status.test(q)) intent = "status";
  else if (RE.conversationWords.test(q) && (companyTypes.length || categories.length || timeRange || hasEntity) && !mentionedTypes.some((t) => !CONVERSATION_TYPES.includes(t))) {
    intent = hasEntity ? "discussed" : "conversations";
  } else if (mentionedTypes.length && (RE.listVerb.test(q) || residual.length === 0 || startsWithTypeWord(q))) intent = "list";
  else if (hasEntity && residual.length === 0) intent = "related";

  // Topic: goals / deals / projects named by the residual phrase ("the Series B").
  let topic: string | null = null;
  if (intent === "status" || intent === "related" || intent === "list" || intent === "keyword" || intent === "deadlines" || intent === "commitments") {
    const phrase = residualPhrase(residualTokens);
    if (phrase) {
      const topicEntities = matchTopic(phrase, lexicon);
      const questionLike = /^(what|which|who|how|where|show|tell|give|any)\b/.test(q);
      // A bare "term sheet" stays a keyword search; "what about the term sheet?" asks for status.
      if (topicEntities.length && (intent !== "keyword" || questionLike)) {
        topic = phrase;
        entities.push(...topicEntities);
        if (intent === "keyword") intent = "status";
      }
    }
  }

  // "investor deck", "board decks": record-type and audience words describe what to find → keyword search.
  if (intent === "list" && residual.length === 0 && !hasEntity && !timeRange && !openOnly && contentWords(query).length >= 2) intent = "keyword";

  let text = residual.join(" ");
  let recordTypes: SearchResultType[] = [];
  let sort: QueryPlan["sort"] = "relevance";
  let timeField: QueryPlan["timeField"] = parsedTime?.future ? "due" : "occurred";
  let confidence = 0.9;
  let effectiveOpenOnly = openOnly;

  switch (intent) {
    case "waiting":
      direction ??= "OUTBOUND";
      recordTypes = ["commitment", "thread"];
      sort = "open_first";
      effectiveOpenOnly = true;
      text = "";
      confidence = 0.9;
      explanation.unshift(direction === "OUTBOUND" ? "Waiting on CytoHub" : "Waiting on them");
      break;
    case "commitments":
      recordTypes = ["commitment"];
      sort = "open_first";
      text = "";
      timeField = parsedTime?.future ? "due" : "occurred";
      confidence = people.length || companies.length || companyTypes.length || direction ? 0.92 : 0.85;
      explanation.unshift("Commitments");
      if (direction) explanation.push(direction === "OUTBOUND" ? "Owed by CytoHub" : "Owed to CytoHub");
      break;
    case "deadlines":
      recordTypes = DEADLINE_TYPES;
      sort = "due";
      timeField = "due";
      effectiveOpenOnly = true;
      text = "";
      if (/\boverdue\b/.test(q) && !parsedTime) timeRange = { from: null, to: dayKey(addDays(ctx.today, -1)), label: "Overdue" };
      timeRange ??= { from: null, to: dayKey(addDays(ctx.today, 14)), label: "Overdue and next 14 days" };
      explanation.unshift("Deadlines");
      break;
    case "discussed":
      recordTypes = DISCUSSED_TYPES;
      sort = "newest";
      timeField = "occurred";
      text = residual.length ? text : "";
      explanation.unshift("Conversations");
      break;
    case "conversations":
      recordTypes = CONVERSATION_TYPES;
      sort = "newest";
      timeField = "occurred";
      text = "";
      explanation.unshift("Conversations");
      break;
    case "related":
      recordTypes = [];
      sort = "newest";
      text = "";
      explanation.unshift("Everything related");
      break;
    case "status":
      recordTypes = STATUS_TYPES;
      sort = "newest";
      text = topic ?? text;
      if (!topic && !hasEntity) confidence = 0.45;
      explanation.unshift("Status");
      break;
    case "list":
      recordTypes = mentionedTypes;
      sort = timeRange && parsedTime?.future ? "due" : text ? "relevance" : "newest";
      if (mentionedTypes.every((t) => DEADLINE_TYPES.includes(t)) && parsedTime?.future) timeField = "due";
      confidence = 0.85;
      break;
    case "keyword": {
      const questionLike = /^(what|which|who|whom|how|why|when|where|show|tell|give|list|find|did|do|does|is|are|can|should)\b/.test(q) && tokens.length >= 4;
      confidence = questionLike ? 0.4 : hasEntity || tokens.length <= 3 ? 0.9 : 0.6;
      text = residual.length ? text : contentWords(query).join(" ") || q;
      // Audience words ("investor deck") are part of the keywords here, not filters.
      companyTypes.length = 0;
      categories.length = 0;
      for (const label of ["Investors", "Customers", "Prospects", "Partners", "Vendors", "Competitors"]) {
        const i = explanation.indexOf(label);
        if (i >= 0) explanation.splice(i, 1);
      }
      break;
    }
  }

  if (intent === "discussed" || intent === "related") {
    if (!hasEntity) confidence = 0.4;
  }
  // "Overdue commitments" / "overdue tasks": due before today, still open.
  if (/\boverdue\b/.test(q) && !parsedTime && intent !== "deadlines" && (intent === "commitments" || intent === "list" || intent === "waiting")) {
    timeRange = { from: null, to: dayKey(addDays(ctx.today, -1)), label: "Overdue" };
    timeField = "due";
    effectiveOpenOnly = true;
  }
  const entityConfidence = entities.length ? Math.min(...entities.filter((e) => e.kind === "company" || e.kind === "person").map((e) => e.confidence), 1) : 1;
  confidence = Math.round(Math.min(confidence, 0.4 + entityConfidence * 0.6) * 100) / 100;

  for (const e of entities) {
    const fam = e.kind === "company" ? lexiconFamily(lexicon, e.id).length - 1 : 0;
    explanation.push(`${e.label}${fam > 0 ? ` (+${fam} related)` : ""}`);
  }
  if (timeRange) explanation.push(timeRange.label);
  if (effectiveOpenOnly && intent !== "waiting" && intent !== "deadlines") explanation.push("Open only");

  return {
    query,
    intent,
    text: text.trim(),
    terms: highlightTerms(text, entities),
    entities,
    topic,
    recordTypes,
    direction,
    companyTypes,
    categories,
    timeRange,
    timeField,
    openOnly: effectiveOpenOnly,
    sort,
    confidence,
    engine: "rules",
    explanation: [...new Set(explanation)],
  };
}

/** A plan built in code (Chief of Staff tools) rather than parsed from a question. */
export function explicitPlan(query: string, patch: Partial<QueryPlan>): QueryPlan {
  return {
    query,
    intent: "keyword",
    text: "",
    terms: [],
    entities: [],
    topic: null,
    recordTypes: [],
    direction: null,
    companyTypes: [],
    categories: [],
    timeRange: null,
    timeField: "occurred",
    openOnly: false,
    sort: "relevance",
    confidence: 1,
    engine: "rules",
    explanation: [],
    ...patch,
  };
}

/** The residual tokens as a phrase, trimmed of leading/trailing stopwords ("the series b" → "series b"). */
function residualPhrase(tokens: Token[]): string | null {
  const ws = tokens.map((t) => t.norm);
  let s = 0;
  let e = ws.length - 1;
  const edgeStop = (w: string) => STOPWORDS.has(w) && !/^[a-z]$/.test(w);
  while (s <= e && edgeStop(ws[s])) s++;
  while (e >= s && edgeStop(ws[e])) e--;
  // Single letters only survive inside phrases ("series b").
  const phrase = ws.slice(s, e + 1).filter((w, i, arr) => !(arr.length === 1 && w.length < 3));
  return phrase.length ? phrase.join(" ") : null;
}

const GOAL_TYPE_RANK: Record<string, number> = { COMPANY: 0, ANNUAL: 1, QUARTERLY: 2, CEO: 3, DEPARTMENT: 4 };

/** Goals, deals and projects whose name contains the phrase (all its words, in order). */
export function matchTopic(phrase: string, lexicon: Lexicon): PlanEntity[] {
  const p = words(phrase).filter((w) => !(STOPWORDS.has(w) && w.length > 1) || /^[a-z]$/.test(w));
  if (!p.length || p.join("").length < 3) return [];
  const contains = (title: string) => {
    const t = words(title);
    for (let i = 0; i + p.length <= t.length; i++) if (p.every((w, j) => t[i + j] === w)) return true;
    return false;
  };
  const goals = lexicon.goals
    .filter((g) => contains(g.title))
    .sort((a, b) => (GOAL_TYPE_RANK[a.type] ?? 9) - (GOAL_TYPE_RANK[b.type] ?? 9))
    .slice(0, 3)
    .map<PlanEntity>((g) => ({ kind: "goal", id: g.id, label: g.title, matched: phrase, confidence: 0.85 }));
  const deals = lexicon.deals
    .filter((d) => contains(d.name))
    .sort((a, b) => Number(b.status === "OPEN") - Number(a.status === "OPEN"))
    .slice(0, 10)
    .map<PlanEntity>((d) => ({ kind: "deal", id: d.id, label: d.name, matched: phrase, confidence: 0.8 }));
  const projects = lexicon.projects
    .filter((x) => contains(x.name) || x.aliases.some(contains))
    .slice(0, 3)
    .map<PlanEntity>((x) => ({ kind: "project", id: x.id, label: x.name, matched: phrase, confidence: 0.85 }));
  return [...goals, ...projects, ...deals];
}

/** Words worth highlighting in snippets: the residual terms plus matched entity words. */
function highlightTerms(text: string, entities: PlanEntity[]): string[] {
  const out = new Set<string>();
  for (const w of text.split(/\s+/)) if (w.length >= 3) out.add(w);
  for (const e of entities) if (e.kind === "company" || e.kind === "person" || e.kind === "project") for (const w of e.matched.split(/\s+/)) if (w.length >= 3) out.add(w);
  return [...out].slice(0, 12);
}

/** Label for an entity kind, for UI chips. */
export function entityKindLabel(kind: EntityKind): string {
  return titleCase(kind);
}
