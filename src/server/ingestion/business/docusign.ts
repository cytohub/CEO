/**
 * DocuSign connector (eSignature REST API v2.1, OAuth scope "signature
 * extended", read-only).
 *
 *   changes:      GET {baseUri}/restapi/v2.1/accounts/{accountId}/envelopes
 *                 from_date = cursor.since (first sync: now − initialDays),
 *                 recipients included, paged with start_position.
 *   outstanding:  later syncs also list envelopes still out for signature
 *                 (status sent/delivered, same window), because an envelope
 *                 becomes stalled without its status ever changing again.
 *
 * Nothing is stored except Brain signals, each once per envelope and event:
 *   - waiting for the CEO's own signature (approval request in the inbox),
 *   - sent by the CEO and unsigned for more than stallDays (risk),
 *   - completed (development), declined (risk), voided (risk).
 * Pending-signature state is signalled on the first sync too; completions,
 * declines and voids older than a week stay quiet then.
 *
 * Signals link to an existing company by the counterparty's email domain;
 * DocuSign never creates companies.
 */
import { z } from "zod";
import { DAY_MS } from "@/lib/dates";
import { db } from "@/lib/db";
import { providerJson } from "../providers/http";
import { safeDocusignBaseUri } from "../providers/oauth";
import { ProviderAuthError } from "../types";
import { type SignalInput, emitSignal, findPersonByEmail, normalizeDomain } from "./helpers";
import type { BusinessConnector, ConnectorSyncContext } from "./types";

const PAGE_SIZE = 100;
/** 50 pages × 100 envelopes per sync; the rest continues next run from the cursor. */
const MAX_PAGES = 50;
const DEFAULT_INITIAL_DAYS = 90;
const DEFAULT_STALL_DAYS = 7;
/** On the first sync, completions, declines and voids older than this stay quiet. */
const INITIAL_QUIET_DAYS = 7;
const PENDING = new Set(["sent", "delivered"]);

// ─── API shapes (lenient: only the fields used here) ─────────────────────────

const text = z.string().nullish();
const numberish = z.union([z.string(), z.number()]).nullish();

const signerSchema = z.object({
  name: text,
  email: text,
  status: text,
  routingOrder: numberish,
  declinedReason: text,
  sentDateTime: text,
  deliveredDateTime: text,
  declinedDateTime: text,
});

export const envelopeSchema = z.object({
  envelopeId: z.string().min(1),
  status: text,
  emailSubject: text,
  sentDateTime: text,
  statusChangedDateTime: text,
  completedDateTime: text,
  declinedDateTime: text,
  voidedDateTime: text,
  voidedReason: text,
  sender: z.object({ userName: text, email: text }).nullish(),
  recipients: z.object({ signers: z.array(signerSchema).nullish() }).nullish(),
});

export type DocusignEnvelope = z.infer<typeof envelopeSchema>;
type Signer = z.infer<typeof signerSchema>;

/** Paging fields arrive as strings ("99"); envelopes are validated one by one. */
const pageSchema = z.object({
  envelopes: z.array(z.unknown()).nullish(),
  resultSetSize: numberish,
  totalSetSize: numberish,
  startPosition: numberish,
  endPosition: numberish,
  nextUri: text,
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toInt(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t);
}

function lower(email: string | null | undefined): string | null {
  const e = email?.trim().toLowerCase();
  return e && e.includes("@") ? e : null;
}

/** A positive number from settings (numbers or numeric strings), else the default. */
function settingDays(value: unknown, fallback: number, max: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : fallback;
}

function subjectOf(env: DocusignEnvelope): string {
  return env.emailSubject?.trim() || "Untitled envelope";
}

function signersOf(env: DocusignEnvelope): Signer[] {
  return [...(env.recipients?.signers ?? [])].sort((a, b) => (toInt(a.routingOrder) ?? 0) - (toInt(b.routingOrder) ?? 0));
}

function who(s: Pick<Signer, "name" | "email">): string {
  return s.name?.trim() || s.email?.trim() || "a signer";
}

function names(signers: Signer[]): string {
  const list = signers.map(who);
  if (list.length <= 3) return list.join(", ");
  return `${list.slice(0, 3).join(", ")} and ${list.length - 3} more`;
}

function daysAgo(at: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - at.getTime()) / DAY_MS));
}

function isoDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "an unknown date";
}

/**
 * The other side of the agreement: the first signer outside the CEO's own
 * domain (in routing order), else an outside sender.
 */
