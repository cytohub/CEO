/**
 * CEO attention engine (docs/ingestion/ARCHITECTURE.md §9).
 *
 * Scores a written item on strategic impact, revenue, fundraising, customer
 * importance, risk, urgency, deadline firmness, the CEO's ownership of the
 * relationship, legal and scientific significance and opportunity size, then
 * classifies it IMMEDIATE · TODAY · THIS_WEEK · MONITOR · DELEGATE · ARCHIVE.
 * Only IMMEDIATE/TODAY (plus CEO-owed commitments due this week and decisions
 * needed) reach the CEO Inbox — one item per thread, capped per day — so the
 * CEO never gets hundreds of notifications.
 */
import type { AttentionLevel, CeoCategory, CompanyType, Confidence, InboxType, Relevance } from "@/generated/prisma/enums";
import { addDays, dayStartInstant, daysBetween, formatDayLong } from "@/lib/dates";
import { confidenceFromScore } from "@/lib/intelligence";
import { companyShortName } from "../resolve/names";
import type { WriteEnv } from "./env";
import { upsertInsight } from "./insights";
import { tokenCoverage } from "./dedupe";
import { ceoSoleRecipient, dealFor, personName, type ItemCtx } from "./item";
import { actionClause, actionWithRecipient, cleanDecisionTitle, cleanTitle } from "./phrasing";
import { hasReferenceFrom, reference } from "./provenance";
import { formatMoney, sourceToItemSource } from "./records";

// ─── Scoring (pure) ──────────────────────────────────────────────────────────

export interface AttentionInput {
  relevance: Relevance;
  isNoise: boolean;
  category: CeoCategory;
  /** 0–1 */
  strategicScore: number;
  /** Commercial value at stake (deal or stated money), USD. */
  revenueValue: number | null;
  fundraising: boolean;
  fundraisingValue: number | null;
  companyType: CompanyType | null;
  /** 1–5 */
  companyRelationship: number | null;
  /** 1–5 */
  riskSeverity: number | null;
  /** Days from today to the earliest due date of the CEO-relevant work (negative = overdue). */
  daysToDue: number | null;
  hardDeadline: boolean;
  dealOwnerIsCeo: boolean;
  ceoSoleRecipient: boolean;
  ceoRepliedBefore: boolean;
  legal: boolean;
  scientific: boolean;
  opportunityValue: number | null;
  /** The CEO personally owns resulting work (asked directly, a CEO promise, a decision to take). */
  ceoAsked: boolean;
  /** A CEO-owed commitment is overdue or due within two days. */
  ceoOwesDueSoon: boolean;
  decisionNeeded: boolean;
  /** Work exists but all of it belongs to the team. */
  teamOwnedOnly: boolean;
  wroteSomething: boolean;
  urgentAction: boolean;
  /** Highest importance of an "Important change" raised from the item. */
  changeImportance: number | null;
  /** That change concerns the next few days (e.g. a meeting moved to tomorrow). */
  changeSoon: boolean;
}

export interface AttentionResult {
  level: AttentionLevel;
  score: number;
  reasons: string[];
}

const WEIGHTS = {
  strategic: 14,
  revenue: 9,
  fundraising: 10,
  customer: 8,
  risk: 9,
  urgency: 13,
  deadline: 5,
  ownership: 8,
  legal: 5,
  science: 4,
  opportunity: 5,
  directAsk: 10,
} as const;

function money(v: number | null): number {
  if (!v || v <= 0) return 0;
  if (v >= 5_000_000) return 1;
  if (v >= 1_000_000) return 0.9;
  if (v >= 300_000) return 0.75;
  if (v >= 100_000) return 0.5;
  return 0.3;
}

function urgency(days: number | null): number {
  if (days == null) return 0;
  if (days <= 0) return 1;
  if (days === 1) return 0.9;
  if (days === 2) return 0.8;
  if (days <= 7) return 0.6;
  if (days <= 14) return 0.35;
  return 0.1;
}

const KEY_CATEGORIES: ReadonlySet<CeoCategory> = new Set(["INVESTOR", "FUNDRAISING", "BOARD", "CUSTOMER", "STRATEGIC_PARTNER", "COMMERCIAL_OPPORTUNITY", "LEGAL"]);
const KEY_COMPANIES: ReadonlySet<CompanyType> = new Set(["CUSTOMER", "PROSPECT", "INVESTOR", "PARTNER"]);
const RANK: Record<AttentionLevel, number> = { IMMEDIATE: 6, TODAY: 5, THIS_WEEK: 4, MONITOR: 3, DELEGATE: 2, ARCHIVE: 1 };

