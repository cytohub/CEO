/**
 * Rules-engine answers: one to three sentences with counts and the top items,
 * built only from the (already permission-filtered) result groups. Pure, so
 * every template is unit-tested; Claude synthesis (synthesize.ts) replaces the
 * text when configured, and falls back to these.
 */
import type { CompanyType } from "@/generated/prisma/enums";
import { dayFromKey, daysBetween, formatDay, timeAgo } from "@/lib/dates";
import { formatCurrency } from "@/lib/format";
import { snippetText } from "./snippets";
import { type Citation, type QueryPlan, RESULT_LABELS, type SearchAnswer, type SearchGroup, type SearchResult, type SearchResultType, type StatusContext } from "./types";

export interface AnswerInput {
  plan: QueryPlan;
  groups: SearchGroup[];
  today: Date;
  now: Date;
  context?: StatusContext;
  structuredExcluded?: boolean;
  hiddenByAccess?: boolean;
}

// ─── Phrasing helpers ────────────────────────────────────────────────────────

export function listJoin(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

const TYPE_NOUN: Partial<Record<CompanyType, string>> = { INVESTOR: "investors", CUSTOMER: "customers", PROSPECT: "customers", PARTNER: "partners", ACADEMIC: "partners", VENDOR: "vendors", COMPETITOR: "competitors" };

/** "investors", "customers and partners" */
export function companyTypeNoun(types: CompanyType[]): string | null {
  const nouns = [...new Set(types.map((t) => TYPE_NOUN[t]).filter((x): x is string => Boolean(x)))];
  return nouns.length ? listJoin(nouns) : null;
}

function dueLabel(due: string | null | undefined, today: Date): string | null {
  if (!due) return null;
  const d = dayFromKey(due);
  const diff = daysBetween(today, d);
  if (diff < 0) return `${-diff}d overdue`;
  if (diff === 0) return "due today";
  if (diff === 1) return "due tomorrow";
  return `due ${formatDay(d)}`;
}

function quote(title: string, max = 70): string {
  const t = title.length > max ? `${title.slice(0, max - 1).trimEnd()}…` : title;
  return `“${t}”`;
}

function group(groups: SearchGroup[], type: SearchResultType): SearchResult[] {
  return groups.find((g) => g.type === type)?.results ?? [];
}

function cite(r: SearchResult): Citation {
  return { type: r.type, id: r.id, label: r.title, href: r.href };
}

function countsPhrase(groups: SearchGroup[], order?: SearchResultType[], max = 6): string {
  const sorted = (order ? [...groups].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type)) : groups).filter((g) => g.results.length);
  const parts = sorted.map((g) => count(g.results.length, RESULT_LABELS[g.type].label.toLowerCase(), RESULT_LABELS[g.type].plural.toLowerCase()));
  return parts.length > max ? `${parts.slice(0, max).join(", ")} and more` : listJoin(parts);
}

/** Most recent result that already happened (upcoming meetings and future dates don't count). */
function newest(groups: SearchGroup[], now: Date): SearchResult | null {
  const cutoff = now.toISOString();
  let best: SearchResult | null = null;
  for (const g of groups) for (const r of g.results) if (r.timestamp && r.timestamp <= cutoff && (!best || r.timestamp > best.timestamp!)) best = r;
  return best;
}

function targetPhrase(plan: QueryPlan): string | null {
  const names = plan.entities.filter((e) => e.kind === "person" || e.kind === "company").map((e) => e.label);
  if (names.length) return listJoin(names);
  return companyTypeNoun(plan.companyTypes);
}

/**
 * The note appended when the viewer's role hid records or sources. Deliberate
 * product decision: say that something was withheld (never what), so a short
 * answer is not mistaken for a complete one.
 */
export function accessNote(input: AnswerInput): string {
  const notes: string[] = [];
  const wantsStructured = !input.plan.recordTypes.length || input.plan.recordTypes.some((t) => !["thread", "document", "event", "notes", "source"].includes(t));
  if (input.structuredExcluded && wantsStructured) notes.push("Workspace records such as commitments, tasks and meetings aren’t available at your access level.");
  if (input.hiddenByAccess) notes.push("Some matching sources aren’t available at your access level.");
  return notes.join(" ");
}

function finish(text: string, citations: SearchResult[]): SearchAnswer {
  return { text, engine: "rules", citations: dedupe(citations).slice(0, 8).map(cite) };
}

function dedupe(rs: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return rs.filter((r) => (seen.has(`${r.type}:${r.id}`) ? false : (seen.add(`${r.type}:${r.id}`), true)));
}

// ─── Templates ───────────────────────────────────────────────────────────────

