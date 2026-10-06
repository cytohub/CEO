import { runBrainRefresh } from "@/server/brain/refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scheduled Daily Brain Refresh. Call from a cron (e.g. Vercel Cron, GitHub
 * Actions, Cloud Scheduler) with `Authorization: Bearer $CRON_SECRET`.
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
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const outcome = await runBrainRefresh({ trigger: "SCHEDULED" });
  return Response.json(outcome, { status: outcome.status === "FAILED" ? 500 : 200 });
}
