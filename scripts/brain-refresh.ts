/**
 * Run the Daily Brain Refresh from the command line or a system cron:
 *   npm run brain:refresh            (skips if one started in the last 15 minutes)
 *   npm run brain:refresh -- --force
 *
 * The ingestion worker already runs the Brain on its schedule (the morning
 * brief, then hourly on weekdays), so a cron is only needed where no worker runs.
 */
import "dotenv/config";
import { db } from "../src/lib/db";
import { REFRESH_OVERLAP_MINUTES } from "../src/server/brain/schedule";
import { runBrainRefresh } from "../src/server/brain/refresh";

async function main() {
  if (!process.argv.includes("--force")) {
    const recent = await db.brainRefresh.findFirst({
      where: { startedAt: { gte: new Date(Date.now() - REFRESH_OVERLAP_MINUTES * 60_000) } },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true, status: true },
    });
    if (recent) {
      console.log(`Skipped: a Brain refresh started at ${recent.startedAt.toISOString()} (${recent.status.toLowerCase()}). Use --force to run another.`);
      return 0;
    }
  }
  const outcome = await runBrainRefresh({ trigger: "SCHEDULED" });
  console.log(JSON.stringify(outcome, null, 2));
  return outcome.status === "FAILED" ? 1 : 0;
}

main()
  .then(async (code) => {
    await db.$disconnect();
    process.exit(code);
  })
  .catch(async (error) => {
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });
