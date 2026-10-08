/**
 * Incremental sync of one connection (EMAIL_SYNC / CALENDAR_SYNC / DOCUMENT_SYNC).
 *
 *   cursor ─► adapter.listChanges (≤ MAX_PAGES pages per job) ─► per item:
 *     email     normalize (new content, direction, automation) → EmailThread →
 *               SourceItem (raw encrypted) → EmailMessage (+ attachments → documents)
 *     calendar  normalize → SourceItem (times/RSVPs in the hash) → CalendarEvent
 *               (previousStartsAt on reschedule)
 *     documents ingestDocumentRef (download only when the version changed)
 *   created / updated → processing pipeline; unchanged → nothing; deleted →
 *   markDeletedAtSource (retention decides what happens next).
 *
 * The cursor is persisted after every page, so a crash or retry resumes where
 * it stopped. When pages remain after MAX_PAGES a continuation job of the same
 * type and run is queued, keeping each job short. Errors: ProviderAuthError is
 * rethrown untouched (the worker marks NEEDS_REAUTH and stops retrying); any
 * other error is recorded on the connection and run and rethrown so the queue
 * retries with backoff.
 */
import { Prisma, type IngestionRun, type SourceConnection } from "@/generated/prisma/client";
import type { RunStatus, SourceKind } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { DAY_MS } from "@/lib/dates";
import { connectionSettings, getProviderContext } from "./connections";
import { ingestDocumentRef } from "./documents/ingest";
import { enqueue } from "./jobs/queue";
import { calendarHashMaterial, calendarItemText, normalizeCalendarEvent } from "./normalize/calendar";
import { baseSubject, dedupeParticipants, domainOf, emailDirection, extractNewContent, isAutomatedEmail } from "./normalize/email";
import { enqueueProcessing } from "./pipeline";
import { DROPBOX_DELETED_PREFIX } from "./providers/dropbox";
import { isSupportedDocument, MAX_ATTACHMENT_BYTES } from "./providers/doc-types";
import { appOrigin, vendorOf } from "./providers/oauth";
import { getAdapter, getWebhookSubscriber } from "./providers/registry";
import { newWebhookSecret } from "./providers/webhook-verify";
import { markDeletedAtSource, upsertSourceItem } from "./raw";
import { type RetentionPolicy, getRetentionPolicy } from "./retention-policy";
import { SYNC_JOB, nextSyncTime } from "./scheduler";
import {
  type ChangeSet,
  CursorExpiredError,
  type NormalizedCalendarEvent,
  type NormalizedDocumentRef,
  type NormalizedEmail,
  type Participant,
  type PipelineContext,
  ProviderAuthError,
  type ProviderContext,
  type SyncCursor,
} from "./types";

export interface SyncOutcome {
  connectionId: string;
  runId: string;
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  deleted: number;
  noise: number;
  failed: number;
  /** More pages remain; a follow-up sync job has been queued. */
  hasMore: boolean;
  error?: string;
}

/** Pages processed per job before handing over to a continuation job. */
export const MAX_PAGES_PER_JOB = 5;
const PAGE_SIZE: Record<SourceKind, number> = { EMAIL: 50, CALENDAR: 100, DOCUMENTS: 50, MEETINGS: 30, CRM: 100, FINANCE: 100, CONTRACTS: 100 };
const CALENDAR_WINDOW = { pastDays: 90, futureDays: 180 } as const;
const DEFAULT_INITIAL_DAYS = 90;
/** Renew push subscriptions this long before they expire. */
const WEBHOOK_RENEW_MS = 24 * 3_600_000;

type Counters = Omit<SyncOutcome, "connectionId" | "runId" | "hasMore" | "error"> & { duplicates: number };
type ItemResult = "created" | "updated" | "unchanged";

interface SyncState {
  ctx: PipelineContext;
  conn: SourceConnection;
  run: IngestionRun;
  policy: RetentionPolicy;
  counters: Counters;
  notes: string[];
  touchedThreads: Set<string>;
}

