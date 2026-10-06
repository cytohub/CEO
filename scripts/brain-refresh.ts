/**
 * Run the Daily Brain Refresh from the command line or a system cron:
 *   npm run brain:refresh
 */
import "dotenv/config";
import { db } from "../src/lib/db";
import { runBrainRefresh } from "../src/server/brain/refresh";

runBrainRefresh({ trigger: "SCHEDULED" })
  .then((outcome) => {
    console.log(JSON.stringify(outcome, null, 2));
    return db.$disconnect().then(() => process.exit(outcome.status === "FAILED" ? 1 : 0));
  })
  .catch(async (error) => {
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });
