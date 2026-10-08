/**
 * Contracts for connectors that read structured business systems (HubSpot,
 * QuickBooks Online, Brex, DocuSign) and meeting-note services (Granola,
 * Read AI).
 *
 * Unlike mail, calendar and document providers, these do not page raw items
 * through the generic sync loop. Each connector's `sync()` reads what changed
 * since its cursor and writes the result itself through the helpers in
 * ./helpers.ts: deals and companies, scoreboard metric values, Brain signals
 * (which the Daily Brain Refresh turns into insights and inbox items), or
 * meeting-notes source items that run through the AI ingestion pipeline.
 *
 * The runner (./run.ts) owns the IngestionRun, connection status, retries and
 * scheduling; a connector only reads, writes and counts.
 */
import type { Sensitivity, SourceProvider, SyncFrequency } from "@/generated/prisma/enums";
import type { RefreshableProviderContext } from "../providers/http";
import type { PipelineContext } from "../types";

export type SyncCounter = "fetched" | "created" | "updated" | "unchanged" | "failed";

export interface ConnectorConnection {
  id: string;
  provider: SourceProvider;
  label: string;
  accountEmail: string | null;
  externalAccountId: string | null;
  /** Non-secret settings (DocuSign accountId/baseUri, QuickBooks realmId, key hint, pipeline map…). */
  settings: Record<string, unknown>;
  defaultSensitivity: Sensitivity;
  syncFrequency: SyncFrequency;
  /** Catalog key metrics and signals are attributed to ("hubspot", "quickbooks", …). */
  sourceKey: string;
}

export interface ConnectorSyncContext {
  pipeline: PipelineContext;
  /** Authenticated requests: pass to providerJson()/providerFetch(). The key or token never leaves the server. */
  http: RefreshableProviderContext;
  connection: ConnectorConnection;
  runId: string;
  /** Wall clock for this run (tests may fix it). */
  now: Date;
  /** Cursor saved by the previous successful run; null on the first sync. */
  cursor: Record<string, unknown> | null;
  /** First sync of this connection: import history quietly (no alerts for old events). */
  initial: boolean;
  /** Persist the cursor right away (a later failure resumes from here). */
  saveCursor(cursor: Record<string, unknown>): Promise<void>;
  /** Merge non-secret settings into the connection (discovered ids, mappings). */
  saveSettings(patch: Record<string, unknown>): Promise<void>;
  count(counter: SyncCounter, by?: number): void;
  /** A line in the run log shown in Settings → Integrations. Never include credentials. */
  note(message: string): void;
}

/** What a pasted key belongs to, checked against the vendor before it is stored. */
export interface KeyVerification {
  accountName: string | null;
  accountEmail?: string | null;
  externalAccountId: string | null;
  /** Non-secret settings to store on the connection. */
  settings?: Record<string, string>;
  /** Scopes or permissions the key was confirmed to have (shown in Settings). */
  scopes?: string[];
}

export class KeyRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyRejectedError";
  }
}

export interface BusinessConnector {
  provider: SourceProvider;
  sync(ctx: ConnectorSyncContext): Promise<void>;
  /**
   * Key-based providers: confirm the key works and has the scopes the
   * connector needs. Throw KeyRejectedError with a message the CEO can act on.
   */
  verifyKey?(key: string): Promise<KeyVerification>;
}
