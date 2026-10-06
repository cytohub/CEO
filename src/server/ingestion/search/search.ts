/**
 * Universal search: plan → fetch (permission-filtered) → group → answer.
 *
 *   searchBrain(viewer, "What commitments have I made to investors?")
 *     → plan (rules; Claude when unsure)  → { intent: commitments, direction: OUTBOUND, companyTypes: [INVESTOR] }
 *     → fetchers for the plan's record types, each built on the viewer's access scope
 *     → groups ordered for the intent, rules answer (Claude synthesis when enabled)
 *
 * Source content (threads, documents, events, notes) is always filtered by
 * the access scope. Structured records need workspace.view; insights need
 * brain.view. Derived records whose provenance is unreadable are dropped.
 */
import { db } from "@/lib/db";
import { claudeEnabled } from "@/server/ai/claude";
import { loadCeoContext } from "@/server/context";
import { type AccessScope, documentWhere, emailThreadWhere, getAccessScope } from "@/server/security/access";
import { accessNote, rulesAnswer } from "./answer";
import { planWithClaude } from "./claude-planner";
import { type Exec, buildExec, hasHiddenMatches } from "./exec";
import { fetchDocuments, fetchEvents, fetchNotesSources, fetchThreads, orphanSourceResults } from "./fetch-source";
import {
  fetchCommitments,
  fetchCompanies,
  fetchDeals,
  fetchDecisions,
  fetchGoals,
  fetchInsights,
  fetchMeetings,
  fetchMilestones,
  fetchNotes,
  fetchOpportunities,
  fetchPeople,
  fetchProjects,
  fetchResources,
  fetchRisks,
  fetchTasks,
} from "./fetch-structured";
import { loadLexicon } from "./lexicon";
import { type Lexicon, contentWords, planQuery } from "./planner";
import { synthesizeAnswer } from "./synthesize";
import { presetRange } from "./time-range";
import {
  type QueryPlan,
  RESULT_LABELS,
  RESULT_TYPES,
  type SearchGroup,
  type SearchOptions,
  type SearchResponse,
  type SearchResult,
  type SearchResultType,
  type SearchViewer,
  STRUCTURED_RESULT_TYPES,
  type StatusContext,
  isSourceType,
} from "./types";

const FETCHERS: Record<SearchResultType, (x: Exec) => Promise<SearchResult[]>> = {
  thread: fetchThreads,
  document: fetchDocuments,
  event: fetchEvents,
  notes: fetchNotesSources,
  source: async (x) => orphanSourceResults(x),
  commitment: fetchCommitments,
  task: fetchTasks,
  meeting: fetchMeetings,
  decision: fetchDecisions,
  milestone: fetchMilestones,
  goal: fetchGoals,
  deal: fetchDeals,
  risk: fetchRisks,
  opportunity: fetchOpportunities,
  company: fetchCompanies,
  person: fetchPeople,
  project: fetchProjects,
  resource: fetchResources,
  note: fetchNotes,
  insight: fetchInsights,
};

/** Group order per intent (types not listed follow in RESULT_TYPES order). */
const ORDER: Partial<Record<QueryPlan["intent"], SearchResultType[]>> = {
  discussed: ["thread", "meeting", "notes", "note", "event", "document"],
  related: ["company", "person", "deal", "thread", "meeting", "notes", "note", "event", "document", "commitment", "task", "decision", "risk", "opportunity", "insight", "milestone", "goal", "resource", "project"],
  commitments: ["commitment"],
  status: ["goal", "milestone", "deal", "insight", "thread", "commitment", "decision", "risk", "opportunity", "meeting", "notes", "document"],
  deadlines: ["task", "commitment", "milestone", "decision"],
  waiting: ["commitment", "thread"],
  conversations: ["thread", "meeting", "notes", "note", "event"],
};

function canSee(viewer: SearchViewer, t: SearchResultType): boolean {
  if (isSourceType(t)) return true;
  if (t === "insight") return viewer.capabilities.includes("brain.view");
  return viewer.capabilities.includes("workspace.view");
}

/** Apply UI overrides (type filter, time preset) to a plan. */
export function applyOverrides(plan: QueryPlan, opts: Pick<SearchOptions, "types" | "when">, today: Date): QueryPlan {
  let p = plan;
  if (opts.when) {
    const r = presetRange(opts.when, today);
    p = { ...p, timeRange: { from: r.from, to: r.to, label: r.label }, timeField: r.future && (p.intent === "deadlines" || p.intent === "commitments") ? "due" : r.future ? p.timeField : "occurred" };
  }
  return p;
}

const BY_RANK = new Set<SearchResultType>(["goal", "deal", "company", "person", "project"]);

