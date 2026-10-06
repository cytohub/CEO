"use server";

import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { EntityType, Sensitivity } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { formatDay } from "@/lib/dates";
import { buildPrepBrief } from "@/server/brain/prepare";
import { briefVisibleTo, normalizePrepBrief, type PrepBrief } from "@/server/brain/prep-brief";
import { loadCeoContext } from "@/server/context";
import type { IntelligenceExtraction } from "@/server/ingestion/extraction-schema";
import { PROCESSING_STAGES, enqueueProcessing } from "@/server/ingestion/pipeline";
import { drainQueue } from "@/server/ingestion/jobs/worker";
import { upsertSourceItem } from "@/server/ingestion/raw";
import { links } from "@/server/ingestion/search/links";
import { logActivity, revalidateAll } from "@/server/mutations";
import { type AccessScope, getAccessScope, sourceItemWhere } from "@/server/security/access";
import { audit } from "@/server/security/audit";
import { LIMITS, rateLimit } from "@/server/security/rate-limit";
import { can, requireCapability, requireViewer } from "@/server/security/session";
import { attempt, fail, id, ok, type ActionResult } from "./result";

export interface MeetingDetail {
  id: string;
  title: string;
  type: string;
  startsAt: Date;
  endsAt: Date;
  location: string | null;
  objective: string | null;
  importance: number;
  status: string;
  company: { id: string; name: string } | null;
  goal: { id: string; title: string } | null;
  attendees: { id: string; name: string; title: string | null; isCeo: boolean }[];
  prepBrief: PrepBrief | null;
  /** A stored brief exists but was built from sources above the viewer's clearance. */
  briefHidden: boolean;
  preparedAt: Date | null;
  notes: MeetingNotesSummary[];
  canEdit: boolean;
}

export interface ExtractedEntry {
  title: string;
  detail?: string;
  href?: string;
  /** Extracted but not written yet (pipeline still running, or below the confidence gate). */
  pending?: boolean;
  /** Waiting for a human decision in the Brain Review Queue. */
  review?: boolean;
}

export interface MeetingNotesSummary {
  sourceItemId: string;
  title: string;
  addedAt: Date;
  status: "processing" | "processed" | "failed" | "skipped";
  /** Short, non-sensitive processing error (stage + reason) when something went wrong. */
  error: string | null;
  retrying: boolean;
  summary: string | null;
  decisions: ExtractedEntry[];
  actionItems: ExtractedEntry[];
  commitments: ExtractedEntry[];
  questions: ExtractedEntry[];
  risks: ExtractedEntry[];
  opportunities: ExtractedEntry[];
  followUps: ExtractedEntry[];
  reviewCount: number;
}

// ─── Meeting detail (sheet) ──────────────────────────────────────────────────

export async function fetchMeetingDetail(meetingId: string): Promise<MeetingDetail | null> {
  const viewer = await requireCapability("workspace.view");
  id.parse(meetingId);
  const m = await db.meeting.findUnique({
    where: { id: meetingId },
    include: {
      company: { select: { id: true, name: true } },
      goal: { select: { id: true, title: true } },
      attendees: { select: { id: true, name: true, title: true, isCeo: true } },
    },
  });
  if (!m) return null;
  const scope = await getAccessScope(viewer);
  const stored = normalizePrepBrief(m.prepBrief);
  const visible = stored && briefVisibleTo(stored, scope) ? stored : null;
  return {
    id: m.id,
    title: m.title,
    type: m.type,
    startsAt: m.startsAt,
    endsAt: m.endsAt,
    location: m.location,
    objective: m.objective,
    importance: m.importance,
    status: m.status,
    company: m.company,
    goal: m.goal,
    attendees: m.attendees,
    prepBrief: visible,
    briefHidden: Boolean(stored && !visible),
    preparedAt: visible ? m.preparedAt : null,
    notes: await loadMeetingNotes(m.id, scope),
    canEdit: can(viewer, "workspace.edit"),
  };
}

