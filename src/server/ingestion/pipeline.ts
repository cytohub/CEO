/**
 * Stage orchestration for one source item.
 *
 *   DOCUMENT_PARSE (documents only)
 *     → ENTITY_EXTRACTION   mentions + classification; noise stops here
 *     → ENTITY_RESOLUTION   canonical people / companies / projects
 *     → RELATIONSHIP_MAPPING graph edges
 *     → INTELLIGENCE_EXTRACTION validated structured extraction
 *     → BRAIN_WRITE         confidence gate, dedupe, records + provenance,
 *                           change detection, CEO attention
 *     → THREAD_SUMMARY (email) + PRIORITY_RECALC (debounced)
 *
 * Each stage persists its output on the SourceItem (stage + stageData) before
 * queueing the next, so a failure retries only the failed stage.
 */
import { Prisma } from "@/generated/prisma/client";
import type { JobType, PipelineStage } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { parseDocumentItem } from "./documents/version";
import type { IntelligenceExtraction } from "./extraction-schema";
import { classifyItem } from "./extract/classify";
import { extractIntelligence } from "./extract/intelligence";
import { extractMentions } from "./extract/mentions";
import { enqueue } from "./jobs/queue";
import { resolveMentions } from "./resolve/entities";
import { mapSourceRelationships } from "./resolve/relationships";
import {
  type Classification,
  type ExtractionInput,
  type KnownEntities,
  type LoadedSourceItem,
  type Participant,
  type PipelineContext,
  type ResolutionContext,
  type StageData,
  loadSourceItem,
} from "./types";
import { writeIntelligence } from "./write/writer";

export const PROCESSING_STAGES: JobType[] = ["DOCUMENT_PARSE", "ENTITY_EXTRACTION", "ENTITY_RESOLUTION", "RELATIONSHIP_MAPPING", "INTELLIGENCE_EXTRACTION", "BRAIN_WRITE"];

const NEXT: Partial<Record<JobType, JobType>> = {
  DOCUMENT_PARSE: "ENTITY_EXTRACTION",
  ENTITY_EXTRACTION: "ENTITY_RESOLUTION",
  ENTITY_RESOLUTION: "RELATIONSHIP_MAPPING",
  RELATIONSHIP_MAPPING: "INTELLIGENCE_EXTRACTION",
  INTELLIGENCE_EXTRACTION: "BRAIN_WRITE",
};

const STAGE_DONE: Partial<Record<JobType, PipelineStage>> = {
  DOCUMENT_PARSE: "PARSED",
  ENTITY_EXTRACTION: "ENTITIES_EXTRACTED",
  ENTITY_RESOLUTION: "ENTITIES_RESOLVED",
  RELATIONSHIP_MAPPING: "RELATIONSHIPS_MAPPED",
  INTELLIGENCE_EXTRACTION: "INTELLIGENCE_EXTRACTED",
  BRAIN_WRITE: "WRITTEN",
};

function stageJobKey(type: JobType, item: { id: string; version: number }) {
  return `stage:${type}:${item.id}:v${item.version}`;
}

/** Queue the first processing stage for a new or changed source item. */
export async function enqueueProcessing(item: { id: string; kind: string; version: number }, opts: { runId?: string | null; delayMs?: number } = {}) {
  const first: JobType = item.kind === "DOCUMENT" ? "DOCUMENT_PARSE" : "ENTITY_EXTRACTION";
  return enqueue(first, {
    sourceItemId: item.id,
    dedupeKey: stageJobKey(first, item),
    runId: opts.runId ?? null,
    runAt: opts.delayMs ? new Date(Date.now() + opts.delayMs) : undefined,
  });
}

async function enqueueNext(type: JobType, item: { id: string; version: number }, ctx: PipelineContext) {
  const next = NEXT[type];
  if (next) await enqueue(next, { sourceItemId: item.id, dedupeKey: stageJobKey(next, item), runId: ctx.runId });
}

function stageDataOf(item: { stageData: Prisma.JsonValue }): StageData {
  return (item.stageData as StageData | null) ?? {};
}

async function saveStage(item: LoadedSourceItem, stage: PipelineStage, patch: Partial<StageData>, extra: Prisma.SourceItemUpdateInput = {}) {
  await db.sourceItem.update({
    where: { id: item.id },
    data: { stage, status: "PROCESSING", stageData: { ...stageDataOf(item), ...patch } as unknown as Prisma.InputJsonValue, ...extra },
  });
}

export interface StageResult {
  sourceItemId: string;
  stage: JobType;
  outcome: "advanced" | "completed" | "skipped" | "unchanged" | "stale";
  detail?: string;
}

