/**
 * HubSpot CRM connector. Authenticates with a HubSpot service key (or a legacy
 * private-app token): both are a Bearer token for api.hubapi.com.
 *
 * Every deal pipeline is read (sales, fundraising and partnership pipelines
 * alike) and each deal becomes a Deal row keyed by its HubSpot id, linked to
 * its primary company and its owner. From those rows the scoreboard derives
 * the pipeline metrics, the Daily Brain Refresh spots stalled deals, and stage
 * moves, wins, losses and new deals arrive as CRM_UPDATE signals.
 *
 * - Pipeline → deal type: settings.pipelineTypes wins, otherwise the pipeline
 *   label decides ("Series B" → FUNDRAISING). The effective map is saved back
 *   to settings so it can be corrected.
 * - Incremental: the CRM search API, ascending by hs_lastmodifieddate, from
 *   the saved cursor minus five minutes (search results lag writes a little).
 *   One search query stops at 10,000 results, so a long history advances the
 *   time window instead of paging on. Search allows ~4 requests/s per
 *   account, so pages are spaced.
 * - The first sync imports quietly; later syncs signal what changed.
 * - Deals deleted or archived in HubSpot stay as they are here (search does
 *   not return them).
 */
import { z } from "zod";
import type { CompanyType, DealStatus, DealType, MetricCategory, MetricUnit } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { dayFromKey, dayKeyInTz, formatDay } from "@/lib/dates";
import { formatCurrency } from "@/lib/format";
import type { SignalMetadata, SignalType } from "@/server/brain/analyzers/signals";
import { DERIVED_METRICS } from "@/server/brain/metrics";
import { ProviderHttpError, type RefreshableProviderContext, providerJson, providerSend } from "../providers/http";
import { ProviderAuthError } from "../types";
import { emitSignal, findOrCreateCompany, findPersonByEmail } from "./helpers";
import { type BusinessConnector, type ConnectorSyncContext, type KeyVerification, KeyRejectedError } from "./types";

export const HUBSPOT_API = "https://api.hubapi.com";
const SOURCE = "hubspot";

export const HUBSPOT_SCOPES = ["crm.objects.deals.read", "crm.objects.companies.read", "crm.objects.owners.read"];

const KEY_HELP = `Create a service key in HubSpot → Development → Keys → Service keys with the scopes ${HUBSPOT_SCOPES.join(", ")}, then paste it here.`;

/** Search page size, result cap per query, and spacing between search calls. */
const SEARCH_LIMIT = 100;
const SEARCH_CAP = 10_000;
const SEARCH_SPACING_MS = 300;
/** Re-read this much before the cursor: search results lag writes slightly. */
const CURSOR_OVERLAP_MS = 5 * 60_000;
/** Batch read endpoints take up to 100 ids (associations take more; 100 keeps pages aligned). */
const BATCH_SIZE = 100;
/** Stop a run that fails on this many deals: something larger is wrong. */
const MAX_DEAL_FAILURES = 20;

export const DEAL_PROPERTIES = [
  "dealname",
  "amount",
  "amount_in_home_currency",
  "dealstage",
  "pipeline",
  "closedate",
  "createdate",
  "hs_lastmodifieddate",
  "hs_next_step",
  "notes_last_updated",
  "hubspot_owner_id",
  "hs_deal_stage_probability",
  "hs_v2_date_entered_current_stage",
  "hs_is_closed_won",
  "hs_is_closed_lost",
  "closed_lost_reason",
];

// ─── Values ──────────────────────────────────────────────────────────────────

const id = z.union([z.string(), z.number()]).transform(String);
const paging = z.object({ next: z.object({ after: z.union([z.string(), z.number()]).transform(String).nullish() }).nullish() }).nullish();