/** Generate (or regenerate) the Prepare Me brief at the viewer's access level. */
export async function prepareMeeting(meetingId: string): Promise<ActionResult<PrepBrief>> {
  return attempt(async () => {
    id.parse(meetingId);
    const viewer = await requireViewer();
    const meeting = await db.meeting.findUnique({ where: { id: meetingId }, select: { id: true, title: true, companyId: true, prepBrief: true } });
    if (!meeting) return fail("Meeting not found");
    const scope = await getAccessScope(viewer);
    const brief = await buildPrepBrief(meetingId, { scope, userId: viewer.userId });
    // Never replace a brief built at a higher clearance with a narrower one: the
    // viewer gets theirs, the stored brief stays for those cleared to see it.
    const stored = normalizePrepBrief(meeting.prepBrief);
    const store = !stored || briefVisibleTo(stored, scope);
    if (store) {
      await db.meeting.update({ where: { id: meetingId }, data: { prepBrief: brief as unknown as Prisma.InputJsonValue, preparedAt: new Date() } });
      await logActivity(db, { type: "MEETING_PREPARED", summary: `Prepared for ${meeting.title}`, meetingId, companyId: meeting.companyId, actor: viewer.name });
      // The "meeting prep" insight is resolved once the CEO is prepared.
      await db.brainInsight.updateMany({ where: { fingerprint: `meeting-prep:${meetingId}`, status: { in: ["NEW", "ACKNOWLEDGED"] } }, data: { status: "ACTIONED" } });
      revalidateAll();
    }
    return ok(brief, brief.engine === "claude" ? "Brief prepared by Chief of Staff" : "Brief prepared");
  });
}

// ─── Post-meeting notes ──────────────────────────────────────────────────────

const notesInput = z.object({
  meetingId: id,
  text: z.string().trim().min(10, "Add a few lines of notes first").max(100_000, "Notes are limited to 100,000 characters"),
});

/** The connection meeting notes and memos written in the app belong to (created on first use). */
async function internalConnection(ownerUserId: string) {
  return db.$transaction(async (tx) => {
    // Serialize first-use creation so concurrent notes don't create two connections.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('cytohub-internal-connection'))`;
    const existing = await tx.sourceConnection.findFirst({ where: { provider: "CYTOHUB_INTERNAL" }, orderBy: { createdAt: "asc" } });
    if (existing) return existing;
    const catalog = await tx.brainSource.findUnique({ where: { key: "workspace" }, select: { id: true } });
    return tx.sourceConnection.create({
      data: {
        kind: "DOCUMENTS",
        provider: "CYTOHUB_INTERNAL",
        mode: "LIVE",
        label: "CytoHub workspace",
        status: "CONNECTED",
        syncFrequency: "MANUAL",
        scopes: [],
        ownerUserId,
        brainSourceId: catalog?.id ?? null,
      },
    });
  });
}

/**
 * Add notes or a transcript to a meeting and run them through the ingestion
 * pipeline (extraction → resolution → validated intelligence → Brain write).
 * Returns what was extracted so far; later stages may still be running.
 */
