import { drainQueue } from "@/server/ingestion/jobs/worker";
import { scheduleDueSyncs } from "@/server/ingestion/scheduler";
import { hasBearer } from "@/server/security/request";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Leaves headroom under maxDuration for the response and connection teardown. */
const DRAIN_BUDGET_MS = 50_000;

/**
 * Ingestion heartbeat. Call every few minutes from a cron (Vercel Cron,
 * Cloud Scheduler, GitHub Actions…) with `Authorization: Bearer $CRON_SECRET`:
 * queues syncs that are due (hourly / daily / safety syncs for webhook
 * connections, plus the nightly retention sweep) and drains the job queue
 * within the time budget. Safe to overlap with the CLI worker — job claims use
 * FOR UPDATE SKIP LOCKED.
 */
export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}

async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  if (!hasBearer(request, secret)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const started = Date.now();
  try {
    const scheduled = await scheduleDueSyncs();
    const drain = await drainQueue({ budgetMs: DRAIN_BUDGET_MS, workerId: `tick-${started}` });
    return Response.json({ ok: true, scheduled, ...drain, totalMs: Date.now() - started });
  } catch (error) {
    // Message only: never echo stack traces or payloads to the caller.
    console.error("[ingest:tick] failed:", error instanceof Error ? error.message : error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Tick failed" }, { status: 500 });
  }
}
