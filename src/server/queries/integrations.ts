/**
 * Settings → Integrations: connected accounts per source kind, their recent
 * runs, and which providers can be connected. Credentials, cursors and
 * webhook secrets never leave the server: every field is selected explicitly.
 */
import type { ConnectionMode, ConnectionStatus, RunStatus, RunTrigger, Sensitivity, SourceKind, SourceProvider, SyncFrequency } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { type ProviderAuth, SOURCE_KINDS, SOURCE_PROVIDERS } from "@/lib/intelligence";
import { getCeoContext } from "@/server/context";
import { providerAvailability } from "@/server/ingestion/providers/availability";
import { appOrigin, providerSlug } from "@/server/ingestion/providers/oauth";

// ─── Scopes → human-readable permissions ─────────────────────────────────────

export interface Permission {
  label: string;
  /** True when the scope only grants read access (all CytoHub scopes should). */
  readOnly: boolean;
  scope: string;
}

const GOOGLE_PREFIX = "https://www.googleapis.com/auth/";
const GRAPH_PREFIX = "https://graph.microsoft.com/";

const KNOWN_SCOPES: Record<string, { label: string; readOnly: boolean }> = {
  // Google
  "gmail.readonly": { label: "Read email messages and labels", readOnly: true },
  "gmail.metadata": { label: "Read email headers and labels (no message bodies)", readOnly: true },
  "calendar.readonly": { label: "View calendar events", readOnly: true },
  "calendar.events.readonly": { label: "View calendar events", readOnly: true },
  "drive.readonly": { label: "View and download files in Google Drive", readOnly: true },
  "drive.metadata.readonly": { label: "View file names and folders in Google Drive", readOnly: true },
  openid: { label: "Confirm which account is connected", readOnly: true },
  email: { label: "See the account’s email address", readOnly: true },
  "userinfo.email": { label: "See the account’s email address", readOnly: true },
  profile: { label: "See the account’s basic profile", readOnly: true },
  "userinfo.profile": { label: "See the account’s basic profile", readOnly: true },
  // Microsoft Graph
  "mail.read": { label: "Read mail", readOnly: true },
  "mail.readbasic": { label: "Read mail headers (no message bodies)", readOnly: true },
  "calendars.read": { label: "Read calendars", readOnly: true },
  "files.read": { label: "Read your OneDrive files", readOnly: true },
  "files.read.all": { label: "Read all files you can access", readOnly: true },
  "sites.read.all": { label: "Read SharePoint sites and libraries", readOnly: true },
  "user.read": { label: "Sign in and read the account profile", readOnly: true },
  offline_access: { label: "Stay connected between syncs (refresh token)", readOnly: true },
  // Dropbox
  "files.metadata.read": { label: "View file and folder names", readOnly: true },
  "files.content.read": { label: "View and download file contents", readOnly: true },
  "account_info.read": { label: "See the account’s basic info", readOnly: true },
  // Microsoft Teams
  "chat.read": { label: "Read your Teams chats", readOnly: true },
  // QuickBooks Online: Intuit offers no read-only accounting scope; CytoHub only reads.
  "com.intuit.quickbooks.accounting": { label: "QuickBooks accounting data (CytoHub only reads reports and balances)", readOnly: true },
  // DocuSign: the signature scope also allows sending; CytoHub only lists envelopes.
  signature: { label: "DocuSign envelopes (CytoHub only reads their status)", readOnly: true },
  extended: { label: "Stay connected beyond 30 days (refresh token)", readOnly: true },
  // HubSpot
  "crm.objects.deals.read": { label: "Read deals and pipelines", readOnly: true },
  "crm.objects.companies.read": { label: "Read companies", readOnly: true },
  "crm.objects.owners.read": { label: "Read deal owners", readOnly: true },
  // Brex
  "accounts.cash.readonly": { label: "Read cash account balances", readOnly: true },
  "transactions.cash.readonly": { label: "Read cash transactions", readOnly: true },
  "transactions.card.readonly": { label: "Read card transactions", readOnly: true },
  // Granola, Read AI
  "notes:read": { label: "Read meeting notes", readOnly: true },
  "webhook:meeting_end": { label: "Receive meeting reports after each meeting (signed)", readOnly: true },
};

