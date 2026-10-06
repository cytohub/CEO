/**
 * Change detection (docs/ingestion/ARCHITECTURE.md §8): compare what a source
 * says with what the Brain already holds and raise an "Important change"
 * insight — what changed, the impact, and the recommended action.
 *
 * changeKind values: meeting_rescheduled, meeting_cancelled,
 * customer_deliverable_requested, deadline_moved, proposal_value_changed,
 * milestone_slipped, document_changed, new_scientific_result, new_risk,
 * new_investor, contract_status_changed.
 * Fingerprints are `change:<changeKind>:<stable subject>` so re-processing
 * updates the same insight and a dismissed change never comes back.
 */
import type { DocumentType } from "@/generated/prisma/enums";
import { dayFromKey, dayKey, formatDay } from "@/lib/dates";
import { DOCUMENT_TYPES } from "@/lib/intelligence";
import { companyShortName, conversationalName } from "../resolve/names";
import type { StageData } from "../types";
import { actionKey, shortHash, tokenCoverage } from "./dedupe";
import { PROTECTED_REASONS } from "./gate";
import { recordActivity } from "./history";
import { upsertInsight, type InsightLinks } from "./insights";
import { dealFor, personName, type ItemCtx } from "./item";
import { deliverablePhrase, describeChange, documentShortTitle, isMeaningfulMetricLabel, longDay, metricKey, requestedObject, significanceRank, signedSentence, type SignificantChange } from "./phrasing";
import { formatMoney } from "./records";
import { queueReview } from "./review";

export interface ChangeInput {
  changeKind: string;
  fingerprint: string;
  title: string;
  summary: string;
  recommendation: string;
  importance: number;
  requiresCeo: boolean;
  links: InsightLinks;
  excerpt?: string | null;
  confidence?: number | null;
  /** Same change reported by another source: corroborate the existing insight instead of rewriting it. */
  corroborateOnly?: boolean;
}

export async function raiseChange(w: ItemCtx, c: ChangeInput) {
  const r = await upsertInsight(w, {
    type: "CHANGE",
    fingerprint: c.fingerprint,
    title: c.title,
    summary: c.summary,
    recommendation: c.recommendation,
    importance: c.importance,
    requiresCeo: c.requiresCeo,
    changeKind: c.changeKind,
    links: c.links,
    excerpt: c.excerpt,
    confidence: c.confidence,
    corroborateOnly: c.corroborateOnly,
  });
  if (r && !w.written.changes.some((x) => x.insightId === r.id)) {
    w.written.changes.push({ insightId: r.id, changeKind: c.changeKind, importance: r.importance, requiresCeo: r.requiresCeo, title: r.title });
  }
  return r;
}

// ─── Detection ───────────────────────────────────────────────────────────────

export async function detectChanges(w: ItemCtx) {
  await customerDeliverable(w);
  await deadlineMoves(w);
  await documentChanged(w);
  await scientificResult(w);
  await newRisks(w);
  await newInvestor(w);
  await contractSigned(w);
}