export function counterpartyEmail(env: DocusignEnvelope, ceoEmail: string | null): string | null {
  const ownDomain = normalizeDomain(ceoEmail);
  const external = (email: string | null | undefined) => {
    const e = lower(email);
    if (!e || e === ceoEmail) return null;
    const domain = normalizeDomain(e);
    return domain && domain !== ownDomain ? e : null;
  };
  for (const s of signersOf(env)) {
    const e = external(s.email);
    if (e) return e;
  }
  return external(env.sender?.email);
}

// ─── Signal decisions ────────────────────────────────────────────────────────

export interface EnvelopeSignal extends Omit<SignalInput, "companyId" | "personId" | "dealId"> {
  /** Person the signal is about (sender, decliner, pending signer…), when known. */
  personEmail: string | null;
  /** Counterparty whose domain may identify an existing company. */
  counterpartyEmail: string | null;
}

export interface EnvelopeSignalOptions {
  /** The CEO's DocuSign email (the account that signed in). */
  ceoEmail: string | null;
  now: Date;
  /** First sync: old completions, declines and voids stay quiet. */
  initial: boolean;
  stallDays: number;
}

/** The signals an envelope's current state calls for (each has a stable externalId). */
export function envelopeSignals(env: DocusignEnvelope, opts: EnvelopeSignalOptions): EnvelopeSignal[] {
  const ceo = lower(opts.ceoEmail);
  const status = env.status?.toLowerCase() ?? "";
  const subject = subjectOf(env);
  const signers = signersOf(env);
  const sender = env.sender ?? null;
  const senderEmail = lower(sender?.email);
  const senderName = sender?.userName?.trim() || sender?.email?.trim() || "someone";
  const counterparty = counterpartyEmail(env, ceo);
  const sentAt = toDate(env.sentDateTime);
  const changedAt = toDate(env.statusChangedDateTime);
  const out: EnvelopeSignal[] = [];
  const base = { kind: "DOCUMENT" as const, counterpartyEmail: counterparty };

  if (PENDING.has(status)) {
    // Waiting for the CEO's own signature.
    const mine = ceo ? signers.find((s) => lower(s.email) === ceo && PENDING.has(s.status?.toLowerCase() ?? "")) : undefined;
    if (mine) {
      const others = signers.filter((s) => s !== mine);
      const when = toDate(mine.sentDateTime) ?? sentAt ?? changedAt ?? opts.now;
      out.push({
        ...base,
        externalId: `docusign:${env.envelopeId}:awaiting-ceo`,
        title: `Waiting for your signature: ${subject}`,
        body: [`Sent by ${senderName} on ${isoDate(sentAt)}.`, others.length ? `Other signers: ${names(others)}.` : null].filter(Boolean).join(" "),
        occurredAt: when,
        personEmail: senderEmail !== ceo ? senderEmail : lower(others[0]?.email),
        metadata: {
          signalType: "approval_request",
          requiresCeo: true,
          importance: 4,
          urgency: 4,
          whyCeo: "You are a signer on this agreement, and it can’t complete until you sign.",
          recommendedAction: "Review and sign in DocuSign",
          summary: `${senderName} sent “${subject}” for your signature.`,
          envelopeId: env.envelopeId,
        },
      });
    }

    // Sent by the CEO and still unsigned after stallDays.
    if (ceo && senderEmail === ceo && sentAt && opts.now.getTime() - sentAt.getTime() > opts.stallDays * DAY_MS) {
      const outstanding = signers.filter((s) => lower(s.email) !== ceo && !["completed", "signed", "declined"].includes(s.status?.toLowerCase() ?? ""));
      const current = outstanding.filter((s) => PENDING.has(s.status?.toLowerCase() ?? ""));
      const waitingOn = current.length ? current : outstanding;
      // Only the CEO's own signature missing: the awaiting-signature signal covers it.
      if (waitingOn.length) {
        const days = daysAgo(sentAt, opts.now);
        const list = names(waitingOn);
        out.push({
          ...base,
          externalId: `docusign:${env.envelopeId}:stalled`,
          title: `Unsigned for ${days} days: ${subject} (waiting on ${list})`,
          body: `You sent this on ${isoDate(sentAt)}; ${list} ${waitingOn.length === 1 ? "has" : "have"} not signed yet.`,
          occurredAt: new Date(Math.min(opts.now.getTime(), sentAt.getTime() + opts.stallDays * DAY_MS)),
          personEmail: lower(waitingOn[0]?.email),
          metadata: {
            signalType: "risk",
            importance: 3,
            summary: `“${subject}” has been out for signature for ${days} days.`,
            recommendation: `Nudge ${list} or resend the envelope from DocuSign.`,
            envelopeId: env.envelopeId,
          },
        });
      }
    }
    return out;
  }

  // Terminal events: on the first sync only recent ones are news.
  const recent = (at: Date) => !opts.initial || opts.now.getTime() - at.getTime() <= INITIAL_QUIET_DAYS * DAY_MS;

  if (status === "completed") {
    const at = toDate(env.completedDateTime) ?? changedAt;
    if (at && recent(at)) {
      const others = signers.filter((s) => lower(s.email) !== ceo);
      out.push({
        ...base,
        externalId: `docusign:${env.envelopeId}:completed`,
        title: `Signed: ${subject}`,
        body: [signers.length ? `Signed by ${names(signers)}.` : null, `Sent by ${senderName} on ${isoDate(sentAt)}.`].filter(Boolean).join(" "),
        occurredAt: at,
        personEmail: lower(others[0]?.email) ?? (senderEmail !== ceo ? senderEmail : null),
        metadata: { signalType: "development", importance: 3, summary: `“${subject}” is fully signed.`, envelopeId: env.envelopeId },
      });
    }
  } else if (status === "declined") {
    const decliner = signers.find((s) => s.status?.toLowerCase() === "declined");
    const at = toDate(env.declinedDateTime) ?? toDate(decliner?.declinedDateTime) ?? changedAt;
    if (at && recent(at)) {
      const name = decliner ? who(decliner) : "a signer";
      const reason = decliner?.declinedReason?.trim();
      out.push({
        ...base,
        externalId: `docusign:${env.envelopeId}:declined`,
        title: `Declined: ${subject} — ${name}${reason ? `, ${reason}` : ""}`,
        body: `${name} declined to sign${reason ? `: “${reason}”` : ""}. Sent by ${senderName} on ${isoDate(sentAt)}.`,
        occurredAt: at,
        personEmail: lower(decliner?.email),
        metadata: {
          signalType: "risk",
          importance: 4,
          summary: `${name} declined “${subject}”.`,
          recommendation: `Find out what ${name} objects to, then revise and resend or close it out.`,
          envelopeId: env.envelopeId,
        },
      });
    }
  } else if (status === "voided") {
    const at = toDate(env.voidedDateTime) ?? changedAt;
    if (at && recent(at)) {
      const reason = env.voidedReason?.trim();
      out.push({
        ...base,
        externalId: `docusign:${env.envelopeId}:voided`,
        title: `Voided: ${subject}${reason ? ` — ${reason}` : ""}`,
        body: `The envelope sent by ${senderName} on ${isoDate(sentAt)} was voided${reason ? `: “${reason}”` : ""}.`,
        occurredAt: at,
        personEmail: senderEmail !== ceo ? senderEmail : null,
        metadata: { signalType: "risk", importance: 3, summary: `“${subject}” was voided before it was signed.`, envelopeId: env.envelopeId },
      });
    }
  }
  return out;
}

