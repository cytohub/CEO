/**
 * Append-only audit log. Never throws: auditing must not break the action it
 * records. Request metadata (IP, user agent) is attached when available.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { AuditOutcome } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { requestMeta } from "./request";
import type { Viewer } from "./session";

export type AuditAction =
  | "auth.login"
  | "auth.logout"
  | "auth.lockout"
  | "auth.denied"
  | "user.create"
  | "user.update"
  | "user.password_reset"
  | "user.deactivate"
  | "grant.create"
  | "grant.delete"
  | "connection.connect"
  | "connection.reconnect"
  | "connection.disconnect"
  | "connection.update"
  | "connection.sync"
  | "connection.oauth_failed"
  | "webhook.received"
  | "webhook.rejected"
  | "source.view"
  | "source.delete"
  | "document.upload"
  | "review.resolve"
  | "search.query"
  | "settings.update"
  | "retention.update"
  | "retention.purge"
  | "job.retry"
  | (string & {});

export async function audit(entry: {
  action: AuditAction;
  viewer?: Pick<Viewer, "userId" | "email"> | null;
  actorLabel?: string;
  outcome?: AuditOutcome;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    const meta = await requestMeta();
    await db.auditLog.create({
      data: {
        action: entry.action,
        outcome: entry.outcome ?? "SUCCESS",
        actorUserId: entry.viewer?.userId ?? null,
        actorLabel: entry.viewer?.email ?? entry.actorLabel ?? "system",
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        ip: meta.ip,
        userAgent: meta.userAgent,
        metadata: (entry.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (error) {
    console.error("[audit] failed to record", entry.action, error);
  }
}