export function scoreAttention(i: AttentionInput): AttentionResult {
  if (i.isNoise || i.relevance === "NOISE") return { level: "ARCHIVE", score: 0, reasons: ["Noise"] };
  const reasons: string[] = [];
  const keyParty = (i.companyType != null && KEY_COMPANIES.has(i.companyType)) || KEY_CATEGORIES.has(i.category);

  const f = {
    strategic: Math.max(Math.min(1, Math.max(0, i.strategicScore)), KEY_CATEGORIES.has(i.category) ? 0.6 : 0.3),
    revenue: Math.max(money(i.revenueValue), i.category === "CUSTOMER" || i.category === "COMMERCIAL_OPPORTUNITY" ? 0.4 : 0),
    fundraising: i.fundraising ? Math.max(0.8, money(i.fundraisingValue)) : i.category === "BOARD" ? 0.5 : 0,
    customer: i.companyType === "CUSTOMER" ? Math.min(1, 0.5 + 0.1 * (i.companyRelationship ?? 3)) : i.companyType === "PROSPECT" ? 0.5 : 0,
    risk: i.riskSeverity ? i.riskSeverity / 5 : 0,
    urgency: urgency(i.daysToDue),
    deadline: i.hardDeadline ? 1 : 0,
    ownership: Math.min(1, (i.dealOwnerIsCeo ? 0.4 : 0) + (i.ceoSoleRecipient ? 0.4 : 0) + (i.ceoRepliedBefore ? 0.3 : 0)),
    legal: i.legal ? 0.8 : 0,
    science: i.scientific ? 0.6 : 0,
    opportunity: money(i.opportunityValue),
    directAsk: i.ceoAsked ? 1 : 0,
  };
  let score = 0;
  for (const [k, v] of Object.entries(f)) score += WEIGHTS[k as keyof typeof WEIGHTS] * v;
  score += i.relevance === "CRITICAL" ? 10 : i.relevance === "HIGH" ? 5 : i.relevance === "LOW" ? -10 : 0;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const soon = (n: number) => i.daysToDue != null && i.daysToDue <= n;
  let level: AttentionLevel = "ARCHIVE";
  const severe = i.riskSeverity ?? 0;
  if (score >= 66 || (i.ceoOwesDueSoon && soon(0) && keyParty) || (i.relevance === "CRITICAL" && ((i.urgentAction && i.ceoAsked) || (severe >= 5 && keyParty)))) level = "IMMEDIATE";
  else if (score >= 50 || (i.ceoAsked && keyParty && soon(3)) || i.ceoOwesDueSoon || (i.decisionNeeded && soon(2)) || (severe >= 4 && keyParty)) level = "TODAY";
  else if (score >= 35 || (i.ceoAsked && soon(7)) || i.decisionNeeded) level = "THIS_WEEK";
  else if (i.teamOwnedOnly && !i.ceoAsked) level = "DELEGATE";
  else if (score >= 18 || i.wroteSomething) level = "MONITOR";

  // Important changes lift the level: a moved meeting tomorrow is for today.
  if (i.changeImportance != null) {
    const lift: AttentionLevel = i.changeImportance >= 5 || (i.changeImportance >= 4 && i.changeSoon) ? "TODAY" : i.changeImportance >= 4 ? "THIS_WEEK" : "MONITOR";
    if (RANK[lift] > RANK[level]) level = lift;
  }
  if (level === "DELEGATE" && !i.teamOwnedOnly) level = "MONITOR";
  // Delegable work stays delegated unless the score says the CEO must see it.
  if (i.teamOwnedOnly && !i.ceoAsked && level === "THIS_WEEK" && score < 50) level = "DELEGATE";

  if (i.ceoAsked) reasons.push("Asks the CEO personally");
  if (i.ceoOwesDueSoon) reasons.push("A CEO promise is due");
  if (i.decisionNeeded) reasons.push("Needs a decision");
  if (keyParty) reasons.push("Key relationship");
  if (soon(2)) reasons.push("Due within two days");
  if (i.riskSeverity && i.riskSeverity >= 4) reasons.push("Serious risk");
  return { level, score, reasons };
}