async function customerDeliverable(w: ItemCtx) {
  // An inbound email, or meeting notes that record the customer asking (not CytoHub volunteering).
  const asked = /\b(asked|requested|request(s|ing)?|needs?|needed|wants?|wanted|expects?|please|could you|can you|would like)\b/i;
  const notesAsk = w.item.kind === "MEETING_NOTES" && w.written.tasks.some((t) => t.created && asked.test(t.evidence ?? ""));
  const inbound = w.direction === "INBOUND" || notesAsk;
  const companyId = w.resolution.primaryCompanyId;
  const company = companyId ? w.refs.companies.get(companyId) : null;
  if (!inbound || !company || (company.type !== "CUSTOMER" && company.type !== "PROSPECT")) return;
  type Ask = { title: string; due: Date; ownerId: string | null; taskId: string | null; commitmentId: string | null; evidence: string | null };
  const asks: Ask[] = [
    ...w.written.tasks.filter((t) => t.created && t.dueDate).map((t) => ({ title: t.title, due: t.dueDate!, ownerId: t.ownerId, taskId: t.id, commitmentId: null, evidence: t.evidence })),
    ...w.written.commitments
      .filter((c) => c.created && c.dueDate && c.direction !== "INBOUND")
      .map((c) => ({ title: c.title, due: c.dueDate!, ownerId: c.ownerPersonId, taskId: c.taskId, commitmentId: c.id, evidence: null })),
    // The request stands even when the task itself waits for review…
    ...w.written.queuedTasks.filter((t) => t.dueDate).map((t) => ({ title: t.title, due: t.dueDate!, ownerId: t.ownerId, taskId: null, commitmentId: null, evidence: t.evidence })),
    // …or when only a dated "we need X by <date>" was extracted.
    ...w.extraction.deadlines
      .filter((d) => d.hard && requestedObject(d.evidence))
      .map((d) => ({ title: requestedObject(d.evidence)!, due: dayFromKey(d.date), ownerId: null, taskId: null, commitmentId: null, evidence: d.evidence })),
  ];
  asks.sort((a, b) => a.due.getTime() - b.due.getTime() || Number(!!b.taskId) - Number(!!a.taskId));
  const ask = asks[0];
  if (!ask) return;
  const short = companyShortName(company.name);
  const deal = dealFor(w, companyId);
  const renewal = !!deal && /renewal/i.test(`${deal.name} ${deal.stage}`);
  const requester = w.resolution.counterpartPersonIds[0] ?? null;
  const ownerName = ask.ownerId && ask.ownerId !== w.ceo.personId ? personName(w, ask.ownerId) : null;
  const who = personName(w, requester);
  await raiseChange(w, {
    changeKind: "customer_deliverable_requested",
    fingerprint: `change:customer_deliverable_requested:${w.threadId ?? w.item.id}:${shortHash(actionKey(ask.title))}`,
    title: `Important change: ${short} requested ${deliverablePhrase(ask.title, ask.evidence, ...w.extraction.deadlines.filter((d) => d.date === dayKey(ask.due)).map((d) => d.evidence), w.item.text)} by ${longDay(ask.due)}`,
    summary: `Impact: customer relationship${renewal ? " / renewal" : ""}${deal ? ` (${deal.name}${deal.value ? `, ${formatMoney(deal.value)}` : ""})` : ""}.`,
    recommendation: ownerName ? `Confirm ${ownerName} can deliver by ${formatDay(ask.due)}${who ? ` and reply to ${who}` : ""}.` : "Assign an owner and confirm delivery.",
    importance: renewal || (deal?.value ?? 0) >= 500_000 || company.type === "CUSTOMER" ? 4 : 3,
    requiresCeo: true,
    links: { companyId, personId: requester, taskId: ask.taskId, commitmentId: ask.commitmentId, dealId: deal?.id ?? null },
    excerpt: ask.evidence,
  });
}

async function deadlineMoves(w: ItemCtx) {
  for (const c of w.written.dueChanges) {
    if (!c.from) continue;
    const later = c.to > c.from;
    const high = c.priority === "P0" || c.priority === "P1";
    await raiseChange(w, {
      changeKind: "deadline_moved",
      fingerprint: `change:deadline_moved:${c.type}:${c.id}:${dayKey(c.to)}`,
      title: `Important change: “${c.title}” ${later ? "moved out" : "pulled in"} from ${formatDay(c.from)} to ${formatDay(c.to)}`,
      summary: c.applied ? "The new date was applied automatically from the source." : "Waiting for approval in the Brain Review Queue — the work is CEO-owned or high priority.",
      recommendation: later ? "Check what depends on the old date and tell anyone affected." : "Make sure the owner can meet the earlier date.",
      importance: high ? 4 : 3,
      requiresCeo: !c.applied || c.ownerId === w.ceo.personId,
      links: { companyId: c.companyId, ...(c.type === "TASK" ? { taskId: c.id } : { commitmentId: c.id }) },
    });
  }
}