function commitmentItem(r: SearchResult, today: Date, withParty = true): string {
  const party = withParty ? ((r.meta?.party as string | null) ?? r.companyName ?? null) : null;
  const due = r.meta?.status === "FULFILLED" ? "fulfilled" : (dueLabel(r.meta?.due as string | null, today) ?? (r.meta?.dueText ? `“${r.meta.dueText}”` : null));
  const extra = [party, due].filter(Boolean).join(", ");
  return `${quote(r.title, 60)}${extra ? ` (${extra})` : ""}`;
}

function commitmentsAnswer(input: AnswerInput): SearchAnswer {
  const { plan, today } = input;
  const all = group(input.groups, "commitment");
  const open = all.filter((r) => r.meta?.status === "OPEN");
  const fulfilled = all.filter((r) => r.meta?.status === "FULFILLED");
  const overdue = open.filter((r) => r.meta?.overdue);
  const target = targetPhrase(plan);
  const single = plan.entities.some((e) => e.kind === "person") && plan.entities.length === 1;
  const items = open.slice(0, 3).map((r) => commitmentItem(r, today, !single));
  let lead: string;
  if (plan.direction === "INBOUND") {
    lead = open.length
      ? `${target ? `${target[0].toUpperCase()}${target.slice(1)} ${single ? "owes" : "owe"} you` : "You are owed"} ${count(open.length, "open commitment")}: ${listJoin(items)}.`
      : `Nothing is currently owed to you${target ? ` by ${target}` : ""}.`;
  } else if (plan.direction === "OUTBOUND") {
    lead = open.length
      ? `You have ${count(open.length, "open commitment")}${target ? ` to ${target}` : ""}: ${listJoin(items)}.`
      : `You have no open commitments${target ? ` to ${target}` : ""}.`;
  } else {
    lead = open.length ? `There ${open.length === 1 ? "is" : "are"} ${count(open.length, "open commitment")}${target ? ` involving ${target}` : ""}: ${listJoin(items)}.` : `There are no open commitments${target ? ` involving ${target}` : ""}.`;
  }
  if (input.plan.timeRange && open.length) lead = lead.replace(/:/, ` (${input.plan.timeRange.label.toLowerCase()}):`);
  const tail = [overdue.length && open.length > 1 ? `${overdue.length} ${overdue.length === 1 ? "is" : "are"} overdue.` : null, !plan.openOnly && fulfilled.length ? `${count(fulfilled.length, "commitment")} already fulfilled.` : null]
    .filter(Boolean)
    .join(" ");
  return finish([lead, tail].filter(Boolean).join(" "), [...open.slice(0, 3), ...fulfilled.slice(0, 1)]);
}

function waitingAnswer(input: AnswerInput): SearchAnswer {
  const { plan, today } = input;
  const commitments = group(input.groups, "commitment");
  const threads = group(input.groups, "thread");
  const byCompany = new Map<string, string[]>();
  const add = (name: string, what: string) => byCompany.set(name, [...(byCompany.get(name) ?? []), what]);
  for (const c of commitments) add(c.companyName ?? ((c.meta?.party as string | null) ?? "Unattributed"), `${quote(c.title, 50)}${c.meta?.due ? `, ${dueLabel(c.meta.due as string, today)}` : ""}`);
  for (const t of threads) add(t.companyName ?? "Unattributed", `${quote(t.title, 50)} ${plan.direction === "INBOUND" ? "awaiting their reply" : "awaiting your reply"}`);
  const noun = companyTypeNoun(plan.companyTypes) ?? "people";
  const names = [...byCompany.keys()];
  if (!names.length) {
    return finish(plan.direction === "INBOUND" ? `You are not waiting on any ${noun} right now.` : `No ${noun} are waiting on CytoHub right now.`, []);
  }
  const parts = names.slice(0, 3).map((n) => `${n} (${byCompany.get(n)!.slice(0, 2).join("; ")})`);
  const lead =
    plan.direction === "INBOUND"
      ? `You are waiting on ${count(names.length, noun.replace(/s$/, ""), noun)}: ${listJoin(parts)}.`
      : `${count(names.length, noun.replace(/s$/, ""), noun).replace(/^./, (c) => c.toUpperCase())} ${names.length === 1 ? "is" : "are"} waiting on CytoHub: ${listJoin(parts)}.`;
  const overdue = commitments.length > 1 ? commitments.filter((c) => c.meta?.overdue).length : 0;
  return finish([lead, overdue ? `${overdue} of these commitments ${overdue === 1 ? "is" : "are"} overdue.` : null].filter(Boolean).join(" "), [...commitments.slice(0, 3), ...threads.slice(0, 3)]);
}

