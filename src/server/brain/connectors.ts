/**
 * CytoHub Brain connector registry.
 *
 * Each connector normalizes an external system into BrainSignal rows
 * (kind, title, body, occurredAt, entity links, structured metadata). The
 * analysis stage never talks to vendors directly — it only reads signals and
 * the workspace graph — so adding a source is a matter of implementing
 * `sync()` for it here.
 *
 * Connectors are inert until their credentials are present. Sources seeded
 * with sample data carry `config.mode = "sample"` and report as such in the UI.
 */
import type { SourceProvider } from "@/generated/prisma/enums";
import type { Connector, ConnectorDefinition, SyncResult } from "./types";

export const CONNECTOR_DEFINITIONS: ConnectorDefinition[] = [
  {
    key: "workspace",
    name: "CytoHub Workspace",
    provider: "CytoHub",
    category: "WORKSPACE",
    description: "Tasks, goals, milestones, decisions, delegation and CEO history in this command center.",
    extracts: ["Overdue & blocked work", "Milestone health", "Goal confidence", "Delegation follow-ups", "Attention allocation"],
  },
  {
    key: "outlook-mail",
    name: "Outlook Mail",
    provider: "Microsoft 365",
    category: "COMMUNICATION",
    description: "CEO mailbox: commitments made, requests, escalations and investor/customer threads.",
    extracts: ["Commitments", "Response-needed threads", "Escalations", "Investor & customer requests"],
  },
  {
    key: "outlook-calendar",
    name: "Outlook Calendar",
    provider: "Microsoft 365",
    category: "CALENDAR",
    description: "Meetings, participants and time allocation by focus area.",
    extracts: ["Upcoming meetings", "Participants", "CEO time allocation"],
  },
  {
    key: "gmail",
    name: "Gmail",
    provider: "Google Workspace",
    category: "COMMUNICATION",
    description: "CEO mailbox: threads, commitments made and received, requests, escalations and follow-ups.",
    extracts: ["Commitments", "Requests & deadlines", "Thread summaries", "Investor & customer follow-ups"],
  },
  {
    key: "google-calendar",
    name: "Google Calendar",
    provider: "Google Workspace",
    category: "CALENDAR",
    description: "Meetings, attendees, reschedules and preparation context.",
    extracts: ["Meetings", "Reschedules & cancellations", "CEO time allocation"],
  },
  {
    key: "google-drive",
    name: "Google Drive",
    provider: "Google Workspace",
    category: "DOCUMENTS",
    description: "Decks, models, contracts and reports — versioned, with significant changes detected.",
    extracts: ["Document summaries", "Key figures & version changes", "Contracts & deadlines"],
  },
  {
    key: "onedrive",
    name: "OneDrive",
    provider: "Microsoft 365",
    category: "DOCUMENTS",
    description: "The CEO's OneDrive documents, versioned.",
    extracts: ["Document summaries", "Version changes"],
  },
  {
    key: "dropbox",
    name: "Dropbox",
    provider: "Dropbox",
    category: "DOCUMENTS",
    description: "Shared folders with partners and investors.",
    extracts: ["Document summaries", "Version changes"],
  },
  {
    key: "uploads",
    name: "Uploads & workspace notes",
    provider: "CytoHub",
    category: "DOCUMENTS",
    description: "Files uploaded to the command center and meeting notes written in it.",
    extracts: ["Document intelligence", "Meeting decisions & action items"],
  },
  {
    key: "teams",
    name: "Microsoft Teams",
    provider: "Microsoft 365",
    category: "COMMUNICATION",
    description: "Leadership channels and direct messages that need CEO attention.",
    extracts: ["Escalations", "Approvals", "Hiring signals"],
  },
  {
    key: "sharepoint",
    name: "SharePoint & OneDrive",
    provider: "Microsoft 365",
    category: "DOCUMENTS",
    description: "Strategy documents, investor materials, financial models and board decks.",
    extracts: ["New & changed documents", "Document summaries", "Resource links"],
  },
  {
    key: "hubspot",
    name: "HubSpot CRM",
    provider: "HubSpot",
    category: "CRM",
    description: "Pharma pipeline, investor pipeline and partnership deals.",
    extracts: ["Deal stage changes", "Stalled deals", "Contact recency"],
  },
  {
    key: "granola",
    name: "Granola",
    provider: "Granola",
    category: "COMMUNICATION",
    description: "Meeting notes and transcripts: decisions, action items and risks raised.",
    extracts: ["Action items", "Decisions raised", "Risks mentioned"],
  },
  {
    key: "read-ai",
    name: "Read AI",
    provider: "Read AI",
    category: "COMMUNICATION",
    description: "Meeting summaries and engagement signals for external calls.",
    extracts: ["Meeting summaries", "Follow-ups"],
  },
  {
    key: "docusign",
    name: "DocuSign",
    provider: "DocuSign",
    category: "DOCUMENTS",
    description: "Contract and agreement status: sent, viewed, signed, stalled.",
    extracts: ["Contracts awaiting signature", "Signed agreements"],
  },
  {
    key: "finance",
    name: "Accounting & Banking",
    provider: "Accounting system",
    category: "FINANCE",
    description: "Cash, burn, revenue recognition and bookings for the scoreboard.",
    extracts: ["Cash & runway", "Revenue", "Burn"],
  },
  {
    key: "eln-lims",
    name: "ELN / LIMS",
    provider: "Lab systems",
    category: "SCIENCE",
    description: "Scientific programs: donor hearts profiled, assays validated, study readouts.",
    extracts: ["Dataset growth", "Study milestones", "Assay throughput"],
  },
  {
    key: "hris",
    name: "HRIS & Recruiting",
    provider: "People systems",
    category: "PEOPLE",
    description: "Headcount, open roles, candidate pipeline and offers.",
    extracts: ["Open roles", "Offer deadlines", "Headcount"],
  },
];

