import { z } from "zod";
import { Sensitivity, type SourceProvider } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { createPipelineContext } from "@/server/ingestion/context";
import { ingestDocumentRef } from "@/server/ingestion/documents/ingest";
import { drainQueue } from "@/server/ingestion/jobs/worker";
import { PROCESSING_STAGES } from "@/server/ingestion/pipeline";
import type { NormalizedDocumentRef } from "@/server/ingestion/types";
import { documentWhere, getAccessScope } from "@/server/security/access";
import { audit } from "@/server/security/audit";
import { sha256 } from "@/server/security/crypto";
import { MAX_UPLOAD_BYTES, validateUpload } from "@/server/security/files";
import { LIMITS, rateLimit } from "@/server/security/rate-limit";
import { forbiddenResponse, isSameOrigin } from "@/server/security/request";
import { type Viewer, can, getViewer } from "@/server/security/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Room for multipart boundaries and the small text fields around the file. */
const MULTIPART_OVERHEAD = 256 * 1024;
const MAX_BODY_BYTES = MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD;
/** Process the upload right away so the response can report the parsed result. */
const DRAIN_BUDGET_MS = 25_000;

const fieldsSchema = z.object({
  sensitivity: z.enum(Sensitivity).optional(),
  documentId: z
    .string()
    .regex(/^[a-z0-9]{20,40}$/i)
    .optional(),
});

const CONNECTION_SELECT = { id: true, provider: true, defaultSensitivity: true } as const;

function error(status: number, message: string, headers?: Record<string, string>) {
  return Response.json({ error: message }, { status, headers });
}

