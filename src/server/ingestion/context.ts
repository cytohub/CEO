import type { RunTrigger } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { loadCeoContext } from "@/server/context";
import type { PipelineContext, PipelineCounters } from "./types";

export interface FlushablePipelineContext extends PipelineContext {
  /** Persist counter increments to the IngestionRun (if any) and reset them. */
  flush(): Promise<void>;
  counters: PipelineCounters;
}

/** Build the context every stage receives. One per job execution. */
export async function createPipelineContext(opts: { runId?: string | null; trigger: RunTrigger; now?: Date }): Promise<FlushablePipelineContext> {
  const now = opts.now ?? new Date();
  const ceo = await loadCeoContext(db, now);
  const user = await db.user.findUnique({ where: { id: ceo.userId }, select: { email: true } });
  const counters: PipelineCounters = { duplicatesPrevented: 0, extractionErrors: 0, recordsWritten: 0, reviewItems: 0 };
  const runId = opts.runId ?? null;
  return {
    db,
    now,
    runId,
    trigger: opts.trigger,
    ceo: {
      userId: ceo.userId,
      personId: ceo.personId,
      name: ceo.name,
      firstName: ceo.firstName,
      email: user?.email ?? null,
      timezone: ceo.timezone,
      today: ceo.today,
    },
    counters,
    log(stage, message) {
      if (process.env.CYTOHUB_INGEST_DEBUG === "true") console.log(`[ingest:${stage}] ${message}`);
    },
    count(counter, by = 1) {
      counters[counter] += by;
    },
    async flush() {
      const total = counters.duplicatesPrevented + counters.extractionErrors + counters.recordsWritten + counters.reviewItems;
      if (runId && total > 0) {
        await db.ingestionRun.update({
          where: { id: runId },
          data: {
            duplicatesPrevented: { increment: counters.duplicatesPrevented },
            extractionErrors: { increment: counters.extractionErrors },
            recordsWritten: { increment: counters.recordsWritten },
            reviewItems: { increment: counters.reviewItems },
          },
        }).catch(() => {});
      }
      counters.duplicatesPrevented = counters.extractionErrors = counters.recordsWritten = counters.reviewItems = 0;
    },
  };
}
