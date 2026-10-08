import type { SourceConnection } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { BRAIN_SOURCE_KEY } from "@/server/brain/connectors";
import { type MeetingNoteInput, ingestMeetingNote } from "@/server/ingestion/business/meeting-notes";
import { readAiNote, readCappedBody, verifyReadAiSignature } from "@/server/ingestion/business/read-ai";
import { connectionSettings, decryptCredentials } from "@/server/ingestion/connections";
import { audit } from "@/server/security/audit";
import { LIMITS, rateLimit } from "@/server/security/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Read AI meeting reports (user or workspace webhook, "meeting_end").
 *
 * Outside the session proxy, so each delivery proves itself: X-Read-Signature
 * must be the HMAC-SHA256 of the raw body under the signing key of a
 * connected Read AI source (stored encrypted, compared in constant time).
 * The report is stored as meeting notes and queued for extraction in the same
 * request, with an IngestionRun so it shows in Settings → Integrations.
 *
 * Payloads are never logged or echoed. Read AI retries non-2xx responses, and
 * storing a report twice is a no-op, so failures answer 500 and wait for the retry.
 */

const MAX_BODY_BYTES = 5 * 1024 * 1024;

function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

async function rejected(reason: string) {
  await audit({ action: "webhook.rejected", actorLabel: "webhook:read-ai", outcome: "DENIED", targetType: "SourceProvider", targetId: "READ_AI", metadata: { vendor: "read-ai", reason } });
}

/** The connected Read AI source whose signing key produced this signature. */
async function signingConnection(body: Buffer, signature: string): Promise<SourceConnection | null> {
  const candidates = await db.sourceConnection.findMany({
    where: { provider: "READ_AI", mode: "LIVE", status: { not: "DISCONNECTED" }, credentials: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  for (const conn of candidates) {
    const key = decryptCredentials(conn.credentials)?.accessToken;
    if (key && verifyReadAiSignature(body, signature, key)) return conn;
  }
  return null;
}

async function storeReport(conn: SourceConnection, note: MeetingNoteInput): Promise<void> {
  const started = new Date();
  const run = await db.ingestionRun.create({ data: { connectionId: conn.id, trigger: "WEBHOOK", startedAt: started }, select: { id: true } });
  const ctx = {
    connection: {
      id: conn.id,
      provider: conn.provider,
      label: conn.label,
      accountEmail: conn.accountEmail,
      externalAccountId: conn.externalAccountId,
      settings: connectionSettings(conn),
      defaultSensitivity: conn.defaultSensitivity,
      syncFrequency: conn.syncFrequency,
      sourceKey: BRAIN_SOURCE_KEY.READ_AI,
    },
    runId: run.id,
    now: started,
  };
  try {
    const outcome = await ingestMeetingNote(ctx, note);
    const created = outcome === "created" ? 1 : 0;
    const done = new Date();
    await db.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCEEDED",
        completedAt: done,
        durationMs: done.getTime() - started.getTime(),
        fetched: 1,
        created,
        updated: outcome === "updated" ? 1 : 0,
        unchanged: outcome === "unchanged" || outcome === "skipped" ? 1 : 0,
        log: outcome === "skipped" ? ["Meeting report too short to extract anything from"] : undefined,
      },
    });
    await db.sourceConnection.update({
      where: { id: conn.id },
      data: { status: "CONNECTED", lastSyncAt: done, lastSuccessAt: done, lastError: null, consecutiveFailures: 0, itemsIngested: { increment: created } },
    });
    if (conn.brainSourceId) {
      await db.brainSource
        .update({ where: { id: conn.brainSourceId }, data: { lastSyncAt: done, itemsIndexed: { increment: created }, status: "CONNECTED", error: null } })
        .catch(() => {});
    }
  } catch (error) {
    const done = new Date();
    const message = "A Read AI meeting report could not be stored; Read AI will resend it";
    await db.ingestionRun
      .update({ where: { id: run.id }, data: { status: "FAILED", completedAt: done, durationMs: done.getTime() - started.getTime(), fetched: 1, failed: 1, error: message } })
      .catch(() => {});
    await db.sourceConnection
      .update({ where: { id: conn.id }, data: { status: "ERROR", lastSyncAt: done, lastError: message, lastErrorAt: done, consecutiveFailures: { increment: 1 } } })
      .catch(() => {});
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const limit = await rateLimit("webhook", `read-ai:${clientIp(request)}`, LIMITS.webhook);
    if (!limit.ok) return new Response("Too many requests", { status: 429, headers: { "retry-after": String(limit.retryAfterSec) } });

    const signature = request.headers.get("x-read-signature");
    if (!signature) {
      // Webhooks created in Read AI before signing existed (March 2026) send none.
      await rejected("missing signature");
      return new Response(null, { status: 401 });
    }
    const body = await readCappedBody(request, MAX_BODY_BYTES);
    if (!body) return new Response(null, { status: 413 });

    const conn = await signingConnection(body, signature);
    if (!conn) {
      await rejected("signature mismatch");
      return new Response(null, { status: 401 });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body.toString("utf8"));
    } catch {
      return new Response(null, { status: 400 });
    }
    const note = readAiNote(payload);
    // meeting_start deliveries carry no report; a paused source accepts and drops deliveries so Read AI keeps the webhook active.
    if (!note || conn.status === "PAUSED") return Response.json({ ok: true, ignored: true });

    await storeReport(conn, note);
    return Response.json({ ok: true });
  } catch (error) {
    console.error(`[webhook:read-ai] delivery failed (${error instanceof Error ? error.name : "unknown error"})`);
    return new Response(null, { status: 500 });
  }
}