function note(state: SyncState, message: string) {
  if (state.notes.length < 50) state.notes.push(message.slice(0, 300));
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1000);
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function syncConnection(ctx: PipelineContext, connectionId: string, runId: string): Promise<SyncOutcome> {
  const conn = await db.sourceConnection.findUnique({ where: { id: connectionId } });
  const base: SyncOutcome = { connectionId, runId, fetched: 0, created: 0, updated: 0, unchanged: 0, deleted: 0, noise: 0, failed: 0, hasMore: false };
  if (!conn) return { ...base, error: "Connection not found" };

  const run =
    (runId ? await db.ingestionRun.findUnique({ where: { id: runId } }) : null) ??
    (await db.ingestionRun.create({ data: { connectionId, trigger: ctx.trigger, cursorBefore: conn.cursor ?? undefined } }));
  base.runId = run.id;

  if (conn.status === "DISCONNECTED" || conn.status === "PAUSED") {
    await finishRun(run, "SUCCEEDED", { notes: [`Skipped: connection is ${conn.status.toLowerCase()}`] });
    return base;
  }
  if (conn.status === "NEEDS_REAUTH") {
    const message = "Reconnect needed before this source can sync";
    await finishRun(run, "FAILED", { error: message });
    throw new ProviderAuthError(message);
  }

  // One sync per connection at a time: the earliest-started running job wins, later ones
  // fold into it (a deterministic order, so two simultaneous jobs never both step aside).
  const running = await db.ingestionJob.findMany({
    where: { connectionId, type: SYNC_JOB[conn.kind], status: "RUNNING" },
    orderBy: [{ startedAt: "asc" }, { id: "asc" }],
    select: { runId: true },
    take: 1,
  });
  if (running[0] && running[0].runId !== run.id) {
    await finishRun(run, "SUCCEEDED", { notes: [`Merged into the sync already running (run ${running[0].runId ?? "unknown"})`] });
    return base;
  }

  const state: SyncState = {
    ctx,
    conn,
    run,
    policy: await getRetentionPolicy(db),
    counters: { fetched: 0, created: 0, updated: 0, unchanged: 0, deleted: 0, noise: 0, failed: 0, duplicates: 0 },
    notes: [],
    touchedThreads: new Set(),
  };
  await db.sourceConnection.update({ where: { id: conn.id }, data: { status: "SYNCING" } });

  let cursor = (conn.cursor as SyncCursor | null) ?? null;
  let hasMore = false;
  try {
    const pctx = await getProviderContext(conn.id, ctx.now);
    let pages = 0;
    let resynced = false;
    while (pages < MAX_PAGES_PER_JOB) {
      let page: ChangeSet<unknown>;
      try {
        page = await listPage(state, pctx, cursor);
      } catch (error) {
        // An expired cursor means a fresh full listing; content hashes make it idempotent.
        if (error instanceof CursorExpiredError && !resynced) {
          resynced = true;
          cursor = null;
          note(state, "Provider cursor expired; restarted with a full resync");
          continue;
        }
        throw error;
      }
      pages++;
      await processPage(state, page);
      cursor = page.cursor;
      await db.sourceConnection.update({ where: { id: conn.id }, data: { cursor: cursor as Prisma.InputJsonValue } });
      hasMore = page.hasMore;
      if (!hasMore) break;
    }
    await refreshThreads(state);

    if (hasMore) {
      await recordProgress(state, cursor);
      const type = SYNC_JOB[conn.kind];
      const n = await db.ingestionJob.count({ where: { runId: run.id, type } });
      await enqueue(type, { connectionId: conn.id, runId: run.id, payload: { runId: run.id }, dedupeKey: `sync:${conn.id}:cont:${run.id}:${n}`, maxAttempts: 4 });
      return { ...base, ...publicCounters(state.counters), hasMore: true };
    }

    await completeSync(state, cursor);
    if (conn.mode === "LIVE") await ensureWebhook(state, pctx);
    return { ...base, ...publicCounters(state.counters), hasMore: false };
  } catch (error) {
    await recordFailure(state, cursor, error).catch(() => {});
    throw error;
  }
}

function publicCounters(c: Counters) {
  return { fetched: c.fetched, created: c.created, updated: c.updated, unchanged: c.unchanged, deleted: c.deleted, noise: c.noise, failed: c.failed };
}

// ─── Paging ──────────────────────────────────────────────────────────────────

