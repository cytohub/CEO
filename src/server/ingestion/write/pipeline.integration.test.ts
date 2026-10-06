/**
 * End-to-end test of resolution → relationships → Brain write against a
 * seeded database. It writes to the database, so it only runs when
 * INGEST_INTEGRATION=1 and DATABASE_URL points at a disposable copy:
 *
 *   INGEST_INTEGRATION=1 DATABASE_URL=… node --import tsx --test src/server/ingestion/write/pipeline.integration.test.ts
 *
 * The extraction stage is simulated: EntityMention rows + stageData are
 * written by hand and hand-written extractions pass through validateExtraction.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import type { Classification, MentionDraft } from "../types";

const enabled = process.env.INGEST_INTEGRATION === "1";

type Mods = {
  db: typeof import("@/lib/db").db;
  ctx: Awaited<ReturnType<typeof import("../context").createPipelineContext>>;
  loadSourceItem: typeof import("../types").loadSourceItem;
  resolveMentions: typeof import("../resolve/entities").resolveMentions;
  mapSourceRelationships: typeof import("../resolve/relationships").mapSourceRelationships;
  writeIntelligence: typeof import("./writer").writeIntelligence;
  validateExtraction: typeof import("../extraction-schema").validateExtraction;
  emptyExtraction: typeof import("../extraction-schema").emptyExtraction;
  resolveReviewItem: typeof import("./review").resolveReviewItem;
  sweepCommitments: typeof import("./commitments").sweepCommitments;
  markCompletedMeetings: typeof import("./meetings").markCompletedMeetings;
  graph: typeof import("../graph");
  dates: typeof import("@/lib/dates");
};

let m: Mods;
let connectionId = "";
let calendarConnectionId = "";
let docConnectionId = "";
const run = randomUUID().slice(0, 8);
let seq = 0;
const ids: Record<string, string> = {};

const CEO = { name: "CEO", email: "ceo@cytohub.example" };
const HENRIK = { name: "Dr. Henrik Sørensen", email: "henrik@calder.example" };

function classification(partial: Partial<Classification>): Classification {
  return { relevance: "NORMAL", relevanceScore: 0.6, category: "OTHER", reasons: [], sensitivity: "CONFIDENTIAL", isNoise: false, activityTags: [], ...partial };
}

function person(p: { name: string; email: string }, role: MentionDraft["role"]): MentionDraft {
  return { entityType: "PERSON", text: p.name, email: p.email, domain: p.email.split("@")[1], role, confidence: 1 };
}

async function writeMentions(itemId: string, mentions: MentionDraft[]) {
  await m.db.entityMention.createMany({
    data: mentions.map((x) => ({ sourceItemId: itemId, entityType: x.entityType, text: x.text, normalized: x.text.toLowerCase(), email: x.email ?? null, role: x.role, confidence: x.confidence })),
  });
}

async function email(opts: {
  thread: string;
  subject: string;
  from: { name: string; email: string };
  to: { name: string; email: string }[];
  body: string;
  sentAt: Date;
  direction: "INBOUND" | "OUTBOUND" | "INTERNAL";
  cls: Partial<Classification>;
  mentions: MentionDraft[];
  attachments?: string[];
}): Promise<string> {
  const n = ++seq;
  const thread = await m.db.emailThread.upsert({
    where: { connectionId_externalThreadId: { connectionId, externalThreadId: `${run}-${opts.thread}` } },
    create: { connectionId, externalThreadId: `${run}-${opts.thread}`, subject: opts.subject, firstMessageAt: opts.sentAt, lastMessageAt: opts.sentAt, messageCount: 1, participants: [] },
    update: { lastMessageAt: opts.sentAt, messageCount: { increment: 1 } },
  });
  const cls = classification(opts.cls);
  const item = await m.db.sourceItem.create({
    data: {
      connectionId,
      kind: "EMAIL_MESSAGE",
      externalId: `${run}-msg-${n}`,
      title: opts.subject,
      occurredAt: opts.sentAt,
      contentHash: randomUUID(),
      text: opts.body,
      snippet: opts.body.slice(0, 200),
      status: "PROCESSING",
      stage: "ENTITIES_EXTRACTED",
      relevance: cls.relevance,
      category: cls.category,
      stageData: { mentions: opts.mentions, classification: cls } as object,
    },
  });
  await m.db.emailMessage.create({
    data: {
      sourceItemId: item.id,
      threadId: thread.id,
      externalMessageId: `${run}-m-${n}`,
      fromName: opts.from.name,
      fromEmail: opts.from.email,
      to: opts.to,
      cc: [],
      subject: opts.subject,
      sentAt: opts.sentAt,
      direction: opts.direction,
      labels: [],
      hasAttachments: !!opts.attachments?.length,
      attachments: { create: (opts.attachments ?? []).map((f) => ({ filename: f, mimeType: "application/pdf", sizeBytes: 1000 })) },
    },
  });
  await writeMentions(item.id, opts.mentions);
  return item.id;
}

/** Run resolution → relationships → (validated) extraction → write, like the pipeline stages do. */
async function processItem(itemId: string, raw: Record<string, unknown>) {
  const item = (await m.loadSourceItem(m.db, itemId))!;
  const stage = (item.stageData ?? {}) as { classification: Classification };
  const resolution = await m.resolveMentions(m.ctx, item);
  await m.db.sourceItem.update({ where: { id: itemId }, data: { stageData: { ...(item.stageData as object), resolution } as object } });
  const edges = await m.mapSourceRelationships(m.ctx, (await m.loadSourceItem(m.db, itemId))!, resolution);
  const { extraction, issues } = m.validateExtraction({ ...m.emptyExtraction(), ...raw }, item.text ?? "", m.ctx.now);
  assert.deepEqual(issues, [], "hand-written extraction must validate");
  await m.db.sourceItem.update({ where: { id: itemId }, data: { extraction: extraction as object, extractionEngine: "rules" } });
  const loaded = (await m.loadSourceItem(m.db, itemId))!;
  const summary = await m.writeIntelligence(m.ctx, loaded, extraction, resolution, stage.classification);
  return { resolution, edges, summary, extraction };
}

async function rewrite(itemId: string) {
  const item = (await m.loadSourceItem(m.db, itemId))!;
  const stage = item.stageData as { classification: Classification; resolution: Parameters<Mods["writeIntelligence"]>[3] };
  return m.writeIntelligence(m.ctx, item, item.extraction as never, stage.resolution, stage.classification);
}

const day = (offset: number) => m.dates.dayKey(m.dates.addDays(m.ctx.ceo.today, offset));
/** Next weekday (1 = Monday … 5 = Friday) strictly after today. */
function nextWeekday(dow: number): string {
  for (let i = 1; i <= 7; i++) if (m.dates.addDays(m.ctx.ceo.today, i).getUTCDay() === dow) return day(i);
  throw new Error("unreachable");
}

