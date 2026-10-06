/** CONTRACT STUB — implemented by the providers & sync workstream. */
import type { SourceProvider } from "@/generated/prisma/enums";

export interface ProviderAvailability {
  /** OAuth client credentials are configured (LIVE connections possible). */
  configured: boolean;
  missingEnv: string[];
  /** Provider supports push notifications (REALTIME frequency). */
  webhooks: boolean;
  /** Demo (mock) adapter available. */
  demo: boolean;
}

export function providerAvailability(): Record<SourceProvider, ProviderAvailability> {
  throw new Error("providerAvailability: not implemented yet");
}