/** Provider scope strings as read-only permissions people understand. Unknown scopes are shown verbatim. Pure. */
export function describeScopes(scopes: string[]): Permission[] {
  const seen = new Set<string>();
  const out: Permission[] = [];
  for (const raw of scopes) {
    const scope = raw.trim();
    if (!scope) continue;
    const key = scope.replace(GOOGLE_PREFIX, "").replace(GRAPH_PREFIX, "").toLowerCase();
    // Demo connections carry a marker instead of provider scopes.
    const known = key.startsWith("demo:") ? { label: "Sample CytoHub data only — no real account", readOnly: true } : KNOWN_SCOPES[key];
    const label = known?.label ?? `Provider permission “${scope}”`;
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ label, readOnly: known?.readOnly ?? false, scope });
  }
  return out;
}

// ─── Provider availability ───────────────────────────────────────────────────

/** Providers offered under "Add an account", in display order per section. */
const CONNECTABLE: SourceProvider[] = [
  "OUTLOOK_MAIL",
  "TEAMS_CHAT",
  "GMAIL",
  "OUTLOOK_CALENDAR",
  "GOOGLE_CALENDAR",
  "SHAREPOINT",
  "ONEDRIVE",
  "GOOGLE_DRIVE",
  "DROPBOX",
  "GRANOLA",
  "READ_AI",
  "HUBSPOT",
  "QUICKBOOKS",
  "BREX",
  "DOCUSIGN",
];

/** Where Read AI posts meeting reports (the public origin in production). */
export function readAiWebhookUrl(origin: string | null): string | null {
  const base = appOrigin(origin);
  return base ? `${base}/api/webhooks/read-ai` : null;
}

export function connectUrl(provider: SourceProvider, connectionId?: string): string {
  const base = `/api/integrations/${providerSlug(provider)}/connect`;
  return connectionId ? `${base}?connectionId=${encodeURIComponent(connectionId)}` : base;
}

// ─── Data ────────────────────────────────────────────────────────────────────

export interface RunRow {
  id: string;
  trigger: RunTrigger;
  status: RunStatus;
  startedAt: Date;
  durationMs: number | null;
  fetched: number;
  created: number;
  updated: number;
  noise: number;
  duplicatesPrevented: number;
  reviewItems: number;
  error: string | null;
}

export interface ConnectionCard {
  id: string;
  kind: SourceKind;
  provider: SourceProvider;
  providerLabel: string;
  vendor: string;
  mode: ConnectionMode;
  label: string;
  accountEmail: string | null;
  status: ConnectionStatus;
  lastError: string | null;
  lastErrorAt: Date | null;
  lastSyncAt: Date | null;
  lastSuccessAt: Date | null;
  nextSyncAt: Date | null;
  itemsIngested: number;
  syncFrequency: SyncFrequency;
  includeNoise: boolean;
  defaultSensitivity: Sensitivity;
  permissions: Permission[];
  supportsRealtime: boolean;
  webhookActive: boolean;
  /** OAuth reconnect URL when the provider is configured; null otherwise. */
  reconnectUrl: string | null;
  auth: ProviderAuth;
  /** Last characters of a pasted key, so keys can be told apart (never the key). */
  keyHint: string | null;
  /** Read AI: where its webhook must point. */
  webhookUrl: string | null;
  missingEnv: string[];
  /** Upload-only sources are not synced on a schedule. */
  syncable: boolean;
  runs: RunRow[];
}

export interface ProviderOption {
  provider: SourceProvider;
  label: string;
  vendor: string;
  auth: ProviderAuth;
  webhookUrl: string | null;
  configured: boolean;
  missingEnv: string[];
  demo: boolean;
  webhooks: boolean;
  connectUrl: string | null;
}

export interface IntegrationSection {
  kind: SourceKind;
  label: string;
  description: string;
  connections: ConnectionCard[];
  providers: ProviderOption[];
}

export interface IntegrationsData {
  sections: IntegrationSection[];
  timezone: string;
  now: Date;
  disconnected: number;
}

