/**
 * Provider webhook handling. Webhook routes are outside the session proxy, so
 * each request authenticates itself (see webhook-verify.ts), is rate limited
 * per client, and only ever *queues* a sync (requestSync is idempotent while
 * one is pending) before answering quickly. Nothing is fetched or processed
 * inline, and request bodies are never logged.
 */
import { z } from "zod";
import type { ConnectionStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { audit } from "@/server/security/audit";
import { LIMITS, rateLimit } from "@/server/security/rate-limit";
import { requestSync } from "../scheduler";
import { decodeChannelId } from "./google/channels";
import { safeEchoToken, verifyDropboxSignature, verifySharedToken, verifyWebhookSecret } from "./webhook-verify";

const MAX_BODY_BYTES = 256 * 1024;
const SYNCABLE: ConnectionStatus[] = ["CONNECTED", "ERROR", "SYNCING"];

function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

async function limited(request: Request, vendor: string): Promise<Response | null> {
  const res = await rateLimit("webhook", `${vendor}:${clientIp(request)}`, LIMITS.webhook);
  return res.ok ? null : new Response("Too many requests", { status: 429, headers: { "retry-after": String(res.retryAfterSec) } });
}

async function readBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return null;
  const text = await request.text();
  return Buffer.byteLength(text) > MAX_BODY_BYTES ? null : text;
}

async function rejected(vendor: string, reason: string, targetId?: string) {
  await audit({ action: "webhook.rejected", actorLabel: `webhook:${vendor}`, outcome: "DENIED", targetType: "SourceConnection", targetId, metadata: { vendor, reason } });
}

/** Queue a WEBHOOK sync for each connection that can sync. */
async function queueSyncs(connectionIds: string[]): Promise<number> {
  let queued = 0;
  for (const id of [...new Set(connectionIds)]) {
    const conn = await db.sourceConnection.findUnique({ where: { id }, select: { status: true } });
    if (!conn || !SYNCABLE.includes(conn.status)) continue;
    const res = await requestSync(id, "WEBHOOK");
    if (res.queued) queued++;
  }
  return queued;
}

const accepted = () => new Response(null, { status: 202 });

// ─── Google (Calendar / Drive channels, Gmail via Pub/Sub) ───────────────────

const pubSubPush = z.object({
  message: z.object({ data: z.string().max(10_000).optional(), messageId: z.string().optional() }),
  subscription: z.string().optional(),
});
const gmailNotification = z.object({ emailAddress: z.string().email(), historyId: z.union([z.string(), z.number()]).optional() });

export async function handleGoogleWebhook(request: Request): Promise<Response> {
  const tooMany = await limited(request, "google");
  if (tooMany) return tooMany;
  const channelId = request.headers.get("x-goog-channel-id");

  // Calendar / Drive push channel: the channel token is the per-connection secret.
  if (channelId) {
    if (channelId.length > 200) return new Response(null, { status: 400 });
    const conn = await db.sourceConnection.findFirst({
      where: { webhookChannelId: { startsWith: `${channelId}|` }, provider: { in: ["GOOGLE_CALENDAR", "GOOGLE_DRIVE"] } },
      select: { id: true, webhookChannelId: true, webhookSecretHash: true },
    });
    const token = request.headers.get("x-goog-channel-token");
    const resourceId = request.headers.get("x-goog-resource-id");
    const expectedResource = conn?.webhookChannelId ? decodeChannelId(conn.webhookChannelId).resourceId : null;
    if (!conn || !verifyWebhookSecret(token, conn.webhookSecretHash) || (resourceId && expectedResource && resourceId !== expectedResource)) {
      await rejected("google", conn ? "channel token mismatch" : "unknown channel", conn?.id);
      return new Response(null, { status: 403 });
    }
    // "sync" is the handshake Google sends when a channel is created.
    if (request.headers.get("x-goog-resource-state") === "sync") return new Response(null, { status: 200 });
    await queueSyncs([conn.id]);
    return accepted();
  }

  // Gmail: Pub/Sub push with a deployment-level verification token in the endpoint URL.
  const expected = process.env.GOOGLE_PUBSUB_VERIFICATION_TOKEN;
  const presented = new URL(request.url).searchParams.get("token");
  if (!verifySharedToken(presented, expected)) {
    await rejected("google", expected ? "pubsub token mismatch" : "pubsub verification token not configured");
    return new Response(null, { status: 403 });
  }
  const body = await readBody(request);
  if (body === null) return new Response(null, { status: 413 });
  let parsed: z.infer<typeof pubSubPush>;
  try {
    parsed = pubSubPush.parse(JSON.parse(body));
  } catch {
    return new Response(null, { status: 400 });
  }
  let email: string | null = null;
  try {
    const data = gmailNotification.safeParse(JSON.parse(Buffer.from(parsed.message.data ?? "", "base64").toString("utf8")));
    email = data.success ? data.data.emailAddress.toLowerCase() : null;
  } catch {
    email = null;
  }
  // Acknowledge malformed messages so Pub/Sub does not redeliver them forever.
  if (!email) return accepted();
  const conns = await db.sourceConnection.findMany({ where: { provider: "GMAIL", mode: "LIVE", accountEmail: email }, select: { id: true } });
  await queueSyncs(conns.map((c) => c.id));
  return accepted();
}

