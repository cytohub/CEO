import { handleGoogleWebhook } from "@/server/ingestion/providers/webhook-handlers";

export const dynamic = "force-dynamic";

/**
 * Google push: Calendar / Drive channel notifications (authenticated by the
 * per-connection channel token) and Gmail Pub/Sub pushes (authenticated by
 * GOOGLE_PUBSUB_VERIFICATION_TOKEN in the endpoint URL). Queues a sync only.
 */
export async function POST(request: Request) {
  return handleGoogleWebhook(request);
}