/** `origin`: the request's origin, used for the webhook URL outside production. */
export async function getIntegrationsData(origin: string | null = null): Promise<IntegrationsData> {
  const ceo = await getCeoContext();
  const [connections, disconnected] = await Promise.all([
    db.sourceConnection.findMany({
      where: { status: { not: "DISCONNECTED" } },
      orderBy: [{ kind: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        kind: true,
        provider: true,
        mode: true,
        label: true,
        accountEmail: true,
        status: true,
        lastError: true,
        lastErrorAt: true,
        lastSyncAt: true,
        lastSuccessAt: true,
        nextSyncAt: true,
        itemsIngested: true,
        syncFrequency: true,
        includeNoise: true,
        defaultSensitivity: true,
        settings: true,
        scopes: true,
        webhookChannelId: true,
        webhookExpiresAt: true,
        runs: {
          orderBy: { startedAt: "desc" },
          take: 5,
          select: {
            id: true,
            trigger: true,
            status: true,
            startedAt: true,
            durationMs: true,
            fetched: true,
            created: true,
            updated: true,
            noise: true,
            duplicatesPrevented: true,
            reviewItems: true,
            error: true,
          },
        },
      },
    }),
    db.sourceConnection.count({ where: { status: "DISCONNECTED" } }),
  ]);

  const now = new Date();
  const availability = providerAvailability();
  const webhookUrl = readAiWebhookUrl(origin);
  const cards: ConnectionCard[] = connections.map((c) => {
    const meta = SOURCE_PROVIDERS[c.provider];
    const avail = availability[c.provider];
    return {
      id: c.id,
      kind: c.kind,
      provider: c.provider,
      providerLabel: meta.label,
      vendor: meta.vendor,
      mode: c.mode,
      label: c.label,
      accountEmail: c.accountEmail,
      status: c.status,
      lastError: c.lastError,
      lastErrorAt: c.lastErrorAt,
      lastSyncAt: c.lastSyncAt,
      lastSuccessAt: c.lastSuccessAt,
      nextSyncAt: c.syncFrequency === "MANUAL" ? null : c.nextSyncAt,
      itemsIngested: c.itemsIngested,
      syncFrequency: c.syncFrequency,
      includeNoise: c.includeNoise,
      defaultSensitivity: c.defaultSensitivity,
      permissions: describeScopes(c.scopes),
      supportsRealtime: avail.webhooks,
      webhookActive: Boolean(c.webhookChannelId && (!c.webhookExpiresAt || c.webhookExpiresAt > now)),
      reconnectUrl: meta.oauth && avail.configured ? connectUrl(c.provider, c.id) : null,
      auth: meta.auth,
      keyHint: c.mode === "LIVE" && (meta.auth === "apiKey" || meta.auth === "webhook") ? keyHintOf(c.settings) : null,
      webhookUrl: c.provider === "READ_AI" ? webhookUrl : null,
      missingEnv: avail.missingEnv,
      // Uploads arrive from the Documents page and Read AI pushes reports: neither syncs on a schedule.
      syncable: c.provider !== "LOCAL_UPLOAD" && meta.auth !== "webhook",
      runs: c.runs,
    };
  });

  const sections: IntegrationSection[] = (Object.keys(SOURCE_KINDS) as SourceKind[]).map((kind) => ({
    kind,
    label: SOURCE_KINDS[kind].label,
    description: SOURCE_KINDS[kind].description,
    connections: cards.filter((c) => c.kind === kind),
    providers: CONNECTABLE.filter((p) => SOURCE_PROVIDERS[p].kind === kind).map((provider) => {
      const avail = availability[provider];
      return {
        provider,
        label: SOURCE_PROVIDERS[provider].label,
        vendor: SOURCE_PROVIDERS[provider].vendor,
        auth: SOURCE_PROVIDERS[provider].auth,
        webhookUrl: provider === "READ_AI" ? webhookUrl : null,
        configured: avail.configured,
        missingEnv: avail.missingEnv,
        demo: avail.demo,
        webhooks: avail.webhooks,
        connectUrl: avail.configured && SOURCE_PROVIDERS[provider].auth === "oauth" ? connectUrl(provider) : null,
      };
    }),
  }));

  return { sections, timezone: ceo.timezone, now, disconnected };
}

function keyHintOf(settings: unknown): string | null {
  const hint = settings && typeof settings === "object" && !Array.isArray(settings) ? (settings as Record<string, unknown>).keyHint : null;
  return typeof hint === "string" && /^….{1,8}$/.test(hint) ? hint : null;
}
