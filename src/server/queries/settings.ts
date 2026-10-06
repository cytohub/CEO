import type { FocusArea, SourceCategory, SourceStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { tzOffsetMinutes } from "@/lib/dates";
import { FOCUS_AREA_ORDER, OPEN_TASK_STATUSES } from "@/lib/domain";
import { CLAUDE_MODEL, claudeEnabled } from "@/server/ai/claude";
import { computeAttention } from "@/server/brain/attention";
import { CONNECTOR_DEFINITIONS, credentialEnvFor } from "@/server/brain/connectors";
import type { PriorityWeights } from "@/server/brain/scoring";
import { getCeoContext } from "@/server/context";
import { getPriorityWeights, getThresholds, type BrainThresholds } from "@/server/settings";

/** Common IANA zones offered in the profile timezone picker. */
const COMMON_TIMEZONES = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Toronto",
  "America/Sao_Paulo",
  "UTC",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Amsterdam",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Zurich",
  "Europe/Stockholm",
  "Asia/Jerusalem",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];

export interface TimezoneOption {
  value: string;
  label: string;
  region: string;
  offsetMinutes: number;
}

function offsetLabel(minutes: number): string {
  if (minutes === 0) return "UTC";
  const sign = minutes > 0 ? "+" : "−";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

function timezoneOptions(current: string, now: Date): TimezoneOption[] {
  const zones = COMMON_TIMEZONES.includes(current) ? COMMON_TIMEZONES : [current, ...COMMON_TIMEZONES];
  return zones
    .map((tz) => {
      let offset = 0;
      try {
        offset = tzOffsetMinutes(now, tz);
      } catch {
        offset = 0;
      }
      const [region, ...rest] = tz.split("/");
      const city = (rest.join(" / ") || region).replace(/_/g, " ");
      return {
        value: tz,
        label: `${city} (${offsetLabel(offset)})`,
        region: tz === "UTC" ? "Universal" : region,
        offsetMinutes: offset,
      };
    })
    .sort((a, b) => a.offsetMinutes - b.offsetMinutes || a.label.localeCompare(b.label));
}

export interface PillarRow {
  id: string;
  name: string;
  description: string | null;
  color: string;
  order: number;
  active: boolean;
  counts: { goals: number; milestones: number; tasks: number; decisions: number; metrics: number };
  linked: number;
}

export interface AttentionTargetRow {
  focusArea: FocusArea;
  recommendedPct: number;
  rationale: string;
  actualPct: number;
  minutes: number;
}

export interface SourceRow {
  key: string;
  name: string;
  provider: string;
  category: SourceCategory;
  description: string;
  extracts: string[];
  status: SourceStatus | null;
  /** Derived display state. */
  state: "connected" | "sample" | "not_connected" | "disabled" | "syncing" | "error";
  lastSyncAt: Date | null;
  itemsIndexed: number;
  error: string | null;
  credentialEnv: string[];
  /** Every credential env var is present on the server. */
  credentialsPresent: boolean;
  /** Whether a BrainSource row exists (toggle needs one). */
  registered: boolean;
  alwaysOn: boolean;
}

export interface SettingsData {
  profile: { name: string; title: string; timezone: string; email: string; today: Date };
  timezones: TimezoneOption[];
  pillars: PillarRow[];
  attention: { rows: AttentionTargetRow[]; windowDays: number; totalMinutes: number; strategicPct: number };
  weights: PriorityWeights;
  openTaskCount: number;
  thresholds: BrainThresholds;
  sources: SourceRow[];
  ai: { claudeEnabled: boolean; model: string; cronSecretSet: boolean; disabledByFlag: boolean };
}

export async function getSettingsData(): Promise<SettingsData> {
  const ceo = await getCeoContext();
  const ATTENTION_WINDOW = 14;
  const [user, pillars, targets, weights, thresholds, sources, openTaskCount] = await Promise.all([
    db.user.findUnique({ where: { id: ceo.userId }, select: { email: true } }),
    db.strategicPillar.findMany({
      orderBy: [{ order: "asc" }, { name: "asc" }],
      include: { _count: { select: { goals: true, milestones: true, tasks: true, decisions: true, metrics: true } } },
    }),
    db.attentionTarget.findMany(),
    getPriorityWeights(db),
    getThresholds(db),
    db.brainSource.findMany(),
    db.task.count({ where: { status: { in: [...OPEN_TASK_STATUSES, "SOMEDAY"] } } }),
  ]);
  const attention = await computeAttention(db, { today: ceo.today, windowDays: ATTENTION_WINDOW, tolerance: thresholds.attentionTolerance });

  const targetBy = new Map(targets.map((t) => [t.focusArea, t]));
  const actualBy = new Map(attention.areas.map((a) => [a.area, a]));

  const sourceRows: SourceRow[] = CONNECTOR_DEFINITIONS.map((def) => {
    const row = sources.find((s) => s.key === def.key);
    const env = credentialEnvFor(def.key);
    const sample = (row?.config as { mode?: string } | null)?.mode === "sample";
    const status = row?.status ?? null;
    const state: SourceRow["state"] =
      status === "DISABLED"
        ? "disabled"
        : status === "ERROR"
          ? "error"
          : status === "SYNCING"
            ? "syncing"
            : sample
              ? "sample"
              : status === "CONNECTED"
                ? "connected"
                : "not_connected";
    return {
      key: def.key,
      name: row?.name ?? def.name,
      provider: def.provider,
      category: def.category,
      description: def.description,
      extracts: def.extracts,
      status,
      state,
      lastSyncAt: row?.lastSyncAt ?? null,
      itemsIndexed: row?.itemsIndexed ?? 0,
      error: row?.error ?? null,
      credentialEnv: env,
      credentialsPresent: env.length > 0 && env.every((v) => Boolean(process.env[v])),
      registered: Boolean(row),
      alwaysOn: def.key === "workspace",
    };
  });

  return {
    profile: { name: ceo.name, title: ceo.title, timezone: ceo.timezone, email: user?.email ?? "", today: ceo.today },
    timezones: timezoneOptions(ceo.timezone, ceo.now),
    pillars: pillars.map((p) => {
      const counts = { goals: p._count.goals, milestones: p._count.milestones, tasks: p._count.tasks, decisions: p._count.decisions, metrics: p._count.metrics };
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        color: p.color,
        order: p.order,
        active: p.active,
        counts,
        linked: counts.goals + counts.milestones + counts.tasks + counts.decisions + counts.metrics,
      };
    }),
    attention: {
      rows: FOCUS_AREA_ORDER.map((area) => {
        const t = targetBy.get(area);
        const a = actualBy.get(area);
        return {
          focusArea: area,
          recommendedPct: t?.recommendedPct ?? 0,
          rationale: t?.rationale ?? "",
          actualPct: a?.actualPct ?? 0,
          minutes: a?.minutes ?? 0,
        };
      }),
      windowDays: ATTENTION_WINDOW,
      totalMinutes: attention.totalMinutes,
      strategicPct: attention.strategicPct,
    },
    weights,
    openTaskCount,
    thresholds,
    sources: sourceRows,
    ai: {
      claudeEnabled: claudeEnabled(),
      model: CLAUDE_MODEL,
      cronSecretSet: Boolean(process.env.CRON_SECRET),
      disabledByFlag: process.env.CYTOHUB_DISABLE_CLAUDE === "true",
    },
  };
}