// ─── Inbox items ─────────────────────────────────────────────────────────────

export const DAILY_INBOX_CAP = 8;

export interface InboxInput {
  fingerprint: string;
  type: InboxType;
  level: AttentionLevel;
  title: string;
  summary?: string | null;
  whyCeo: string;
  recommendedAction: string;
  dueDate?: Date | null;
  confidence?: Confidence | null;
  strategicRelevance?: string | null;
  occurredAt?: Date | null;
  links?: {
    insightId?: string | null;
    personId?: string | null;
    companyId?: string | null;
    taskId?: string | null;
    decisionId?: string | null;
    goalId?: string | null;
    dealId?: string | null;
    commitmentId?: string | null;
    riskId?: string | null;
    opportunityId?: string | null;
  };
}

const URGENCY: Record<AttentionLevel, number> = { IMMEDIATE: 5, TODAY: 4, THIS_WEEK: 3, MONITOR: 2, DELEGATE: 2, ARCHIVE: 1 };

/**
 * Create or refresh an inbox item (one per fingerprint). New ingestion items
 * are capped per CEO day unless IMMEDIATE; an item the CEO resolved reopens
 * only for newer information, and a dismissed one only for IMMEDIATE news.
 */
export async function upsertInboxItem(env: WriteEnv, input: InboxInput): Promise<{ id: string; created: boolean } | null> {
  const { tx } = env;
  const links = input.links ?? {};
  const data = {
    type: input.type,
    title: input.title.slice(0, 300),
    summary: input.summary?.slice(0, 2000) ?? null,
    whyCeo: input.whyCeo.slice(0, 1000),
    recommendedAction: input.recommendedAction.slice(0, 500),
    urgency: URGENCY[input.level],
    dueDate: input.dueDate ?? null,
    attention: input.level,
    confidence: input.confidence ?? null,
    strategicRelevance: input.strategicRelevance?.slice(0, 300) ?? null,
    source: env.source ? sourceToItemSource(env.source.kind) : ("BRAIN" as const),
    insightId: links.insightId ?? null,
    personId: links.personId ?? null,
    companyId: links.companyId ?? null,
    taskId: links.taskId ?? null,
    decisionId: links.decisionId ?? null,
    goalId: links.goalId ?? null,
    dealId: links.dealId ?? null,
    commitmentId: links.commitmentId ?? null,
    riskId: links.riskId ?? null,
    opportunityId: links.opportunityId ?? null,
    sourceItemId: env.source?.id ?? null,
  };
  const existing = await tx.inboxItem.findUnique({ where: { fingerprint: input.fingerprint }, select: { id: true, status: true, resolvedAt: true, urgency: true, snoozedUntil: true } });
  let id: string;
  let created = false;
  if (existing) {
    const newer = (input.occurredAt ?? env.now) > (existing.resolvedAt ?? new Date(0));
    if (existing.status === "DONE" || existing.status === "DISMISSED") {
      const reopen = newer && (input.level === "IMMEDIATE" || (existing.status === "DONE" && input.level === "TODAY"));
      if (!reopen) return null;
    }
    const patch = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null)) as typeof data;
    await tx.inboxItem.update({
      where: { id: existing.id },
      data: {
        ...patch,
        urgency: Math.max(existing.urgency, data.urgency),
        ...(existing.status === "DONE" || existing.status === "DISMISSED" ? { status: "OPEN", resolvedAt: null, resolution: null } : {}),
        ...(existing.status === "SNOOZED" && input.level === "IMMEDIATE" ? { status: "OPEN", snoozedUntil: null } : {}),
        updatedAt: env.now,
      },
    });
    id = existing.id;
  } else {
    if (input.level !== "IMMEDIATE") {
      const since = dayStartInstant(env.today, env.timezone);
      const today = await tx.inboxItem.count({ where: { sourceItemId: { not: null }, createdAt: { gte: since } } });
      if (today >= DAILY_INBOX_CAP) return null;
    }
    const row = await tx.inboxItem.create({ data: { ...data, fingerprint: input.fingerprint, status: "OPEN", createdAt: env.now, updatedAt: env.now } });
    id = row.id;
    created = true;
  }
  if (env.source && (created || !(await hasReferenceFrom(tx, "INBOX_ITEM", id, env.source.id)))) {
    await reference(env, "INBOX_ITEM", id, created ? "CREATED_FROM" : "UPDATED_FROM", { excerpt: input.whyCeo });
  }
  if (!env.summary.inboxItemIds.includes(id)) env.summary.inboxItemIds.push(id);
  return { id, created };
}

