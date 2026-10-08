/**
 * Which connector serves a business or meeting-notes connection. Mail,
 * calendar and document providers live in ../providers/registry.ts.
 */
import type { SourceProvider } from "@/generated/prisma/enums";
import { brexConnector } from "./brex";
import { docusignConnector } from "./docusign";
import { granolaConnector } from "./granola";
import { hubspotConnector } from "./hubspot";
import { quickbooksConnector } from "./quickbooks";
import { readAiConnector } from "./read-ai";
import type { BusinessConnector } from "./types";

const CONNECTORS: Partial<Record<SourceProvider, BusinessConnector>> = {
  HUBSPOT: hubspotConnector,
  QUICKBOOKS: quickbooksConnector,
  BREX: brexConnector,
  DOCUSIGN: docusignConnector,
  GRANOLA: granolaConnector,
  READ_AI: readAiConnector,
};

export function getBusinessConnector(provider: SourceProvider): BusinessConnector | null {
  return CONNECTORS[provider] ?? null;
}