// ─── Listing ─────────────────────────────────────────────────────────────────

/** API root for the connection's DocuSign account, re-validated on every run. */
export function docusignAccountUrl(settings: Record<string, unknown>): string {
  const accountId = typeof settings.accountId === "string" ? settings.accountId.trim() : "";
  const baseUri = typeof settings.baseUri === "string" ? safeDocusignBaseUri(settings.baseUri) : null;
  if (!baseUri || !/^[A-Za-z0-9-]{1,64}$/.test(accountId)) {
    throw new ProviderAuthError("DocuSign account details are missing. Reconnect DocuSign in Settings → Integrations.");
  }
  return `${baseUri}/restapi/v2.1/accounts/${accountId}`;
}

export interface EnvelopePage {
  envelopes: DocusignEnvelope[];
  /** Entries that did not parse (no envelope id). */
  skipped: number;
  /** Last page allowed in one run, with more still to come. */
  truncated: boolean;
}

/** Page through /envelopes with start_position until totalSetSize (or nextUri) says there is no more. */
export async function* listEnvelopes(
  ctx: Pick<ConnectorSyncContext, "http">,
  accountUrl: string,
  query: Record<string, string>,
  opts: { pageSize?: number; maxPages?: number } = {},
): AsyncGenerator<EnvelopePage> {
  const count = opts.pageSize ?? PAGE_SIZE;
  const maxPages = opts.maxPages ?? MAX_PAGES;
  let start = 0;
  for (let page = 0; page < maxPages; page++) {
    const res = await providerJson(ctx.http, `${accountUrl}/envelopes`, pageSchema, {
      query: { ...query, include: "recipients", order_by: "last_modified", order: "asc", count, start_position: start },
    });
    const raw = res.envelopes ?? [];
    const envelopes: DocusignEnvelope[] = [];
    for (const item of raw) {
      const parsed = envelopeSchema.safeParse(item);
      if (parsed.success) envelopes.push(parsed.data);
    }
    const end = toInt(res.endPosition);
    const next = end != null && end >= start ? end + 1 : start + raw.length;
    const total = toInt(res.totalSetSize);
    const more = raw.length > 0 && next > start && (total != null ? next < total : Boolean(res.nextUri));
    yield { envelopes, skipped: raw.length - envelopes.length, truncated: more && page === maxPages - 1 };
    if (!more) return;
    start = next;
  }
}