/** Reads the body but stops (and reports null) as soon as it exceeds `limit` — covers chunked uploads without Content-Length. */
async function readBodyLimited(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** The viewer's "Uploads" connection (one per user; serialized so concurrent first uploads don't create two). */
async function uploadConnectionFor(viewer: Viewer) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`uploads:${viewer.userId}`}))`;
    const existing = await tx.sourceConnection.findFirst({
      where: { provider: "LOCAL_UPLOAD", ownerUserId: viewer.userId, disconnectedAt: null },
      orderBy: { createdAt: "asc" },
      select: CONNECTION_SELECT,
    });
    if (existing) return existing;
    const catalog = await tx.brainSource.findUnique({ where: { key: "uploads" }, select: { id: true } });
    return tx.sourceConnection.create({
      data: {
        kind: "DOCUMENTS",
        provider: "LOCAL_UPLOAD",
        mode: "LIVE",
        label: "Uploads",
        accountEmail: viewer.email,
        status: "CONNECTED",
        syncFrequency: "MANUAL",
        ownerUserId: viewer.userId,
        brainSourceId: catalog?.id ?? null,
      },
      select: CONNECTION_SELECT,
    });
  });
}

/**
 * POST /api/uploads — multipart/form-data:
 *   file         the document (PDF, DOCX, PPTX, XLSX, CSV, TXT, MD, PNG/JPEG/WebP; ≤ 25 MB)
 *   sensitivity  optional INTERNAL | CONFIDENTIAL | RESTRICTED
 *   documentId   optional: upload a new version of an existing uploaded document
 *
 * Responds { documentId, sourceItemId, status, stage, outcome, version, format, title }.
 * The file is ingested and parsed before the response; later pipeline stages
 * run within a short budget and otherwise continue in the background queue.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return forbiddenResponse("Cross-site request blocked");
  const viewer = await getViewer();
  if (!viewer) return error(401, "Unauthorized");
  if (!can(viewer, "workspace.edit")) {
    await audit({ action: "auth.denied", viewer, outcome: "DENIED", metadata: { capability: "workspace.edit", route: "/api/uploads" } });
    return forbiddenResponse();
  }
  const limit = await rateLimit("upload", viewer.userId, LIMITS.upload);
  if (!limit.ok) return error(429, "Too many uploads — try again later.", { "Retry-After": String(limit.retryAfterSec) });

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) return error(415, "Send the file as multipart/form-data.");
  const declaredLength = Number(request.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return error(413, "The file is larger than the 25 MB upload limit.");

  const body = await readBodyLimited(request, MAX_BODY_BYTES);
  if (!body) return error(413, "The file is larger than the 25 MB upload limit.");
  let form: FormData;
  try {
    form = await new Response(body, { headers: { "content-type": contentType } }).formData();
  } catch {
    // Also what a body truncated by an intermediary looks like: the closing boundary is missing.
    return error(400, "The upload was incomplete or malformed. Please try again.");
  }

  const file = form.get("file");
  if (!(file instanceof File)) return error(400, "No file was uploaded.");
  const fields = fieldsSchema.safeParse({
    sensitivity: typeof form.get("sensitivity") === "string" && form.get("sensitivity") ? form.get("sensitivity") : undefined,
    documentId: typeof form.get("documentId") === "string" && form.get("documentId") ? form.get("documentId") : undefined,
  });
  if (!fields.success) return error(400, "Invalid upload options.");

  const bytes = Buffer.from(await file.arrayBuffer());
  const check = validateUpload({ filename: file.name, declaredType: file.type, bytes });
  if (!check.ok) {
    await audit({ action: "document.upload", viewer, outcome: "DENIED", targetType: "Document", metadata: { reason: check.reason, sizeBytes: bytes.length } });
    return error(file.size > MAX_UPLOAD_BYTES ? 413 : 415, check.reason);
  }

  // A new version of an existing upload: same Document, same connection.
  let connection: { id: string; provider: SourceProvider; defaultSensitivity: Sensitivity } | null = null;
  let externalId: string | null = null;
  if (fields.data.documentId) {
    const scope = await getAccessScope(viewer);
    const doc = await db.document.findFirst({
      where: { AND: [{ id: fields.data.documentId }, documentWhere(scope)] },
      select: { id: true, sourceItem: { select: { externalId: true, connection: { select: { ...CONNECTION_SELECT, ownerUserId: true } } } } },
    });
    if (!doc || doc.sourceItem.connection.provider !== "LOCAL_UPLOAD") return error(404, "Document not found.");
    if (doc.sourceItem.connection.ownerUserId !== viewer.userId && !scope.all) {
      await audit({ action: "document.upload", viewer, outcome: "DENIED", targetType: "Document", targetId: doc.id, metadata: { reason: "not the uploader" } });
      return forbiddenResponse("Only the person who uploaded this document can add a new version.");
    }
    connection = doc.sourceItem.connection;
    externalId = doc.sourceItem.externalId;
  }
  connection ??= await uploadConnectionFor(viewer);
  const sensitivity = fields.data.sensitivity ?? connection.defaultSensitivity;

  const hash = sha256(bytes);
  const now = new Date();
  const run = await db.ingestionRun.create({ data: { connectionId: connection.id, trigger: "UPLOAD", status: "RUNNING", fetched: 1 }, select: { id: true } });
  const ctx = await createPipelineContext({ runId: run.id, trigger: "UPLOAD", now });

  const ref: NormalizedDocumentRef = {
    externalId: externalId ?? `upload:${hash}`,
    title: check.safeName,
    mimeType: check.mimeType,
    sizeBytes: check.sizeBytes,
    createdAt: now,
    modifiedAt: now,
    author: viewer.name,
    path: null,
    webUrl: null,
    versionTag: hash,
    download: async () => bytes,
    raw: { filename: check.safeName, sizeBytes: check.sizeBytes, sha256: hash, uploadedBy: viewer.email },
  };

  let result: { sourceItemId: string; outcome: "created" | "updated" | "unchanged" };
  try {
    result = await ingestDocumentRef(ctx, { id: connection.id, provider: "LOCAL_UPLOAD", defaultSensitivity: sensitivity }, ref, { runId: run.id });
  } catch (err) {
    console.error("[uploads] ingest failed", err instanceof Error ? err.message : err);
    await db.ingestionRun
      .update({ where: { id: run.id }, data: { status: "FAILED", failed: 1, completedAt: new Date(), durationMs: Date.now() - now.getTime(), error: "Ingest failed" } })
      .catch(() => {});
    await audit({ action: "document.upload", viewer, outcome: "FAILURE", targetType: "Document", metadata: { filename: check.safeName, format: check.format } });
    return error(500, "The upload could not be processed. Please try again.");
  }

  // An explicit sensitivity also applies to new versions of an existing document.
  if (fields.data.sensitivity) {
    await db.sourceItem.update({ where: { id: result.sourceItemId }, data: { sensitivity } });
    await db.document.updateMany({ where: { sourceItemId: result.sourceItemId }, data: { sensitivity } });
  }

  await db.ingestionRun.update({
    where: { id: run.id },
    data: { [result.outcome]: { increment: 1 } },
  });
  await db.sourceConnection.update({
    where: { id: connection.id },
    data: { lastSyncAt: now, lastSuccessAt: now, ...(result.outcome === "created" ? { itemsIngested: { increment: 1 } } : {}) },
  });

  if (result.outcome !== "unchanged") {
    // Parse now (DOCUMENT_PARSE runs first by priority); extraction and writing follow
    // within the budget or later from the queue. Failures there never fail the upload.
    try {
      await drainQueue({ budgetMs: DRAIN_BUDGET_MS, types: PROCESSING_STAGES });
    } catch (err) {
      console.error("[uploads] processing deferred to the queue:", err instanceof Error ? err.message : err);
    }
  }

  const item = await db.sourceItem.findUnique({
    where: { id: result.sourceItemId },
    select: { id: true, status: true, stage: true, processingError: true, document: { select: { id: true, currentVersion: true, format: true, title: true } } },
  });
  await ctx.flush();
  await db.ingestionRun
    .update({
      where: { id: run.id },
      data: { status: item?.status === "FAILED" ? "PARTIAL" : "SUCCEEDED", completedAt: new Date(), durationMs: Date.now() - now.getTime(), failed: item?.status === "FAILED" ? 1 : 0 },
    })
    .catch(() => {});
  await audit({
    action: "document.upload",
    viewer,
    targetType: "Document",
    targetId: item?.document?.id,
    metadata: { filename: check.safeName, format: check.format, sizeBytes: check.sizeBytes, outcome: result.outcome, newVersionOf: fields.data.documentId ?? null },
  });

  return Response.json(
    {
      documentId: item?.document?.id ?? null,
      sourceItemId: result.sourceItemId,
      status: item?.status ?? "PENDING",
      stage: item?.stage ?? "RAW",
      outcome: result.outcome,
      version: item?.document?.currentVersion ?? null,
      format: item?.document?.format ?? check.format,
      title: item?.document?.title ?? check.safeName,
      error: item?.status === "FAILED" ? (item.processingError ?? "Processing failed") : undefined,
    },
    { status: result.outcome === "created" ? 201 : 200 },
  );
}
