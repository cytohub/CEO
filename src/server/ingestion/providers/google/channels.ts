/**
 * Google push channels (Calendar events.watch, Drive changes.watch).
 *
 * The channel token is the per-connection webhook secret; Google echoes it in
 * X-Goog-Channel-Token on every notification. Stopping a channel needs both
 * the channel id and Google's resource id, so the stored channel id is
 * "<channelId>|<resourceId>".
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ProviderContext } from "../../types";
import { ProviderHttpError, providerJson, providerSend } from "../http";

const watchResponse = z.object({ id: z.string(), resourceId: z.string(), expiration: z.string().optional() });

export function encodeChannelId(id: string, resourceId: string): string {
  return `${id}|${resourceId}`;
}

export function decodeChannelId(channelId: string): { id: string; resourceId: string | null } {
  const [id, resourceId] = channelId.split("|", 2);
  return { id, resourceId: resourceId ?? null };
}

export async function watchChannel(
  ctx: ProviderContext,
  url: string,
  opts: { callbackUrl: string; secret: string; ttlSeconds: number; query?: Record<string, string | boolean> },
): Promise<{ channelId: string; expiresAt: Date }> {
  const res = await providerJson(ctx, url, watchResponse, {
    method: "POST",
    query: opts.query,
    json: { id: randomUUID(), type: "web_hook", address: opts.callbackUrl, token: opts.secret, params: { ttl: String(opts.ttlSeconds) } },
  });
  const expiresAt = res.expiration ? new Date(Number(res.expiration)) : new Date(ctx.now.getTime() + opts.ttlSeconds * 1000);
  return { channelId: encodeChannelId(res.id, res.resourceId), expiresAt };
}

export async function stopChannel(ctx: ProviderContext, url: string, channelId: string): Promise<void> {
  const { id, resourceId } = decodeChannelId(channelId);
  if (!resourceId) return;
  try {
    await providerSend(ctx, url, { method: "POST", json: { id, resourceId } });
  } catch (error) {
    // Already expired or stopped.
    if (error instanceof ProviderHttpError && (error.status === 404 || error.status === 410)) return;
    throw error;
  }
}