describe("ingestion resolve & write (integration)", { skip: !enabled && "set INGEST_INTEGRATION=1 with a disposable DATABASE_URL" }, () => {
  before(async () => {
    const [{ db }, context, types, entities, relationships, writer, schema, review, commitments, meetings, graph, dates] = await Promise.all([
      import("@/lib/db"),
      import("../context"),
      import("../types"),
      import("../resolve/entities"),
      import("../resolve/relationships"),
      import("./writer"),
      import("../extraction-schema"),
      import("./review"),
      import("./commitments"),
      import("./meetings"),
      import("../graph"),
      import("@/lib/dates"),
    ]);
    m = {
      db,
      ctx: await context.createPipelineContext({ trigger: "MANUAL" }),
      loadSourceItem: types.loadSourceItem,
      resolveMentions: entities.resolveMentions,
      mapSourceRelationships: relationships.mapSourceRelationships,
      writeIntelligence: writer.writeIntelligence,
      validateExtraction: schema.validateExtraction,
      emptyExtraction: schema.emptyExtraction,
      resolveReviewItem: review.resolveReviewItem,
      sweepCommitments: commitments.sweepCommitments,
      markCompletedMeetings: meetings.markCompletedMeetings,
      graph,
      dates,
    };
    connectionId = (await db.sourceConnection.create({ data: { kind: "EMAIL", provider: "GMAIL", mode: "DEMO", label: `Integration ${run}`, accountEmail: CEO.email } })).id;
    calendarConnectionId = (await db.sourceConnection.create({ data: { kind: "CALENDAR", provider: "GOOGLE_CALENDAR", mode: "DEMO", label: `Integration cal ${run}`, accountEmail: CEO.email } })).id;
    docConnectionId = (await db.sourceConnection.create({ data: { kind: "DOCUMENTS", provider: "GOOGLE_DRIVE", mode: "DEMO", label: `Integration docs ${run}`, accountEmail: CEO.email } })).id;
  });

  after(async () => {
    await m?.db.$disconnect();
  });

  it("customer ask → CEO task, inbound commitment, change insight, inbox, provenance", async () => {
    const friday = nextWeekday(5);
    const wednesday = nextWeekday(3);
    const body =
      "Hi,\n\nCould you send the revised data package by Friday? We need it before our steering committee.\nOn our side, our team will send the signed SOW by next Wednesday.\n\nBest,\nHenrik";
    ids.ask = await email({
      thread: "calder",
      subject: "Calder study — revised data package",
      from: HENRIK,
      to: [CEO],
      body,
      sentAt: new Date(m.ctx.now.getTime() - 3_600_000),
      direction: "INBOUND",
      cls: { relevance: "HIGH", relevanceScore: 0.85, category: "CUSTOMER" },
      mentions: [person(HENRIK, "SENDER"), person(CEO, "RECIPIENT"), { entityType: "COMPANY", text: "Calder", domain: "calder.example", role: "SENDER", confidence: 1 }, { entityType: "PERSON", text: "Maya", role: "MENTIONED", confidence: 0.6 }],
    });
    const { resolution, edges, summary } = await processItem(ids.ask, {
      summary: "Henrik asks the CEO for the revised data package by Friday and promises the signed SOW by next Wednesday.",
      ceoRelevance: { level: "HIGH", score: 0.85, category: "CUSTOMER", reasons: ["Customer asks the CEO directly"] },
      strategicRelevance: { score: 0.6, goalTitles: ["Reach $6M ARR by year-end"], pillarNames: [] },
      tasks: [{ title: "Send the revised data package", description: null, ownerName: null, ownerIsCeo: true, dueDate: friday, dueText: "by Friday", priorityHint: null, companyName: "Calder", focusArea: null, confidence: 0.9, evidence: "Could you send the revised data package by Friday?" }],
      commitments: [{ direction: "INBOUND", title: "Send the signed SOW", text: "our team will send the signed SOW by next Wednesday", owedByName: "Henrik", owedToName: null, companyName: "Calder", dueDate: wednesday, dueText: "by next Wednesday", confidence: 0.85, evidence: "our team will send the signed SOW by next Wednesday" }],
    });

    const calder = await m.db.company.findFirstOrThrow({ where: { domain: "calder.example" } });
    assert.equal(resolution.primaryCompanyId, calder.id);
    const henrik = resolution.people.find((p) => p.email === HENRIK.email);
    assert.equal(henrik?.resolution, "RESOLVED");
    assert.equal(resolution.people.find((p) => p.isCeo)?.role, "RECIPIENT");
    assert.ok(resolution.people.some((p) => p.label.includes("Maya")), "first name resolves within the CytoHub team");
    assert.ok(edges >= 4, `edges ${edges}`);
    const thread = await m.db.emailThread.findFirstOrThrow({ where: { externalThreadId: `${run}-calder` } });
    assert.equal(thread.companyId, calder.id);

    const task = await m.db.task.findFirstOrThrow({ where: { sourceRef: `source:${ids.ask}` }, include: { people: true } });
    ids.task = task.id;
    assert.equal(task.ownerId, m.ctx.ceo.personId);
    assert.equal(m.dates.dayKey(task.dueDate!), friday);
    assert.equal(task.priority, "P1");
    assert.equal(task.focusArea, "CUSTOMERS");
    assert.equal(task.companyId, calder.id);
    assert.equal(task.ceoUniqueness, 5);
    assert.equal(task.extractionConfidence, "HIGH");
    assert.ok(task.people.some((p) => p.id === henrik!.id));
    assert.ok(task.description?.includes("revised data package"));

    const inbound = await m.db.commitment.findFirstOrThrow({ where: { direction: "INBOUND", threadId: thread.id } });
    assert.equal(inbound.ownerPersonId, henrik!.id);
    assert.equal(inbound.counterpartyPersonId, m.ctx.ceo.personId);
    assert.ok(inbound.followUpDate! > inbound.dueDate!);
    assert.equal(inbound.taskId, null, "inbound promises are not CEO tasks");

    const refs = await m.db.sourceReference.findMany({ where: { sourceItemId: ids.ask } });
    for (const t of ["TASK", "COMMITMENT", "INSIGHT", "INBOX_ITEM"]) assert.ok(refs.some((r) => r.targetType === t && r.role === "CREATED_FROM"), `provenance for ${t}`);
    assert.ok(refs.every((r) => r.provider === "GMAIL" && r.sourceTitle === "Calder study — revised data package"));
    assert.ok(await m.db.activity.count({ where: { taskId: task.id, type: "TASK_CREATED", actor: "CytoHub Brain", sourceItemId: ids.ask } }));
    assert.ok(await m.db.activity.count({ where: { commitmentId: inbound.id, type: "COMMITMENT_CREATED" } }));

    const change = await m.db.brainInsight.findFirstOrThrow({ where: { sourceItemId: ids.ask, changeKind: "customer_deliverable_requested" } });
    assert.match(change.title, /^Important change: Calder requested the revised data package by /);
    assert.equal(change.type, "CHANGE");

    const inbox = await m.db.inboxItem.findUniqueOrThrow({ where: { fingerprint: `inbox:thread:${thread.id}` } });
    assert.equal(inbox.type, "REQUEST");
    assert.match(inbox.whyCeo, /Henrik Sørensen \(Calder Biosciences — customer, \$350K paid validation study\) asked you directly to send the revised data package by Friday\./);
    assert.ok(inbox.attention === "TODAY" || inbox.attention === "IMMEDIATE");
    assert.equal(inbox.taskId, task.id);
    const item = await m.db.sourceItem.findUniqueOrThrow({ where: { id: ids.ask } });
    assert.equal(item.attention, inbox.attention);
    assert.ok(summary.created.some((c) => c.type === "TASK"));
  });

  it("re-processing the same item creates nothing new", async () => {
    const before = {
      tasks: await m.db.task.count(),
      commitments: await m.db.commitment.count(),
      inbox: await m.db.inboxItem.count(),
      insights: await m.db.brainInsight.count(),
      refs: await m.db.sourceReference.count(),
      reviews: await m.db.reviewQueueItem.count(),
    };
    const dupBefore = m.ctx.counters.duplicatesPrevented;
    const summary = await rewrite(ids.ask);
    assert.equal(summary.created.length, 0);
    assert.ok(summary.duplicatesPrevented >= 2, `duplicates ${summary.duplicatesPrevented}`);
    assert.ok(m.ctx.counters.duplicatesPrevented > dupBefore);
    assert.deepEqual(
      {
        tasks: await m.db.task.count(),
        commitments: await m.db.commitment.count(),
        inbox: await m.db.inboxItem.count(),
        insights: await m.db.brainInsight.count(),
        refs: await m.db.sourceReference.count(),
        reviews: await m.db.reviewQueueItem.count(),
      },
      before,
    );
  });

  it("a moved deadline on P1 work goes to review; approval applies it with history", async () => {
    const monday = nextWeekday(1);
    const body = "Quick update — could you send the revised data package by Monday instead? Our committee moved.";
    ids.move = await email({
      thread: "calder",
      subject: "Re: Calder study — revised data package",
      from: HENRIK,
      to: [CEO],
      body,
      sentAt: new Date(m.ctx.now.getTime() - 1_800_000),
      direction: "INBOUND",
      cls: { relevance: "HIGH", category: "CUSTOMER" },
      mentions: [person(HENRIK, "SENDER"), person(CEO, "RECIPIENT")],
    });
    await processItem(ids.move, {
      tasks: [{ title: "Send the revised data package", description: null, ownerName: null, ownerIsCeo: true, dueDate: monday, dueText: "by Monday", priorityHint: null, companyName: null, focusArea: null, confidence: 0.9, evidence: "could you send the revised data package by Monday instead?" }],
    });
    const tasks = await m.db.task.count({ where: { title: "Send the revised data package" } });
    assert.equal(tasks, 1, "deduplicated into the existing task");
    const review = await m.db.reviewQueueItem.findFirstOrThrow({ where: { kind: "FIELD_CHANGE", targetId: ids.task, status: "PENDING" } });
    assert.equal((review.proposal as { to: string }).to, monday);
    assert.ok(await m.db.brainInsight.count({ where: { changeKind: "deadline_moved", taskId: ids.task } }));
    assert.ok(await m.db.sourceReference.count({ where: { targetType: "TASK", targetId: ids.task, sourceItemId: ids.move, role: "CORROBORATED_BY" } }));

    const ceoUser = await m.db.user.findFirstOrThrow({ where: { role: "CEO" } });
    const out = await m.resolveReviewItem(review.id, { action: "APPROVE" }, { userId: ceoUser.id, email: ceoUser.email });
    assert.deepEqual(out, { status: "APPROVED", resultType: "TASK", resultId: ids.task });
    const task = await m.db.task.findUniqueOrThrow({ where: { id: ids.task } });
    assert.equal(m.dates.dayKey(task.dueDate!), monday);
    assert.ok(await m.db.activity.count({ where: { taskId: ids.task, type: "DEADLINE_CHANGED" } }));
    assert.ok(await m.db.activity.count({ where: { taskId: ids.task, type: "REVIEW_RESOLVED", actor: "CEO" } }));
    assert.ok(await m.db.auditLog.count({ where: { action: "review.resolve", targetId: review.id } }));
    await assert.rejects(() => m.resolveReviewItem(review.id, { action: "APPROVE" }, { userId: ceoUser.id, email: ceoUser.email }), /already been resolved/);
  });

  it("a CEO promise mirrors the existing task, and a later delivery fulfils both", async () => {
    const monday = nextWeekday(1);
    ids.promise = await email({
      thread: "calder",
      subject: "Re: Calder study — revised data package",
      from: CEO,
      to: [HENRIK],
      body: "Henrik — no problem. I'll send the revised data package by Monday.",
      sentAt: new Date(m.ctx.now.getTime() - 1_200_000),
      direction: "OUTBOUND",
      cls: { relevance: "HIGH", category: "CUSTOMER" },
      mentions: [person(CEO, "SENDER"), person(HENRIK, "RECIPIENT")],
    });
    await processItem(ids.promise, {
      commitments: [{ direction: "OUTBOUND", title: "Send the revised data package", text: "I'll send the revised data package by Monday.", owedByName: null, owedToName: "Henrik", companyName: null, dueDate: monday, dueText: "by Monday", confidence: 0.9, evidence: "I'll send the revised data package by Monday." }],
    });
    const c = await m.db.commitment.findFirstOrThrow({ where: { direction: "OUTBOUND", title: "Send the revised data package" } });
    assert.equal(c.ownerPersonId, m.ctx.ceo.personId);
    assert.equal(c.taskId, ids.task, "the existing task became the mirror");
    const mirrored = await m.db.task.findUniqueOrThrow({ where: { id: ids.task } });
    assert.equal(mirrored.hardDeadline, true);
    assert.equal(mirrored.ceoUniqueness, 5);

    ids.delivery = await email({
      thread: "calder",
      subject: "Re: Calder study — revised data package",
      from: CEO,
      to: [HENRIK],
      body: "Henrik — as promised, attached is the revised data package. Happy to walk your team through it.",
      sentAt: new Date(m.ctx.now.getTime() - 600_000),
      direction: "OUTBOUND",
      cls: { relevance: "NORMAL", category: "CUSTOMER" },
      mentions: [person(CEO, "SENDER"), person(HENRIK, "RECIPIENT")],
      attachments: ["Calder_revised_data_package.pdf"],
    });
    await processItem(ids.delivery, {});
    const done = await m.db.commitment.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(done.status, "FULFILLED");
    assert.ok(done.fulfilledAt);
    assert.equal((await m.db.task.findUniqueOrThrow({ where: { id: ids.task } })).status, "DONE");
    assert.ok(await m.db.activity.count({ where: { commitmentId: c.id, type: "COMMITMENT_FULFILLED" } }));
    assert.ok(await m.db.sourceReference.count({ where: { targetType: "COMMITMENT", targetId: c.id, sourceItemId: ids.delivery, role: "UPDATED_FROM" } }));
  });

  it("an unknown fundraising domain is never auto-created: it goes to review, and approval creates the investor", async () => {
    const maria = { name: "Maria Okonkwo", email: `maria@orbit${run}ventures.example` };
    ids.investor = await email({
      thread: "orbit",
      subject: "Series B — Orbit Ventures",
      from: maria,
      to: [CEO],
      body: "Hi — we have followed CytoHub for a while and would love to explore leading or co-leading your Series B. Could we find 30 minutes next week?",
      sentAt: new Date(m.ctx.now.getTime() - 7_200_000),
      direction: "INBOUND",
      cls: { relevance: "HIGH", category: "FUNDRAISING" },
      mentions: [person(maria, "SENDER"), person(CEO, "RECIPIENT")],
    });
    const companiesBefore = await m.db.company.count();
    await processItem(ids.investor, {
      meetingRequests: [{ title: "Intro call about the Series B", withName: "Maria Okonkwo", proposedTimes: ["next week"], confidence: 0.85, evidence: "Could we find 30 minutes next week?" }],
    });
    assert.equal(await m.db.company.count(), companiesBefore, "no investor company auto-created");
    const p = await m.db.person.findUniqueOrThrow({ where: { email: maria.email } });
    assert.equal(p.type, "INVESTOR");
    assert.equal(p.companyId, null);
    const review = await m.db.reviewQueueItem.findUniqueOrThrow({ where: { fingerprint: `new-investor:orbit${run}ventures.example` } });
    assert.equal(review.kind, "NEW_INVESTOR");
    assert.deepEqual((review.proposal as { personIds: string[] }).personIds, [p.id]);
    assert.ok(await m.db.brainInsight.count({ where: { changeKind: "new_investor", sourceItemId: ids.investor } }));
    assert.ok(await m.db.task.count({ where: { title: "Schedule time with Maria Okonkwo", ownerId: m.ctx.ceo.personId } }));

    const ceoUser = await m.db.user.findFirstOrThrow({ where: { role: "CEO" } });
    const out = await m.resolveReviewItem(review.id, { action: "EDIT", edited: { name: "Orbit Ventures", createDeal: true } }, { userId: ceoUser.id, email: ceoUser.email });
    assert.equal(out.resultType, "COMPANY");
    const orbit = await m.db.company.findUniqueOrThrow({ where: { id: out.resultId! } });
    assert.equal(orbit.type, "INVESTOR");
    assert.equal((await m.db.person.findUniqueOrThrow({ where: { id: p.id } })).companyId, orbit.id);
    assert.ok(await m.db.entityAlias.count({ where: { entityType: "COMPANY", entityId: orbit.id, kind: "DOMAIN" } }));
    assert.ok(await m.db.deal.count({ where: { companyId: orbit.id, type: "FUNDRAISING" } }));
  });

  it("near-duplicate company and person go to ENTITY_MERGE review; merge re-points everything", async () => {
    const karen2 = { name: "Karen Liu", email: `karen.liu@brightwater${run}.example` };
    ids.bwDup = await email({
      thread: "bw-dup",
      subject: "Pilot data request",
      from: karen2,
      to: [CEO],
      body: "Hi — writing from our new address. Could you share the pilot onboarding checklist?",
      sentAt: new Date(m.ctx.now.getTime() - 9_000_000),
      direction: "INBOUND",
      cls: { relevance: "NORMAL", category: "COMMERCIAL_OPPORTUNITY" },
      mentions: [{ ...person(karen2, "SENDER"), companyHint: "Brightwater" }, person(CEO, "RECIPIENT")],
    });
    await processItem(ids.bwDup, {});
    const original = await m.db.company.findFirstOrThrow({ where: { domain: "brightwater.example" } });
    const dupCompany = await m.db.company.findFirstOrThrow({ where: { domain: `brightwater${run}.example` } });
    assert.equal(dupCompany.type, "PROSPECT");
    assert.ok(await m.db.activity.count({ where: { companyId: dupCompany.id, type: "ENTITY_CREATED" } }));
    const companyMerge = await m.db.reviewQueueItem.findFirstOrThrow({ where: { kind: "ENTITY_MERGE", status: "PENDING", proposal: { path: ["mergeId"], equals: dupCompany.id } } });
    const newKaren = await m.db.person.findUniqueOrThrow({ where: { email: karen2.email } });
    const oldKaren = await m.db.person.findUniqueOrThrow({ where: { email: "karen@brightwater.example" } });
    const personMerge = await m.db.reviewQueueItem.findFirstOrThrow({ where: { kind: "ENTITY_MERGE", status: "PENDING", proposal: { path: ["mergeId"], equals: newKaren.id } } });

    const ceoUser = await m.db.user.findFirstOrThrow({ where: { role: "CEO" } });
    const actor = { userId: ceoUser.id, email: ceoUser.email };
    const c = await m.resolveReviewItem(companyMerge.id, { action: "MERGE", mergeIntoId: original.id }, actor);
    assert.deepEqual(c, { status: "MERGED", resultType: "COMPANY", resultId: original.id });
    assert.equal(await m.db.company.count({ where: { id: dupCompany.id } }), 0);
    assert.equal((await m.db.person.findUniqueOrThrow({ where: { id: newKaren.id } })).companyId, original.id);
    assert.ok(await m.db.entityAlias.count({ where: { entityType: "COMPANY", entityId: original.id, normalized: `brightwater${run}.example` } }));
    assert.ok(await m.db.activity.count({ where: { companyId: original.id, type: "ENTITY_MERGED" } }));
    assert.equal(await m.db.entityMention.count({ where: { entityType: "COMPANY", entityId: dupCompany.id } }), 0);

    const p = await m.resolveReviewItem(personMerge.id, { action: "APPROVE" }, actor);
    assert.equal(p.resultId, oldKaren.id);
    assert.equal(await m.db.person.count({ where: { id: newKaren.id } }), 0);
    assert.ok(await m.db.entityAlias.count({ where: { entityType: "PERSON", entityId: oldKaren.id, kind: "EMAIL", normalized: karen2.email } }));
    // The next message from the new address resolves straight to the original person.
    const again = await email({
      thread: "bw-dup",
      subject: "Re: Pilot data request",
      from: karen2,
      to: [CEO],
      body: "Thanks!",
      sentAt: new Date(m.ctx.now.getTime() - 8_000_000),
      direction: "INBOUND",
      cls: { relevance: "LOW", category: "CUSTOMER" },
      mentions: [person(karen2, "SENDER"), person(CEO, "RECIPIENT")],
    });
    const { resolution } = await processItem(again, {});
    assert.equal(resolution.people.find((x) => x.role === "SENDER")?.id, oldKaren.id);
    assert.equal(resolution.primaryCompanyId, original.id);
  });

  it("calendar event adopts the seeded meeting; a reschedule raises a CHANGE insight; cancellation is recorded", async () => {
    const seeded = await m.db.meeting.findFirstOrThrow({ where: { title: "Northbridge Ventures — partner meeting" } });
    const sarah = { name: "Sarah Chen", email: "sarah@northbridge.example" };
    const jonas = { name: "Jonas Weber", email: "jonas@cytohub.example" };
    const cls = classification({ relevance: "HIGH", category: "INVESTOR", meetingCategory: "INVESTOR" });
    const item = await m.db.sourceItem.create({
      data: {
        connectionId: calendarConnectionId,
        kind: "CALENDAR_EVENT",
        externalId: `${run}-evt-1`,
        title: seeded.title,
        occurredAt: seeded.startsAt,
        contentHash: randomUUID(),
        text: `${seeded.title}\nObjective: Earn a term sheet.`,
        status: "PROCESSING",
        relevance: "HIGH",
        category: "INVESTOR",
        stageData: { mentions: [], classification: cls } as object,
      },
    });
    ids.event = item.id;
    const attendees = [
      { ...sarah, responseStatus: "ACCEPTED" },
      { ...jonas, responseStatus: "ACCEPTED" },
    ];
    await m.db.calendarEvent.create({
      data: { sourceItemId: item.id, externalEventId: `${run}-evt-1`, title: seeded.title, description: "Objective: Earn a term sheet.", startsAt: seeded.startsAt, endsAt: seeded.endsAt, organizerName: "CEO", organizerEmail: CEO.email, attendees, category: "INVESTOR", importance: 5 },
    });
    const mentions = [person(CEO, "ORGANIZER"), person(sarah, "ATTENDEE"), person(jonas, "ATTENDEE")];
    await m.db.sourceItem.update({ where: { id: item.id }, data: { stageData: { mentions, classification: cls } as object } });
    await writeMentions(item.id, mentions);
    await processItem(item.id, {});

    const ev = await m.db.calendarEvent.findUniqueOrThrow({ where: { sourceItemId: item.id } });
    assert.equal(ev.meetingId, seeded.id, "seeded meeting adopted, not duplicated");
    const meeting = await m.db.meeting.findUniqueOrThrow({ where: { id: seeded.id }, include: { attendees: true } });
    assert.equal(await m.db.meeting.count({ where: { externalId: `cal:${calendarConnectionId}:${run}-evt-1` } }), 0, "no twin meeting created");
    assert.equal(meeting.category, "INVESTOR");
    assert.ok(meeting.attendees.some((a) => a.email === sarah.email));
    await m.db.meeting.update({ where: { id: seeded.id }, data: { prepBrief: { stale: true }, preparedAt: m.ctx.now } });

    // Northbridge moves it from Thu 10:00 to Fri 14:00 (New York).
    const newStart = new Date(seeded.startsAt.getTime() + 28 * 3_600_000);
    await m.db.calendarEvent.update({ where: { id: ev.id }, data: { startsAt: newStart, endsAt: new Date(newStart.getTime() + 90 * 60_000), previousStartsAt: seeded.startsAt, organizerEmail: sarah.email, organizerName: sarah.name } });
    const moved = [person(sarah, "ORGANIZER"), person(CEO, "ATTENDEE"), person(jonas, "ATTENDEE")];
    await m.db.entityMention.deleteMany({ where: { sourceItemId: item.id } });
    await writeMentions(item.id, moved);
    await m.db.sourceItem.update({ where: { id: item.id }, data: { version: 2, occurredAt: newStart, stageData: { mentions: moved, classification: cls } as object } });
    await processItem(item.id, {});
    const after = await m.db.meeting.findUniqueOrThrow({ where: { id: seeded.id } });
    assert.equal(after.startsAt.getTime(), newStart.getTime());
    assert.equal(after.prepBrief, null, "stale prep brief cleared");
    assert.ok(await m.db.activity.count({ where: { meetingId: seeded.id, type: "MEETING_RESCHEDULED" } }));
    const change = await m.db.brainInsight.findFirstOrThrow({ where: { meetingId: seeded.id, changeKind: "meeting_rescheduled" } });
    assert.equal(change.title, "Important change: Northbridge moved the partner meeting from Thu 10:00 to Fri 14:00");
    assert.equal(await m.db.meeting.count({ where: { title: seeded.title } }), 1);

    await m.db.calendarEvent.update({ where: { id: ev.id }, data: { status: "CANCELLED" } });
    await processItem(item.id, {});
    assert.equal((await m.db.meeting.findUniqueOrThrow({ where: { id: seeded.id } })).status, "CANCELLED");
    assert.ok(await m.db.activity.count({ where: { meetingId: seeded.id, type: "MEETING_CANCELLED" } }));
    assert.ok(await m.db.brainInsight.count({ where: { meetingId: seeded.id, changeKind: "meeting_cancelled" } }));
  });

  it("a significant document version raises a CHANGE insight and mirrors into the Resource Center", async () => {
    const cls = classification({ relevance: "HIGH", category: "FUNDRAISING", docType: "INVESTOR_DECK" });
    const item = await m.db.sourceItem.create({
      data: {
        connectionId: docConnectionId,
        kind: "DOCUMENT",
        externalId: `${run}-doc-1`,
        title: "CytoHub Series B deck v7.pptx",
        occurredAt: new Date(m.ctx.now.getTime() - 86_400_000),
        contentHash: randomUUID(),
        text: "CytoHub Series B. We are raising $40M to scale the Human Heart Dataset.",
        status: "PROCESSING",
        relevance: "HIGH",
        category: "FUNDRAISING",
        stageData: { mentions: [], classification: cls } as object,
      },
    });
    const doc = await m.db.document.create({
      data: { sourceItemId: item.id, title: "CytoHub Series B deck v7.pptx", docType: "INVESTOR_DECK", format: "PPTX", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", contentHash: "h2", currentVersion: 2 },
    });
    const v1 = await m.db.documentVersion.create({ data: { documentId: doc.id, version: 1, modifiedAt: new Date(m.ctx.now.getTime() - 7 * 86_400_000), contentHash: "h1", parser: "pptx" } });
    const v2 = await m.db.documentVersion.create({
      data: {
        documentId: doc.id,
        version: 2,
        modifiedAt: item.occurredAt,
        contentHash: "h2",
        parser: "pptx",
        previousVersionId: v1.id,
        isSignificant: true,
        changeSummary: "Raise amount increased from $35M to $40M; runway slide updated.",
        significantChanges: [
          { label: "Raise amount", from: "$35M", to: "$40M", kind: "MONEY", significance: "high" },
          { label: "Runway", from: "18 months", to: "24 months", kind: "TEXT", significance: "medium" },
        ],
      },
    });
    await m.db.sourceItem.update({ where: { id: item.id }, data: { stageData: { mentions: [], classification: cls, document: { versionId: v2.id, changed: true } } as object } });
    await processItem(item.id, {
      summary: "Series B deck: CytoHub raises $40M to scale the Human Heart Dataset.",
      facts: [{ label: "Series B raise amount", value: "$40M", kind: "MONEY", numericValue: 40_000_000, evidence: "We are raising $40M" }],
    });
    const change = await m.db.brainInsight.findFirstOrThrow({ where: { documentId: doc.id, changeKind: "document_changed" } });
    assert.equal(change.title, "Important change: CytoHub Series B deck: raise amount changed from $35M to $40M");
    assert.ok(change.importance >= 4);
    assert.ok(await m.db.activity.count({ where: { documentId: doc.id, type: "DOCUMENT_CHANGED" } }));
    const d = await m.db.document.findUniqueOrThrow({ where: { id: doc.id } });
    assert.ok(d.resourceId);
    assert.equal(d.summary, "Series B deck: CytoHub raises $40M to scale the Human Heart Dataset.");
    assert.ok(Array.isArray(d.keyFacts));
    const resource = await m.db.resource.findUniqueOrThrow({ where: { id: d.resourceId! } });
    assert.equal(resource.type, "PRESENTATION");
    assert.ok(await m.db.sourceReference.count({ where: { targetType: "RESOURCE", targetId: resource.id } }));
  });

  it("meeting notes: decisions made go to review; approval decides; the meeting is marked held", async () => {
    const meeting = await m.db.meeting.findFirstOrThrow({ where: { title: "Brightwater MSA redline review" } });
    const cls = classification({ relevance: "HIGH", category: "CUSTOMER" });
    const text = "Notes: We agreed to offer a field-limited license for clause 7.3. Priya will send the revised redlines by Thursday.";
    const item = await m.db.sourceItem.create({
      data: { connectionId: docConnectionId, kind: "MEETING_NOTES", externalId: `${run}-notes-1`, title: "Notes — Brightwater MSA redline review", occurredAt: meeting.endsAt, contentHash: randomUUID(), text, status: "PROCESSING", relevance: "HIGH", category: "CUSTOMER", meetingId: meeting.id, stageData: { mentions: [], classification: cls } as object },
    });
    const mentions: MentionDraft[] = [{ entityType: "PERSON", text: "Priya", role: "MENTIONED", confidence: 0.8 }, { entityType: "COMPANY", text: "Brightwater", role: "MENTIONED", confidence: 0.9 }];
    await m.db.sourceItem.update({ where: { id: item.id }, data: { stageData: { mentions, classification: cls } as object } });
    await writeMentions(item.id, mentions);
    const thursday = nextWeekday(4);
    await processItem(item.id, {
      decisions: [{ title: "Offer a field-limited license for clause 7.3", status: "MADE", decision: "Offer a field-limited license for clause 7.3", decidedByName: null, deadline: null, options: [], confidence: 0.9, evidence: "We agreed to offer a field-limited license for clause 7.3." }],
      tasks: [{ title: "Send the revised redlines", description: null, ownerName: "Priya", ownerIsCeo: false, dueDate: thursday, dueText: "by Thursday", priorityHint: null, companyName: "Brightwater", focusArea: null, confidence: 0.9, evidence: "Priya will send the revised redlines by Thursday." }],
    });
    const priya = await m.db.person.findUniqueOrThrow({ where: { email: "priya@cytohub.example" } });
    const t = await m.db.task.findFirstOrThrow({ where: { title: "Send the revised redlines" } });
    assert.equal(t.ownerId, priya.id);
    assert.equal(t.meetingId, meeting.id);
    const held = await m.db.meeting.findUniqueOrThrow({ where: { id: meeting.id } });
    assert.equal(held.status, "COMPLETED");
    assert.ok(held.notesProcessedAt);
    assert.equal(await m.db.activity.count({ where: { meetingId: meeting.id, type: "MEETING_OCCURRED" } }), 1);
    const review = await m.db.reviewQueueItem.findFirstOrThrow({ where: { sourceItemId: item.id, kind: "DECISION" } });
    assert.equal((review.proposal as { meetingId: string }).meetingId, meeting.id);
    const ceoUser = await m.db.user.findFirstOrThrow({ where: { role: "CEO" } });
    const out = await m.resolveReviewItem(review.id, { action: "APPROVE" }, { userId: ceoUser.id, email: ceoUser.email });
    const decision = await m.db.decision.findUniqueOrThrow({ where: { id: out.resultId! } });
    assert.equal(decision.status, "DECIDED");
    assert.ok(decision.decidedAt);
    assert.ok(await m.db.activity.count({ where: { decisionId: decision.id, type: "DECISION_MADE" } }));
    assert.ok(await m.db.relationship.count({ where: { fromType: "DECISION", fromId: decision.id, relation: "ORIGINATED_FROM", toType: "MEETING", toId: meeting.id } }));
  });

  it("contract signed + new proposal value → change insights and protected reviews", async () => {
    const karen = { name: "Karen Liu", email: "karen@brightwater.example" };
    const body = "Great news — the MSA is signed. The countersigned copy is attached. Total contract value is $1.6M over three years.";
    const id = await email({
      thread: "bw-msa",
      subject: "Brightwater MSA — executed",
      from: karen,
      to: [CEO],
      body,
      sentAt: new Date(m.ctx.now.getTime() - 300_000),
      direction: "INBOUND",
      cls: { relevance: "CRITICAL", category: "CUSTOMER" },
      mentions: [person(karen, "SENDER"), person(CEO, "RECIPIENT")],
      attachments: ["Brightwater_MSA_countersigned.pdf"],
    });
    await processItem(id, { facts: [{ label: "Total contract value", value: "$1.6M", kind: "MONEY", numericValue: 1_600_000, evidence: "Total contract value is $1.6M over three years." }] });
    const bw = await m.db.company.findFirstOrThrow({ where: { domain: "brightwater.example" } });
    const signed = await m.db.brainInsight.findFirstOrThrow({ where: { sourceItemId: id, changeKind: "contract_status_changed" } });
    assert.equal(signed.title, "Important change: Brightwater MSA signed");
    const milestone = await m.db.milestone.findFirstOrThrow({ where: { title: "Brightwater MSA signed" } });
    const msReview = await m.db.reviewQueueItem.findUniqueOrThrow({ where: { fingerprint: `field:MILESTONE:${milestone.id}:status:COMPLETED` } });
    assert.equal(msReview.kind, "FIELD_CHANGE");
    const deal = await m.db.deal.findFirstOrThrow({ where: { companyId: bw.id, status: "OPEN" } });
    assert.ok(await m.db.reviewQueueItem.count({ where: { fingerprint: `field:DEAL:${deal.id}:value:1600000` } }));
    const value = await m.db.brainInsight.findFirstOrThrow({ where: { sourceItemId: id, changeKind: "proposal_value_changed" } });
    assert.match(value.title, /\$1\.4M to \$1\.6M/);
    assert.equal((await m.db.deal.findUniqueOrThrow({ where: { id: deal.id } })).value, 1_400_000, "deal value is protected until approved");

    // Rejected proposals are never asked again.
    const ceoUser = await m.db.user.findFirstOrThrow({ where: { role: "CEO" } });
    await m.resolveReviewItem(msReview.id, { action: "REJECT", note: "Not yet countersigned by us" }, { userId: ceoUser.id, email: ceoUser.email });
    await rewrite(id);
    assert.equal((await m.db.reviewQueueItem.findUniqueOrThrow({ where: { id: msReview.id } })).status, "REJECTED");
    assert.equal(await m.db.reviewQueueItem.count({ where: { fingerprint: `field:MILESTONE:${milestone.id}:status:COMPLETED` } }), 1);
  });

  it("corporate families: Janssen links to J&J and the graph answers family queries", async () => {
    const jnj = await m.db.company.create({ data: { name: `Johnson & Johnson`, type: "PROSPECT", domain: "jnj.example" } });
    const janssen = await m.db.company.create({ data: { name: "Janssen Pharmaceuticals", type: "PROSPECT", domain: "janssen.example" } });
    const id = await email({
      thread: "jnj",
      subject: "Janssen safety pharmacology",
      from: CEO,
      to: [{ name: "Priya Raman", email: "priya@cytohub.example" }],
      body: "Priya — J&J's Janssen team asked about cardiac safety screening.",
      sentAt: new Date(m.ctx.now.getTime() - 400_000),
      direction: "INTERNAL",
      cls: { relevance: "NORMAL", category: "COMMERCIAL_OPPORTUNITY" },
      mentions: [person(CEO, "SENDER"), { entityType: "COMPANY", text: "J&J", role: "MENTIONED", confidence: 0.9 }, { entityType: "COMPANY", text: "Janssen", role: "MENTIONED", confidence: 0.9 }],
    });
    const { resolution } = await processItem(id, {});
    assert.ok(resolution.companies.some((c) => c.id === jnj.id));
    assert.ok(resolution.companies.some((c) => c.id === janssen.id));
    assert.equal((await m.db.company.findUniqueOrThrow({ where: { id: janssen.id } })).parentId, jnj.id);
    const family = await m.graph.companyFamilyIds(janssen.id);
    assert.deepEqual(new Set(family), new Set([jnj.id, janssen.id]));
    const n = await m.graph.neighbors({ type: "COMPANY", id: janssen.id }, { relations: ["SUBSIDIARY_OF"] });
    assert.ok(n.some((x) => x.id === jnj.id && x.direction === "out"));
    const calder = await m.db.company.findFirstOrThrow({ where: { domain: "calder.example" } });
    const items = await m.graph.sourceItemIdsForEntity({ type: "COMPANY", id: calder.id });
    assert.ok(items.includes(ids.ask));
    const henrik = await m.db.person.findUniqueOrThrow({ where: { email: HENRIK.email } });
    assert.ok((await m.graph.sourceItemIdsForEntity({ type: "PERSON", id: henrik.id })).includes(ids.ask));
  });

  it("risks, opportunities, medium-confidence review, milestone slip and risk resolution", async () => {
    const rachel = { name: "Rachel Moore", email: "rachel@lumen.example" };
    const ms = await m.db.milestone.findFirstOrThrow({ where: { title: "CardioPredict v2 validation (AUC ≥ 0.90)" } });
    const slipTo = m.dates.dayKey(m.dates.addDays(ms.dueDate, 14));
    const body =
      "Hi — the assay turnaround delays are putting our renewal at risk. We are also interested in adding two more assay panels next year, roughly $200K. " +
      `Separately, we heard the CardioPredict v2 validation (AUC ≥ 0.90) is now expected on ${slipTo}. Maybe someone could look at the invoice format.`;
    const id = await email({
      thread: "lumen",
      subject: "Lumen — turnaround and renewal",
      from: rachel,
      to: [CEO],
      body,
      sentAt: new Date(m.ctx.now.getTime() - 5_000_000),
      direction: "INBOUND",
      cls: { relevance: "HIGH", category: "CUSTOMER" },
      mentions: [person(rachel, "SENDER"), person(CEO, "RECIPIENT")],
    });
    const { summary } = await processItem(id, {
      risks: [{ title: "Assay turnaround delays", description: "Turnaround delays put the Lumen renewal at risk.", category: "CUSTOMER", severity: 4, companyName: "Lumen", confidence: 0.9, evidence: "the assay turnaround delays are putting our renewal at risk" }],
      opportunities: [{ title: "Two more assay panels", description: null, kind: "EXPANSION", estimatedValue: 200_000, companyName: "Lumen", confidence: 0.85, evidence: "adding two more assay panels next year, roughly $200K" }],
      tasks: [{ title: "Look at the invoice format", description: null, ownerName: null, ownerIsCeo: false, dueDate: null, dueText: null, priorityHint: null, companyName: null, focusArea: null, confidence: 0.6, evidence: "Maybe someone could look at the invoice format." }],
      deadlines: [{ what: "CardioPredict v2 validation (AUC ≥ 0.90)", date: slipTo, hard: false, confidence: 0.85, evidence: `CardioPredict v2 validation (AUC ≥ 0.90) is now expected on ${slipTo}` }],
    });
    const lumen = await m.db.company.findFirstOrThrow({ where: { domain: "lumen.example" } });
    const risk = await m.db.risk.findFirstOrThrow({ where: { title: "Assay turnaround delays", companyId: lumen.id } });
    assert.equal(risk.severity, 4);
    assert.ok(await m.db.brainInsight.count({ where: { fingerprint: `risk:${risk.id}`, type: "RISK" } }));
    assert.ok(await m.db.brainInsight.count({ where: { fingerprint: `change:new_risk:${risk.id}` } }));
    assert.ok(await m.db.activity.count({ where: { riskId: risk.id, type: "RISK_EMERGED" } }));
    const opp = await m.db.opportunity.findFirstOrThrow({ where: { title: "Two more assay panels" } });
    assert.equal(opp.estimatedValue, 200_000);
    assert.ok(await m.db.brainInsight.count({ where: { fingerprint: `opp:${opp.id}`, type: "OPPORTUNITY" } }));
    assert.ok(await m.db.activity.count({ where: { opportunityId: opp.id, type: "OPPORTUNITY_IDENTIFIED" } }));
    assert.equal(await m.db.task.count({ where: { title: "Look at the invoice format" } }), 0, "medium confidence is not written");
    assert.ok(await m.db.reviewQueueItem.count({ where: { kind: "TASK", sourceItemId: id, title: { contains: "invoice format" } } }));
    assert.ok(await m.db.reviewQueueItem.count({ where: { fingerprint: `field:MILESTONE:${ms.id}:dueDate:${slipTo}` } }));
    assert.ok(await m.db.brainInsight.count({ where: { changeKind: "milestone_slipped", milestoneId: ms.id } }));
    assert.equal((await m.db.milestone.findUniqueOrThrow({ where: { id: ms.id } })).dueDate.getTime(), ms.dueDate.getTime(), "milestone dates are protected");
    const inbox = await m.db.inboxItem.findFirst({ where: { sourceItemId: id } });
    assert.ok(inbox, "a serious customer risk reaches the inbox");
    assert.ok(summary.reviewItemIds.length >= 2);

    // The same risk raised again corroborates; resolution language closes it.
    const again = await email({
      thread: "lumen",
      subject: "Re: Lumen — turnaround and renewal",
      from: rachel,
      to: [CEO],
      body: "Update: the assay turnaround delays are resolved — last three batches came back in 9 days. Thanks for the push.",
      sentAt: new Date(m.ctx.now.getTime() - 4_000_000),
      direction: "INBOUND",
      cls: { relevance: "NORMAL", category: "CUSTOMER" },
      mentions: [person(rachel, "SENDER"), person(CEO, "RECIPIENT")],
    });
    await processItem(again, {});
    const closed = await m.db.risk.findUniqueOrThrow({ where: { id: risk.id } });
    assert.equal(closed.status, "RESOLVED");
    assert.ok(await m.db.activity.count({ where: { riskId: risk.id, type: "RISK_RESOLVED" } }));
  });

  it("a scientific result linked to a milestone is an important change", async () => {
    const tom = { name: "Dr. Tom Okafor", email: "tom@cytohub.example" };
    const id = await email({
      thread: "auc",
      subject: "CardioPredict v2 retraining results",
      from: tom,
      to: [CEO],
      body: "Retraining on the 60 new donor hearts is done: hold-out AUC is now 0.91 on 214 compounds.",
      sentAt: new Date(m.ctx.now.getTime() - 3_000_000),
      direction: "INTERNAL",
      cls: { relevance: "HIGH", category: "SCIENTIFIC_LEADERSHIP" },
      mentions: [person(tom, "SENDER"), person(CEO, "RECIPIENT")],
    });
    await processItem(id, {
      activityTags: ["SCIENTIFIC"],
      facts: [{ label: "CardioPredict v2 hold-out AUC", value: "0.91", kind: "METRIC", numericValue: 0.91, evidence: "hold-out AUC is now 0.91 on 214 compounds" }],
    });
    const insight = await m.db.brainInsight.findFirstOrThrow({ where: { sourceItemId: id, changeKind: "new_scientific_result" } });
    assert.equal(insight.title, "Important change: New scientific result — CardioPredict v2 hold-out AUC: 0.91");
    const ms = await m.db.milestone.findFirstOrThrow({ where: { title: "CardioPredict v2 validation (AUC ≥ 0.90)" } });
    assert.equal(insight.milestoneId, ms.id);
  });

  it("an inbound delivery fulfils what a customer promised", async () => {
    const sow = await m.db.commitment.findFirstOrThrow({ where: { direction: "INBOUND", title: "Send the signed SOW" } });
    const id = await email({
      thread: "calder",
      subject: "Re: Calder study — revised data package",
      from: HENRIK,
      to: [CEO],
      body: "As promised, attached is the signed SOW for the expanded study.",
      sentAt: new Date(m.ctx.now.getTime() - 100_000),
      direction: "INBOUND",
      cls: { relevance: "NORMAL", category: "CUSTOMER" },
      mentions: [person(HENRIK, "SENDER"), person(CEO, "RECIPIENT")],
      attachments: ["Calder_SOW_signed.pdf"],
    });
    await processItem(id, {});
    assert.equal((await m.db.commitment.findUniqueOrThrow({ where: { id: sow.id } })).status, "FULFILLED");
  });

  it("caps new ingestion inbox items per CEO day unless IMMEDIATE", async () => {
    const { upsertInboxItem, DAILY_INBOX_CAP } = await import("./attention");
    const { emptySummary, emptyCounters } = await import("./env");
    const results = await m.db.$transaction(async (tx) => {
      const env = {
        tx,
        now: m.ctx.now,
        today: m.ctx.ceo.today,
        timezone: m.ctx.ceo.timezone,
        ceo: { personId: m.ctx.ceo.personId, userId: m.ctx.ceo.userId, name: m.ctx.ceo.name, email: m.ctx.ceo.email },
        actor: "CytoHub Brain",
        source: { id: ids.ask, kind: "EMAIL_MESSAGE" as const, provider: "GMAIL" as const, title: "cap", externalId: null, externalUrl: null, occurredAt: m.ctx.now, ingestedAt: m.ctx.now },
        engine: null,
        relevance: null,
        summary: emptySummary(),
        counters: emptyCounters(),
      };
      const out: (string | null)[] = [];
      for (let i = 0; i < DAILY_INBOX_CAP + 2; i++) {
        const r = await upsertInboxItem(env, { fingerprint: `cap:${run}:${i}`, type: "REQUEST", level: "TODAY", title: `cap ${i}`, whyCeo: "test", recommendedAction: "test" });
        out.push(r?.id ?? null);
      }
      const urgent = await upsertInboxItem(env, { fingerprint: `cap:${run}:urgent`, type: "REQUEST", level: "IMMEDIATE", title: "urgent", whyCeo: "test", recommendedAction: "test" });
      return { out, urgent };
    });
    assert.ok(results.out.some((x) => x === null), "TODAY items beyond the cap are held back");
    assert.ok(results.urgent, "IMMEDIATE items bypass the cap");
  });

  it("sweepCommitments raises overdue promises once; markCompletedMeetings is idempotent", async () => {
    const calder = await m.db.company.findFirstOrThrow({ where: { domain: "calder.example" } });
    const henrik = await m.db.person.findUniqueOrThrow({ where: { email: HENRIK.email } });
    const overdue = await m.db.commitment.create({
      data: {
        direction: "OUTBOUND",
        title: `Send the toxicology summary ${run}`,
        text: "I'll send the toxicology summary",
        dueDate: m.dates.addDays(m.ctx.ceo.today, -2),
        committedAt: m.dates.addDays(m.ctx.now, -5),
        confidence: "HIGH",
        confidenceScore: 0.9,
        fingerprint: `cm:test:${run}`,
        ownerPersonId: m.ctx.ceo.personId,
        counterpartyPersonId: henrik.id,
        companyId: calder.id,
      },
    });
    const first = await m.sweepCommitments(m.ctx);
    assert.ok(first.overdue >= 1);
    const insight = await m.db.brainInsight.findUniqueOrThrow({ where: { fingerprint: `commitment:overdue:${overdue.id}` } });
    assert.equal(insight.type, "COMMITMENT");
    const inbox = await m.db.inboxItem.findUniqueOrThrow({ where: { fingerprint: `inbox:commitment:${overdue.id}` } });
    assert.equal(inbox.type, "COMMITMENT");
    assert.equal(inbox.attention, "IMMEDIATE");
    const inboxCount = await m.db.inboxItem.count();
    const second = await m.sweepCommitments(m.ctx);
    assert.equal(second.inbox, 0);
    assert.equal(await m.db.inboxItem.count(), inboxCount);

    await m.markCompletedMeetings(m.ctx);
    assert.equal(await m.markCompletedMeetings(m.ctx), 0);
    const occurred = await m.db.activity.groupBy({ by: ["meetingId"], where: { type: "MEETING_OCCURRED" }, _count: true });
    assert.ok(occurred.every((g) => g._count === 1), "MEETING_OCCURRED logged once per meeting");
  });
});