async function documentChanged(w: ItemCtx) {
  const doc = w.item.document;
  if (!doc) return;
  const stage = (w.item.stageData as StageData | null) ?? {};
  const versionId = stage.document?.versionId ?? null;
  const version = versionId
    ? await w.tx.documentVersion.findUnique({ where: { id: versionId } })
    : await w.tx.documentVersion.findFirst({ where: { documentId: doc.id }, orderBy: { version: "desc" } });
  if (!version || !version.isSignificant || version.version <= 1) return;
  const changes = (Array.isArray(version.significantChanges) ? version.significantChanges : []) as unknown as SignificantChange[];
  const ranked = changes.filter((c) => c && typeof c.label === "string").sort((a, b) => significanceRank(b.significance) - significanceRank(a.significance));
  const top = ranked[0];
  const short = documentShortTitle(doc.title);
  const what = top ? describeChange(top) : "significant changes";
  const keyDoc = (["INVESTOR_DECK", "FINANCIAL_MODEL", "CUSTOMER_CONTRACT", "CUSTOMER_PROPOSAL", "BOARD_DOCUMENT", "PARTNERSHIP_AGREEMENT"] as DocumentType[]).includes(doc.docType);
  const importance = Math.min(5, Math.max(top ? significanceRank(top.significance) : 3, 3) + (keyDoc ? 1 : 0));
  const r = await raiseChange(w, {
    changeKind: "document_changed",
    fingerprint: `change:document_changed:${doc.id}:v${version.version}`,
    title: `Important change: ${short}: ${what}`,
    summary:
      version.changeSummary ??
      ranked
        .slice(0, 5)
        .map((c) => `${c.label}: ${c.from ?? "—"} → ${c.to ?? "—"}`)
        .join("; "),
    recommendation:
      doc.docType === "INVESTOR_DECK" || doc.docType === "FINANCIAL_MODEL" || doc.docType === "FUNDRAISING_MATERIAL"
        ? "Check the new figures match the model, data room and what investors have already seen."
        : "Review the new version and confirm the change is intended.",
    importance,
    requiresCeo: importance >= 4,
    links: { documentId: doc.id, companyId: w.resolution.primaryCompanyId },
    excerpt: version.changeSummary,
  });
  if (r?.created) {
    await recordActivity(w, "DOCUMENT_CHANGED", `${short} v${version.version}: ${what}`, { documentId: doc.id, companyId: w.resolution.primaryCompanyId }, {
      version: version.version,
      changes: ranked.slice(0, 10).map((c) => ({ label: c.label, from: c.from, to: c.to })),
    });
  }
}

const SCIENCE_DOCS: DocumentType[] = ["EXPERIMENT_REPORT", "SCIENTIFIC_DATA_SUMMARY", "PUBLICATION"];

async function scientificResult(w: ItemCtx) {
  const doc = w.item.document;
  // A result is a named metric ("Hold-out AUC: 0.88"), never a bare "Percentage: 94%".
  const metrics = w.extraction.facts.filter((f) => (f.kind === "METRIC" || f.kind === "PERCENT") && isMeaningfulMetricLabel(f.label));
  const top = metrics.find((f) => f.kind === "METRIC") ?? metrics[0] ?? null;
  const scienceDoc = !!doc && SCIENCE_DOCS.includes(doc.docType);
  if (scienceDoc) {
    const v = await w.tx.documentVersion.findFirst({ where: { documentId: doc!.id }, orderBy: { version: "desc" }, select: { version: true, isSignificant: true } });
    if (v && v.version > 1 && !v.isSignificant) return;
  } else if (!top || !(w.classification.category === "SCIENTIFIC_LEADERSHIP" || w.extraction.activityTags.includes("SCIENTIFIC"))) {
    return;
  }
  if (!top && !scienceDoc) return;
  // One insight per reported result: the deck, the report and the email quoting the same AUC corroborate it.
  const subject = top ? metricKey(top.label, top.value) : `doc:${doc!.id}`;
  const text = `${top?.label ?? ""} ${doc?.title ?? w.item.title}`;
  const milestone = w.refs.milestones
    .filter((m) => ["AI_MODEL", "SCIENTIFIC_VALIDATION", "PUBLICATION", "THERAPEUTIC"].includes(m.type))
    .map((m) => ({ m, s: tokenCoverage(text, m.title) }))
    .filter((x) => x.s >= 0.3)
    .sort((a, b) => b.s - a.s)[0]?.m;
  const label = top ? `${top.label}: ${top.value}` : `${DOCUMENT_TYPES[doc!.docType].label} — ${documentShortTitle(doc!.title)}`;
  await raiseChange(w, {
    changeKind: "new_scientific_result",
    fingerprint: `change:new_scientific_result:${subject}`,
    title: `Important change: New scientific result — ${label}`,
    summary: `${w.extraction.summary || w.item.title}${milestone ? ` Relevant to the milestone “${milestone.title}” (due ${formatDay(milestone.dueDate)}).` : ""}`.trim(),
    recommendation: milestone ? "Check whether this moves the milestone and update investors or customers who are waiting on it." : "Review with the scientific lead and decide who needs to know.",
    importance: milestone ? 4 : 3,
    requiresCeo: !!milestone,
    links: { documentId: doc?.id ?? null, milestoneId: milestone?.id ?? null, goalId: milestone?.goalId ?? null, companyId: w.resolution.primaryCompanyId },
    excerpt: top?.evidence ?? null,
    corroborateOnly: true,
  });
}