// ─── Item attention (database) ───────────────────────────────────────────────

const ESCALATION = /\b(escalat\w*|urgent(ly)?|unacceptable|breach|immediately|asap)\b/i;
const APPROVAL = /\b(approv\w*|sign[- ]?off|your signature|countersign)\b/i;

function lowerFirst(s: string): string {
  return /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
}

function companyTypeLabel(type: CompanyType): string {
  return type === "PROSPECT" ? "prospect" : type === "ACADEMIC" ? "academic partner" : type.toLowerCase();
}

/** "Calder Biosciences — customer, $350K paid validation study" */
async function partyDescriptor(w: ItemCtx, companyId: string | null): Promise<string | null> {
  if (!companyId) return null;
  const company = w.refs.companies.get(companyId);
  if (!company) return null;
  const open = dealFor(w, companyId);
  const deal =
    open ??
    (await w.tx.deal.findFirst({ where: { companyId, status: "WON" }, orderBy: { updatedAt: "desc" }, select: { id: true, name: true, value: true, type: true, status: true, stage: true, companyId: true, ownerId: true } }));
  const what = deal?.name.split(/\s+[—–-]\s+/).slice(1).join(" — ") || null;
  const dealPart = deal?.value ? `, ${formatMoney(deal.value)}${what ? ` ${lowerFirst(what)}` : ""}` : what ? `, ${lowerFirst(what)}` : "";
  return `${company.name} — ${companyTypeLabel(company.type)}${dealPart}`;
}

/** "today", "tomorrow", "by Fri, Oct 9", or "now — it was due Mon, Oct 5". */
function dueLabel(dueText: string | null | undefined, due: Date | null, today: Date): string {
  if (!due) return dueText ? dueClause(dueText, null).trim() : "soon";
  const d = daysBetween(today, due);
  if (d < 0) return `now — it was due ${formatDayLong(due)}`;
  if (d === 0) return /tonight/i.test(dueText ?? "") ? "tonight" : "today";
  if (d === 1) return "by tomorrow";
  return `by ${formatDayLong(due)}`;
}

/**
 * The extractor's recommended action, when it adds something: not a restated
 * title ("<title> by <date> and reply to <name>") and not a templated stub.
 */
function usefulRecommendation(actions: { action: string; urgency: string }[], titles: (string | null | undefined)[]): string | null {
  for (const a of actions) {
    const text = a.action.trim();
    if (!text || /\band reply to\b|^(address|track|review)\b[: ]/i.test(text)) continue;
    if (titles.some((t) => t && tokenCoverage(t, text) >= 0.6)) continue;
    return cleanTitle(text, 160).replace(/(?<![.?!])$/, ".");
  }
  return null;
}

function dueClause(dueText: string | null | undefined, due: Date | null): string {
  if (dueText && /^(by|before|no later than|on|until|end of|eod|this|next|today|tomorrow)\b/i.test(dueText.trim())) return ` ${dueText.trim()}`;
  if (dueText) return ` by ${dueText.trim()}`;
  return due ? ` by ${formatDayLong(due)}` : "";
}

