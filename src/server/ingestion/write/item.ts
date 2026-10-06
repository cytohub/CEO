/**
 * Per-item write context: the WriteEnv plus everything the writer needs to
 * turn names in an extraction into ids (CytoHub team, companies, goals,
 * milestones, deals) and what it has written so far (for change detection
 * and the attention engine, which run after the records).
 */
import type { CompanyType, MessageDirection, Priority } from "@/generated/prisma/enums";
import type { Tx } from "@/lib/db";
import { RELEVANCE } from "@/lib/intelligence";
import type { IntelligenceExtraction } from "../extraction-schema";
import { knownForms, knownOrganizationByName } from "../resolve/known-organizations";
import { companyCoreName, conversationalName, firstNameKey, normalizeCompanyName, normalizePersonName } from "../resolve/names";
import type { Classification, LoadedSourceItem, PipelineContext, ResolutionContext } from "../types";
import { actionTokens } from "./dedupe";
import type { WriteEnv } from "./env";

export interface TeamMember {
  id: string;
  name: string;
  normalized: string;
  first: string;
  isCeo: boolean;
}

export interface CompanyRef {
  id: string;
  name: string;
  type: CompanyType;
  relationship: number;
}

export interface DealRef {
  id: string;
  name: string;
  value: number | null;
  type: "SALES" | "FUNDRAISING" | "PARTNERSHIP";
  status: string;
  stage: string;
  companyId: string | null;
  ownerId: string | null;
}

export interface WriteRefs {
  team: TeamMember[];
  people: Map<string, { id: string; name: string; email: string | null; companyId: string | null; type: string; isCeo: boolean }>;
  companies: Map<string, CompanyRef>;
  companyForms: Map<string, string[]>;
  goals: { id: string; title: string; pillarId: string | null; tokens: string[] }[];
  milestones: { id: string; title: string; dueDate: Date; status: string; goalId: string | null; type: string }[];
  deals: DealRef[];
}

export interface WrittenTask {
  id: string;
  title: string;
  ownerId: string | null;
  dueDate: Date | null;
  hard: boolean;
  priority: Priority;
  created: boolean;
  confidence: number;
  companyId: string | null;
  evidence: string | null;
  dueText: string | null;
}

export interface WrittenCommitment {
  id: string;
  title: string;
  direction: "OUTBOUND" | "INBOUND" | "INTERNAL";
  ownerPersonId: string | null;
  counterpartyPersonId: string | null;
  dueDate: Date | null;
  dueText: string | null;
  taskId: string | null;
  created: boolean;
  confidence: number;
  companyId: string | null;
}

export interface DueChange {
  type: "TASK" | "COMMITMENT";
  id: string;
  title: string;
  from: Date | null;
  to: Date;
  applied: boolean;
  ownerId: string | null;
  priority: Priority | null;
  companyId: string | null;
}

export interface ItemCtx extends WriteEnv {
  ctx: PipelineContext;
  item: LoadedSourceItem;
  extraction: IntelligenceExtraction;
  resolution: ResolutionContext;
  classification: Classification;
  direction: MessageDirection | null;
  threadId: string | null;
  meetingId: string | null;
  refs: WriteRefs;
  written: {
    tasks: WrittenTask[];
    commitments: WrittenCommitment[];
    /** id is the Decision (null while only proposed for review). */
    decisions: { id: string | null; title: string; status: "MADE" | "NEEDED"; deadline: Date | null; created: boolean; queued: boolean }[];
    /** Tasks proposed for review (not written), still evidence of what was asked. */
    queuedTasks: { title: string; dueDate: Date | null; evidence: string | null; ownerId: string | null }[];
    risks: { id: string; title: string; severity: number; created: boolean; companyId: string | null }[];
    opportunities: { id: string; title: string; value: number | null; created: boolean; companyId: string | null }[];
    dueChanges: DueChange[];
    changes: { insightId: string; changeKind: string; importance: number; requiresCeo: boolean; title: string }[];
    meeting: { id: string; important: boolean; rescheduled: boolean; cancelled: boolean } | null;
  };
}

