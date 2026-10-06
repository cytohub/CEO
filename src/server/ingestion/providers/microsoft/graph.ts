/**
 * Microsoft Graph helpers shared by Outlook Mail, Outlook Calendar, OneDrive
 * and SharePoint: delta paging, JSON batching, date-time parsing and change
 * notification subscriptions (clientState = per-connection secret).
 */
import { z } from "zod";
import { tzOffsetMinutes } from "@/lib/dates";
import { CursorExpiredError, type ProviderContext } from "../../types";
import { ProviderHttpError, assertHost, providerJson, providerSend } from "../http";

export const GRAPH = "https://graph.microsoft.com/v1.0";
const GRAPH_HOSTS = ["graph.microsoft.com"];

const deltaPage = z.object({
  value: z.array(z.unknown()).optional(),
  "@odata.nextLink": z.string().optional(),
  "@odata.deltaLink": z.string().optional(),
});

export interface DeltaPage<T> {
  items: T[];
  nextLink: string | null;
  deltaLink: string | null;
}

/**
 * Fetch one delta page. Items failing the schema are skipped (not fatal) so
 * one odd item cannot block a mailbox. 410 / resync errors → CursorExpiredError.
 */
export async function graphDeltaPage<T>(
  ctx: ProviderContext,
  url: string,
  itemSchema: z.ZodType<T>,
  opts: { prefer?: string[]; query?: Record<string, string | number | undefined> } = {},
): Promise<DeltaPage<T>> {
  assertHost(url, GRAPH_HOSTS);
  let res: z.infer<typeof deltaPage>;
  try {
    res = await providerJson(ctx, url, deltaPage, { headers: opts.prefer?.length ? { prefer: opts.prefer.join(", ") } : undefined, query: opts.query });
  } catch (error) {
    if (error instanceof ProviderHttpError && (error.status === 410 || /resync|syncstatenotfound|syncstateinvalid/i.test(error.code ?? ""))) {
      throw new CursorExpiredError("Microsoft Graph delta token expired; full resync required");
    }
    throw error;
  }
  const items: T[] = [];
  for (const raw of res.value ?? []) {
    const parsed = itemSchema.safeParse(raw);
    if (parsed.success) items.push(parsed.data);
    else ctx.log(`graph: skipped an item with an unexpected shape (${parsed.error.issues[0]?.path.join(".") ?? "?"})`);
  }
  return { items, nextLink: res["@odata.nextLink"] ?? null, deltaLink: res["@odata.deltaLink"] ?? null };
}

const batchResponse = z.object({
  responses: z.array(z.object({ id: z.string(), status: z.number(), body: z.unknown().optional() })),
});

/** JSON batching (max 20 requests per call). Returns bodies of successful sub-requests by id. */
export async function graphBatch(ctx: ProviderContext, requests: { id: string; url: string }[]): Promise<Map<string, unknown>> {
  const out = new Map<string, unknown>();
  for (let i = 0; i < requests.length; i += 20) {
    const chunk = requests.slice(i, i + 20);
    const res = await providerJson(ctx, `${GRAPH}/$batch`, batchResponse, {
      method: "POST",
      json: { requests: chunk.map((r) => ({ id: r.id, method: "GET", url: r.url })) },
    });
    for (const r of res.responses) if (r.status >= 200 && r.status < 300) out.set(r.id, r.body);
  }
  return out;
}

/**
 * Graph dateTimeTimeZone → instant. With `Prefer: outlook.timezone="UTC"`
 * times arrive in UTC; IANA zones are converted; unknown (Windows) zone
 * names fall back to UTC.
 */
export function parseGraphDateTime(dateTime: string, timeZone?: string | null): Date {
  const trimmed = dateTime.replace(/(\.\d{3})\d+/, "$1");
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed)) return new Date(trimmed);
  const asUtc = new Date(`${trimmed}Z`);
  const tz = timeZone?.trim();
  if (!tz || /^(utc|gmt|etc\/utc|coordinated universal time)$/i.test(tz)) return asUtc;
  try {
    const offset = tzOffsetMinutes(asUtc, tz);
    const guess = new Date(asUtc.getTime() - offset * 60_000);
    const offset2 = tzOffsetMinutes(guess, tz);
    return offset2 === offset ? guess : new Date(asUtc.getTime() - offset2 * 60_000);
  } catch {
    return asUtc;
  }
}

// ─── Subscriptions ───────────────────────────────────────────────────────────

const subscriptionSchema = z.object({ id: z.string(), expirationDateTime: z.string() });

/** Max lifetimes: Outlook messages/events 10,070 min, driveItem 42,300 min. Stay well under. */
export const SUBSCRIPTION_MINUTES = { outlook: 4_200, drive: 40_000 } as const;

export async function createGraphSubscription(
  ctx: ProviderContext,
  opts: { resource: string; changeType: string; callbackUrl: string; secret: string; minutes: number },
): Promise<{ channelId: string; expiresAt: Date }> {
  const expiration = new Date(Date.now() + opts.minutes * 60_000);
  const res = await providerJson(ctx, `${GRAPH}/subscriptions`, subscriptionSchema, {
    method: "POST",
    json: {
      changeType: opts.changeType,
      notificationUrl: opts.callbackUrl,
      resource: opts.resource,
      expirationDateTime: expiration.toISOString(),
      clientState: opts.secret,
    },
  });
  return { channelId: res.id, expiresAt: new Date(res.expirationDateTime) };
}

export async function deleteGraphSubscription(ctx: ProviderContext, subscriptionId: string): Promise<void> {
  try {
    await providerSend(ctx, `${GRAPH}/subscriptions/${encodeURIComponent(subscriptionId)}`, { method: "DELETE" });
  } catch (error) {
    if (error instanceof ProviderHttpError && error.status === 404) return;
    throw error;
  }
}

export const graphRecipient = z.object({
  emailAddress: z.object({ name: z.string().nullish(), address: z.string().nullish() }).nullish(),
});

export function recipientToParticipant(r: z.infer<typeof graphRecipient> | null | undefined): { name: string | null; email: string } | null {
  const address = r?.emailAddress?.address?.trim().toLowerCase();
  if (!address || !address.includes("@")) return null;
  const name = r?.emailAddress?.name?.trim();
  return { name: name && name.toLowerCase() !== address ? name : null, email: address };
}
