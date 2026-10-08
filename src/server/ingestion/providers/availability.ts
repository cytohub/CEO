/**
 * What each provider can do in this deployment: LIVE connections (OAuth
 * client credentials present, or a key the CEO pastes in), push
 * notifications, and demo mode.
 */
import type { SourceProvider } from "@/generated/prisma/enums";
import { PIPELINE_KINDS, SOURCE_PROVIDERS } from "@/lib/intelligence";
import { vendorConfig, vendorOf } from "./oauth";

export interface ProviderAvailability {
  /** LIVE connections are possible (OAuth app configured, or key-based). */
  configured: boolean;
  missingEnv: string[];
  /** Provider supports push notifications (REALTIME frequency). */
  webhooks: boolean;
  /** Demo (mock) adapter available. */
  demo: boolean;
}

/** Push subscriptions this server can create per connection. */
const PUSH: Partial<Record<SourceProvider, boolean>> = {
  OUTLOOK_MAIL: true,
  GOOGLE_CALENDAR: true,
  OUTLOOK_CALENDAR: true,
  GOOGLE_DRIVE: true,
  ONEDRIVE: true,
  SHAREPOINT: true,
  DROPBOX: true,
};

/** Sample-data adapters exist for mail, calendar and documents only. */
const DEMO: Partial<Record<SourceProvider, boolean>> = {
  GMAIL: true,
  OUTLOOK_MAIL: true,
  GOOGLE_CALENDAR: true,
  OUTLOOK_CALENDAR: true,
  GOOGLE_DRIVE: true,
  ONEDRIVE: true,
  SHAREPOINT: true,
  DROPBOX: true,
};

export function providerAvailability(env: NodeJS.ProcessEnv = process.env): Record<SourceProvider, ProviderAvailability> {
  const out = {} as Record<SourceProvider, ProviderAvailability>;
  for (const provider of Object.keys(SOURCE_PROVIDERS) as SourceProvider[]) {
    const meta = SOURCE_PROVIDERS[provider];
    const vendor = vendorOf(provider);
    if (!vendor) {
      // Uploads need nothing; key- and webhook-based sources are configured from Settings.
      // A webhook URL must come from configuration in production, never from the request.
      const missingEnv = meta.auth === "webhook" && env.NODE_ENV === "production" && !env.APP_ORIGIN ? ["APP_ORIGIN"] : [];
      out[provider] = { configured: missingEnv.length === 0, missingEnv, webhooks: meta.auth === "webhook", demo: false };
      continue;
    }
    const config = vendorConfig(vendor, env);
    const missingEnv = [...config.missingEnv];
    // Production redirect URIs must come from configuration, never from the request.
    if (env.NODE_ENV === "production" && !env.APP_ORIGIN) missingEnv.push("APP_ORIGIN");
    out[provider] = {
      configured: missingEnv.length === 0,
      missingEnv,
      // Gmail push goes through Pub/Sub; Dropbox webhooks are app-level (registered in the Dropbox console).
      webhooks: provider === "GMAIL" ? Boolean(env.GOOGLE_PUBSUB_TOPIC) : Boolean(PUSH[provider]),
      demo: Boolean(DEMO[provider]) && PIPELINE_KINDS.includes(meta.kind),
    };
  }
  return out;
}