async function listPage(state: SyncState, pctx: ProviderContext, cursor: SyncCursor | null): Promise<ChangeSet<unknown>> {
  const { conn, ctx } = state;
  const settings = connectionSettings(conn);
  const pageSize = Number(settings.pageSize) > 0 ? Math.min(500, Number(settings.pageSize)) : PAGE_SIZE[conn.kind];
  const adapter = getAdapter(conn);
  switch (adapter.kind) {
    case "EMAIL": {
      const days = Number(settings.initialDays) > 0 ? Number(settings.initialDays) : DEFAULT_INITIAL_DAYS;
      return adapter.listChanges(pctx, cursor, { pageSize, initialSince: new Date(ctx.now.getTime() - days * DAY_MS) });
    }
    case "CALENDAR":
      return adapter.listChanges(pctx, cursor, {
        pageSize,
        windowStart: new Date(ctx.now.getTime() - CALENDAR_WINDOW.pastDays * DAY_MS),
        windowEnd: new Date(ctx.now.getTime() + CALENDAR_WINDOW.futureDays * DAY_MS),
      });
    case "DOCUMENTS":
      return adapter.listChanges(pctx, cursor, { pageSize });
  }
}

async function processPage(state: SyncState, page: ChangeSet<unknown>) {
  const { conn, counters } = state;
  counters.fetched += page.items.length;
  for (const raw of page.items) {
    try {
      let result: ItemResult;
      if (conn.kind === "EMAIL") result = await processEmail(state, raw as NormalizedEmail);
      else if (conn.kind === "CALENDAR") result = await processCalendarEvent(state, raw as NormalizedCalendarEvent);
      else result = await processDocument(state, raw as NormalizedDocumentRef);
      counters[result]++;
    } catch (error) {
      if (error instanceof ProviderAuthError) throw error;
      counters.failed++;
      const id = (raw as { externalId?: string }).externalId ?? "?";
      note(state, `Item ${id.slice(0, 80)} failed: ${errorText(error).slice(0, 200)}`);
    }
  }
  if (page.deletedExternalIds.length) counters.deleted += await handleDeletions(state, page.deletedExternalIds);
}

// ─── Email ───────────────────────────────────────────────────────────────────

const DOCUMENT_ATTACHMENT_EXTENSIONS = /\.(pdf|docx|pptx|xlsx|csv|txt|md)$/i;

function participantsJson(list: Participant[]): Prisma.InputJsonValue {
  return list.map((p) => ({ name: p.name, email: p.email }));
}

function mergeParticipants(existing: Prisma.JsonValue, incoming: Participant[]): Participant[] {
  const current = Array.isArray(existing)
    ? existing.filter((p): p is { name: string | null; email: string } => typeof p === "object" && p !== null && typeof (p as { email?: unknown }).email === "string")
    : [];
  return dedupeParticipants([...current.map((p) => ({ name: p.name ?? null, email: p.email })), ...incoming]);
}