export async function applyAttention(w: ItemCtx): Promise<AttentionLevel> {
  const ceoTasks = w.written.tasks.filter((t) => t.ownerId === w.ceo.personId);
  const ceoCommitments = w.written.commitments.filter((c) => c.ownerPersonId === w.ceo.personId && c.direction !== "INBOUND");
  const decisions = w.written.decisions.filter((d) => d.status === "NEEDED");
  const teamTasks = w.written.tasks.filter((t) => t.ownerId && t.ownerId !== w.ceo.personId);
  const dues = [...ceoTasks.map((t) => t.dueDate), ...ceoCommitments.map((c) => c.dueDate), ...decisions.map((d) => d.deadline)].filter((d): d is Date => !!d);
  const earliest = dues.length ? new Date(Math.min(...dues.map((d) => d.getTime()))) : null;
  const daysToDue = earliest ? daysBetween(w.today, earliest) : null;
  const ceoOwesDue = ceoCommitments.filter((c) => c.dueDate && daysBetween(w.today, c.dueDate) <= 2);

  const companyId = w.resolution.primaryCompanyId;
  const company = companyId ? w.refs.companies.get(companyId) : null;
  const deal = dealFor(w, companyId);
  const moneyFacts = w.extraction.facts.filter((f) => f.kind === "MONEY" && f.numericValue != null).map((f) => f.numericValue!);
  const fundraising = w.classification.category === "INVESTOR" || w.classification.category === "FUNDRAISING" || company?.type === "INVESTOR";
  const msg = w.item.emailMessage;
  const repliedBefore = msg ? (await w.tx.emailMessage.count({ where: { threadId: msg.threadId, direction: "OUTBOUND", sentAt: { lt: msg.sentAt } } })) > 0 : false;
  const topChange = [...w.written.changes].sort((a, b) => b.importance - a.importance)[0] ?? null;
  const meetingSoon = w.written.meeting && w.item.calendarEvent ? daysBetween(w.today, w.item.calendarEvent.startsAt) <= 3 : false;

  const input: AttentionInput = {
    relevance: w.classification.relevance,
    isNoise: w.classification.isNoise,
    category: w.classification.category,
    strategicScore: w.extraction.strategicRelevance.score,
    revenueValue: Math.max(deal && deal.type !== "FUNDRAISING" ? (deal.value ?? 0) : 0, ...moneyFacts, 0) || null,
    fundraising,
    fundraisingValue: deal?.type === "FUNDRAISING" ? deal.value : null,
    companyType: company?.type ?? null,
    companyRelationship: company?.relationship ?? null,
    riskSeverity: w.written.risks.length ? Math.max(...w.written.risks.map((r) => r.severity)) : null,
    daysToDue,
    hardDeadline: ceoTasks.some((t) => t.hard) || ceoCommitments.length > 0,
    dealOwnerIsCeo: deal?.ownerId === w.ceo.personId,
    ceoSoleRecipient: ceoSoleRecipient(w),
    ceoRepliedBefore: repliedBefore,
    legal: w.classification.category === "LEGAL" || w.extraction.activityTags.includes("LEGAL"),
    scientific: w.classification.category === "SCIENTIFIC_LEADERSHIP" || w.extraction.activityTags.includes("SCIENTIFIC"),
    opportunityValue: w.written.opportunities.length ? Math.max(0, ...w.written.opportunities.map((o) => o.value ?? 0)) || null : null,
    ceoAsked: ceoTasks.length > 0 || ceoCommitments.length > 0 || decisions.length > 0,
    ceoOwesDueSoon: ceoOwesDue.length > 0,
    decisionNeeded: decisions.length > 0,
    teamOwnedOnly: teamTasks.length > 0 && ceoTasks.length === 0 && ceoCommitments.length === 0 && decisions.length === 0,
    wroteSomething: w.summary.created.length + w.summary.updated.length + w.summary.reviewItemIds.length > 0,
    urgentAction: w.extraction.recommendedActions.some((a) => a.urgency === "IMMEDIATE"),
    changeImportance: topChange ? (topChange.requiresCeo ? topChange.importance : Math.min(3, topChange.importance)) : null,
    changeSoon: meetingSoon || (daysToDue != null && daysToDue <= 3),
  };
  const result = scoreAttention(input);
  await w.tx.sourceItem.update({ where: { id: w.item.id }, data: { attention: result.level } });

  const level = result.level;
  const fingerprint = w.threadId ? `inbox:thread:${w.threadId}` : `inbox:item:${w.item.id}`;
  const person = w.resolution.counterpartPersonIds[0] ?? null;
  // Who is asking: the (non-CEO) sender or organizer, else the main external counterpart.
  const requesterId = w.resolution.people.find((p) => !p.isCeo && (p.role === "SENDER" || p.role === "ORGANIZER"))?.id ?? person;
  const requester = personName(w, requesterId);
  const requesterFirst = requester?.split(" ")[0] ?? null;
  const descriptor = await partyDescriptor(w, companyId);
  const goalTitle = w.extraction.strategicRelevance.goalTitles[0] ?? w.extraction.strategicRelevance.pillarNames[0] ?? null;
  const confidence = confidenceFromScore(Math.max(w.classification.relevanceScore, ...w.written.tasks.map((t) => t.confidence), ...w.written.commitments.map((c) => c.confidence), 0));
  const mainTask = [...ceoTasks].sort((a, b) => (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity))[0] ?? null;
  const mainCommitment = [...ceoOwesDue, ...ceoCommitments].sort((a, b) => (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity))[0] ?? null;
  const textForCues = `${w.item.title}\n${w.extraction.summary}\n${mainTask?.evidence ?? ""}`;

  const links = {
    insightId: topChange?.insightId ?? null,
    personId: requesterId,
    companyId,
    taskId: mainTask?.id ?? mainCommitment?.taskId ?? null,
    decisionId: decisions.find((d) => d.id && !d.queued)?.id ?? null,
    goalId: null as string | null,
    dealId: deal?.id ?? null,
    commitmentId: mainCommitment?.id ?? null,
    riskId: w.written.risks[0]?.id ?? null,
    opportunityId: w.written.opportunities[0]?.id ?? null,
  };
  if (mainTask) links.goalId = (await w.tx.task.findUnique({ where: { id: mainTask.id }, select: { goalId: true } }))?.goalId ?? null;

  const base = { level, confidence, strategicRelevance: goalTitle, occurredAt: w.item.occurredAt, links, summary: w.extraction.summary || w.item.snippet || null };
  const short = company ? companyShortName(company.name) : null;
  /** "Henrik Sørensen (Calder Biosciences — customer, …)", or whatever part is known; null when nobody is known. */
  const party = requester && descriptor ? `${requester} (${descriptor})` : (requester ?? descriptor ?? null);
  const rec = usefulRecommendation(w.extraction.recommendedActions, [mainTask?.title, mainCommitment?.title, decisions[0]?.title]);

  const inbox = async (type: InboxType, title: string, whyCeo: string, recommendedAction: string, dueDate: Date | null) =>
    upsertInboxItem(w, { ...base, fingerprint, type, title: cleanTitle(title, 120), whyCeo, recommendedAction, dueDate });

  const commitmentInbox = async (c: NonNullable<typeof mainCommitment>, thisWeek: boolean) => {
    const cpName = c.counterpartyPersonId && c.counterpartyPersonId !== w.ceo.personId ? personName(w, c.counterpartyPersonId) : null;
    const cpFirst = cpName?.split(" ")[0] ?? null;
    const cpDescriptor = cpName && descriptor && w.refs.people.get(c.counterpartyPersonId!)?.companyId === companyId ? ` (${descriptor})` : "";
    const advice = thisWeek && c.dueDate
      ? `Plan time for it before ${formatDayLong(c.dueDate)}: ${lowerFirst(actionWithRecipient(c.title, cpFirst))}.`
      : `${actionWithRecipient(c.title, cpFirst)} ${dueLabel(c.dueText, c.dueDate, w.today)}${cpFirst ? `, or tell ${cpFirst} when it will arrive` : ""}.`;
    await inbox(
      "COMMITMENT",
      cpName ? `You owe ${cpName}: ${cleanTitle(c.title)}` : `You promised: ${cleanTitle(c.title)}`,
      `You promised ${cpName ? `${cpName}${cpDescriptor} ` : ""}to ${actionClause(c.title)}${dueClause(c.dueText, c.dueDate)}.`,
      advice,
      c.dueDate,
    );
  };
  const decisionInbox = async (d: (typeof decisions)[number], thisWeek: boolean) => {
    const title = cleanDecisionTitle(d.title);
    const by = d.deadline ? ` by ${formatDayLong(d.deadline)}` : "";
    await inbox(
      "DECISION",
      `Decision needed: ${title}`,
      `${requester ? `${requester} needs` : "Needs"} your decision${by}: ${title}${/[.?!]$/.test(title) ? "" : "."}`,
      rec ?? `Decide${by || (thisWeek ? " this week" : " today")}${requesterFirst ? ` and tell ${requesterFirst}` : ""}, or set a date to decide.`,
      d.deadline,
    );
  };

  if (level === "IMMEDIATE" || level === "TODAY") {
    if (mainCommitment) {
      await commitmentInbox(mainCommitment, false);
    } else if (decisions.length) {
      await decisionInbox(decisions[0], false);
    } else if (mainTask) {
      const type: InboxType =
        w.classification.category === "INTERNAL_ESCALATION" || ESCALATION.test(textForCues)
          ? "ESCALATION"
          : company?.type === "CUSTOMER" && w.written.risks.length
            ? "CUSTOMER_ISSUE"
            : fundraising
              ? "INVESTOR_FOLLOW_UP"
              : APPROVAL.test(textForCues)
                ? "APPROVAL"
                : "REQUEST";
      const asker = requesterFirst ?? short;
      await inbox(
        type,
        `${asker ? `${asker} asked` : "Request"}: ${cleanTitle(mainTask.title)}`,
        `${party ? `${party} asked you` : "You were asked"} directly to ${actionClause(mainTask.title)}${dueClause(mainTask.dueText, mainTask.dueDate)}.`,
        rec ?? `${actionWithRecipient(mainTask.title, requesterFirst)}${mainTask.dueDate ? ` ${dueLabel(mainTask.dueText, mainTask.dueDate, w.today)}` : ""}.`,
        mainTask.dueDate,
      );
    } else if (topChange) {
      const insight = await w.tx.brainInsight.findUnique({ where: { id: topChange.insightId }, select: { summary: true, recommendation: true } });
      const type: InboxType = topChange.changeKind === "new_investor" ? "INVESTOR_FOLLOW_UP" : "CHANGE";
      await inbox(type, topChange.title.replace(/^Important change:\s*/, ""), insight?.summary ?? topChange.title, insight?.recommendation ?? "Review the change.", null);
    } else if (w.written.risks.length && company?.type === "CUSTOMER") {
      const r = w.written.risks[0];
      await inbox("CUSTOMER_ISSUE", `${short}: ${cleanTitle(r.title)}`, `${party ? `${party}: ` : ""}${cleanTitle(r.title, 200)} (severity ${r.severity}/5).`, rec ?? `Call ${requesterFirst ?? "the customer sponsor"} and agree a dated recovery plan.`, null);
    } else if (w.written.opportunities.length) {
      const o = w.written.opportunities[0];
      await inbox("OPPORTUNITY", `Opportunity: ${cleanTitle(o.title)}`, `${party ? `${party} — ` : ""}${cleanTitle(o.title, 200)}${o.value ? ` (${formatMoney(o.value)})` : ""}.`, rec ?? "Decide whether to pursue it and who owns the next step.", null);
    } else {
      const why = w.extraction.ceoRelevance.reasons[0] ?? w.classification.reasons[0] ?? "High-relevance source.";
      await inbox(fundraising ? "INVESTOR_FOLLOW_UP" : "REQUEST", w.item.title, `${party ? `${party}: ` : ""}${why}`, rec ?? (requesterFirst ? `Read and reply to ${requesterFirst}.` : "Read and reply."), earliest);
    }
  } else if (level === "THIS_WEEK") {
    const weekEnd = addDays(w.today, 7);
    const owed = ceoCommitments.find((c) => c.dueDate && c.dueDate <= weekEnd);
    const decision = decisions.find((d) => !d.queued);
    if (owed) await commitmentInbox(owed, true);
    else if (decision) await decisionInbox(decision, true);
  } else if (level === "DELEGATE") {
    const t = teamTasks[0];
    const owner = personName(w, t.ownerId);
    await upsertInsight(w, {
      type: "DELEGATION",
      fingerprint: `delegate:${w.threadId ? `thread:${w.threadId}` : `item:${w.item.id}`}`,
      title: `Handled by ${owner ?? "the team"}: ${t.title}`,
      summary: w.extraction.summary || null,
      recommendation: `Leave it with ${owner ?? "the owner"}${t.dueDate ? `; check in before ${formatDayLong(t.dueDate)}` : ""}.`,
      importance: 2,
      requiresCeo: false,
      links: { taskId: t.id, companyId, personId: t.ownerId },
    });
  } else if (level === "MONITOR" && w.extraction.summary && w.classification.relevance !== "LOW") {
    await upsertInsight(w, {
      type: "DEVELOPMENT",
      fingerprint: `monitor:${w.threadId ? `thread:${w.threadId}` : `item:${w.item.id}`}`,
      title: `${short ? `${short}: ` : ""}${w.item.title}`,
      summary: w.extraction.summary,
      recommendation: "No action needed now.",
      importance: 2,
      requiresCeo: false,
      links: { companyId, personId: person, dealId: deal?.id ?? null },
    });
  }
  return level;
}
