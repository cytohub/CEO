/**
 * What each provider can do in this deployment: LIVE OAuth (client
 * credentials present), push notifications, and demo mode.
 */
import type { SourceProvider } from "@/generated/prisma/enums";
import { SOURCE_PROVIDERS } from "@/lib/intelligence";
import { vendorConfig, vendorOf } from "./oauth";

export interface ProviderAvailability {
  /** OAuth client credentials are configured (LIVE connections possible). */
  configured: boolean;
  missingEnv: string[];
  /** Provider supports push notifications (REALTIME frequency). */
  webhooks: boolean;
  /** Demo (mock) adapter available. */
  demo: boolean;
}

export function providerAvailability(env: NodeJS.ProcessEnv = process.env): Record<SourceProvider, ProviderAvailability> {
  const out = {} as Record<SourceProvider, ProviderAvailability>;
  for (const provider of Object.keys(SOURCE_PROVIDERS) as SourceProvider[]) {
    const vendor = vendorOf(provider);
    if (!vendor) {
      // Uploads and in-app content need no credentials and have nothing to simulate.
      out[provider] = { configured: true, missingEnv: [], webhooks: false, demo: false };
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
      webhooks: provider === "GMAIL" ? Boolean(env.GOOGLE_PUBSUB_TOPIC) : true,
      demo: true,
    };
  }
  return out;
}