async function processEmail(state: SyncState, email: NormalizedEmail): Promise<ItemResult> {
  const { ctx, conn, policy } = state;
  const content = extractNewContent(email.bodyText, { senderName: email.from.name });
  const direction = emailDirection(email, { accountEmail: conn.accountEmail, ceoEmail: ctx.ceo.email });
  const automated = isAutomatedEmail(email);
  const subject = email.subject.trim() || "(no subject)";
  const participants = dedupeParticipants([email.from, ...email.to, ...email.cc, ...(email.bcc ?? [])]);

  const thread = await db.emailThread.upsert({
    where: { connectionId_externalThreadId: { connectionId: conn.id, externalThreadId: email.threadExternalId } },
    create: {
      connectionId: conn.id,
      externalThreadId: email.threadExternalId,
      subject: baseSubject(subject).slice(0, 500),
      firstMessageAt: email.sentAt,
      lastMessageAt: email.sentAt,
      participants: participantsJson(participants),
      sensitivity: conn.defaultSensitivity,
    },
    update: {},
    select: { id: true, participants: true },
  });
  const merged = mergeParticipants(thread.participants, participants);
  if (merged.length !== (Array.isArray(thread.participants) ? thread.participants.length : 0)) {
    await db.emailThread.update({ where: { id: thread.id }, data: { participants: participantsJson(merged) } });
  }

  // The same RFC 5322 message already stored through another mailbox connection.
  const original = email.internetMessageId
    ? await db.emailMessage.findFirst({
        where: { internetMessageId: email.internetMessageId, sourceItem: { connectionId: { not: conn.id }, duplicateOfId: null } },
        orderBy: { createdAt: "asc" },
        select: { sourceItemId: true },
      })
    : null;

  const { item, outcome } = await upsertSourceItem(db, {
    connectionId: conn.id,
    kind: "EMAIL_MESSAGE",
    externalId: email.externalId,
    externalUrl: email.webUrl ?? null,
    title: subject,
    occurredAt: email.sentAt,
    text: content.text,
    raw: email.raw ?? { subject, from: email.from, to: email.to, cc: email.cc, sentAt: email.sentAt.toISOString(), headers: email.headers ?? {}, body: email.bodyText },
    storeRaw: policy.rawEmailDays !== 0,
    sensitivity: conn.defaultSensitivity,
    startStage: "NORMALIZED",
  });

  const messageData = {
    threadId: thread.id,
    externalMessageId: email.externalId,
    internetMessageId: email.internetMessageId ?? null,
    inReplyTo: email.inReplyTo ?? null,
    fromName: email.from.name,
    fromEmail: email.from.email.toLowerCase(),
    to: participantsJson(email.to),
    cc: participantsJson(email.cc),
    bcc: email.bcc?.length ? participantsJson(email.bcc) : Prisma.DbNull,
    subject: subject.slice(0, 1000),
    sentAt: email.sentAt,
    direction,
    labels: email.labels.slice(0, 50),
    folder: email.folder ?? null,
    isRead: email.isRead ?? null,
    isAutomated: automated,
    hasAttachments: email.attachments.length > 0,
  };
  const message = await db.emailMessage.upsert({
    where: { sourceItemId: item.id },
    create: { sourceItemId: item.id, ...messageData },
    update: messageData,
    select: { id: true },
  });
  if (outcome !== "unchanged") state.touchedThreads.add(thread.id);

  if (original) {
    if (outcome !== "unchanged") {
      await db.sourceItem.update({ where: { id: item.id }, data: { duplicateOfId: original.sourceItemId, status: "SKIPPED", processedAt: ctx.now, processingError: null } });
      state.counters.duplicates++;
    }
    return outcome;
  }

  await syncAttachments(state, email, message.id, automated);
  if (outcome !== "unchanged") {
    if (automated) state.counters.noise++;
    await enqueueProcessing(item, { runId: state.run.id });
  }
  return outcome;
}

async function syncAttachments(state: SyncState, email: NormalizedEmail, messageId: string, automated: boolean) {
  if (!email.attachments.length) return;
  const { ctx, conn, policy } = state;
  let rows = await db.emailAttachment.findMany({ where: { messageId }, select: { id: true, externalAttachmentId: true, filename: true, documentId: true } });
  if (!rows.length) {
    await db.emailAttachment.createMany({
      data: email.attachments.map((a) => ({
        messageId,
        externalAttachmentId: a.externalId ?? null,
        filename: a.filename.slice(0, 500),
        mimeType: a.mimeType.slice(0, 200),
        sizeBytes: Math.max(0, Math.round(a.sizeBytes)),
      })),
    });
    rows = await db.emailAttachment.findMany({ where: { messageId }, select: { id: true, externalAttachmentId: true, filename: true, documentId: true } });
  }
  // Newsletters and notifications do not get their attachments ingested.
  if (!policy.storeAttachments || automated) return;

  for (const att of email.attachments) {
    const row = rows.find((r) => (att.externalId ? r.externalAttachmentId === att.externalId : r.filename === att.filename));
    if (!row || row.documentId || !att.fetch) continue;
    if (!DOCUMENT_ATTACHMENT_EXTENSIONS.test(att.filename) && !isSupportedDocument(att.filename, att.mimeType)) continue;
    if (att.sizeBytes > MAX_ATTACHMENT_BYTES) continue;
    const fetch = att.fetch;
    try {
      const ref: NormalizedDocumentRef = {
        externalId: `att:${email.externalId}:${att.externalId ?? att.filename}`,
        title: att.filename,
        mimeType: att.mimeType,
        sizeBytes: att.sizeBytes || null,
        createdAt: email.sentAt,
        modifiedAt: email.sentAt,
        author: email.from.name ?? email.from.email,
        path: null,
        webUrl: email.webUrl ?? null,
        // Attachments are immutable: the message + attachment id is a stable version tag.
        versionTag: `${email.externalId}:${att.externalId ?? att.filename}:${att.sizeBytes}`,
        download: () => fetch(),
        raw: { attachmentOf: email.externalId, filename: att.filename, mimeType: att.mimeType, sizeBytes: att.sizeBytes },
      };
      const res = await ingestDocumentRef(ctx, { id: conn.id, provider: conn.provider, defaultSensitivity: conn.defaultSensitivity }, ref, { runId: state.run.id });
      const doc = await db.document.findUnique({ where: { sourceItemId: res.sourceItemId }, select: { id: true } });
      if (doc) await db.emailAttachment.update({ where: { id: row.id }, data: { documentId: doc.id } });
    } catch (error) {
      if (error instanceof ProviderAuthError) throw error;
      note(state, `Attachment ${att.filename.slice(0, 80)} on ${email.externalId.slice(0, 60)} not ingested: ${errorText(error).slice(0, 160)}`);
    }
  }
}

/**
 * First-pass thread status from the latest conversational message (the thread
 * summarizer refines it later): our side spoke last → AWAITING_THEM; addressed
 * to the account → AWAITING_CEO; the CEO only copied → FYI.
 */
export function firstPassThreadStatus(
  last: { direction: string; fromEmail: string; to: Prisma.JsonValue; cc: Prisma.JsonValue } | null,
  accountEmail: string | null,
): "AWAITING_CEO" | "AWAITING_THEM" | "FYI" {
  if (!last) return "FYI";
  if (last.direction === "OUTBOUND") return "AWAITING_THEM";
  const emails = (v: Prisma.JsonValue) => (Array.isArray(v) ? v.map((p) => String((p as { email?: unknown } | null)?.email ?? "").toLowerCase()) : []);
  const ownDomain = domainOf(accountEmail);
  const to = emails(last.to);
  const recipients = [...to, ...emails(last.cc)];
  // A teammate answered the counterpart: the ball is in their court.
  if (ownDomain && domainOf(last.fromEmail) === ownDomain && recipients.some((e) => domainOf(e) !== ownDomain)) return "AWAITING_THEM";
  const me = accountEmail?.toLowerCase();
  if (!me || to.includes(me)) return "AWAITING_CEO";
  return "FYI";
}

/** Recompute thread aggregates (and a first-pass status) for threads that changed in this job. */
async function refreshThreads(state: SyncState) {
  for (const threadId of state.touchedThreads) {
    const messages = await db.emailMessage.findMany({
      where: { threadId },
      orderBy: { sentAt: "asc" },
      select: { sentAt: true, direction: true, isAutomated: true, fromEmail: true, to: true, cc: true, sourceItem: { select: { deletedAtSource: true } } },
    });
    if (!messages.length) continue;
    const inbound = messages.filter((m) => m.direction !== "OUTBOUND");
    const outbound = messages.filter((m) => m.direction === "OUTBOUND");
    const conversational = messages.filter((m) => !m.isAutomated && !m.sourceItem.deletedAtSource);
    const last = conversational[conversational.length - 1] ?? null;
    const status = firstPassThreadStatus(last, state.conn.accountEmail ?? state.ctx.ceo.email);
    await db.emailThread.update({
      where: { id: threadId },
      data: {
        firstMessageAt: messages[0].sentAt,
        lastMessageAt: messages[messages.length - 1].sentAt,
        lastInboundAt: inbound.length ? inbound[inbound.length - 1].sentAt : null,
        lastOutboundAt: outbound.length ? outbound[outbound.length - 1].sentAt : null,
        messageCount: messages.length,
        status,
        awaitingSince: status === "FYI" || !last ? null : last.sentAt,
      },
    });
  }
  state.touchedThreads.clear();
}

// ─── Calendar ────────────────────────────────────────────────────────────────