export async function addMeetingNotes(meetingId: string, text: string): Promise<ActionResult<MeetingNotesSummary>> {
  return attempt(async () => {
    const input = notesInput.parse({ meetingId, text });
    const viewer = await requireViewer();
    const limit = await rateLimit("notes", viewer.userId, LIMITS.upload);
    if (!limit.ok) return fail("Too many notes added — try again later.");

    const meeting = await db.meeting.findUnique({ where: { id: input.meetingId }, select: { id: true, title: true, type: true, category: true, startsAt: true, companyId: true } });
    if (!meeting) return fail("Meeting not found");
    const ceo = await loadCeoContext();
    const board = meeting.type === "BOARD" || meeting.category === "BOARD";
    const sensitivity: Sensitivity = board ? "RESTRICTED" : "CONFIDENTIAL";

    // Restricted board notes are not copied into the workspace Note (visible to every
    // executive); the full text lives only in the access-controlled source item.
    const note = await db.note.create({
      data: {
        meetingId: meeting.id,
        companyId: meeting.companyId,
        author: viewer.name,
        body: board ? "Board meeting notes added (restricted — processed by CytoHub Brain)." : input.text,
      },
    });
    const connection = await internalConnection(ceo.userId);
    const now = new Date();
    const { item } = await upsertSourceItem(db, {
      connectionId: connection.id,
      kind: "MEETING_NOTES",
      externalId: `notes:${note.id}`,
      title: `Notes: ${meeting.title}`,
      occurredAt: meeting.startsAt < now ? meeting.startsAt : now,
      text: input.text,
      storeRaw: false,
      sensitivity,
      meetingId: meeting.id,
      startStage: "NORMALIZED",
    });
    // The author can always read what they wrote, even above their clearance.
    const scope = await getAccessScope(viewer);
    if (!scope.all && !scope.levels.includes(sensitivity)) {
      await db.accessGrant.create({ data: { resourceType: "SOURCE_ITEM", resourceId: item.id, userId: viewer.userId, grantedById: viewer.userId } });
      await audit({ action: "grant.create", viewer, targetType: "SourceItem", targetId: item.id, metadata: { reason: "author of meeting notes" } });
    }

    const run = await db.ingestionRun.create({ data: { connectionId: connection.id, trigger: "MANUAL", fetched: 1, created: 1 } });
    await db.sourceConnection.update({ where: { id: connection.id }, data: { lastSyncAt: now, lastSuccessAt: now, itemsIngested: { increment: 1 } } });
    await enqueueProcessing(item, { runId: run.id });
    try {
      await drainQueue({ budgetMs: 20_000, types: [...PROCESSING_STAGES, "PRIORITY_RECALC"] });
    } catch (error) {
      // Processing continues on the next drain (cron / refresh); the notes are saved.
      console.error("[notes] drain failed", error instanceof Error ? error.message : error);
    }

    const after = await db.sourceItem.findUnique({ where: { id: item.id }, select: { status: true, processingError: true } });
    const done = after?.status === "PROCESSED" || after?.status === "SKIPPED";
    await db.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: done ? "SUCCEEDED" : after?.status === "FAILED" ? "FAILED" : "PARTIAL",
        completedAt: new Date(),
        durationMs: Date.now() - now.getTime(),
        error: done ? null : (after?.processingError?.slice(0, 500) ?? "Still processing in the background"),
      },
    });
    if (done) await db.meeting.update({ where: { id: meeting.id }, data: { notesProcessedAt: new Date() } });
    await logActivity(db, { type: "NOTE_ADDED", summary: `Meeting notes added: ${meeting.title}`, meetingId: meeting.id, companyId: meeting.companyId, actor: viewer.name, metadata: { sourceItemId: item.id, length: input.text.length } });
    await audit({ action: "meeting.notes_added", viewer, targetType: "Meeting", targetId: meeting.id, metadata: { length: input.text.length, sensitivity } });
    revalidateAll();

    const [summary] = await loadMeetingNotes(meeting.id, { ...scope, sourceItemIds: [...scope.sourceItemIds, item.id] }, item.id);
    if (!summary) return fail("Notes saved, but they could not be loaded.");
    const counts = summary.decisions.length + summary.actionItems.length + summary.commitments.length + summary.risks.length + summary.opportunities.length + summary.followUps.length;
    return ok(summary, summary.status === "processed" ? `Notes processed · ${counts} item${counts === 1 ? "" : "s"} extracted` : summary.status === "failed" ? "Notes saved — processing failed" : "Notes saved — still processing");
  });
}

/** Refresh the processed-notes summaries for a meeting (polling while processing). */
export async function fetchMeetingNotes(meetingId: string): Promise<MeetingNotesSummary[]> {
  const viewer = await requireCapability("workspace.view");
  id.parse(meetingId);
  return loadMeetingNotes(meetingId, await getAccessScope(viewer));
}

// ─── Notes summary ───────────────────────────────────────────────────────────

const STAGE_LABEL: Record<string, string> = {
  ENTITY_EXTRACTION: "entity extraction",
  ENTITY_RESOLUTION: "entity resolution",
  RELATIONSHIP_MAPPING: "relationship mapping",
  INTELLIGENCE_EXTRACTION: "intelligence extraction",
  BRAIN_WRITE: "writing to the Brain",
};

