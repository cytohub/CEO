/**
 * Commitment lifecycle after creation:
 *  - fulfilment detection — a later message in the same thread (or to the
 *    same counterparty) that delivers the promised thing closes it ("as
 *    promised, attached is the revised data package"); uncertain matches go
 *    to review as "Mark fulfilled?";
 *  - the daily sweep — overdue promises the CEO owes, and promises owed to
 *    CytoHub that need a follow-up, become insights and (per the attention
 *    rules) inbox items.
 */
import { addDays, daysBetween, formatDay, toDay } from "@/lib/dates";
import { companyShortName, conversationalName } from "../resolve/names";
import type { PipelineContext } from "../types";
import { upsertInboxItem } from "./attention";
import { BRAIN_ACTOR, emptyCounters, emptySummary, type WriteEnv } from "./env";
import { upsertInsight } from "./insights";
import type { ItemCtx } from "./item";
import { hasReferenceFrom } from "./provenance";
import { actionClause, actionWithRecipient, cleanTitle, fulfilmentMatch, hasDeliveryCue } from "./phrasing";
import { fulfillCommitment } from "./records";
import { queueReview } from "./review";
import { lockBrainWrites } from "./lock";

export async function detectFulfillment(w: ItemCtx) {
  const msg = w.item.emailMessage;
  if (!msg || !w.item.text) return;
  const outbound = msg.direction === "OUTBOUND" || msg.direction === "INTERNAL";
  const sender = w.resolution.people.find((p) => p.role === "SENDER");
  const recipients = w.resolution.people.filter((p) => p.role === "RECIPIENT" || p.role === "CC").map((p) => p.id);
  const or: object[] = [{ threadId: msg.threadId }];
  if (outbound) {
    if (recipients.length) or.push({ counterpartyPersonId: { in: recipients } });
  } else if (sender) {
    or.push({ ownerPersonId: sender.id });
  }
  if (w.resolution.primaryCompanyId) or.push({ companyId: w.resolution.primaryCompanyId });

  const candidates = await w.tx.commitment.findMany({
    where: { status: "OPEN", direction: outbound ? { in: ["OUTBOUND", "INTERNAL"] } : "INBOUND", committedAt: { lt: w.item.occurredAt }, OR: or },
    select: { id: true, title: true, threadId: true, text: true },
    take: 50,
  });
  const attachments = msg.attachments.map((a) => a.filename);
  for (const c of candidates) {
    // Never let the message that created a promise also fulfil it.
    if (w.written.commitments.some((x) => x.id === c.id && x.created)) continue;
    if (await hasReferenceFrom(w.tx, "COMMITMENT", c.id, w.item.id)) continue;
    const { coverage, cue } = fulfilmentMatch(c.title, w.item.text, attachments);
    const sameThread = c.threadId === msg.threadId;
    if (cue && coverage >= 0.6 && sameThread) {
      const excerpt = w.item.text.split(/\n+/).find((l) => hasDeliveryCue(l)) ?? w.item.snippet ?? null;
      await fulfillCommitment(w, c.id, `Fulfilled by “${w.item.title}” (${formatDay(toDay(w.item.occurredAt, w.timezone))}).`, excerpt);
    } else if ((cue && coverage >= 0.5) || coverage >= 0.75) {
      await queueReview(w, {
        kind: "FIELD_CHANGE",
        title: `Mark fulfilled? ${c.title}`,
        reason: `“${w.item.title}” looks like it delivers this ${outbound ? "promise" : "promised item"}, but the match is not certain.`,
        impact: 3,
        confidenceScore: Math.min(0.79, 0.4 + coverage / 2),
        proposal: { targetType: "COMMITMENT", targetId: c.id, targetLabel: c.title, field: "status", from: "OPEN", to: "FULFILLED", fromLabel: "Open", toLabel: "Fulfilled", changeKind: "commitment_fulfilled", note: `Delivered by “${w.item.title}”.`, confidence: Math.min(0.79, 0.4 + coverage / 2), evidence: w.item.snippet ?? null },
        targetType: "COMMITMENT",
        targetId: c.id,
        excerpt: w.item.snippet,
        fingerprint: `field:COMMITMENT:${c.id}:status:FULFILLED`,
        sensitivity: w.item.sensitivity,
      });
    }
  }
}