function deadlinesAnswer(input: AnswerInput): SearchAnswer {
  const { plan, today } = input;
  const items = input.groups
    .filter((g) => ["task", "commitment", "milestone", "decision"].includes(g.type))
    .flatMap((g) => g.results)
    .filter((r) => r.meta?.due)
    .sort((a, b) => String(a.meta!.due).localeCompare(String(b.meta!.due)));
  const when = plan.timeRange?.label ? plan.timeRange.label.replace(/^(\w)/, (c) => c.toLowerCase()) : "coming up";
  if (!items.length) return finish(`You have no deadlines ${when}.`, []);
  const overdue = items.filter((r) => String(r.meta!.due) < today.toISOString().slice(0, 10));
  const top = items.slice(0, 3).map((r) => `${quote(r.title, 55)} (${RESULT_LABELS[r.type].label.toLowerCase()}, ${dueLabel(r.meta!.due as string, today)})`);
  const lead = `You have ${count(items.length, "deadline")} ${when}: ${listJoin(top)}${items.length > 3 ? `, plus ${items.length - 3} more` : ""}.`;
  return finish([lead, overdue.length && plan.timeRange?.label !== "Overdue" ? `${overdue.length} ${overdue.length === 1 ? "is" : "are"} already overdue.` : null].filter(Boolean).join(" "), items.slice(0, 5));
}

function conversationAnswer(input: AnswerInput, entityLabel: string | null): SearchAnswer {
  const { plan, now } = input;
  const groups = input.groups.filter((g) => g.results.length);
  const total = groups.reduce((n, g) => n + g.results.length, 0);
  const latest = newest(groups, now);
  const order: SearchResultType[] = ["thread", "meeting", "notes", "note", "event", "document"];
  const noun = companyTypeNoun(plan.companyTypes);
  const when = plan.timeRange ? ` ${plan.timeRange.label.replace(/^(\w)/, (c) => c.toLowerCase())}` : "";
  if (!total) {
    return finish(entityLabel ? `No conversations with ${entityLabel} found${when}.` : `No ${noun ? `${noun.replace(/s$/, "")} ` : ""}conversations found${when}.`, []);
  }
  const lead = entityLabel
    ? `Here’s what you’ve discussed with ${entityLabel}${when}: ${countsPhrase(groups, order)}.`
    : `${count(total, `${noun ? `${noun.replace(/s$/, "")} ` : ""}conversation`)}${when}: ${countsPhrase(groups, order)}.`;
  const summary = latest ? ((latest.meta?.summary as string | null) ?? snippetText(latest.snippet)) : "";
  const recent = latest ? `Most recent: ${quote(latest.title)} (${latest.timestamp ? timeAgo(new Date(latest.timestamp), now) : ""})${summary ? ` — ${summary.slice(0, 220)}${summary.length > 220 ? "…" : ""}` : "."}` : "";
  const cites = groups.flatMap((g) => g.results.slice(0, 2));
  return finish([lead, recent].filter(Boolean).join(" "), latest ? [latest, ...cites] : cites);
}

function statusAnswer(input: AnswerInput): SearchAnswer {
  const { plan, now } = input;
  const ctx = input.context;
  const sentences: string[] = [];
  const cites: SearchResult[] = [];
  const goal = ctx?.goals[0];
  if (goal) {
    sentences.push(`${quote(goal.title)} is ${goal.progress}% complete (${goal.status.replace(/_/g, " ").toLowerCase()}, ${goal.confidence}% confidence${goal.targetDate ? `, target ${formatDay(dayFromKey(goal.targetDate))}` : ""}).`);
    const g = group(input.groups, "goal").find((r) => r.id === goal.id);
    if (g) cites.push(g);
  }
  if (ctx?.pipeline && ctx.pipeline.open) {
    const deals = group(input.groups, "deal").filter((d) => d.meta?.status === "OPEN").slice(0, 3);
    sentences.push(
      `The pipeline has ${count(ctx.pipeline.open, "open deal")}${ctx.pipeline.totalValue ? ` worth ${formatCurrency(ctx.pipeline.totalValue)}` : ""}${deals.length ? `, led by ${listJoin(deals.map((d) => `${d.companyName ?? d.title} (${d.meta?.stage})`))}` : ""}.`,
    );
    cites.push(...deals);
  }
  const activity = ["thread", "insight", "notes", "meeting"].flatMap((t) => group(input.groups, t as SearchResultType));
  const latest = newest([{ type: "thread", label: "", truncated: false, results: activity }], now);
  const openCommitments = group(input.groups, "commitment").filter((c) => c.meta?.status === "OPEN");
  const risks = group(input.groups, "risk");
  const extras = [openCommitments.length ? count(openCommitments.length, "open commitment") : null, risks.length ? count(risks.length, "open risk") : null, group(input.groups, "decision").length ? count(group(input.groups, "decision").length, "related decision") : null].filter(Boolean) as string[];
  if (latest) {
    sentences.push(`Latest: ${quote(latest.title)} (${latest.timestamp ? timeAgo(new Date(latest.timestamp), now) : ""})${extras.length ? `; ${listJoin(extras)}` : ""}.`);
    cites.push(latest);
  } else if (extras.length) sentences.push(`${listJoin(extras)[0].toUpperCase()}${listJoin(extras).slice(1)}.`);
  if (!sentences.length) {
    const total = input.groups.reduce((n, g) => n + g.results.length, 0);
    const subject = plan.topic ?? plan.entities[0]?.label ?? plan.query;
    return finish(total ? `Found ${count(total, "item")} about ${subject}: ${countsPhrase(input.groups)}.` : `Nothing found about ${subject}.`, input.groups.flatMap((g) => g.results.slice(0, 1)));
  }
  return finish(sentences.slice(0, 3).join(" "), [...cites, ...openCommitments.slice(0, 2)]);
}

