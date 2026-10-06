/**
 * Provider registry: which adapter serves a connection.
 *
 *   LIVE  → the real adapter for the provider (OAuth tokens via connections.ts)
 *   DEMO  → the mock adapter for the connection kind (demo fixtures)
 *   LOCAL_UPLOAD / CYTOHUB_INTERNAL → no-op (their documents arrive through
 *   uploads and the app itself, never through a sync)
 */
import type { ConnectionMode, SourceKind, SourceProvider } from "@/generated/prisma/enums";
import type { CalendarProvider, DocumentProvider, EmailProvider, SourceProviderAdapter, WebhookSubscriber } from "../types";
import { dropboxProvider } from "./dropbox";
import { googleCalendarProvider } from "./google/calendar";
import { googleDriveProvider } from "./google/drive";
import { gmailProvider } from "./google/gmail";
import { outlookCalendarProvider } from "./microsoft/calendar";
import { oneDriveProvider, sharePointProvider } from "./microsoft/drive";
import { outlookMailProvider } from "./microsoft/mail";
import { mockCalendarProvider } from "./mock/calendar";
import { mockDocumentProvider } from "./mock/documents";
import { mockEmailProvider } from "./mock/email";

/** Uploads and in-app notes have nothing to pull. */
export const noopDocumentProvider: DocumentProvider = {
  kind: "DOCUMENTS",
  async listChanges(ctx, cursor) {
    return { items: [], deletedExternalIds: [], cursor: cursor ?? { noop: true }, hasMore: false };
  },
};

const LIVE: Record<SourceProvider, SourceProviderAdapter> = {
  GMAIL: gmailProvider,
  OUTLOOK_MAIL: outlookMailProvider,
  GOOGLE_CALENDAR: googleCalendarProvider,
  OUTLOOK_CALENDAR: outlookCalendarProvider,
  GOOGLE_DRIVE: googleDriveProvider,
  ONEDRIVE: oneDriveProvider,
  SHAREPOINT: sharePointProvider,
  DROPBOX: dropboxProvider,
  LOCAL_UPLOAD: noopDocumentProvider,
  CYTOHUB_INTERNAL: noopDocumentProvider,
};

const DEMO: Record<SourceKind, SourceProviderAdapter> = {
  EMAIL: mockEmailProvider,
  CALENDAR: mockCalendarProvider,
  DOCUMENTS: mockDocumentProvider,
};

type AdapterConnection = { provider: SourceProvider; mode: ConnectionMode; kind: SourceKind };

export function getAdapter(connection: AdapterConnection): SourceProviderAdapter {
  if (connection.provider === "LOCAL_UPLOAD" || connection.provider === "CYTOHUB_INTERNAL") return noopDocumentProvider;
  const adapter = connection.mode === "DEMO" ? DEMO[connection.kind] : LIVE[connection.provider];
  if (adapter.kind !== connection.kind) throw new Error(`${connection.provider} adapter serves ${adapter.kind}, not ${connection.kind}`);
  return adapter;
}

export function getEmailAdapter(connection: AdapterConnection): EmailProvider {
  const a = getAdapter(connection);
  if (a.kind !== "EMAIL") throw new Error(`${connection.provider} is not an email source`);
  return a;
}

export function getCalendarAdapter(connection: AdapterConnection): CalendarProvider {
  const a = getAdapter(connection);
  if (a.kind !== "CALENDAR") throw new Error(`${connection.provider} is not a calendar source`);
  return a;
}

export function getDocumentAdapter(connection: AdapterConnection): DocumentProvider {
  const a = getAdapter(connection);
  if (a.kind !== "DOCUMENTS") throw new Error(`${connection.provider} is not a document source`);
  return a;
}

/**
 * Push subscription support for LIVE connections. Dropbox webhooks are
 * app-level (nothing to subscribe per connection); Gmail push needs a
 * Pub/Sub topic.
 */
export function getWebhookSubscriber(connection: AdapterConnection): WebhookSubscriber | null {
  if (connection.mode !== "LIVE") return null;
  switch (connection.provider) {
    case "GMAIL":
      return process.env.GOOGLE_PUBSUB_TOPIC ? gmailProvider : null;
    case "OUTLOOK_MAIL":
      return outlookMailProvider;
    case "GOOGLE_CALENDAR":
      return googleCalendarProvider;
    case "OUTLOOK_CALENDAR":
      return outlookCalendarProvider;
    case "GOOGLE_DRIVE":
      return googleDriveProvider;
    case "ONEDRIVE":
      return oneDriveProvider;
    case "SHAREPOINT":
      return sharePointProvider;
    default:
      return null;
  }
}