// ─── Sync ────────────────────────────────────────────────────────────────────

/** Database lookups and writes, replaceable in tests. */
export interface DocusignDeps {
  emitSignal: typeof emitSignal;
  findPersonByEmail: typeof findPersonByEmail;
  findCompanyIdByDomain(domain: string): Promise<string | null>;
}

const defaultDeps: DocusignDeps = {
  emitSignal,
  findPersonByEmail,
  async findCompanyIdByDomain(domain) {
    const row = await db.company.findFirst({ where: { domain: { equals: domain, mode: "insensitive" } }, select: { id: true } });
    return row?.id ?? null;
  },
};

export async function syncDocusign(ctx: ConnectorSyncContext, deps: DocusignDeps = defaultDeps): Promise<void> {
  const accountUrl = docusignAccountUrl(ctx.connection.settings);
  const settings = ctx.connection.settings;
  const initialDays = settingDays(settings.initialDays, DEFAULT_INITIAL_DAYS, 3650);
  const stallDays = settingDays(settings.stallDays, DEFAULT_STALL_DAYS, 365);
  const ceoEmail = lower(ctx.connection.accountEmail ?? ctx.pipeline?.ceo?.email);
  if (!ceoEmail) ctx.note("DocuSign account email unknown: signature requests and stalled envelopes can’t be attributed to you.");
  const opts: EnvelopeSignalOptions = { ceoEmail, now: ctx.now, initial: ctx.initial, stallDays };

  const windowStart = new Date(ctx.now.getTime() - initialDays * DAY_MS).toISOString();
  const since = typeof ctx.cursor?.since === "string" && toDate(ctx.cursor.since) ? ctx.cursor.since : windowStart;

  const companies = new Map<string, string | null>();
  const people = new Map<string, string | null>();
  const companyFor = async (email: string | null) => {
    const domain = normalizeDomain(email);
    if (!domain || domain === normalizeDomain(ceoEmail)) return null;
    if (!companies.has(domain)) companies.set(domain, await deps.findCompanyIdByDomain(domain));
    return companies.get(domain) ?? null;
  };
  const personFor = async (email: string | null) => {
    if (!email) return null;
    if (!people.has(email)) people.set(email, await deps.findPersonByEmail(email));
    return people.get(email) ?? null;
  };

  const seen = new Set<string>();
  let maxChanged = toDate(since)!;
  const handle = async (env: DocusignEnvelope) => {
    if (seen.has(env.envelopeId)) return;
    seen.add(env.envelopeId);
    ctx.count("fetched");
    const changed = toDate(env.statusChangedDateTime);
    if (changed && changed > maxChanged) maxChanged = changed;
    let created = 0;
    for (const s of envelopeSignals(env, opts)) {
      const { personEmail, counterpartyEmail: counterparty, ...signal } = s;
      const outcome = await deps.emitSignal(ctx, { ...signal, companyId: await companyFor(counterparty), personId: await personFor(personEmail) });
      if (outcome === "created") created++;
    }
    // Created counts new signals; unchanged counts envelopes with nothing new to say.
    if (created) ctx.count("created", created);
    else ctx.count("unchanged");
  };

  let skipped = 0;
  for await (const page of listEnvelopes(ctx, accountUrl, { from_date: since })) {
    skipped += page.skipped;
    for (const env of page.envelopes) await handle(env);
    if (page.truncated) ctx.note(`More than ${PAGE_SIZE * MAX_PAGES} DocuSign envelopes changed since the last sync; only the first ${PAGE_SIZE * MAX_PAGES} were read`);
  }

  // Envelopes still out for signature whose status has not changed since the
  // last run: they turn stalled (or become the CEO's turn) quietly.
  if (!ctx.initial) {
    for await (const page of listEnvelopes(ctx, accountUrl, { from_date: windowStart, status: "sent,delivered" })) {
      skipped += page.skipped;
      for (const env of page.envelopes) await handle(env);
    }
  }

  if (skipped) ctx.note(`${skipped} DocuSign envelope(s) had an unexpected shape and were skipped`);
  await ctx.saveCursor({ since: maxChanged.toISOString() });
}

export const docusignConnector: BusinessConnector = {
  provider: "DOCUSIGN",
  sync: (ctx) => syncDocusign(ctx),
};