export async function loadWriteRefs(tx: Tx, resolution: ResolutionContext): Promise<WriteRefs> {
  const companyIds = resolution.companies.map((c) => c.id);
  const [team, people, companies, aliases, goals, milestones, deals] = await Promise.all([
    tx.person.findMany({ where: { OR: [{ type: "TEAM" }, { isCeo: true }] }, select: { id: true, name: true, isCeo: true } }),
    resolution.people.length
      ? tx.person.findMany({ where: { id: { in: resolution.people.map((p) => p.id) } }, select: { id: true, name: true, email: true, companyId: true, type: true, isCeo: true } })
      : [],
    tx.company.findMany({ select: { id: true, name: true, type: true, relationship: true } }),
    tx.entityAlias.findMany({ where: { entityType: "COMPANY", kind: { not: "DOMAIN" } }, select: { entityId: true, normalized: true } }),
    tx.goal.findMany({ where: { status: { notIn: ["COMPLETED"] } }, select: { id: true, title: true, pillarId: true } }),
    tx.milestone.findMany({ where: { status: { notIn: ["COMPLETED", "MISSED"] } }, select: { id: true, title: true, dueDate: true, status: true, goalId: true, type: true } }),
    tx.deal.findMany({
      where: { OR: [{ status: "OPEN" }, ...(companyIds.length ? [{ companyId: { in: companyIds } }] : [])] },
      select: { id: true, name: true, value: true, type: true, status: true, stage: true, companyId: true, ownerId: true },
      orderBy: { updatedAt: "desc" },
    }),
  ]);
  const companyForms = new Map<string, string[]>();
  const addForm = (form: string, id: string) => {
    if (!form) return;
    const list = companyForms.get(form) ?? [];
    if (!list.includes(id)) list.push(id);
    companyForms.set(form, list);
  };
  for (const c of companies) {
    const n = normalizeCompanyName(c.name);
    addForm(n, c.id);
    addForm(companyCoreName(n), c.id);
  }
  for (const a of aliases) addForm(a.normalized, a.entityId);
  return {
    team: team.map((t) => {
      const normalized = normalizePersonName(t.name);
      return { id: t.id, name: t.name, normalized, first: firstNameKey(normalized), isCeo: t.isCeo };
    }),
    people: new Map(people.map((p) => [p.id, p])),
    companies: new Map(companies.map((c) => [c.id, c])),
    companyForms,
    goals: goals.map((g) => ({ ...g, tokens: actionTokens(g.title) })),
    milestones,
    deals,
  };
}

// ─── Name → id ───────────────────────────────────────────────────────────────

export type Owner =
  | { kind: "CEO"; personId: string }
  | { kind: "TEAM"; personId: string }
  | { kind: "EXTERNAL"; personId: string }
  | { kind: "UNKNOWN"; name: string | null };

const SELF = new Set(["me", "i", "myself", "you", "ceo"]);
const WE = new Set(["we", "us", "cytohub", "the team", "our team", "team"]);

/** Who is meant by a name in an extraction ("Rajib", "me", "Maya", "Henrik"). */
export function resolveOwner(w: ItemCtx, name: string | null | undefined, isCeo: boolean): Owner {
  if (isCeo) return { kind: "CEO", personId: w.ceo.personId };
  if (!name || !name.trim()) return { kind: "UNKNOWN", name: null };
  const raw = name.trim().toLowerCase();
  const n = normalizePersonName(name);
  const ceo = w.refs.team.find((t) => t.isCeo);
  if (SELF.has(raw) || (ceo && (n === ceo.normalized || n === ceo.first))) {
    // "you" in an inbound message means the CEO; in the CEO's own message it means the recipient.
    if (raw === "you" && senderIsCeo(w)) return { kind: "UNKNOWN", name };
    return { kind: "CEO", personId: w.ceo.personId };
  }
  if (WE.has(raw)) return senderIsCeo(w) ? { kind: "CEO", personId: w.ceo.personId } : { kind: "UNKNOWN", name };

  const team = w.refs.team.filter((t) => !t.isCeo);
  const full = team.filter((t) => t.normalized === n);
  if (full.length === 1) return { kind: "TEAM", personId: full[0].id };
  const first = team.filter((t) => t.first === firstNameKey(n) && (!n.includes(" ") || t.normalized.endsWith(n.split(" ").slice(-1)[0])));
  if (first.length === 1) return { kind: "TEAM", personId: first[0].id };

  for (const p of w.resolution.people) {
    if (p.isCeo) continue;
    const pn = normalizePersonName(p.label);
    if (pn === n || (!n.includes(" ") && firstNameKey(pn) === n)) {
      const row = w.refs.people.get(p.id);
      return row?.type === "TEAM" ? { kind: "TEAM", personId: p.id } : { kind: "EXTERNAL", personId: p.id };
    }
  }
  return { kind: "UNKNOWN", name };
}

export function senderIsCeo(w: ItemCtx): boolean {
  const msg = w.item.emailMessage;
  if (msg) return !!w.ceo.email && msg.fromEmail.toLowerCase() === w.ceo.email.toLowerCase();
  const ev = w.item.calendarEvent;
  if (ev) return !!w.ceo.email && (ev.organizerEmail ?? "").toLowerCase() === w.ceo.email.toLowerCase();
  return w.resolution.people.some((p) => p.isCeo && p.role === "AUTHOR");
}

