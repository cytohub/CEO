/**
 * Long-running ingestion worker for self-hosted deployments:
 *   npm run ingest:worker
 *
 * Every cycle (30 s) it queues syncs that are due and drains the job queue for
 * up to 25 s. Any number of workers (and the /api/ingestion/tick cron) can run
 * at once: jobs are claimed with FOR UPDATE SKIP LOCKED. SIGINT / SIGTERM stop
 * it gracefully — the job in progress finishes (or its lock expires and
 * another worker recovers it), then the database connection closes.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import { queueSummary } from "../src/server/ingestion/health";
import { drainQueue } from "../src/server/ingestion/jobs/worker";
import { scheduleDueSyncs } from "../src/server/ingestion/scheduler";

const CYCLE_MS = 30_000;
const BUDGET_MS = 25_000;
const workerId = `cli-${process.pid}-${randomUUID().slice(0, 8)}`;

let stopping = false;
let wake: (() => void) | null = null;

function stop(signal: string) {
  if (stopping) {
    console.log(`[ingest:worker] ${signal} again — exiting now`);
    process.exit(1);
  }
  stopping = true;
  console.log(`[ingest:worker] ${signal} received — finishing the current cycle…`);
  wake?.();
}
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

/** Sleep that a shutdown signal interrupts. */
function pause(ms: number) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      wake = null;
      resolve();
    }
    wake = done;
  });
}

async function cycle(n: number) {
  const started = Date.now();
  try {
    const scheduled = await scheduleDueSyncs();
    const drain = await drainQueue({ budgetMs: BUDGET_MS, workerId });
    const q = await queueSummary();
    console.log(
      `[ingest:worker] #${n} ${new Date().toISOString()} scheduled=${scheduled} processed=${drain.processed} ok=${drain.succeeded} failed=${drain.failed} dead=${drain.dead} ` +
        `remaining=${drain.remaining} queued=${q.queued} retrying=${q.retrying} deadTotal=${q.dead} ${Date.now() - started}ms`,
    );
  } catch (error) {
    // Keep running: a database blip should not kill the worker.
    console.error(`[ingest:worker] #${n} cycle failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main() {
  console.log(`[ingest:worker] ${workerId} started (cycle ${CYCLE_MS / 1000}s, budget ${BUDGET_MS / 1000}s)`);
  for (let n = 1; !stopping; n++) {
    const started = Date.now();
    await cycle(n);
    if (stopping) break;
    await pause(Math.max(1_000, CYCLE_MS - (Date.now() - started)));
  }
  await db.$disconnect();
  console.log("[ingest:worker] stopped");
  process.exit(0);
}

main().catch(async (error) => {
  console.error("[ingest:worker] fatal:", error instanceof Error ? error.message : error);
  await db.$disconnect().catch(() => {});
  process.exit(1);
});