// ─── Daily sweep ─────────────────────────────────────────────────────────────

/** Daily pass: surface overdue commitments (both directions) as insights / inbox items. */
export async function sweepCommitments(ctx: PipelineContext): Promise<{ overdue: number; insights: number; inbox: number }> {
  const today = ctx.ceo.today;
  const soon = addDays(today, 2);
  const open = await ctx.db.commitment.findMany({
    where: {
      status: "OPEN",
      OR: [{ dueDate: { lt: today } }, { followUpDate: { lte: today } }, { direction: { not: "INBOUND" }, ownerPersonId: ctx.ceo.personId, dueDate: { lte: soon } }],
    },
    include: {
      owner: { select: { id: true, name: true } },
      counterparty: { select: { id: true, name: true } },
      company: { select: { id: true, name: true, type: true } },
      deal: { select: { id: true, name: true, value: true } },
    },
    orderBy: { dueDate: "asc" },
    take: 300,
  });
  const result = { overdue: 0, insights: 0, inbox: 0 };
  if (!open.length) return result;

  await ctx.db.$transaction(
    async (tx) => {
      await lockBrainWrites(tx);
      const env: WriteEnv = {
        tx,
        now: ctx.now,
        today,
        timezone: ctx.ceo.timezone,
        ceo: { personId: ctx.ceo.personId, userId: ctx.ceo.userId, name: ctx.ceo.name, email: ctx.ceo.email },
        actor: BRAIN_ACTOR,
        source: null,
        engine: null,
        relevance: null,
        summary: emptySummary(),
        counters: emptyCounters(),
      };
      for (const c of open) {
        const ceoOwes = c.ownerPersonId === ctx.ceo.personId && c.direction !== "INBOUND";
        const company = c.company ? companyShortName(c.company.name) : null;
        const key = c.company?.type === "CUSTOMER" || c.company?.type === "INVESTOR" || c.company?.type === "PROSPECT" || !!c.deal;
        const links = { commitmentId: c.id, companyId: c.companyId, taskId: c.taskId, dealId: c.dealId };

        if (c.direction !== "INBOUND") {
          const late = c.dueDate ? daysBetween(c.dueDate, today) : 0;
          // Never print "Someone"/"them": name the counterparty when known, otherwise leave it out.
          const party = (c.counterparty && c.counterpartyPersonId !== ctx.ceo.personId ? conversationalName(c.counterparty.name) : null) ?? company;
          const first = c.counterparty && c.counterpartyPersonId !== ctx.ceo.personId ? conversationalName(c.counterparty.name).split(" ")[0] : null;
          const what = cleanTitle(c.title);
          if (c.dueDate && late > 0) {
            result.overdue++;
            const insight = await upsertInsight(env, {
              type: "COMMITMENT",
              fingerprint: `commitment:overdue:${c.id}`,
              title: ceoOwes ? `Overdue: you promised ${party ? `${party} ` : ""}“${what}”` : `Overdue: ${c.owner ? conversationalName(c.owner.name) : "the team"} owes ${party ? `${party} ` : ""}“${what}”`,
              summary: `Due ${formatDay(c.dueDate)} (${late} day${late === 1 ? "" : "s"} ago)${c.dueText ? ` — “${c.dueText}”` : ""}.`,
              recommendation: ceoOwes ? `${actionWithRecipient(c.title, first)} today${first ? `, or tell ${first} when it will arrive` : ""}.` : `Check with ${c.owner ? conversationalName(c.owner.name).split(" ")[0] : "the owner"} and agree a new date.`,
              importance: ceoOwes ? (late >= 2 || key ? 5 : 4) : 3,
              requiresCeo: ceoOwes,
              links: { ...links, personId: c.counterpartyPersonId },
              occurredAt: c.dueDate,
            });
            if (insight) result.insights++;
            if (ceoOwes) {
              const r = await upsertInboxItem(env, {
                fingerprint: `inbox:commitment:${c.id}`,
                type: "COMMITMENT",
                level: "IMMEDIATE",
                title: party ? `You owe ${party}: ${what}` : `You promised: ${what}`,
                whyCeo: `You promised ${party ? `${party} ` : ""}to ${actionClause(c.title)} by ${formatDay(c.dueDate)}; it is ${late} day${late === 1 ? "" : "s"} overdue.`,
                recommendedAction: `${actionWithRecipient(c.title, first)} today${first ? `, or tell ${first} when it will arrive` : ""}.`,
                dueDate: c.dueDate,
                confidence: c.confidence,
                links: { ...links, personId: c.counterpartyPersonId, insightId: insight?.id ?? null },
              });
              if (r?.created) result.inbox++;
            }
          } else if (ceoOwes && c.dueDate) {
            // Due within two days: on the CEO's radar today.
            const r = await upsertInboxItem(env, {
              fingerprint: `inbox:commitment:${c.id}`,
              type: "COMMITMENT",
              level: "TODAY",
              title: party ? `You owe ${party}: ${what}` : `You promised: ${what}`,
              whyCeo: `You promised ${party ? `${party} ` : ""}to ${actionClause(c.title)} by ${formatDay(c.dueDate)}.`,
              recommendedAction: `${actionWithRecipient(c.title, first)} by ${formatDay(c.dueDate)} — block the time now.`,
              dueDate: c.dueDate,
              confidence: c.confidence,
              links: { ...links, personId: c.counterpartyPersonId },
            });
            if (r?.created) result.inbox++;
          }
          continue;
        }

        // Owed to us: chase once the follow-up date has arrived.
        const chaseFrom = c.followUpDate ?? (c.dueDate ? addDays(c.dueDate, 1) : null);
        if (!chaseFrom || chaseFrom > today) continue;
        result.overdue++;
        const owner = (c.owner ? conversationalName(c.owner.name) : null) ?? company ?? "They";
        const importance = key ? 4 : 3;
        const insight = await upsertInsight(env, {
          type: "FOLLOW_UP",
          fingerprint: `commitment:follow-up:${c.id}`,
          title: `Follow up: ${owner}${company && c.owner ? ` (${company})` : ""} hasn't delivered “${c.title}”`,
          summary: c.dueDate ? `Promised by ${formatDay(c.dueDate)}${c.dueText ? ` (“${c.dueText}”)` : ""}.` : "Promised without a firm date.",
          recommendation: `Send ${owner.split(" ")[0]} a short nudge${c.deal ? ` — it gates ${c.deal.name}` : ""}.`,
          importance,
          requiresCeo: importance >= 4 && c.counterpartyPersonId === ctx.ceo.personId,
          links: { ...links, personId: c.ownerPersonId },
          occurredAt: chaseFrom,
        });
        if (insight) result.insights++;
        if (importance >= 4 && c.counterpartyPersonId === ctx.ceo.personId) {
          const r = await upsertInboxItem(env, {
            fingerprint: `inbox:commitment:${c.id}`,
            type: c.company?.type === "INVESTOR" ? "INVESTOR_FOLLOW_UP" : "RESPONSE",
            level: "TODAY",
            title: `Follow up with ${owner}: ${c.title}`,
            whyCeo: `${owner}${company && c.owner ? ` (${company})` : ""} promised you “${c.title}”${c.dueDate ? ` by ${formatDay(c.dueDate)}` : ""} and it hasn't arrived.`,
            recommendedAction: `Nudge ${owner.split(" ")[0]} today.`,
            dueDate: today,
            confidence: c.confidence,
            links: { ...links, personId: c.ownerPersonId, insightId: insight?.id ?? null },
          });
          if (r?.created) result.inbox++;
        }
      }
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
  if (result.insights || result.inbox) ctx.log("COMMITMENT_SWEEP", `${result.overdue} overdue, ${result.insights} insights, ${result.inbox} new inbox items`);
  return result;
}
