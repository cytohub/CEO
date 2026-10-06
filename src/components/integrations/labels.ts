import type { RunStatus, RunTrigger } from "@/generated/prisma/enums";
import type { Tone } from "@/lib/domain";

export const RUN_TRIGGER: Record<RunTrigger, string> = {
  MANUAL: "Manual",
  SCHEDULED: "Scheduled",
  WEBHOOK: "Push",
  REFRESH: "Brain refresh",
  SEED: "Seed",
  UPLOAD: "Upload",
};

export const RUN_STATUS: Record<RunStatus, { label: string; tone: Tone }> = {
  RUNNING: { label: "Running", tone: "info" },
  SUCCEEDED: { label: "Succeeded", tone: "good" },
  PARTIAL: { label: "Partial", tone: "warning" },
  FAILED: { label: "Failed", tone: "critical" },
};

/** "in 42m", "in 3h", "in 2d", "due now" — the future counterpart of timeAgo(). */
export function timeUntil(instant: Date | null | undefined, now: Date): string {
  if (!instant) return "—";
  const diff = instant.getTime() - now.getTime();
  if (diff <= 60_000) return "due now";
  const min = Math.round(diff / 60_000);
  if (min < 60) return `in ${min}m`;
  const h = Math.round(min / 60);
  if (h < 48) return `in ${h}h`;
  return `in ${Math.round(h / 24)}d`;
}

/** "850 ms", "4.2 s", "3m 10s" */
export function shortDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(Math.round(s % 60)).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
