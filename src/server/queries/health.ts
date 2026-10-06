/**
 * Ingestion Health dashboard data, scoped to the viewer: metrics and job
 * details are operational, but source titles and extraction issues (which can
 * quote content) are shown only when the viewer may read the source item.
 */
import type { JobStatus, JobType, PipelineStage, ProcessingStatus, RunStatus, RunTrigger, SourceItemKind, SourceKind, SourceProvider } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { SOURCE_PROVIDERS } from "@/lib/intelligence";
import { getCeoContext } from "@/server/context";
import { failingJobs, healthSnapshot, itemsWithErrors, recentExtractionIssues, recentRuns, type HealthSnapshot } from "@/server/ingestion/health";
import { getAccessScope, sourceItemWhere } from "@/server/security/access";
import { can, type Viewer } from "@/server/security/session";
import { RESTRICTED_LABEL } from "./users";

export interface HealthRunRow {
  id: string;
  connection: { id: string; label: string; provider: SourceProvider; providerLabel: string; kind: SourceKind } | null;
  trigger: RunTrigger;
  status: RunStatus;
  startedAt: Date;
  durationMs: number | null;
  fetched: number;
  created: number;
  updated: number;
  noise: number;
  duplicatesPrevented: number;
  recordsWritten: number;
  reviewItems: number;
  extractionErrors: number;
  error: string | null;
}

export interface HealthJobRow {
  id: string;
  type: JobType;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  runAt: Date;
  updatedAt: Date;
  subject: string | null;
  restricted: boolean;
}

export interface HealthItemRow {
  id: string;
  title: string;
  restricted: boolean;
  kind: SourceItemKind;
  status: ProcessingStatus;
  stage: PipelineStage;
  attempts: number;
  error: string | null;
  providerLabel: string;
  updatedAt: Date;
}

export interface HealthIssueRow {
  id: string;
  title: string;
  restricted: boolean;
  at: Date | null;
  /** Issue text only for readable items (reasons can quote the source). */
  issues: { path: string; reason: string }[];
  issueCount: number;
}

export interface HealthData {
  snapshot: HealthSnapshot;
  timezone: string;
  runs: HealthRunRow[];
  jobs: HealthJobRow[];
  items: HealthItemRow[];
  issues: HealthIssueRow[];
  canManage: boolean;
  reauth: { id: string; label: string; provider: SourceProvider; providerLabel: string; status: "ERROR" | "NEEDS_REAUTH"; lastError: string | null; reconnectHref: string }[];
}

export async function getHealthData(viewer: Viewer): Promise<HealthData> {
  const ceo = await getCeoContext();
  const [snapshot, runs, jobs, items, issues, scope] = await Promise.all([
    healthSnapshot({ timezone: ceo.timezone }),
    recentRuns(15),
    failingJobs(25),
    itemsWithErrors(20),
    recentExtractionIssues(10),
    getAccessScope(viewer),
  ]);

  const itemIds = [...new Set([...jobs.map((j) => j.sourceItem?.id), ...items.map((i) => i.id), ...issues.map((i) => i.id)].filter((x): x is string => Boolean(x)))];
  const readable = new Set(
    scope.all ? itemIds : (await db.sourceItem.findMany({ where: { AND: [{ id: { in: itemIds } }, sourceItemWhere(scope)] }, select: { id: true } })).map((r) => r.id),
  );

  const canManage = can(viewer, "integrations.manage");
  return {
    snapshot,
    timezone: ceo.timezone,
    canManage,
    runs: runs.map((r) => ({
      id: r.id,
      connection: r.connection
        ? { id: r.connection.id, label: r.connection.label, provider: r.connection.provider as SourceProvider, providerLabel: SOURCE_PROVIDERS[r.connection.provider as SourceProvider].label, kind: r.connection.kind }
        : null,
      trigger: r.trigger,
      status: r.status,
      startedAt: r.startedAt,
      durationMs: r.durationMs,
      fetched: r.fetched,
      created: r.created,
      updated: r.updated,
      noise: r.noise,
      duplicatesPrevented: r.duplicatesPrevented,
      recordsWritten: r.recordsWritten,
      reviewItems: r.reviewItems,
      extractionErrors: r.extractionErrors,
      error: r.error,
    })),
    jobs: jobs.map((j) => {
      const item = j.sourceItem;
      const restricted = Boolean(item && !readable.has(item.id));
      const subject = item ? (restricted ? RESTRICTED_LABEL : item.title) : j.connection ? `${SOURCE_PROVIDERS[j.connection.provider].label} · ${j.connection.label}` : null;
      return { id: j.id, type: j.type, status: j.status, attempts: j.attempts, maxAttempts: j.maxAttempts, lastError: j.lastError, runAt: j.runAt, updatedAt: j.updatedAt, subject, restricted };
    }),
    items: items.map((i) => {
      const restricted = !readable.has(i.id);
      return {
        id: i.id,
        title: restricted ? RESTRICTED_LABEL : i.title,
        restricted,
        kind: i.kind,
        status: i.status,
        stage: i.stage,
        attempts: i.attempts,
        error: i.processingError,
        providerLabel: SOURCE_PROVIDERS[i.connection.provider].label,
        updatedAt: i.updatedAt,
      };
    }),
    issues: issues.map((i) => {
      const restricted = !readable.has(i.id);
      const list = Array.isArray(i.errors) ? i.errors : [];
      return { id: i.id, title: restricted ? RESTRICTED_LABEL : i.title, restricted, at: i.extractedAt, issues: restricted ? [] : list.slice(0, 3), issueCount: list.length };
    }),
    reauth: snapshot.sync.flatMap((k) =>
      k.inError.map((c) => ({
        id: c.id,
        label: c.label,
        provider: c.provider as SourceProvider,
        providerLabel: SOURCE_PROVIDERS[c.provider as SourceProvider].label,
        status: c.status,
        lastError: c.lastError,
        reconnectHref: `/settings/integrations#connection-${c.id}`,
      })),
    ),
  };
}