function sortResults(plan: QueryPlan, type: SearchResultType, results: SearchResult[]): SearchResult[] {
  const ts = (r: SearchResult) => r.timestamp ?? "";
  const due = (r: SearchResult) => (r.meta?.due as string | null | undefined) ?? "9999";
  const copy = [...results];
  // Entities and goals read best by relevance; milestones by due date — whatever the plan's sort.
  if (BY_RANK.has(type)) return copy.sort((a, b) => b.rank - a.rank);
  if (type === "milestone" && plan.sort !== "relevance") return copy.sort((a, b) => due(a).localeCompare(due(b)));
  switch (plan.sort) {
    case "newest":
      return copy.sort((a, b) => ts(b).localeCompare(ts(a)));
    case "due":
      return copy.sort((a, b) => due(a).localeCompare(due(b)) || b.rank - a.rank);
    case "open_first":
      return copy.sort((a, b) => b.rank - a.rank || due(a).localeCompare(due(b)));
    default:
      return copy.sort((a, b) => b.rank - a.rank || ts(b).localeCompare(ts(a)));
  }
}

export function groupResults(plan: QueryPlan, byType: Map<SearchResultType, SearchResult[]>, limit: number): SearchGroup[] {
  const groups: SearchGroup[] = [];
  for (const [type, results] of byType) {
    if (!results.length) continue;
    const sorted = sortResults(plan, type, results);
    groups.push({ type, label: RESULT_LABELS[type].plural, results: sorted.slice(0, limit), truncated: sorted.length > limit });
  }
  const order = ORDER[plan.intent];
  if (order) {
    const pos = (t: SearchResultType) => (order.includes(t) ? order.indexOf(t) : order.length + RESULT_TYPES.indexOf(t));
    groups.sort((a, b) => pos(a.type) - pos(b.type));
  } else {
    // Keyword / list: the group with the best match first.
    groups.sort((a, b) => Math.max(...b.results.map((r) => r.rank)) - Math.max(...a.results.map((r) => r.rank)));
  }
  return groups;
}

function typesToFetch(plan: QueryPlan, viewer: SearchViewer, filter?: SearchResultType[]): SearchResultType[] {
  let types: SearchResultType[] = plan.recordTypes.length ? [...plan.recordTypes] : [...RESULT_TYPES];
  // Status of a fundraising goal: show the pipeline and decisions too.
  if (plan.intent === "status" && !types.includes("deal")) types.push("deal");
  if (filter?.length) types = types.filter((t) => filter.includes(t));
  return types.filter((t) => canSee(viewer, t));
}

async function statusContext(plan: QueryPlan, groups: SearchGroup[]): Promise<StatusContext | undefined> {
  if (plan.intent !== "status") return undefined;
  const goals = (groups.find((g) => g.type === "goal")?.results ?? [])
    .filter((g) => plan.entities.some((e) => e.kind === "goal" && e.id === g.id))
    .map((g) => ({
      id: g.id,
      title: g.title,
      progress: Number(g.meta?.progress ?? 0),
      status: String(g.meta?.status ?? ""),
      confidence: Number(g.meta?.confidence ?? 0),
      targetDate: (g.meta?.targetDate as string | null) ?? null,
    }));
  const deals = (groups.find((g) => g.type === "deal")?.results ?? []).filter((d) => d.meta?.status === "OPEN");
  const stages = new Map<string, number>();
  for (const d of deals) stages.set(String(d.meta?.stage), (stages.get(String(d.meta?.stage)) ?? 0) + 1);
  return {
    goals,
    pipeline: deals.length ? { open: deals.length, totalValue: deals.reduce((n, d) => n + Number(d.meta?.value ?? 0), 0), stages: [...stages].map(([stage, count]) => ({ stage, count })) } : null,
  };
}

/** Cheap check: did access filtering hide matching source content? Never reveals what. */
async function computeHidden(scope: AccessScope, plan: QueryPlan, x: Exec): Promise<boolean> {
  if (scope.all) return false;
  if (plan.text && (await hasHiddenMatches(scope, plan.text))) return true;
  if (x.companyIds.length) {
    const [t, d] = await Promise.all([
      db.emailThread.count({ where: { AND: [{ companyId: { in: x.companyIds } }, { NOT: emailThreadWhere(scope) }] } }),
      db.document.count({ where: { AND: [{ companyId: { in: x.companyIds } }, { NOT: documentWhere(scope) }] } }),
    ]);
    return t + d > 0;
  }
  if (plan.categories.length) {
    const t = await db.emailThread.count({ where: { AND: [{ category: { in: plan.categories } }, { NOT: emailThreadWhere(scope) }] } });
    return t > 0;
  }
  return false;
}