async function newRisks(w: ItemCtx) {
  for (const r of w.written.risks) {
    if (!r.created || r.severity < 4) continue;
    const company = r.companyId ? w.refs.companies.get(r.companyId) : null;
    await raiseChange(w, {
      changeKind: "new_risk",
      fingerprint: `change:new_risk:${r.id}`,
      title: `Important change: New ${r.severity >= 5 ? "critical" : "serious"} risk${company ? ` at ${companyShortName(company.name)}` : ""} — ${r.title}`,
      summary: `Severity ${r.severity}/5, identified from ${w.item.title}.`,
      recommendation: "Name an owner and a mitigation; decide whether the board or the customer needs to hear it from you.",
      importance: r.severity,
      requiresCeo: true,
      links: { riskId: r.id, companyId: r.companyId },
    });
  }
}

async function newInvestor(w: ItemCtx) {
  const pending = await w.tx.reviewQueueItem.findMany({ where: { sourceItemId: w.item.id, kind: "NEW_INVESTOR", status: "PENDING" }, select: { id: true, proposal: true, fingerprint: true } });
  for (const r of pending) {
    const p = (r.proposal ?? {}) as { name?: string; domain?: string | null; personIds?: string[] };
    const contact = p.personIds?.[0] ? await w.tx.person.findUnique({ where: { id: p.personIds[0] }, select: { id: true, name: true } }) : null;
    await raiseChange(w, {
      changeKind: "new_investor",
      fingerprint: `change:new_investor:${p.domain ?? r.fingerprint}`,
      title: `Important change: Possible new investor — ${p.name ?? p.domain ?? "unknown"}${contact ? ` (${contact.name})` : ""}`,
      summary: `${contact ? `${conversationalName(contact.name)} at ` : ""}${p.name ?? "An unknown firm"}${p.domain ? ` (${p.domain})` : ""} reached out in “${w.item.title}”. It is not in the investor pipeline yet.`,
      recommendation: "Confirm it in the Brain Review Queue, then decide whether it belongs in this round.",
      // An investor reaching out about the live round, on a loud source, is for today.
      importance: w.classification.relevance === "HIGH" || w.classification.relevance === "CRITICAL" ? 5 : 4,
      requiresCeo: true,
      links: { personId: contact?.id ?? null },
    });
  }
}

async function contractSigned(w: ItemCtx) {
  const companyId = w.resolution.primaryCompanyId;
  if (!companyId) return;
  const company = w.refs.companies.get(companyId);
  if (!company) return;
  const text = `${w.item.title}\n${w.item.text ?? ""}`;
  const hit = signedSentence(text);
  if (!hit) return;
  const short = companyShortName(company.name);
  const deal = dealFor(w, companyId);
  const lower = short.toLowerCase();
  const milestone = w.refs.milestones.find((m) => ["PHARMA_CONTRACT", "PARTNERSHIP", "FUNDRAISING"].includes(m.type) && m.title.toLowerCase().includes(lower));
  await raiseChange(w, {
    changeKind: "contract_status_changed",
    fingerprint: `change:contract_status_changed:${companyId}:${hit.contract.toLowerCase()}`,
    title: `Important change: ${short} ${hit.contract} signed`,
    summary: `${hit.sentence}${milestone ? ` This should complete the milestone “${milestone.title}”.` : ""}`,
    recommendation: milestone ? "Approve completing the milestone in the Review Queue and update the deal stage and forecast." : "Update the deal stage and plan the kickoff.",
    importance: 5,
    requiresCeo: true,
    links: { companyId, dealId: deal?.id ?? null, milestoneId: milestone?.id ?? null, goalId: milestone?.goalId ?? null },
    excerpt: hit.sentence,
    confidence: 0.85,
  });
  if (milestone) {
    await queueReview(w, {
      kind: "FIELD_CHANGE",
      title: `Complete milestone? ${milestone.title}`,
      reason: PROTECTED_REASONS.MILESTONE_COMPLETE,
      impact: 5,
      confidenceScore: 0.85,
      proposal: { targetType: "MILESTONE", targetId: milestone.id, targetLabel: milestone.title, field: "status", from: milestone.status, to: "COMPLETED", fromLabel: milestone.status, toLabel: "Completed", changeKind: "contract_status_changed", note: hit.sentence, confidence: 0.85, evidence: hit.sentence },
      targetType: "MILESTONE",
      targetId: milestone.id,
      excerpt: hit.sentence,
      fingerprint: `field:MILESTONE:${milestone.id}:status:COMPLETED`,
      sensitivity: w.item.sensitivity,
    });
  }
}
