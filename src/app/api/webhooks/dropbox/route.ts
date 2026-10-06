import { handleDropboxChallenge, handleDropboxWebhook } from "@/server/ingestion/providers/webhook-handlers";

export const dynamic = "force-dynamic";

/** Dropbox endpoint verification: echo `challenge`. */
export async function GET(request: Request) {
  return handleDropboxChallenge(request);
}

/** Dropbox notifications, signed with HMAC-SHA256 of the raw body (X-Dropbox-Signature). Queues a sync only. */
export async function POST(request: Request) {
  return handleDropboxWebhook(request);
}