function friendlyError(raw: string | null): string | null {
  if (!raw) return null;
  const m = /^([A-Z_]+):\s*([\s\S]*)$/.exec(raw);
  const stage = m ? (STAGE_LABEL[m[1]] ?? m[1].toLowerCase().replace(/_/g, " ")) : null;
  const reason = (m ? m[2] : raw).split("\n")[0].slice(0, 160);
  return stage ? `Failed during ${stage}: ${reason}` : reason;
}

/** Questions written in the notes themselves (lines ending with "?"). */
function questionsIn(text: string | null): string[] {
  if (!text) return [];
  return text
    .split(/\n+/)
    .map((l) => l.replace(/^[\s*•\-–—\d.)]+/, "").trim())
    .filter((l) => l.endsWith("?") && l.length >= 8 && l.length <= 300)
    .slice(0, 8);
}

async function loadMeetingNotes(meetingId: string, scope: AccessScope, onlyItemId?: string): Promise<MeetingNotesSummary[]> {
  const items = await db.sourceItem.findMany({
    where: { AND: [{ kind: "MEETING_NOTES", meetingId, ...(onlyItemId ? { id: onlyItemId } : {}) }, sourceItemWhere(scope)] },
    orderBy: { ingestedAt: "desc" },
    take: 5,
    select: { id: true, title: true, text: true, ingestedAt: true, status: true, processingError: true, extraction: true, jobs: { where: { status: { in: ["QUEUED", "FAILED", "RUNNING"] } }, select: { id: true }, take: 1 } },
  });
  if (!items.length) return [];
  const ids = items.map((i) => i.id);
  const [refs, reviews] = await Promise.all([
    db.sourceReference.findMany({ where: { sourceItemId: { in: ids } }, select: { sourceItemId: true, targetType: true, targetId: true } }),
    db.reviewQueueItem.findMany({ where: { sourceItemId: { in: ids } }, select: { id: true, sourceItemId: true, kind: true, title: true, status: true } }),
  ]);
  const idsOf = (t: EntityType) => [...new Set(refs.filter((r) => r.targetType === t).map((r) => r.targetId))];
  const [tasks, commitments, decisions, risks, opportunities] = await Promise.all([
    db.task.findMany({ where: { id: { in: idsOf("TASK") } }, select: { id: true, title: true, dueDate: true, owner: { select: { name: true, isCeo: true } } } }),
    db.commitment.findMany({ where: { id: { in: idsOf("COMMITMENT") } }, select: { id: true, title: true, direction: true, dueDate: true, counterparty: { select: { name: true } }, owner: { select: { name: true, isCeo: true } } } }),
    db.decision.findMany({ where: { id: { in: idsOf("DECISION") } }, select: { id: true, title: true, status: true } }),
    db.risk.findMany({ where: { id: { in: idsOf("RISK") } }, select: { id: true, title: true, severity: true } }),
    db.opportunity.findMany({ where: { id: { in: idsOf("OPPORTUNITY") } }, select: { id: true, title: true } }),
  ]);
  const refsFor = (itemId: string, t: EntityType) => new Set(refs.filter((r) => r.sourceItemId === itemId && r.targetType === t).map((r) => r.targetId));

  return items.map((item) => {
    const x = (item.extraction ?? null) as Partial<IntelligenceExtraction> | null;
    const pendingOf = (kinds: string[]) =>
      reviews.filter((r) => r.sourceItemId === item.id && kinds.includes(r.kind) && r.status === "PENDING").map((r) => ({ title: r.title, href: "/brain/review", review: true }));
    const taskIds = refsFor(item.id, "TASK");
    const commitIds = refsFor(item.id, "COMMITMENT");
    const decisionIds = refsFor(item.id, "DECISION");
    const riskIds = refsFor(item.id, "RISK");
    const oppIds = refsFor(item.id, "OPPORTUNITY");
    const written = refs.some((r) => r.sourceItemId === item.id);
    // Before the writer has run (or when it wrote nothing), show what extraction proposed.
    const fromExtraction = !written && x;

    const actionItems: ExtractedEntry[] = [
      ...tasks.filter((t) => taskIds.has(t.id)).map((t) => ({ title: t.title, detail: [t.owner ? (t.owner.isCeo ? "You" : t.owner.name) : "Unassigned", t.dueDate ? `due ${formatDay(t.dueDate)}` : null].filter(Boolean).join(" · "), href: links.task(t.id) })),
      ...pendingOf(["TASK", "DEADLINE"]),
      ...(fromExtraction ? (x.tasks ?? []).map((t) => ({ title: t.title, detail: [t.ownerIsCeo ? "You" : t.ownerName, t.dueDate ?? t.dueText].filter(Boolean).join(" · ") || undefined, pending: true })) : []),
    ];
    const commitmentsOut: ExtractedEntry[] = [
      ...commitments
        .filter((c) => commitIds.has(c.id))
        .map((c) => ({ title: c.title, detail: [c.direction === "OUTBOUND" ? `You owe ${c.counterparty?.name ?? "them"}` : c.direction === "INBOUND" ? `${c.owner?.name ?? "They"} owe${c.owner ? "s" : ""} you` : "Internal", c.dueDate ? `due ${formatDay(c.dueDate)}` : null].filter(Boolean).join(" · "), href: links.commitment(c.id) })),
      ...pendingOf(["COMMITMENT"]),
      ...(fromExtraction ? (x.commitments ?? []).map((c) => ({ title: c.title, detail: [c.direction === "OUTBOUND" ? "We owe" : c.direction === "INBOUND" ? "Owed to us" : "Internal", c.owedToName ?? c.owedByName, c.dueDate ?? c.dueText].filter(Boolean).join(" · "), pending: true })) : []),
    ];
    const decisionsOut: ExtractedEntry[] = [
      ...decisions.filter((d) => decisionIds.has(d.id)).map((d) => ({ title: d.title, detail: d.status === "DECIDED" ? "Decided" : "Decision needed", href: links.decision(d.id) })),
      ...pendingOf(["DECISION"]),
      ...(fromExtraction ? (x.decisions ?? []).filter((d) => d.status === "MADE").map((d) => ({ title: d.title, detail: d.decision ?? undefined, pending: true })) : []),
    ];
    const questions: ExtractedEntry[] = [
      ...questionsIn(item.text).map((q) => ({ title: q })),
      ...(x?.decisions ?? []).filter((d) => d.status === "NEEDED").map((d) => ({ title: d.title, detail: "Decision needed" })),
    ].slice(0, 8);
    const risksOut: ExtractedEntry[] = [
      ...risks.filter((r) => riskIds.has(r.id)).map((r) => ({ title: r.title, detail: `severity ${r.severity}/5`, href: links.risk(r.id) })),
      ...pendingOf(["RISK"]),
      ...(fromExtraction ? (x.risks ?? []).map((r) => ({ title: r.title, detail: `severity ${r.severity}/5`, pending: true })) : []),
    ];
    const oppsOut: ExtractedEntry[] = [
      ...opportunities.filter((o) => oppIds.has(o.id)).map((o) => ({ title: o.title, href: links.opportunity(o.id) })),
      ...pendingOf(["OPPORTUNITY"]),
      ...(fromExtraction ? (x.opportunities ?? []).map((o) => ({ title: o.title, pending: true })) : []),
    ];
    const followUps: ExtractedEntry[] = [
      ...(x?.followUps ?? []).map((f) => ({ title: f.title, detail: [f.withName, f.dueDate].filter(Boolean).join(" · ") || undefined })),
      ...(x?.meetingRequests ?? []).map((m) => ({ title: m.title, detail: m.withName ?? undefined })),
      ...pendingOf(["MEETING"]),
    ];
    const status: MeetingNotesSummary["status"] = item.status === "PROCESSED" ? "processed" : item.status === "FAILED" ? "failed" : item.status === "SKIPPED" ? "skipped" : "processing";
    return {
      sourceItemId: item.id,
      title: item.title,
      addedAt: item.ingestedAt,
      status,
      error: friendlyError(item.processingError),
      retrying: status === "processing" && Boolean(item.processingError) && item.jobs.length > 0,
      summary: x?.summary || null,
      decisions: decisionsOut,
      actionItems,
      commitments: commitmentsOut,
      questions,
      risks: risksOut,
      opportunities: oppsOut,
      followUps,
      reviewCount: reviews.filter((r) => r.sourceItemId === item.id && r.status === "PENDING").length,
    };
  });
}