/** Environment variables that mark a connector as configured. */
const MICROSOFT = ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"];
const GOOGLE = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];

const CREDENTIAL_ENV: Record<string, string[]> = {
  gmail: GOOGLE,
  "google-calendar": GOOGLE,
  "google-drive": GOOGLE,
  "outlook-mail": MICROSOFT,
  "outlook-calendar": MICROSOFT,
  onedrive: MICROSOFT,
  sharepoint: MICROSOFT,
  teams: MICROSOFT,
  dropbox: ["DROPBOX_APP_KEY", "DROPBOX_APP_SECRET"],
  hubspot: ["HUBSPOT_ACCESS_TOKEN"],
  granola: ["GRANOLA_API_KEY"],
  "read-ai": ["READ_AI_API_KEY"],
  docusign: ["DOCUSIGN_ACCESS_TOKEN"],
  finance: ["FINANCE_API_KEY"],
  "eln-lims": ["ELN_API_KEY"],
  hris: ["HRIS_API_KEY"],
};

/** BrainSource catalog entry for each ingestion provider (SourceConnection.brainSourceId). */
export const BRAIN_SOURCE_KEY: Record<SourceProvider, string> = {
  GMAIL: "gmail",
  OUTLOOK_MAIL: "outlook-mail",
  GOOGLE_CALENDAR: "google-calendar",
  OUTLOOK_CALENDAR: "outlook-calendar",
  GOOGLE_DRIVE: "google-drive",
  ONEDRIVE: "onedrive",
  SHAREPOINT: "sharepoint",
  DROPBOX: "dropbox",
  LOCAL_UPLOAD: "uploads",
  CYTOHUB_INTERNAL: "uploads",
};

/** Catalog keys whose data now arrives through the ingestion pipeline (SourceConnection), not BrainSignal sync. */
export const PIPELINE_SOURCE_KEYS = new Set(Object.values(BRAIN_SOURCE_KEY));

export function credentialEnvFor(key: string): string[] {
  return CREDENTIAL_ENV[key] ?? [];
}

function makeConnector(def: ConnectorDefinition): Connector {
  const env = CREDENTIAL_ENV[def.key] ?? [];
  return {
    ...def,
    isConfigured: () => def.key === "workspace" || def.key === "uploads" || (env.length > 0 && env.every((v) => Boolean(process.env[v]))),
    // Vendor implementations receive (ctx, sourceId); the default is a no-op.
    async sync(): Promise<SyncResult> {
      if (def.key === "workspace") {
        // The workspace is read live by the analyzers; nothing to ingest.
        return { key: def.key, status: "ok", items: 0, message: "Workspace graph analyzed live" };
      }
      // Vendor fetchers plug in here: page through items changed since
      // `ctx.since`, map each to a BrainSignal (upsert on sourceId+externalId)
      // and return the count. Until credentials exist this is a no-op.
      return {
        key: def.key,
        status: "skipped",
        items: 0,
        message: env.length ? `Not connected — set ${env.join(", ")}` : "Not connected",
      };
    },
  };
}

export const CONNECTORS: Connector[] = CONNECTOR_DEFINITIONS.map(makeConnector);

export function getConnector(key: string): Connector | undefined {
  return CONNECTORS.find((c) => c.key === key);
}