async function processCalendarEvent(state: SyncState, raw: NormalizedCalendarEvent): Promise<ItemResult> {
  const { ctx, conn, policy } = state;
  const ev = normalizeCalendarEvent(raw, { accountEmail: conn.accountEmail ?? ctx.ceo.email });
  const existing = await db.calendarEvent.findFirst({
    where: { sourceItem: { connectionId: conn.id, externalId: ev.externalId } },
    select: { id: true, startsAt: true, previousStartsAt: true },
  });

  const { item, outcome } = await upsertSourceItem(db, {
    connectionId: conn.id,
    kind: "CALENDAR_EVENT",
    externalId: ev.externalId,
    externalUrl: ev.webUrl ?? null,
    title: ev.title,
    occurredAt: ev.startsAt,
    sourceUpdatedAt: ev.updatedAt ?? null,
    text: calendarItemText(ev),
    hashMaterial: calendarHashMaterial(ev),
    raw: ev.raw ?? { ...ev, raw: undefined },
    storeRaw: policy.rawEmailDays !== 0,
    sensitivity: conn.defaultSensitivity,
    startStage: "NORMALIZED",
  });

  const data = {
    externalEventId: ev.externalId,
    iCalUid: ev.iCalUid ?? null,
    seriesId: ev.seriesId ?? null,
    title: ev.title.slice(0, 500),
    description: ev.description ?? null,
    startsAt: ev.startsAt,
    endsAt: ev.endsAt,
    allDay: ev.allDay,
    timezone: ev.timezone ?? null,
    location: ev.location ?? null,
    conferenceUrl: ev.conferenceUrl ?? null,
    organizerName: ev.organizer?.name ?? null,
    organizerEmail: ev.organizer?.email ?? null,
    attendees: ev.attendees.map((a) => ({ name: a.name, email: a.email, responseStatus: a.responseStatus, optional: Boolean(a.optional) })) as Prisma.InputJsonValue,
    isRecurring: ev.isRecurring,
    recurrence: ev.recurrence ?? null,
    status: ev.status,
    ceoResponse: ev.ceoResponse ?? null,
  };
  if (existing) {
    const moved = existing.startsAt.getTime() !== ev.startsAt.getTime();
    await db.calendarEvent.update({ where: { id: existing.id }, data: { ...data, ...(moved ? { previousStartsAt: existing.startsAt } : {}) } });
  } else {
    await db.calendarEvent.create({ data: { sourceItemId: item.id, ...data } });
  }
  if (outcome !== "unchanged") await enqueueProcessing(item, { runId: state.run.id });
  return outcome;
}

// ─── Documents ───────────────────────────────────────────────────────────────

async function processDocument(state: SyncState, ref: NormalizedDocumentRef): Promise<ItemResult> {
  const { ctx, conn } = state;
  // ingestDocumentRef queues DOCUMENT_PARSE itself for new or changed content.
  const res = await ingestDocumentRef(ctx, { id: conn.id, provider: conn.provider, defaultSensitivity: conn.defaultSensitivity }, ref, { runId: state.run.id });
  return res.outcome;
}

// ─── Deletions ───────────────────────────────────────────────────────────────