// ─── Microsoft Graph ─────────────────────────────────────────────────────────

const graphNotifications = z.object({
  value: z
    .array(
      z.object({
        subscriptionId: z.string().max(200),
        clientState: z.string().max(512).nullish(),
        changeType: z.string().optional(),
        lifecycleEvent: z.string().optional(),
      }),
    )
    .max(1000),
});

export async function handleMicrosoftWebhook(request: Request): Promise<Response> {
  const tooMany = await limited(request, "microsoft");
  if (tooMany) return tooMany;

  // Subscription validation: echo the token as text/plain within 10 seconds.
  const validationToken = new URL(request.url).searchParams.get("validationToken");
  if (validationToken !== null) {
    const echo = safeEchoToken(validationToken);
    if (!echo) return new Response(null, { status: 400 });
    return new Response(echo, { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" } });
  }

  const body = await readBody(request);
  if (body === null) return new Response(null, { status: 413 });
  let parsed: z.infer<typeof graphNotifications>;
  try {
    parsed = graphNotifications.parse(JSON.parse(body));
  } catch {
    return new Response(null, { status: 400 });
  }

  const ids = [...new Set(parsed.value.map((n) => n.subscriptionId))];
  const conns = await db.sourceConnection.findMany({ where: { webhookChannelId: { in: ids } }, select: { id: true, webhookChannelId: true, webhookSecretHash: true } });
  const bySubscription = new Map(conns.map((c) => [c.webhookChannelId!, c]));
  const verified: string[] = [];
  const renew: string[] = [];
  let rejectedCount = 0;
  for (const n of parsed.value) {
    const conn = bySubscription.get(n.subscriptionId);
    if (!conn || !verifyWebhookSecret(n.clientState, conn.webhookSecretHash)) {
      rejectedCount++;
      continue;
    }
    verified.push(conn.id);
    if (n.lifecycleEvent === "reauthorizationRequired" || n.lifecycleEvent === "subscriptionRemoved") renew.push(conn.id);
  }
  if (rejectedCount) await rejected("microsoft", `${rejectedCount} notification(s) failed clientState verification`);
  if (!verified.length) return new Response(null, { status: rejectedCount ? 403 : 202 });
  // Lifecycle events: let the next sync recreate the subscription.
  if (renew.length) await db.sourceConnection.updateMany({ where: { id: { in: renew } }, data: { webhookExpiresAt: new Date() } });
  await queueSyncs(verified);
  return accepted();
}

// ─── Dropbox ─────────────────────────────────────────────────────────────────

const dropboxNotification = z.object({
  list_folder: z.object({ accounts: z.array(z.string().max(200)).max(10_000) }).optional(),
  delta: z.object({ users: z.array(z.union([z.number(), z.string()])).max(10_000) }).optional(),
});

/** Endpoint verification: echo the challenge. */
export async function handleDropboxChallenge(request: Request): Promise<Response> {
  const tooMany = await limited(request, "dropbox");
  if (tooMany) return tooMany;
  const challenge = safeEchoToken(new URL(request.url).searchParams.get("challenge"), 512);
  if (!challenge) return new Response(null, { status: 400 });
  return new Response(challenge, { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" } });
}

export async function handleDropboxWebhook(request: Request): Promise<Response> {
  const tooMany = await limited(request, "dropbox");
  if (tooMany) return tooMany;
  const body = await readBody(request);
  if (body === null) return new Response(null, { status: 413 });
  if (!verifyDropboxSignature(body, request.headers.get("x-dropbox-signature"), process.env.DROPBOX_APP_SECRET)) {
    await rejected("dropbox", process.env.DROPBOX_APP_SECRET ? "signature mismatch" : "app secret not configured");
    return new Response(null, { status: 403 });
  }
  let parsed: z.infer<typeof dropboxNotification>;
  try {
    parsed = dropboxNotification.parse(JSON.parse(body));
  } catch {
    return new Response(null, { status: 400 });
  }
  const accounts = parsed.list_folder?.accounts ?? [];
  if (accounts.length) {
    const conns = await db.sourceConnection.findMany({ where: { provider: "DROPBOX", mode: "LIVE", externalAccountId: { in: accounts } }, select: { id: true } });
    await queueSyncs(conns.map((c) => c.id));
  }
  return new Response(null, { status: 200 });
}