/** Run one processing stage for one source item. Throws on failure (the queue retries). */
export async function runStage(type: JobType, sourceItemId: string, ctx: PipelineContext): Promise<StageResult> {
  const item = await loadSourceItem(db, sourceItemId);
  if (!item) return { sourceItemId, stage: type, outcome: "stale", detail: "source item no longer exists" };
  if (item.contentPurgedAt && type !== "BRAIN_WRITE") return { sourceItemId, stage: type, outcome: "skipped", detail: "content purged" };
  const data = stageDataOf(item);

  switch (type) {
    case "DOCUMENT_PARSE": {
      const res = await parseDocumentItem(ctx, item.id);
      if (!res.changed) {
        await db.sourceItem.update({ where: { id: item.id }, data: { status: "PROCESSED", stage: "WRITTEN", processedAt: ctx.now } });
        return { sourceItemId, stage: type, outcome: "unchanged", detail: "document content unchanged" };
      }
      const fresh = (await loadSourceItem(db, item.id))!;
      await saveStage(fresh, "PARSED", { document: { versionId: res.versionId, changed: true } });
      break;
    }

    case "ENTITY_EXTRACTION": {
      const mentions = extractMentions(item, ctx.ceo);
      const classification = await classifyItem(ctx, item, mentions);
      await db.$transaction([
        db.entityMention.deleteMany({ where: { sourceItemId: item.id } }),
        db.entityMention.createMany({
          data: mentions.map((m) => ({
            sourceItemId: item.id,
            entityType: m.entityType,
            text: m.text.slice(0, 300),
            normalized: m.text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 300),
            email: m.email ?? null,
            role: m.role,
            confidence: m.confidence,
          })),
        }),
      ]);
      // An uploader's explicit choice wins over the classifier.
      const sensitivity = data.sensitivityOverride ?? classification.sensitivity;
      const skip = classification.isNoise && !item.connection.includeNoise;
      await db.sourceItem.update({
        where: { id: item.id },
        data: {
          stage: "ENTITIES_EXTRACTED",
          status: skip ? "SKIPPED" : "PROCESSING",
          relevance: classification.relevance,
          relevanceScore: classification.relevanceScore,
          category: classification.category,
          relevanceReasons: classification.reasons.slice(0, 8),
          sensitivity,
          processedAt: skip ? ctx.now : null,
          stageData: { ...data, mentions, classification } as unknown as Prisma.InputJsonValue,
        },
      });
      if (item.emailMessage) {
        await db.emailThread.update({
          where: { id: item.emailMessage.threadId },
          data: { relevance: classification.relevance, category: classification.category, sensitivity },
        });
      }
      if (item.document) {
        await db.document.update({
          where: { id: item.document.id },
          data: {
            sensitivity,
            ...(classification.docType ? { docType: classification.docType, docTypeConfidence: classification.docTypeConfidence ?? null } : {}),
          },
        });
      }
      if (item.calendarEvent && classification.meetingCategory) {
        await db.calendarEvent.update({ where: { id: item.calendarEvent.id }, data: { category: classification.meetingCategory } });
      }
      if (skip) return { sourceItemId, stage: type, outcome: "skipped", detail: `noise (${classification.category})` };
      break;
    }

    case "ENTITY_RESOLUTION": {
      const resolution = await resolveMentions(ctx, item);
      await saveStage(item, "ENTITIES_RESOLVED", { resolution });
      break;
    }

    case "RELATIONSHIP_MAPPING": {
      if (!data.resolution) throw new Error("RELATIONSHIP_MAPPING ran before ENTITY_RESOLUTION");
      const n = await mapSourceRelationships(ctx, item, data.resolution);
      await saveStage(item, "RELATIONSHIPS_MAPPED", { relationshipsMapped: n });
      break;
    }

    case "INTELLIGENCE_EXTRACTION": {
      if (!data.resolution || !data.classification) throw new Error("INTELLIGENCE_EXTRACTION ran before resolution/classification");
      const input = await buildExtractionInput(ctx, item, data.classification, data.resolution);
      const { extraction, engine, issues } = await extractIntelligence(ctx, input);
      if (issues.length) ctx.count("extractionErrors", issues.length);
      await saveStage(
        item,
        "INTELLIGENCE_EXTRACTED",
        { extractionErrors: issues.slice(0, 50) },
        { extraction: extraction as unknown as Prisma.InputJsonValue, extractionEngine: engine, extractedAt: ctx.now },
      );
      break;
    }

    case "BRAIN_WRITE": {
      if (!data.resolution || !data.classification || !item.extraction) throw new Error("BRAIN_WRITE ran before extraction");
      const summary = await writeIntelligence(ctx, item, item.extraction as unknown as IntelligenceExtraction, data.resolution, data.classification);
      await db.sourceItem.update({
        where: { id: item.id },
        data: {
          stage: "WRITTEN",
          status: "PROCESSED",
          processedAt: ctx.now,
          processingError: null,
          stageData: { ...data, write: summary } as unknown as Prisma.InputJsonValue,
        },
      });
      if (item.emailMessage) {
        // Debounced: many messages in one sync produce one summary pass per thread.
        await enqueue("THREAD_SUMMARY", {
          payload: { threadId: item.emailMessage.threadId },
          dedupeKey: `thread-summary:${item.emailMessage.threadId}`,
          runAt: new Date(Date.now() + 2_000),
          runId: ctx.runId,
        });
      }
      await enqueue("PRIORITY_RECALC", { dedupeKey: "priority-recalc", runAt: new Date(Date.now() + 5_000) });
      return { sourceItemId, stage: type, outcome: "completed", detail: `${summary.created.length} created, ${summary.updated.length} updated, ${summary.reviewItemIds.length} for review` };
    }

    default:
      throw new Error(`runStage: ${type} is not a processing stage`);
  }

  const done = STAGE_DONE[type];
  if (done) ctx.log(type, `${item.title} → ${done}`);
  await enqueueNext(type, item, ctx);
  return { sourceItemId, stage: type, outcome: "advanced" };
}