async function handleDeletions(state: SyncState, ids: string[]): Promise<number> {
  const { ctx, conn } = state;
  let externalIds = ids.filter((id) => !id.startsWith(DROPBOX_DELETED_PREFIX));
  const paths = ids.filter((id) => id.startsWith(DROPBOX_DELETED_PREFIX)).map((id) => id.slice(DROPBOX_DELETED_PREFIX.length));
  if (paths.length) {
    // Dropbox reports deletions by path; map them back to stored documents (or everything below a deleted folder).
    const docs = await db.document.findMany({
      where: { sourceItem: { connectionId: conn.id }, OR: paths.flatMap((p) => [{ path: { equals: p, mode: "insensitive" as const } }, { path: { startsWith: `${p}/`, mode: "insensitive" as const } }]) },
      select: { sourceItem: { select: { externalId: true } } },
    });
    externalIds = [...externalIds, ...docs.map((d) => d.sourceItem.externalId)];
  }
  if (!externalIds.length) return 0;

  if (conn.kind === "CALENDAR") {
    // A deleted event is a cancelled meeting: record it as a change so the Brain sees the cancellation.
    const events = await db.calendarEvent.findMany({
      where: { sourceItem: { connectionId: conn.id, externalId: { in: externalIds } }, status: { not: "CANCELLED" } },
    });
    for (const e of events) {
      try {
        await processCalendarEvent(state, {
          externalId: e.externalEventId,
          iCalUid: e.iCalUid,
          seriesId: e.seriesId,
          title: e.title,
          description: e.description,
          startsAt: e.startsAt,
          endsAt: e.endsAt,
          allDay: e.allDay,
          timezone: e.timezone,
          location: e.location,
          conferenceUrl: e.conferenceUrl,
          organizer: e.organizerEmail ? { name: e.organizerName, email: e.organizerEmail } : null,
          attendees: Array.isArray(e.attendees) ? (e.attendees as unknown as NormalizedCalendarEvent["attendees"]) : [],
          isRecurring: e.isRecurring,
          recurrence: e.recurrence,
          status: "CANCELLED",
          ceoResponse: e.ceoResponse,
          updatedAt: ctx.now,
        });
      } catch (error) {
        note(state, `Cancelling event ${e.externalEventId.slice(0, 60)} failed: ${errorText(error).slice(0, 160)}`);
      }
    }
  }
  const count = await markDeletedAtSource(db, conn.id, externalIds, ctx.now);
  if (conn.kind === "EMAIL" && count) {
    const threads = await db.emailMessage.findMany({ where: { sourceItem: { connectionId: conn.id, externalId: { in: externalIds } } }, select: { threadId: true } });
    for (const t of threads) state.touchedThreads.add(t.threadId);
  }
  return count;
}

// ─── Run + connection bookkeeping ────────────────────────────────────────────

function counterIncrements(c: Counters) {
  return {
    fetched: { increment: c.fetched },
    created: { increment: c.created },
    updated: { increment: c.updated },
    unchanged: { increment: c.unchanged },
    deleted: { increment: c.deleted },
    noise: { increment: c.noise },
    failed: { increment: c.failed },
    duplicatesPrevented: { increment: c.duplicates },
  };
}

function appendLog(run: IngestionRun, notes: string[]): Prisma.InputJsonValue | undefined {
  if (!notes.length) return undefined;
  const previous = Array.isArray(run.log) ? (run.log as unknown[]) : [];
  return [...previous, ...notes].slice(-100) as Prisma.InputJsonValue;
}

async function finishRun(run: IngestionRun, status: RunStatus, extra: { error?: string; notes?: string[] } = {}) {
  const now = new Date();
  await db.ingestionRun.update({
    where: { id: run.id },
    data: { status, completedAt: now, durationMs: now.getTime() - run.startedAt.getTime(), error: extra.error ?? null, log: appendLog(run, extra.notes ?? []) },
  });
}

/** Counters for a job that hands over to a continuation job. */
async function recordProgress(state: SyncState, cursor: SyncCursor | null) {
  const { conn, run, counters, ctx } = state;
  await db.ingestionRun.update({ where: { id: run.id }, data: { ...counterIncrements(counters), cursorAfter: (cursor ?? undefined) as Prisma.InputJsonValue | undefined, log: appendLog(run, state.notes) } });
  await db.sourceConnection.update({ where: { id: conn.id }, data: { lastSyncAt: ctx.now, itemsIngested: { increment: counters.created } } });
}

async function completeSync(state: SyncState, cursor: SyncCursor | null) {
  const { conn, run, counters, ctx } = state;
  const updated = await db.ingestionRun.update({ where: { id: run.id }, data: counterIncrements(counters) });
  const now = new Date();
  await db.ingestionRun.update({
    where: { id: run.id },
    data: {
      status: updated.failed > 0 ? "PARTIAL" : "SUCCEEDED",
      completedAt: now,
      durationMs: now.getTime() - run.startedAt.getTime(),
      cursorAfter: (cursor ?? undefined) as Prisma.InputJsonValue | undefined,
      error: null,
      log: appendLog(run, state.notes),
    },
  });
  await db.sourceConnection.update({
    where: { id: conn.id },
    data: {
      status: "CONNECTED",
      lastSyncAt: ctx.now,
      lastSuccessAt: ctx.now,
      lastError: null,
      consecutiveFailures: 0,
      nextSyncAt: nextSyncTime({ syncFrequency: conn.syncFrequency, consecutiveFailures: 0 }, ctx.now),
      itemsIngested: { increment: counters.created },
    },
  });
  if (conn.brainSourceId) {
    await db.brainSource
      .update({ where: { id: conn.brainSourceId }, data: { lastSyncAt: ctx.now, itemsIndexed: { increment: counters.created }, status: "CONNECTED", error: null } })
      .catch(() => {});
  }
}