function str(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function num(value: unknown): number | null {
  const s = str(value);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** HubSpot datetimes arrive as ISO strings (search, objects) or epoch milliseconds (older payloads). */
export function parseInstant(value: unknown): Date | null {
  const s = str(value);
  if (!s) return null;
  const ms = /^-?\d+$/.test(s) ? Number(s) : Date.parse(s);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/** "0.2"-style fraction → 0–1. Percent-style values ("20") are tolerated. */
export function parseProbability(value: unknown): number | null {
  const n = num(value);
  if (n === null) return null;
  return Math.min(1, Math.max(0, n > 1 ? n / 100 : n));
}

/**
 * Close date as a calendar day. Dates picked in HubSpot are stored at
 * midnight UTC; other instants (set when a deal closes) count on the
 * portal's local day.
 */
export function closeDay(value: unknown, timeZone: string): Date | null {
  const s = str(value);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return dayFromKey(s);
  const at = parseInstant(s);
  if (!at) return null;
  const utcKey = at.toISOString().slice(0, 10);
  if (at.getTime() % 86_400_000 === 0) return dayFromKey(utcKey);
  try {
    return dayFromKey(dayKeyInTz(at, timeZone));
  } catch {
    return dayFromKey(utcKey);
  }
}

function latest(...dates: (Date | null)[]): Date | null {
  return dates.reduce<Date | null>((a, b) => (b && (!a || b > a) ? b : a), null);
}

function isTrue(value: unknown): boolean {
  return String(value).toLowerCase() === "true";
}

// ─── Pipelines and deal types ────────────────────────────────────────────────

export interface StageInfo {
  id: string;
  label: string;
  order: number;
  /** 0–1, null when the stage has none. */
  probability: number | null;
  closed: boolean;
  pipelineId: string;
  pipelineLabel: string;
}

export interface PipelineInfo {
  id: string;
  label: string;
  order: number;
  stages: StageInfo[];
}

const pipelinesResponse = z.object({ results: z.array(z.unknown()).nullish() });
const pipelineSchema = z.object({
  id: id.optional(),
  pipelineId: id.optional(),
  label: z.string().nullish(),
  displayOrder: z.number().nullish(),
  stages: z.array(z.unknown()).nullish(),
});
const stageSchema = z.object({
  id: id.optional(),
  stageId: id.optional(),
  label: z.string().nullish(),
  displayOrder: z.number().nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
});

/** Pipelines with their stages in display order. Entries with an unexpected shape are skipped. */
export function parsePipelines(results: unknown[]): PipelineInfo[] {
  const pipelines: PipelineInfo[] = [];
  for (const raw of results) {
    const p = pipelineSchema.safeParse(raw);
    const pipelineId = p.success ? (p.data.id ?? p.data.pipelineId) : undefined;
    if (!p.success || !pipelineId) continue;
    const label = (p.data.label?.trim() || pipelineId).slice(0, 200);
    const stages: StageInfo[] = [];
    for (const rawStage of p.data.stages ?? []) {
      const s = stageSchema.safeParse(rawStage);
      const stageId = s.success ? (s.data.id ?? s.data.stageId) : undefined;
      if (!s.success || !stageId) continue;
      const meta = s.data.metadata ?? {};
      stages.push({
        id: stageId,
        label: (s.data.label?.trim() || stageId).slice(0, 200),
        order: s.data.displayOrder ?? stages.length,
        probability: parseProbability(meta.probability),
        closed: isTrue(meta.isClosed),
        pipelineId,
        pipelineLabel: label,
      });
    }
    stages.sort((a, b) => a.order - b.order);
    pipelines.push({ id: pipelineId, label, order: p.data.displayOrder ?? pipelines.length, stages });
  }
  return pipelines.sort((a, b) => a.order - b.order);
}

export async function fetchPipelines(http: RefreshableProviderContext): Promise<PipelineInfo[]> {
  const res = await providerJson(http, `${HUBSPOT_API}/crm/v3/pipelines/deals`, pipelinesResponse);
  return parsePipelines(res.results ?? []);
}

/**
 * Deal outcome of a stage. HubSpot marks closed-won as a closed stage at
 * probability 1 and closed-lost as a closed stage at probability 0; a closed
 * stage with anything in between is judged by its label, then its odds.
 */
export function stageStatus(stage: Pick<StageInfo, "closed" | "probability" | "label">): DealStatus {
  if (!stage.closed) return "OPEN";
  if (stage.probability !== null && stage.probability >= 1) return "WON";
  if (stage.probability !== null && stage.probability <= 0) return "LOST";
  if (/\blost\b/i.test(stage.label)) return "LOST";
  if (/\bwon\b/i.test(stage.label)) return "WON";
  return (stage.probability ?? 0) >= 0.5 ? "WON" : "LOST";
}

const DEAL_TYPES: readonly DealType[] = ["SALES", "FUNDRAISING", "PARTNERSHIP"];
const FUNDRAISING_LABEL = /\b(invest\w*|(crowd)?fund\w*|rais\w*|series|seed|rounds?|vc)\b/i;
const PARTNERSHIP_LABEL = /\b(partner\w*|allian\w*|business development|biz ?dev|bd|licens\w*)\b/i;

/** Deal type a pipeline's label suggests. */
export function guessDealType(pipelineLabel: string): DealType {
  if (FUNDRAISING_LABEL.test(pipelineLabel)) return "FUNDRAISING";
  if (PARTNERSHIP_LABEL.test(pipelineLabel)) return "PARTNERSHIP";
  return "SALES";
}

/** settings.pipelineTypes, keeping only valid entries. */
export function configuredPipelineTypes(value: unknown): Record<string, DealType> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, DealType> = {};
  for (const [pipelineId, type] of Object.entries(value)) {
    const t = typeof type === "string" ? (type.trim().toUpperCase() as DealType) : null;
    if (t && DEAL_TYPES.includes(t)) out[pipelineId] = t;
  }
  return out;
}

/** Effective pipeline → deal type map: configured entries win over the label heuristic. */
export function resolvePipelineTypes(pipelines: Pick<PipelineInfo, "id" | "label">[], configured: Record<string, DealType>): Record<string, DealType> {
  return Object.fromEntries(pipelines.map((p) => [p.id, configured[p.id] ?? guessDealType(p.label)]));
}

export interface KnownStage {
  pipeline: string;
  stage: string;
  order: number;
}

function knownStages(value: unknown): Record<string, KnownStage> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, KnownStage> = {};
  for (const [stageId, v] of Object.entries(value as Record<string, unknown>)) {
    const s = v as Partial<KnownStage> | null;
    if (s && typeof s.pipeline === "string" && typeof s.stage === "string") out[stageId] = { pipeline: s.pipeline, stage: s.stage, order: typeof s.order === "number" ? s.order : 0 };
  }
  return out;
}

/**
 * Stages renamed or reordered since the last sync. Stored deals carry stage
 * and pipeline labels, so they are relabelled in place: a rename is not a
 * stage move. Ambiguous swaps (one stage taking another's old name) are left
 * to the next change of each deal.
 */
export function stageRelabels(previous: Record<string, KnownStage>, current: Record<string, KnownStage>): { from: KnownStage; to: KnownStage }[] {
  const changes: { from: KnownStage; to: KnownStage }[] = [];
  for (const [stageId, to] of Object.entries(current)) {
    const from = previous[stageId];
    if (from && (from.pipeline !== to.pipeline || from.stage !== to.stage || from.order !== to.order)) changes.push({ from, to });
  }
  const key = (s: KnownStage) => `${s.pipeline}\u0000${s.stage}`;
  const sources = new Set(changes.filter((c) => key(c.from) !== key(c.to)).map((c) => key(c.from)));
  return changes.filter((c) => key(c.from) === key(c.to) || !sources.has(key(c.to)));
}

// ─── Deals ───────────────────────────────────────────────────────────────────

export interface HubSpotDeal {
  id: string;
  properties: Record<string, unknown>;
  createdAt?: string | null;
  updatedAt?: string | null;
}

const dealSchema = z.object({
  id,
  properties: z.record(z.string(), z.unknown()).nullish(),
  createdAt: z.string().nullish(),
  updatedAt: z.string().nullish(),
});

/** Last modification of a deal in epoch ms. */
export function dealModifiedMs(deal: HubSpotDeal): number | null {
  return (parseInstant(deal.properties.hs_lastmodifieddate) ?? parseInstant(deal.updatedAt))?.getTime() ?? null;
}

export interface MappedDeal {
  externalId: string;
  name: string;
  type: DealType;
  status: DealStatus;
  stageId: string | null;
  stage: string;
  stageOrder: number;
  value: number | null;
  /** 0–100, null when HubSpot has no probability for the stage. */
  probability: number | null;
  expectedClose: Date | null;
  pipelineId: string | null;
  pipeline: string | null;
  nextStep: string | null;
  lastActivityAt: Date | null;
  stageEnteredAt: Date | null;
  createdAt: Date | null;
  modifiedAt: Date | null;
  hubspotOwnerId: string | null;
  lostReason: string | null;
}

export interface DealLookup {
  stages: Map<string, StageInfo>;
  pipelines: Map<string, PipelineInfo>;
  types: Record<string, DealType>;
  timeZone: string;
}

/** A HubSpot deal as Deal fields. */
export function mapDeal(deal: HubSpotDeal, lookup: DealLookup): MappedDeal {
  const p = deal.properties;
  const stageId = str(p.dealstage);
  const pipelineId = str(p.pipeline);
  const stage = stageId ? lookup.stages.get(stageId) : undefined;
  const pipeline = pipelineId ? lookup.pipelines.get(pipelineId) : undefined;
  const effectivePipelineId = pipelineId ?? stage?.pipelineId ?? null;

  // HubSpot's own closed-won/lost flags win; otherwise the stage decides.
  const status: DealStatus = isTrue(p.hs_is_closed_won) ? "WON" : isTrue(p.hs_is_closed_lost) ? "LOST" : stage ? stageStatus(stage) : "OPEN";
  const odds = stage?.probability ?? parseProbability(p.hs_deal_stage_probability);
  const probability = status === "WON" ? 100 : status === "LOST" ? 0 : odds === null ? null : Math.round(odds * 100);

  const modifiedAt = parseInstant(p.hs_lastmodifieddate) ?? parseInstant(deal.updatedAt);
  const stageEnteredAt = parseInstant(p.hs_v2_date_entered_current_stage);
  const nextStep = str(p.hs_next_step);
  return {
    externalId: deal.id,
    name: (str(p.dealname) ?? `HubSpot deal ${deal.id}`).replace(/\s+/g, " ").slice(0, 300),
    type: (effectivePipelineId && lookup.types[effectivePipelineId]) || guessDealType(pipeline?.label ?? stage?.pipelineLabel ?? ""),
    status,
    stageId,
    stage: (stage?.label ?? stageId ?? "Unknown stage").slice(0, 200),
    stageOrder: stage?.order ?? 0,
    value: num(p.amount_in_home_currency) ?? num(p.amount),
    probability,
    expectedClose: closeDay(p.closedate, lookup.timeZone),
    pipelineId: effectivePipelineId,
    pipeline: (pipeline?.label ?? stage?.pipelineLabel ?? effectivePipelineId)?.slice(0, 200) ?? null,
    nextStep: nextStep ? nextStep.slice(0, 1000) : null,
    // Logged activity, else any edit; a stage move counts as activity too.
    lastActivityAt: latest(parseInstant(p.notes_last_updated) ?? modifiedAt, stageEnteredAt),
    stageEnteredAt,
    createdAt: parseInstant(p.createdate) ?? parseInstant(deal.createdAt),
    modifiedAt,
    hubspotOwnerId: str(p.hubspot_owner_id),
    lostReason: str(p.closed_lost_reason)?.slice(0, 300) ?? null,
  };
}

/** Company type a deal implies for a company first seen through it. */
export function companyTypeFor(type: DealType, status: DealStatus): CompanyType {
  if (type === "FUNDRAISING") return "INVESTOR";
  if (type === "PARTNERSHIP") return "PARTNER";
  return status === "WON" ? "CUSTOMER" : "PROSPECT";
}

export interface StoredDeal {
  stage: string;
  pipeline: string | null;
  status: DealStatus;
  stageOrder: number;
}

/** Did the deal move to another stage (or pipeline) since it was stored? */
export function stageChanged(stored: Pick<StoredDeal, "stage" | "pipeline"> | null, next: Pick<MappedDeal, "stage" | "pipeline">): boolean {
  if (!stored) return false;
  return stored.stage !== next.stage || (stored.pipeline ?? null) !== (next.pipeline ?? null);
}

// ─── Signals ─────────────────────────────────────────────────────────────────

export interface SignalDraft {
  externalId: string;
  title: string;
  body: string | null;
  occurredAt: Date;
  metadata: SignalMetadata & Record<string, unknown>;
}

const NOUN: Record<DealType, string> = { SALES: "Deal", FUNDRAISING: "Investor", PARTNERSHIP: "Partnership" };

/** "$1.4M at 70% · expected close Nov 14" (won: "· closed …", lost: "· reason: …"). */
export function dealSummary(deal: Pick<MappedDeal, "value" | "probability" | "status" | "expectedClose" | "lostReason">): string | undefined {
  const value = deal.value ? formatCurrency(deal.value) : null;
  const parts: string[] = [];
  if (deal.status === "OPEN") {
    const odds = deal.probability !== null ? `${deal.probability}%` : null;
    if (value || odds) parts.push(value && odds ? `${value} at ${odds}` : (value ?? `${odds} probability`));
    if (deal.expectedClose) parts.push(`expected close ${formatDay(deal.expectedClose)}`);
  } else {
    if (value) parts.push(value);
    if (deal.status === "WON" && deal.expectedClose) parts.push(`closed ${formatDay(deal.expectedClose)}`);
    if (deal.status === "LOST" && deal.lostReason) parts.push(`reason: ${deal.lostReason}`);
  }
  return parts.length ? parts.join(" · ") : undefined;
}

function signalMetadata(deal: MappedDeal, signalType: SignalType, importance: number, extra: Partial<SignalMetadata> = {}): SignalDraft["metadata"] {
  const meta: SignalDraft["metadata"] = {
    signalType,
    importance,
    summary: dealSummary(deal),
    stageTo: deal.stage,
    ...extra,
    source: SOURCE,
    hubspotDealId: deal.externalId,
    pipeline: deal.pipeline,
    dealType: deal.type,
  };
  for (const key of Object.keys(meta)) if (meta[key] === undefined) delete meta[key];
  return meta;
}

/**
 * Brain signals for one synced deal. Nothing on the first sync; afterwards a
 * stage move, a win or a loss of a known deal, or a deal created since the
 * previous sync. Each event has a stable externalId, so re-reading the same
 * deal never signals twice.
 */
export function decideDealSignals(input: {
  deal: MappedDeal;
  previous: StoredDeal | null;
  initial: boolean;
  /** Deals created at or after this instant (ms) are new; null: none are. */
  newSince: number | null;
  now: Date;
}): SignalDraft[] {
  const { deal, previous, now } = input;
  if (input.initial) return [];
  const clamp = (d: Date | null) => (d && d < now ? d : now);
  const noun = NOUN[deal.type];
  const valueTag = deal.value ? ` (${formatCurrency(deal.value)})` : "";
  const stageKey = `hubspot:deal:${deal.externalId}:stage:${deal.stageId ?? deal.stage}`;
  const movedAt = clamp(deal.stageEnteredAt ?? deal.modifiedAt);
  const nextStep = deal.nextStep ? ` Next step: ${deal.nextStep}` : "";

  const won = (stageFrom?: string): SignalDraft => ({
    externalId: stageKey,
    title: deal.type === "FUNDRAISING" ? `Investor committed: ${deal.name}${valueTag}` : `Won: ${deal.name}${valueTag}`,
    body: `${deal.pipeline ?? "HubSpot"}: ${stageFrom ? `${stageFrom} → ` : ""}${deal.stage}.`,
    occurredAt: movedAt,
    metadata: signalMetadata(deal, "deal_won", 4, { stageFrom }),
  });

  if (!previous) {
    const created = deal.createdAt;
    if (input.newSince === null || !created || created.getTime() < input.newSince) return [];
    if (deal.status === "WON") return [won()];
    if (deal.status !== "OPEN") return [];
    const what = deal.type === "FUNDRAISING" ? "New investor conversation" : deal.type === "PARTNERSHIP" ? "New partnership opportunity" : "New deal";
    return [
      {
        externalId: `hubspot:deal:${deal.externalId}:created`,
        title: `${what}: ${deal.name}${valueTag}`,
        body: `${deal.pipeline ?? "HubSpot"} · ${deal.stage}.${nextStep}`,
        occurredAt: clamp(created),
        metadata: signalMetadata(deal, "opportunity", 3),
      },
    ];
  }

  if (!stageChanged(previous, deal)) return [];
  // Moving between two closed stages of the same outcome is not news.
  if (deal.status !== "OPEN" && deal.status === previous.status) return [];
  const stageFrom = previous.stage;
  if (deal.status === "WON") return [won(stageFrom)];
  if (deal.status === "LOST") {
    return [
      {
        externalId: stageKey,
        title: deal.type === "FUNDRAISING" ? `Investor passed: ${deal.name}${valueTag}` : `Lost: ${deal.name}${valueTag}`,
        body: `${deal.pipeline ?? "HubSpot"}: ${stageFrom} → ${deal.stage}.${deal.lostReason ? ` Reason: ${deal.lostReason}` : ""}`,
        occurredAt: movedAt,
        metadata: signalMetadata(deal, "deal_lost", 4, {
          stageFrom,
          recommendation:
            deal.type === "FUNDRAISING" ? "Note what held them back and keep them on the investor update list." : "Ask the owner why it was lost and whether to revisit it later.",
        }),
      },
    ];
  }
  const back = previous.status === "OPEN" && previous.pipeline === deal.pipeline && deal.stageOrder < previous.stageOrder;
  return [
    {
      externalId: stageKey,
      title: `${noun} ${back ? "moved back" : "advanced"}: ${deal.name} → ${deal.stage}`,
      body: `${deal.pipeline ?? "HubSpot"}: ${stageFrom} → ${deal.stage}.${nextStep}`,
      occurredAt: movedAt,
      metadata: signalMetadata(deal, "deal_stage_change", deal.type === "FUNDRAISING" ? 4 : 3, {
        stageFrom,
        recommendation: back ? "Ask the owner what changed and what would move it forward again." : undefined,
      }),
    },
  ];
}

// ─── HTTP: owners, deal search, companies ────────────────────────────────────

const listResponse = z.object({ results: z.array(z.unknown()).nullish(), paging });
const ownerSchema = z.object({ id, email: z.string().nullish() });

/** Owner id → email, active and deactivated owners (deactivated users can still own deals). */
export async function fetchOwners(http: RefreshableProviderContext): Promise<Map<string, string>> {
  const owners = new Map<string, string>();
  for (const archived of [false, true]) {
    let after: string | undefined;
    for (let page = 0; page < 100; page++) {
      const res = await providerJson(http, `${HUBSPOT_API}/crm/v3/owners`, listResponse, { query: { limit: 100, archived, after } });
      for (const raw of res.results ?? []) {
        const o = ownerSchema.safeParse(raw);
        const email = o.success ? o.data.email?.trim().toLowerCase() : null;
        if (o.success && email && !owners.has(o.data.id)) owners.set(o.data.id, email);
      }
      after = res.paging?.next?.after ?? undefined;
      if (!after) break;
    }
  }
  return owners;
}

const searchResponse = z.object({ total: z.number().nullish(), results: z.array(z.unknown()).nullish(), paging });

export interface DealSearchOptions {
  /** Deals modified at or after this instant (ms); null reads every deal. */
  since: number | null;
  /** Minimum gap between search calls (rate limit). */
  spacingMs?: number;
  note?: (message: string) => void;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Deals modified since `since`, oldest change first, a page at a time. When
 * a query nears the 10,000-result cap, the window restarts at the latest
 * modification seen (re-reading that instant; upserts are idempotent).
 */
export async function* searchDeals(http: RefreshableProviderContext, opts: DealSearchOptions): AsyncGenerator<HubSpotDeal[]> {
  const spacing = opts.spacingMs ?? SEARCH_SPACING_MS;
  let windowStart = opts.since;
  let operator: "GTE" | "GT" = "GTE";
  let after: string | undefined;
  let windowMax: number | null = null;
  let lastCall = 0;

  for (;;) {
    const wait = lastCall + spacing - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    const res = await providerJson(http, `${HUBSPOT_API}/crm/v3/objects/deals/search`, searchResponse, {
      method: "POST",
      json: {
        ...(windowStart !== null ? { filterGroups: [{ filters: [{ propertyName: "hs_lastmodifieddate", operator, value: String(windowStart) }] }] } : {}),
        sorts: [{ propertyName: "hs_lastmodifieddate", direction: "ASCENDING" }],
        properties: DEAL_PROPERTIES,
        limit: SEARCH_LIMIT,
        ...(after ? { after } : {}),
      },
    });

    const deals: HubSpotDeal[] = [];
    for (const raw of res.results ?? []) {
      const d = dealSchema.safeParse(raw);
      if (!d.success) continue;
      const deal: HubSpotDeal = { id: d.data.id, properties: d.data.properties ?? {}, createdAt: d.data.createdAt, updatedAt: d.data.updatedAt };
      const modified = dealModifiedMs(deal);
      if (modified !== null && (windowMax === null || modified > windowMax)) windowMax = modified;
      deals.push(deal);
    }
    if (deals.length) yield deals;

    const next = res.paging?.next?.after;
    if (!next || !res.results?.length) return;
    if (Number(next) + SEARCH_LIMIT <= SEARCH_CAP) {
      after = next;
      continue;
    }
    // The next page would pass the cap: restart the query at the latest change seen.
    if (windowMax !== null && (windowStart === null || windowMax > windowStart)) {
      windowStart = windowMax;
      operator = "GTE";
    } else if (windowStart !== null && operator === "GTE") {
      // 10,000 deals share one modification time (a bulk import): step past it.
      opts.note?.(`More than ${SEARCH_CAP.toLocaleString("en-US")} HubSpot deals share one modification time; some were skipped`);
      operator = "GT";
    } else {
      opts.note?.("HubSpot deal search could not advance past 10,000 results; the rest follows next sync");
      return;
    }
    after = undefined;
    windowMax = null;
  }
}

const assocResponse = z.object({ results: z.array(z.unknown()).nullish() });
const assocResult = z.object({
  from: z.object({ id }),
  to: z
    .array(
      z.object({
        toObjectId: id,
        associationTypes: z.array(z.object({ typeId: z.number().nullish(), label: z.string().nullish() })).nullish(),
      }),
    )
    .nullish(),
});
const companySchema = z.object({ id, properties: z.record(z.string(), z.unknown()).nullish() });

/** Deal → company association type marked "Primary" (HubSpot-defined type 5). */
const PRIMARY_DEAL_COMPANY = 5;

export function primaryCompanyId(to: { toObjectId: string; associationTypes?: { typeId?: number | null; label?: string | null }[] | null }[]): string | null {
  const primary = to.find((t) => t.associationTypes?.some((a) => a.typeId === PRIMARY_DEAL_COMPANY || /primary/i.test(a.label ?? "")));
  return (primary ?? to[0])?.toObjectId ?? null;
}

export interface HubSpotCompany {
  id: string;
  name: string | null;
  domain: string | null;
}

/** Each deal's primary company (deals without one are absent). */
export async function fetchDealCompanies(http: RefreshableProviderContext, dealIds: string[]): Promise<Map<string, HubSpotCompany>> {
  const companyOf = new Map<string, string>();
  for (let i = 0; i < dealIds.length; i += BATCH_SIZE) {
    const res = await providerJson(http, `${HUBSPOT_API}/crm/v4/associations/deals/companies/batch/read`, assocResponse, {
      method: "POST",
      json: { inputs: dealIds.slice(i, i + BATCH_SIZE).map((dealId) => ({ id: dealId })) },
    });
    for (const raw of res.results ?? []) {
      const r = assocResult.safeParse(raw);
      const companyId = r.success ? primaryCompanyId(r.data.to ?? []) : null;
      if (r.success && companyId) companyOf.set(r.data.from.id, companyId);
    }
  }

  const companyIds = [...new Set(companyOf.values())];
  const companies = new Map<string, HubSpotCompany>();
  for (let i = 0; i < companyIds.length; i += BATCH_SIZE) {
    const res = await providerJson(http, `${HUBSPOT_API}/crm/v3/objects/companies/batch/read`, listResponse, {
      method: "POST",
      json: { properties: ["name", "domain"], inputs: companyIds.slice(i, i + BATCH_SIZE).map((companyId) => ({ id: companyId })) },
    });
    for (const raw of res.results ?? []) {
      const c = companySchema.safeParse(raw);
      if (c.success) companies.set(c.data.id, { id: c.data.id, name: str(c.data.properties?.name), domain: str(c.data.properties?.domain) });
    }
  }

  const out = new Map<string, HubSpotCompany>();
  for (const [dealId, companyId] of companyOf) {
    const company = companies.get(companyId);
    if (company) out.set(dealId, company);
  }
  return out;
}

function isForbidden(error: unknown): boolean {
  return error instanceof ProviderHttpError && (error.status === 403 || error.code === "MISSING_SCOPES");
}

// ─── Key check ───────────────────────────────────────────────────────────────

const accountInfo = z.object({
  portalId: id,
  accountType: z.string().nullish(),
  uiDomain: z.string().nullish(),
  timeZone: z.string().nullish(),
  companyCurrency: z.string().nullish(),
});

const ACCOUNT_KIND: Record<string, string> = { SANDBOX: "HubSpot sandbox", DEVELOPER_TEST: "HubSpot test account", APP_DEVELOPER: "HubSpot developer account" };

/** Confirm the key works and can read deals, companies and owners. */
export async function verifyHubSpotKey(http: RefreshableProviderContext): Promise<KeyVerification> {
  const rejected = () => new KeyRejectedError(`HubSpot rejected the key. ${KEY_HELP}`);
  let account: z.infer<typeof accountInfo> | null = null;
  try {
    account = await providerJson(http, `${HUBSPOT_API}/account-info/v3/details`, accountInfo);
  } catch (error) {
    if (error instanceof ProviderAuthError) throw rejected();
    // Account details are a nicety: a key without access to them still syncs.
    if (!isForbidden(error)) throw error;
  }

  const probes: [scope: string, path: string][] = [
    ["crm.objects.deals.read", "/crm/v3/objects/deals"],
    ["crm.objects.companies.read", "/crm/v3/objects/companies"],
    ["crm.objects.owners.read", "/crm/v3/owners"],
  ];
  const missing: string[] = [];
  for (const [scope, path] of probes) {
    try {
      await providerSend(http, `${HUBSPOT_API}${path}`, { query: { limit: 1 } });
    } catch (error) {
      if (error instanceof ProviderAuthError) throw rejected();
      if (isForbidden(error)) missing.push(scope);
      else throw error;
    }
  }
  if (missing.length) {
    throw new KeyRejectedError(
      `The HubSpot key is missing the ${missing.length === 1 ? "scope" : "scopes"} ${missing.join(", ")}. Add ${missing.length === 1 ? "it" : "them"} to the service key in HubSpot → Development → Keys → Service keys, then connect again.`,
    );
  }

  const portalId = account?.portalId ?? null;
  const settings: Record<string, string> = {};
  if (portalId) settings.portalId = portalId;
  if (account?.uiDomain) settings.uiDomain = account.uiDomain;
  if (account?.timeZone) settings.timeZone = account.timeZone;
  if (account?.companyCurrency) settings.currency = account.companyCurrency;
  return {
    accountName: portalId ? `${ACCOUNT_KIND[account?.accountType ?? ""] ?? "HubSpot"} ${portalId}` : null,
    externalAccountId: portalId,
    settings,
    scopes: HUBSPOT_SCOPES,
  };
}

// ─── Scoreboard ──────────────────────────────────────────────────────────────

const PIPELINE_METRICS: { key: string; name: string; category: MetricCategory; unit: MetricUnit; sourceKey: string; dealType: DealType }[] = [
  { key: "pipeline_weighted", name: "Weighted sales pipeline", category: "PIPELINE", unit: "CURRENCY", sourceKey: "derived:pipeline.weighted", dealType: "SALES" },
  { key: "pipeline_total", name: "Open sales pipeline", category: "PIPELINE", unit: "CURRENCY", sourceKey: "derived:pipeline.total", dealType: "SALES" },
  { key: "investor_weighted", name: "Weighted investor pipeline", category: "FUNDRAISING", unit: "CURRENCY", sourceKey: "derived:fundraising.weighted", dealType: "FUNDRAISING" },
  { key: "investor_active", name: "Active investor conversations", category: "FUNDRAISING", unit: "COUNT", sourceKey: "derived:fundraising.active", dealType: "FUNDRAISING" },
];

/**
 * Derived pipeline metrics for the deal types HubSpot has pipelines for.
 * Created only when missing, and offered once per connection: a metric the
 * CEO removed stays removed. Existing metrics are never touched.
 */
async function ensurePipelineMetrics(ctx: ConnectorSyncContext, types: Set<DealType>): Promise<void> {
  const offered = new Set(Array.isArray(ctx.connection.settings.scoreboardMetrics) ? (ctx.connection.settings.scoreboardMetrics as unknown[]).filter((k): k is string => typeof k === "string") : []);
  const before = offered.size;
  for (const def of PIPELINE_METRICS) {
    if (!types.has(def.dealType) || offered.has(def.key)) continue;
    offered.add(def.key);
    const existing = await db.metric.findFirst({ where: { OR: [{ key: def.key }, { sourceKey: def.sourceKey }] }, select: { id: true } });
    if (existing) continue;
    const order = await db.metric.count({ where: { category: def.category } });
    await db.metric.upsert({
      where: { key: def.key },
      create: { key: def.key, name: def.name, category: def.category, unit: def.unit, sourceKey: def.sourceKey, description: DERIVED_METRICS[def.sourceKey]?.description ?? null, order },
      update: {},
    });
    ctx.note(`Added “${def.name}” to the scoreboard`);
  }
  if (offered.size !== before) await ctx.saveSettings({ scoreboardMetrics: [...offered] });
}

// ─── Sync ────────────────────────────────────────────────────────────────────

function validTimeZone(tz: string | null | undefined): string | null {
  if (!tz) return null;
  try {
    dayKeyInTz(new Date(0), tz);
    return tz;
  } catch {
    return null;
  }
}

/** JSON with sorted keys (stored settings come back from jsonb in another key order). */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v,
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const sameValue = (a: unknown, b: unknown) => (a instanceof Date || b instanceof Date ? (a as Date | null)?.getTime() === (b as Date | null)?.getTime() : a === b);

export async function syncHubSpot(ctx: ConnectorSyncContext, opts: { searchSpacingMs?: number } = {}): Promise<void> {
  const http = ctx.http;
  const settings = ctx.connection.settings;

  // Pipelines, stages and the pipeline → deal type map.
  const pipelines = await fetchPipelines(http);
  const types = resolvePipelineTypes(pipelines, configuredPipelineTypes(settings.pipelineTypes));
  const pipelineTypes = { ...configuredPipelineTypes(settings.pipelineTypes), ...types };
  const pipelineLabels = Object.fromEntries(pipelines.map((p) => [p.id, p.label]));
  const stages = new Map(pipelines.flatMap((p) => p.stages.map((s) => [s.id, s] as const)));
  const currentStages: Record<string, KnownStage> = Object.fromEntries([...stages.values()].map((s) => [s.id, { pipeline: s.pipelineLabel, stage: s.label, order: s.order }]));

  // Renamed or reordered stages: relabel stored deals so a rename is not a move.
  for (const { from, to } of stageRelabels(knownStages(settings.stageLabels), currentStages)) {
    const res = await db.deal.updateMany({ where: { externalSource: SOURCE, pipeline: from.pipeline, stage: from.stage }, data: { pipeline: to.pipeline, stage: to.stage, stageOrder: to.order } });
    if (res.count && (from.stage !== to.stage || from.pipeline !== to.pipeline)) ctx.note(`Stage “${from.pipeline} / ${from.stage}” is now “${to.pipeline} / ${to.stage}” (${plural(res.count, "deal")})`);
  }
  // A corrected pipeline type applies to deals already imported.
  const labelCount = new Map<string, number>();
  for (const p of pipelines) labelCount.set(p.label, (labelCount.get(p.label) ?? 0) + 1);
  for (const p of pipelines) {
    if (labelCount.get(p.label) !== 1) continue;
    const res = await db.deal.updateMany({ where: { externalSource: SOURCE, pipeline: p.label, type: { not: types[p.id] } }, data: { type: types[p.id] } });
    if (res.count) ctx.note(`${plural(res.count, "deal")} in “${p.label}” now count as ${types[p.id].toLowerCase()} deals`);
  }
  const patch = { pipelineTypes, pipelineLabels, stageLabels: currentStages };
  if (stableJson({ a: settings.pipelineTypes, b: settings.pipelineLabels, c: settings.stageLabels }) !== stableJson({ a: pipelineTypes, b: pipelineLabels, c: currentStages })) {
    await ctx.saveSettings(patch);
  }

  // Owners (optional: deals still sync without them).
  let owners: Map<string, string> | null = null;
  try {
    owners = await fetchOwners(http);
  } catch (error) {
    if (!isForbidden(error)) throw error;
    ctx.note("The HubSpot key can’t read owners (crm.objects.owners.read): deals sync without owners");
  }
  const personByOwner = new Map<string, Promise<string | null>>();
  const ownerPerson = (ownerId: string | null): Promise<string | null> | undefined => {
    if (!owners) return undefined;
    if (!ownerId) return Promise.resolve(null);
    let hit = personByOwner.get(ownerId);
    if (!hit) personByOwner.set(ownerId, (hit = findPersonByEmail(owners.get(ownerId))));
    return hit;
  };

  // Companies (optional as well).
  let companiesReadable = true;
  const companyByHubSpotId = new Map<string, Promise<string | null>>();
  const dealCompanies = async (dealIds: string[]): Promise<Map<string, HubSpotCompany> | null> => {
    if (!companiesReadable) return null;
    try {
      return await fetchDealCompanies(http, dealIds);
    } catch (error) {
      if (!isForbidden(error)) throw error;
      companiesReadable = false;
      ctx.note("The HubSpot key can’t read companies (crm.objects.companies.read): deals sync without companies");
      return null;
    }
  };

  // Deals changed since the cursor.
  const cursorMs = num(ctx.cursor?.lastModified);
  const since = ctx.initial || cursorMs === null ? null : cursorMs - CURSOR_OVERLAP_MS;
  const timeZone = validTimeZone(str(settings.timeZone)) ?? validTimeZone(ctx.pipeline.ceo.timezone) ?? "UTC";
  const lookup: DealLookup = { stages, pipelines: new Map(pipelines.map((p) => [p.id, p])), types, timeZone };
  const portalId = str(settings.portalId);
  const uiDomain = str(settings.uiDomain) ?? "app.hubspot.com";

  let cursor = cursorMs;
  let savedCursor = cursorMs;
  let advancing = true;
  let failures = 0;
  let deals = 0;
  let signals = 0;
  const usedTypes = new Set<DealType>(Object.values(types));

  for await (const page of searchDeals(http, { since, spacingMs: opts.searchSpacingMs, note: (m) => ctx.note(m) })) {
    ctx.count("fetched", page.length);
    deals += page.length;
    const ids = page.map((d) => d.id);
    const companies = await dealCompanies(ids);
    const storedRows = await db.deal.findMany({
      where: { externalSource: SOURCE, externalId: { in: ids } },
      select: {
        id: true,
        externalId: true,
        name: true,
        type: true,
        status: true,
        stage: true,
        stageOrder: true,
        value: true,
        probability: true,
        expectedClose: true,
        pipeline: true,
        nextStep: true,
        lastActivityAt: true,
        companyId: true,
        ownerId: true,
      },
    });
    const stored = new Map(storedRows.map((d) => [d.externalId!, d]));

    for (const raw of page) {
      try {
        const deal = mapDeal(raw, lookup);
        usedTypes.add(deal.type);
        const previous = stored.get(deal.externalId) ?? null;

        // Company and owner. undefined = unknown (left as stored).
        let companyId: string | null | undefined;
        if (companies) {
          const company = companies.get(deal.externalId);
          if (!company) companyId = null;
          else {
            let hit = companyByHubSpotId.get(company.id);
            if (!hit) {
              hit = findOrCreateCompany({ name: company.name, domain: company.domain, type: companyTypeFor(deal.type, deal.status) });
              companyByHubSpotId.set(company.id, hit);
              // A failed lookup is retried by the next deal instead of being remembered.
              hit.catch(() => companyByHubSpotId.delete(company.id));
            }
            companyId = await hit;
          }
        }
        const ownerId = await ownerPerson(deal.hubspotOwnerId);

        const fields = {
          name: deal.name,
          type: deal.type,
          status: deal.status,
          stage: deal.stage,
          stageOrder: deal.stageOrder,
          value: deal.value,
          ...(deal.probability !== null ? { probability: deal.probability } : {}),
          expectedClose: deal.expectedClose,
          pipeline: deal.pipeline,
          nextStep: deal.nextStep,
          lastActivityAt: deal.lastActivityAt,
          ...(companyId !== undefined ? { companyId } : {}),
          ...(ownerId !== undefined ? { ownerId } : {}),
        };
        const moved = stageChanged(previous, deal);
        const stageTime = deal.stageEnteredAt && deal.stageEnteredAt < ctx.now ? deal.stageEnteredAt : null;

        let dealId: string;
        if (!previous) {
          const row = await db.deal.upsert({
            where: { externalSource_externalId: { externalSource: SOURCE, externalId: deal.externalId } },
            create: { ...fields, externalSource: SOURCE, externalId: deal.externalId, stageChangedAt: stageTime ?? deal.modifiedAt ?? ctx.now },
            update: fields,
            select: { id: true },
          });
          dealId = row.id;
          ctx.count("created");
        } else {
          dealId = previous.id;
          const changed = Object.entries(fields).some(([k, v]) => !sameValue(previous[k as keyof typeof previous], v));
          if (changed) {
            await db.deal.update({ where: { id: dealId }, data: { ...fields, ...(moved ? { stageChangedAt: stageTime ?? ctx.now } : {}) } });
            ctx.count("updated");
          } else {
            ctx.count("unchanged");
          }
        }

        // Signals.
        const drafts = decideDealSignals({ deal, previous, initial: ctx.initial, newSince: since, now: ctx.now });
        for (const draft of drafts) {
          const url = portalId ? `https://${uiDomain}/contacts/${portalId}/record/0-3/${deal.externalId}` : undefined;
          const outcome = await emitSignal(ctx, {
            kind: "CRM_UPDATE",
            ...draft,
            metadata: url ? { ...draft.metadata, url } : draft.metadata,
            dealId,
            companyId: companyId ?? previous?.companyId ?? null,
          });
          if (outcome === "created") signals++;
        }

        const modified = dealModifiedMs(raw);
        if (advancing && modified !== null && (cursor === null || modified > cursor)) cursor = modified;
      } catch (error) {
        // The cursor stops here so the deal is read again next time.
        advancing = false;
        ctx.count("failed");
        if (++failures > MAX_DEAL_FAILURES) throw error;
        ctx.note(`Deal ${raw.id} failed: ${(error instanceof Error ? error.message : String(error)).slice(0, 200)}`);
      }
    }
    // Resume point after every page.
    if (cursor !== null && cursor !== savedCursor) {
      await ctx.saveCursor({ lastModified: cursor });
      savedCursor = cursor;
    }
  }
  // A first sync of an empty CRM still starts the incremental phase.
  if (cursor === null && !failures) await ctx.saveCursor({ lastModified: ctx.now.getTime() });

  // Scoreboard metrics for the pipelines in use.
  await ensurePipelineMetrics(ctx, usedTypes);

  ctx.note(`${plural(deals, "deal")} read from ${plural(pipelines.length, "pipeline")}${ctx.initial ? " (first import, no alerts)" : signals ? `, ${plural(signals, "update")} for the Brain` : ""}`);
}

export const hubspotConnector: BusinessConnector = {
  provider: "HUBSPOT",
  async sync(ctx) {
    try {
      await syncHubSpot(ctx);
    } catch (error) {
      // Owners and companies are optional (handled inside); any other refusal means the key must be fixed.
      if (error instanceof ProviderAuthError) throw new ProviderAuthError(`HubSpot rejected the key (deleted, rotated or expired). ${KEY_HELP}`);
      if (isForbidden(error)) throw new ProviderAuthError(`HubSpot refused access (${(error as Error).message}). ${KEY_HELP}`);
      throw error;
    }
  },
  async verifyKey(key) {
    const http: RefreshableProviderContext = {
      connection: { id: "hubspot-key-check", provider: "HUBSPOT", mode: "LIVE", accountEmail: null, settings: {} },
      now: new Date(),
      log: () => {},
      async getAccessToken() {
        return key;
      },
    };
    return verifyHubSpotKey(http);
  },
};
