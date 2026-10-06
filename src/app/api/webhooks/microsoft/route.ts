import { handleMicrosoftWebhook } from "@/server/ingestion/providers/webhook-handlers";

export const dynamic = "force-dynamic";

/**
 * Microsoft Graph change notifications. Echoes `validationToken` (text/plain)
 * on subscription creation; verifies each notification's clientState against
 * the connection's stored secret hash; queues a sync only.
 */
export async function POST(request: Request) {
  return handleMicrosoftWebhook(request);
}