/** Run every fetcher for the plan; a failing fetcher is logged and skipped, never fatal. */
async function execute(x: Exec, types: SearchResultType[]): Promise<Map<SearchResultType, SearchResult[]>> {
  const settled = await Promise.allSettled(types.map(async (t) => [t, await FETCHERS[t](x)] as const));
  const byType = new Map<SearchResultType, SearchResult[]>();
  for (const s of settled) {
    if (s.status === "fulfilled") byType.set(s.value[0], s.value[1]);
    else console.error("[search] fetcher failed", s.reason instanceof Error ? s.reason.message : s.reason);
  }
  // A calendar event that is also a workspace meeting shows once (as the meeting).
  const meetings = new Set((byType.get("meeting") ?? []).map((m) => m.id));
  const events = byType.get("event");
  if (events && meetings.size) byType.set("event", events.filter((e) => !(e.meta?.meetingId && meetings.has(String(e.meta.meetingId)))));
  return byType;
}

/**
 * Viewers without workspace access must not learn the names of goals, deals
 * or canonical records through the interpretation chips or the answer: show
 * the words they typed instead.
 */
export function sanitizePlan(plan: QueryPlan): QueryPlan {
  const structuredLabels = new Set(plan.entities.map((e) => e.label));
  const entities = plan.entities.filter((e) => e.kind === "company" || e.kind === "person").map((e) => ({ ...e, label: e.matched }));
  const explanation = plan.explanation.filter((c) => ![...structuredLabels].some((l) => c === l || c.startsWith(`${l} (+`)));
  for (const e of entities) if (!explanation.includes(e.matched)) explanation.push(e.matched);
  if (plan.topic && !explanation.includes(plan.topic)) explanation.push(plan.topic);
  return { ...plan, entities, explanation };
}

export interface SearchDeps {
  lexicon?: Lexicon;
  scope?: AccessScope;
}

export async function searchBrain(viewer: SearchViewer, query: string, opts: SearchOptions = {}, deps: SearchDeps = {}): Promise<SearchResponse> {
  const started = Date.now();
  const now = opts.now ?? new Date();
  const ceo = await loadCeoContext(db, now);
  const [scope, lexicon] = await Promise.all([deps.scope ?? getAccessScope(viewer), deps.lexicon ?? loadLexicon()]);

  let plan = planQuery(query, lexicon, { today: ceo.today });
  if (plan.confidence < 0.6 && opts.claudePlanner && claudeEnabled()) plan = (await planWithClaude(query, lexicon, ceo.today, plan)) ?? plan;
  plan = applyOverrides(plan, opts, ceo.today);

  const limit = Math.min(Math.max(opts.limitPerType ?? 8, 1), 25);
  const structuredExcluded = !viewer.capabilities.includes("workspace.view");
  const run = async (p: QueryPlan) => {
    const x = await buildExec({ plan: p, scope, viewer, now, today: ceo.today, timezone: ceo.timezone, ceoPersonId: ceo.personId, limit });
    const byType = await execute(x, typesToFetch(p, viewer, opts.types));
    return { x, groups: groupResults(p, byType, limit) };
  };

  let { x, groups } = await run(plan);
  // A focused interpretation found nothing ("Brightwater proposal" read as documents): try a keyword search.
  if (!groups.length && (plan.intent === "list" || plan.intent === "related")) {
    const words = contentWords(plan.query).join(" ");
    if (words && words !== plan.text) {
      const keyword: QueryPlan = { ...plan, intent: "keyword", entities: [], recordTypes: [], text: words, terms: words.split(/\s+/).filter((w) => w.length >= 3), sort: "relevance", explanation: ["Keyword match"] };
      const second = await run(keyword);
      if (second.groups.length) ({ x, groups, plan } = { ...second, plan: keyword });
    }
  }
  if (structuredExcluded) plan = sanitizePlan(plan);

  const [context, hiddenByAccess] = await Promise.all([statusContext(plan, groups), computeHidden(scope, plan, x).catch(() => false)]);
  const answerInput = { plan, groups, today: ceo.today, now, context, structuredExcluded, hiddenByAccess };
  let answer = rulesAnswer(answerInput);
  if (opts.synthesize) answer = await synthesizeAnswer(plan, groups, answer);

  return {
    plan,
    answer,
    groups,
    total: groups.reduce((n, g) => n + g.results.length, 0),
    hiddenByAccess,
    structuredExcluded,
    accessNote: accessNote(answerInput),
    context,
    durationMs: Date.now() - started,
  };
}

/** Flat list for type-ahead (command bar): best results first, a few per type. */
export function flattenForCommandBar(res: SearchResponse, max = 12): SearchResult[] {
  const out: SearchResult[] = [];
  const perType = res.groups.length > 4 ? 2 : 4;
  for (const g of res.groups) out.push(...g.results.slice(0, perType));
  return out.slice(0, max);
}

export { STRUCTURED_RESULT_TYPES };