/** Record a stage failure on the item itself (visible in View Source and the health dashboard). */
export async function markStageFailed(sourceItemId: string, type: JobType, error: unknown, final: boolean) {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
  await db.sourceItem
    .update({
      where: { id: sourceItemId },
      data: { processingError: `${type}: ${message}`, attempts: { increment: 1 }, ...(final ? { status: "FAILED" } : {}) },
    })
    .catch(() => {});
}

// ─── Extraction input ────────────────────────────────────────────────────────

const knownCache = new WeakMap<PipelineContext, Promise<KnownEntities>>();

/** Canonical entities the extractor may refer to (cached per pipeline context). */
export function loadKnownEntities(ctx: PipelineContext): Promise<KnownEntities> {
  let p = knownCache.get(ctx);
  if (!p) {
    p = (async () => {
      const [people, companies, projects, goals, milestones, deals] = await Promise.all([
        db.person.findMany({ select: { id: true, name: true, email: true, isCeo: true, company: { select: { name: true } } }, orderBy: { lastContactAt: { sort: "desc", nulls: "last" } }, take: 400 }),
        db.company.findMany({ select: { id: true, name: true, type: true }, orderBy: { lastActivityAt: { sort: "desc", nulls: "last" } }, take: 400 }),
        db.project.findMany({ select: { id: true, name: true, kind: true } }),
        db.goal.findMany({ where: { status: { notIn: ["COMPLETED"] } }, select: { id: true, title: true } }),
        db.milestone.findMany({ where: { status: { notIn: ["COMPLETED", "MISSED"] } }, select: { id: true, title: true, dueDate: true } }),
        db.deal.findMany({ where: { status: "OPEN" }, select: { id: true, name: true, value: true, company: { select: { name: true } } } }),
      ]);
      return {
        people: people.map((p) => ({ id: p.id, name: p.name, email: p.email, company: p.company?.name ?? null, isCeo: p.isCeo })),
        companies,
        projects,
        goals,
        milestones: milestones.map((m) => ({ id: m.id, title: m.title, dueDate: m.dueDate.toISOString().slice(0, 10) })),
        deals: deals.map((d) => ({ id: d.id, name: d.name, value: d.value, company: d.company?.name ?? null })),
      };
    })();
    knownCache.set(ctx, p);
  }
  return p;
}

function participants(json: Prisma.JsonValue | null | undefined): Participant[] {
  if (!Array.isArray(json)) return [];
  return json
    .filter((p): p is { name?: string | null; email: string } => typeof p === "object" && p !== null && typeof (p as { email?: unknown }).email === "string")
    .map((p) => ({ name: p.name ?? null, email: p.email }));
}

export async function buildExtractionInput(ctx: PipelineContext, item: LoadedSourceItem, classification: Classification, resolution: ResolutionContext): Promise<ExtractionInput> {
  const known = await loadKnownEntities(ctx);
  const input: ExtractionInput = {
    sourceItemId: item.id,
    kind: item.kind,
    title: item.title,
    text: item.text ?? "",
    occurredAt: item.occurredAt,
    timezone: ctx.ceo.timezone,
    ceo: { personId: ctx.ceo.personId, name: ctx.ceo.name, firstName: ctx.ceo.firstName, email: ctx.ceo.email },
    classification,
    resolution,
    known,
  };

  const msg = item.emailMessage;
  if (msg) {
    const earlier = await db.emailMessage.findMany({
      where: { threadId: msg.threadId, sentAt: { lt: msg.sentAt } },
      orderBy: { sentAt: "desc" },
      take: 4,
      select: { fromName: true, fromEmail: true, sentAt: true, sourceItem: { select: { text: true } } },
    });
    input.email = {
      direction: msg.direction,
      from: { name: msg.fromName, email: msg.fromEmail },
      to: participants(msg.to),
      cc: participants(msg.cc),
      threadSubject: msg.thread.subject,
      previousMessages: earlier.reverse().map((m) => ({ from: m.fromName ?? m.fromEmail, sentAt: m.sentAt, text: (m.sourceItem.text ?? "").slice(0, 2000) })),
    };
  }

  const ev = item.calendarEvent;
  if (ev) {
    input.event = {
      startsAt: ev.startsAt,
      endsAt: ev.endsAt,
      attendees: participants(ev.attendees),
      organizer: ev.organizerEmail ? { name: ev.organizerName, email: ev.organizerEmail } : null,
      category: ev.category,
      status: ev.status,
    };
  }

  if (item.document) {
    input.document = { docType: item.document.docType, format: item.document.format, author: item.document.author, version: item.document.currentVersion };
  }
  if (item.meeting) input.meeting = { id: item.meeting.id, title: item.meeting.title, startsAt: item.meeting.startsAt };
  return input;
}