/** The external person who sent the item (inbound email sender), if any. */
export function externalSender(w: ItemCtx): string | null {
  const sender = w.resolution.people.find((p) => p.role === "SENDER" || p.role === "ORGANIZER");
  if (!sender || sender.isCeo) return null;
  return w.refs.people.get(sender.id)?.type === "TEAM" ? null : sender.id;
}

/** True when the CEO is personally addressed (a "to" recipient, organizer, attendee or author). */
export function ceoIsDirect(w: ItemCtx): boolean {
  if (w.item.kind === "MEETING_NOTES") return true;
  return w.resolution.people.some((p) => p.isCeo && p.role !== "MENTIONED" && p.role !== "CC");
}

/** The CEO is the only "to" recipient. */
export function ceoSoleRecipient(w: ItemCtx): boolean {
  const msg = w.item.emailMessage;
  if (!msg || !w.ceo.email) return false;
  const to = Array.isArray(msg.to) ? (msg.to as { email?: string }[]) : [];
  return to.length === 1 && (to[0].email ?? "").toLowerCase() === w.ceo.email.toLowerCase();
}

export function companyByName(w: ItemCtx, name: string | null | undefined): string | null {
  if (!name) return null;
  const n = normalizeCompanyName(name);
  if (!n) return null;
  const inItem = w.resolution.companies.find((c) => {
    const cn = normalizeCompanyName(c.label);
    return cn === n || companyCoreName(cn) === n || companyCoreName(cn) === companyCoreName(n);
  });
  if (inItem) return inItem.id;
  const one = (ids: string[] | undefined) => (ids && ids.length === 1 ? ids[0] : null);
  const direct = one(w.refs.companyForms.get(n)) ?? one(w.refs.companyForms.get(companyCoreName(n)));
  if (direct) return direct;
  const org = knownOrganizationByName(name);
  if (org) for (const f of knownForms(org)) if (one(w.refs.companyForms.get(f))) return one(w.refs.companyForms.get(f));
  return null;
}

/** Goal by token overlap (≥ 0.6) with the extraction's goal titles; else the goal the company's work already serves. */
export async function matchGoal(w: ItemCtx, companyId: string | null): Promise<string | null> {
  let best: { id: string; score: number } | null = null;
  for (const title of w.extraction.strategicRelevance.goalTitles) {
    const A = new Set(actionTokens(title));
    if (!A.size) continue;
    for (const g of w.refs.goals) {
      const B = new Set(g.tokens);
      if (!B.size) continue;
      let inter = 0;
      for (const t of A) if (B.has(t)) inter++;
      const score = inter / Math.min(A.size, B.size);
      if (inter >= Math.min(2, A.size, B.size) && score >= 0.6 && (!best || score > best.score)) best = { id: g.id, score };
    }
  }
  if (best) return best.id;
  if (!companyId) return null;
  const goalIds = new Set(w.refs.goals.map((g) => g.id));
  const [meetings, tasks] = await Promise.all([
    w.tx.meeting.findMany({ where: { companyId, goalId: { not: null } }, select: { goalId: true }, orderBy: { startsAt: "desc" }, take: 10 }),
    w.tx.task.findMany({ where: { companyId, goalId: { not: null } }, select: { goalId: true }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const counts = new Map<string, number>();
  for (const r of [...meetings, ...tasks]) if (r.goalId && goalIds.has(r.goalId)) counts.set(r.goalId, (counts.get(r.goalId) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** The open deal of a company that fits the conversation (fundraising for investor talk, commercial otherwise). */
export function dealFor(w: ItemCtx, companyId: string | null): DealRef | null {
  if (!companyId) return null;
  const open = w.refs.deals.filter((d) => d.companyId === companyId && d.status === "OPEN");
  if (!open.length) return null;
  const investorish = w.classification.category === "INVESTOR" || w.classification.category === "FUNDRAISING";
  return open.find((d) => (investorish ? d.type === "FUNDRAISING" : d.type !== "FUNDRAISING")) ?? open[0];
}

export function isLoud(w: ItemCtx): boolean {
  return RELEVANCE[w.classification.relevance].rank >= RELEVANCE.HIGH.rank;
}

/** Conversational name ("Henrik Sørensen", without "Dr.") for insight and inbox text. */
export function personName(w: ItemCtx, id: string | null | undefined): string | null {
  if (!id) return null;
  const name = w.refs.people.get(id)?.name ?? w.refs.team.find((t) => t.id === id)?.name ?? null;
  return name ? conversationalName(name) : null;
}