async function recordFailure(state: SyncState, cursor: SyncCursor | null, error: unknown) {
  const { conn, run, counters, ctx } = state;
  const message = errorText(error);
  const now = new Date();
  await db.ingestionRun.update({
    where: { id: run.id },
    data: {
      ...counterIncrements(counters),
      status: "FAILED",
      error: message,
      completedAt: now,
      durationMs: now.getTime() - run.startedAt.getTime(),
      cursorAfter: (cursor ?? undefined) as Prisma.InputJsonValue | undefined,
      log: appendLog(run, state.notes),
    },
  });
  if (error instanceof ProviderAuthError) {
    // The worker does this too; doing it here keeps direct callers (scripts, tests) consistent.
    await db.sourceConnection.update({ where: { id: conn.id }, data: { status: "NEEDS_REAUTH", lastError: message, lastErrorAt: ctx.now } });
    return;
  }
  const failures = conn.consecutiveFailures + 1;
  await db.sourceConnection.update({
    where: { id: conn.id },
    data: {
      status: "ERROR",
      lastSyncAt: ctx.now,
      lastError: message,
      lastErrorAt: ctx.now,
      consecutiveFailures: failures,
      nextSyncAt: nextSyncTime({ syncFrequency: conn.syncFrequency, consecutiveFailures: failures }, ctx.now),
      itemsIngested: { increment: counters.created },
    },
  });
}

// ─── Push subscriptions ──────────────────────────────────────────────────────

/** Keep a provider push subscription alive for REALTIME connections (and drop it otherwise). Never fails the sync. */
async function ensureWebhook(state: SyncState, pctx: ProviderContext) {
  const { conn, ctx } = state;
  const subscriber = getWebhookSubscriber(conn);
  try {
    if (conn.syncFrequency !== "REALTIME" || !subscriber) {
      if (subscriber && conn.webhookChannelId) {
        await subscriber.unsubscribe(pctx, conn.webhookChannelId).catch(() => {});
        await db.sourceConnection.update({ where: { id: conn.id }, data: { webhookChannelId: null, webhookSecretHash: null, webhookExpiresAt: null } });
      }
      return;
    }
    if (conn.webhookChannelId && conn.webhookExpiresAt && conn.webhookExpiresAt.getTime() - Date.now() > WEBHOOK_RENEW_MS) return;
    const origin = appOrigin(null);
    if (!origin || !origin.startsWith("https://")) {
      note(state, "Push notifications need APP_ORIGIN set to a public https origin; using scheduled syncs");
      return;
    }
    const vendor = vendorOf(conn.provider);
    const callbackUrl = `${origin}/api/webhooks/${vendor}`;
    const { secret, hash } = newWebhookSecret();
    const sub = await subscriber.subscribe(pctx, { callbackUrl, secret });
    await db.sourceConnection.update({ where: { id: conn.id }, data: { webhookChannelId: sub.channelId, webhookSecretHash: hash, webhookExpiresAt: sub.expiresAt } });
    if (conn.webhookChannelId && conn.webhookChannelId !== sub.channelId) await subscriber.unsubscribe(pctx, conn.webhookChannelId).catch(() => {});
    ctx.log("SYNC", `${conn.label}: push subscription active until ${sub.expiresAt.toISOString()}`);
  } catch (error) {
    if (error instanceof ProviderAuthError) throw error;
    note(state, `Push subscription not renewed: ${errorText(error).slice(0, 200)}`);
    await db.ingestionRun.update({ where: { id: state.run.id }, data: { log: appendLog(state.run, state.notes) } }).catch(() => {});
  }
}
