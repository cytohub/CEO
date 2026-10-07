import type { Tx } from "@/lib/db";

const BRAIN_WRITE_LOCK = 0x627261696e;

/**
 * One Brain write at a time, across every process (web requests, the worker,
 * crons). Taken first in each ingestion transaction that creates or links Brain
 * records — entity resolution, relationship mapping, the writer, review
 * decisions and the sweeps — so dedupe always sees what the previous
 * transaction committed, and two processes never create the same company,
 * person or relationship. Released when the transaction ends. Slow work
 * (provider calls, AI extraction) happens outside these transactions.
 */
export async function lockBrainWrites(tx: Tx): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BRAIN_WRITE_LOCK})`;
}
