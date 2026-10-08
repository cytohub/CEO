/**
 * Connect a key- or webhook-based source (HubSpot service key, Brex API
 * token, Granola API key, Read AI webhook signing key).
 *
 * - The key is checked against the vendor before anything is stored (Read AI
 *   signing keys are checked for shape; the first signed delivery proves them).
 * - It is stored AES-256-GCM encrypted in SourceConnection.credentials, used
 *   only server-side, and never sent back to a browser. Settings keep a hint
 *   (last four characters) so people can tell keys apart.
 * - Connecting, replacing and failures are audited without key material.
 */
import { Prisma, type SourceConnection } from "@/generated/prisma/client";
import type { SourceProvider } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { SOURCE_PROVIDERS } from "@/lib/intelligence";
import { audit } from "@/server/security/audit";
import { brainSourceIdFor, sealCredentials } from "../connections";
import { PROVIDER_SCOPES } from "../providers/oauth";
import { requestSync } from "../scheduler";
import { getBusinessConnector } from "./registry";
import { KeyRejectedError, type KeyVerification } from "./types";

export class KeyConnectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyConnectError";
  }
}

/** Keys are opaque tokens: printable, no whitespace, sane length. */
export function cleanKey(raw: string): string {
  const key = raw.trim();
  if (key.length < 16 || key.length > 4000) throw new KeyConnectError("That doesn’t look like a complete key. Copy it again from the vendor’s settings.");
  if (/[\s\u0000-\u001f\u007f]/.test(key)) throw new KeyConnectError("The key contains spaces or line breaks. Copy it again without extra characters.");
  return key;
}

export function keyHint(key: string): string {
  return `…${key.slice(-4)}`;
}

/** Read AI signing keys are base64; the first verified delivery confirms the key itself. */
function verifyWebhookKey(key: string): KeyVerification {
  const bytes = Buffer.from(key, "base64");
  if (bytes.length < 16 || !/^[A-Za-z0-9+/=_-]+$/.test(key)) throw new KeyRejectedError("That isn’t a Read AI signing key. Copy the signing key shown for the webhook in Read AI → Integrations → Webhooks.");
  return { accountName: "meeting reports webhook", externalAccountId: null, scopes: PROVIDER_SCOPES.READ_AI };
}

export async function connectWithKey(input: {
  provider: SourceProvider;
  key: string;
  viewer: { userId: string; email: string };
  /** Replace the key of this connection (same provider). */
  connectionId?: string | null;
}): Promise<{ connection: SourceConnection; replaced: boolean }> {
  const meta = SOURCE_PROVIDERS[input.provider];
  if (meta.auth !== "apiKey" && meta.auth !== "webhook") throw new KeyConnectError(`${meta.label} connects by signing in, not with a key.`);
  const key = cleanKey(input.key);

  let verification: KeyVerification;
  try {
    if (meta.auth === "webhook") verification = verifyWebhookKey(key);
    else {
      const connector = getBusinessConnector(input.provider);
      if (!connector?.verifyKey) throw new KeyConnectError(`${meta.label} can’t be connected yet.`);
      verification = await connector.verifyKey(key);
    }
  } catch (error) {
    const message = error instanceof KeyRejectedError || error instanceof KeyConnectError ? error.message : `${meta.label} couldn’t be reached to check the key. Try again in a minute.`;
    await audit({ action: "connection.key_rejected", viewer: input.viewer, outcome: "FAILURE", targetType: "SourceProvider", targetId: input.provider, metadata: { hint: keyHint(key), reason: message.slice(0, 200) } });
    throw new KeyConnectError(message);
  }

  const target = input.connectionId
    ? await db.sourceConnection.findUnique({ where: { id: input.connectionId } })
    : verification.externalAccountId
      ? await db.sourceConnection.findFirst({ where: { provider: input.provider, mode: "LIVE", externalAccountId: verification.externalAccountId }, orderBy: { createdAt: "desc" } })
      : await db.sourceConnection.findFirst({ where: { provider: input.provider, mode: "LIVE", status: { not: "DISCONNECTED" } }, orderBy: { createdAt: "desc" } });
  if (input.connectionId && (!target || target.provider !== input.provider)) throw new KeyConnectError("That connection can’t be updated.");

  const previousSettings = target?.settings && typeof target.settings === "object" && !Array.isArray(target.settings) ? (target.settings as Record<string, unknown>) : {};
  const scopes = verification.scopes?.length ? verification.scopes : PROVIDER_SCOPES[input.provider];
  const credentials = sealCredentials({ accessToken: key, refreshToken: null, expiresAt: null, scope: scopes.join(" "), tokenType: "Bearer" });
  const brainSourceId = await brainSourceIdFor(input.provider);
  const account = verification.accountName ?? verification.accountEmail ?? "account";
  // "HubSpot 4455667" already names the vendor; don't repeat it.
  const label = (account.toLowerCase().startsWith(meta.label.toLowerCase()) ? account : `${meta.label} · ${account}`).slice(0, 200);
  const common = {
    mode: "LIVE" as const,
    status: "CONNECTED" as const,
    accountEmail: verification.accountEmail ?? null,
    externalAccountId: verification.externalAccountId,
    scopes,
    credentials,
    tokenExpiresAt: null,
    ownerUserId: input.viewer.userId,
    brainSourceId,
    lastError: null,
    lastErrorAt: null,
    consecutiveFailures: 0,
    disconnectedAt: null,
    nextSyncAt: null,
    settings: { ...previousSettings, ...(verification.settings ?? {}), keyHint: keyHint(key) } as Prisma.InputJsonValue,
  };

  let connection: SourceConnection;
  const replaced = Boolean(target);
  if (target) {
    // A key for a different account must not continue the old account's cursor.
    const accountChanged = Boolean(target.externalAccountId && verification.externalAccountId && target.externalAccountId !== verification.externalAccountId);
    connection = await db.sourceConnection.update({
      where: { id: target.id },
      data: { ...common, label, ...(accountChanged ? { cursor: Prisma.DbNull } : {}) },
    });
  } else {
    connection = await db.sourceConnection.create({
      // Webhook sources are pushed to, never polled.
      data: { ...common, kind: meta.kind, provider: input.provider, label, syncFrequency: meta.auth === "webhook" ? "MANUAL" : "HOURLY" },
    });
  }
  if (brainSourceId) await db.brainSource.update({ where: { id: brainSourceId }, data: { status: "CONNECTED", error: null } }).catch(() => {});

  await audit({
    action: replaced ? "connection.key_replaced" : "connection.connect",
    viewer: input.viewer,
    targetType: "SourceConnection",
    targetId: connection.id,
    metadata: { provider: input.provider, mode: "LIVE", account: verification.accountName ?? verification.accountEmail ?? null, hint: keyHint(key), scopes },
  });
  const user = await db.user.findUnique({ where: { id: input.viewer.userId }, select: { name: true } });
  await db.activity.create({
    data: {
      type: "SOURCE_CONNECTED",
      summary: `${replaced ? "Updated the key for" : "Connected"} ${label}`,
      actor: user?.name ?? input.viewer.email,
      metadata: { connectionId: connection.id, provider: input.provider, mode: "LIVE" },
    },
  });
  // Webhook sources receive data when the vendor posts; everything else syncs now.
  if (meta.auth !== "webhook") await requestSync(connection.id, "MANUAL");
  return { connection, replaced };
}