function relatedAnswer(input: AnswerInput): SearchAnswer {
  const label = input.plan.entities.find((e) => e.kind === "company" || e.kind === "person" || e.kind === "project")?.label ?? input.plan.entities[0]?.label ?? input.plan.query;
  const groups = input.groups.filter((g) => g.results.length && g.type !== "company" && g.type !== "person");
  const total = groups.reduce((n, g) => n + g.results.length, 0);
  if (!total) return finish(`Nothing is linked to ${label} yet.`, input.groups.flatMap((g) => g.results.slice(0, 1)));
  const latest = newest(groups, input.now);
  const lead = `${count(total, "item")} linked to ${label}: ${countsPhrase(groups)}.`;
  const recent = latest ? `Most recent: ${quote(latest.title)} (${RESULT_LABELS[latest.type].label.toLowerCase()}, ${latest.timestamp ? timeAgo(new Date(latest.timestamp), input.now) : ""}).` : "";
  return finish([lead, recent].filter(Boolean).join(" "), [...input.groups.filter((g) => g.type === "company").flatMap((g) => g.results.slice(0, 1)), ...(latest ? [latest] : []), ...groups.flatMap((g) => g.results.slice(0, 1))]);
}

function listAnswer(input: AnswerInput): SearchAnswer {
  const groups = input.groups.filter((g) => g.results.length);
  const total = groups.reduce((n, g) => n + g.results.length, 0);
  const what = input.plan.recordTypes.length ? listJoin([...new Set(input.plan.recordTypes.map((t) => RESULT_LABELS[t].plural.toLowerCase()))].slice(0, 3)) : "results";
  const about = input.plan.text ? ` about “${input.plan.text}”` : "";
  if (!total) return finish(`No ${what}${about} found.`, []);
  const top = groups.flatMap((g) => g.results).sort((a, b) => b.rank - a.rank).slice(0, 3);
  return finish(`Found ${countsPhrase(groups)}${about}. Top: ${listJoin(top.map((r) => quote(r.title, 60)))}.`, top);
}

function keywordAnswer(input: AnswerInput): SearchAnswer {
  const groups = input.groups.filter((g) => g.results.length);
  const total = groups.reduce((n, g) => n + g.results.length, 0);
  if (!total) return finish(`No results for “${input.plan.query}”.`, []);
  const best = groups.flatMap((g) => g.results).sort((a, b) => b.rank - a.rank)[0];
  return finish(`Found ${count(total, "result")} for “${input.plan.query}” across ${count(groups.length, "type")}. Top match: ${quote(best.title)} (${RESULT_LABELS[best.type].label.toLowerCase()}).`, [best, ...groups.flatMap((g) => g.results.slice(0, 1))]);
}

export function rulesAnswer(input: AnswerInput): SearchAnswer {
  const { plan } = input;
  switch (plan.intent) {
    case "commitments":
      return commitmentsAnswer(input);
    case "waiting":
      return waitingAnswer(input);
    case "deadlines":
      return deadlinesAnswer(input);
    case "discussed":
      return conversationAnswer(input, plan.entities.filter((e) => e.kind === "company" || e.kind === "person").map((e) => e.label).join(" and ") || null);
    case "conversations":
      return conversationAnswer(input, null);
    case "status":
      return statusAnswer(input);
    case "related":
      return relatedAnswer(input);
    case "list":
      return listAnswer(input);
    default:
      return keywordAnswer(input);
  }
}
