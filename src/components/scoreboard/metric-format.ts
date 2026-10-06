/**
 * Pure formatting helpers for scoreboard metrics. Client-safe: no server
 * imports, only types.
 */
import type { MetricDirection, MetricUnit } from "@/generated/prisma/enums";
import { daysBetween, formatDay } from "@/lib/dates";
import { formatMetric } from "@/lib/format";

const COMPACT_STEPS: [number, string][] = [
  [1e12, "T"],
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "K"],
];

/**
 * Deterministic compact notation ("4.7M", "470K"). Intl's compact notation
 * differs between Node's and the browser's ICU ("$6M" vs "$6.0M"), which
 * breaks hydration in client components, so it is computed by hand here.
 */
function compact(abs: number): string {
  for (let i = 0; i < COMPACT_STEPS.length; i++) {
    const [n, suffix] = COMPACT_STEPS[i];
    if (abs >= n) {
      const v = abs / n;
      const rounded = v >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
      if (rounded >= 1000 && i > 0) return `${Math.round((rounded * n) / COMPACT_STEPS[i - 1][0] * 10) / 10}${COMPACT_STEPS[i - 1][1]}`;
      return `${rounded}${suffix}`;
    }
  }
  return String(Math.round(abs * 10) / 10);
}

function plain(value: number, digits = 1): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

/** "$4.7M", "$470K", "$8,400" — compact from $10K, like the shared formatCurrency. */
export function formatUsd(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  return abs >= 10_000 ? `${sign}$${compact(abs)}` : `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
}

/**
 * Scoreboard value formatting. Mirrors the shared formatMetric, with two
 * differences: compact notation is deterministic (hydration-safe), and small
 * unitless numbers (AUC 0.88, health 7.9) keep two decimals — rounding 0.88
 * to 0.9 would make a metric look like it hit a 0.9 target.
 */
export function formatMetricValue(value: number | null | undefined, unit: MetricUnit): string {
  if (value == null || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  switch (unit) {
    case "CURRENCY":
      return formatUsd(value);
    case "PERCENT":
      return formatMetric(value, unit);
    case "MONTHS":
      return `${plain(value)} mo`;
    case "DAYS":
      return `${plain(value)}d`;
    case "NUMBER":
      if (abs < 10) return plain(value, 2);
      return abs >= 10_000 ? `${sign}${compact(abs)}` : plain(value);
    default:
      return abs >= 10_000 ? `${sign}${compact(abs)}` : plain(value);
  }
}

export function displayName(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export const UNIT_HINT: Record<MetricUnit, string> = {
  CURRENCY: "USD — 4.8M, 750k and 1,200,000 all work",
  PERCENT: "Percent — enter 118 for 118%",
  COUNT: "Count",
  NUMBER: "Number",
  MONTHS: "Months",
  DAYS: "Days",
};

/** Parses "4.8M", "$750k", "1,200,000", "118%" into a number. Returns null when invalid or empty. */
export function parseMetricInput(raw: string): number | null {
  const s = raw.trim().replace(/[$,\s%]/g, "").toLowerCase();
  if (!s) return null;
  const m = /^(-?\d*\.?\d+)([kmb])?$/.exec(s);
  if (!m) return null;
  const mult = m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : m[2] === "b" ? 1e9 : 1;
  const n = Number(m[1]) * mult;
  return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : null;
}

type DeltaSource = {
  current: number | null;
  previous: number | null;
  change: number | null;
  unit: MetricUnit;
  direction: MetricDirection;
  series: { date: Date; value: number }[];
};

export interface MetricDelta {
  /** Signed, e.g. "+8.2%", "−4 pts", "+1". */
  text: string;
  dir: "up" | "down" | "flat";
  /** null when flat. */
  favorable: boolean | null;
  vs: Date | null;
  /** Full sentence for tooltips and screen readers. */
  description: string;
}

const MINUS = "−";

export function metricDelta(m: DeltaSource): MetricDelta | null {
  if (m.current === null || m.previous === null) return null;
  const diff = m.current - m.previous;
  const dir: MetricDelta["dir"] = Math.abs(diff) < 1e-9 ? "flat" : diff > 0 ? "up" : "down";
  const sign = dir === "up" ? "+" : dir === "down" ? MINUS : "±";
  let text: string;
  if (m.unit === "PERCENT") {
    const pts = Math.abs(diff);
    text = `${sign}${pts < 10 ? pts.toFixed(1).replace(/\.0$/, "") : Math.round(pts)} pts`;
  } else if (m.change !== null) {
    const pct = Math.abs(m.change * 100);
    text = `${sign}${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
  } else {
    text = `${sign}${formatMetricValue(Math.abs(diff), m.unit)}`;
  }
  if (dir === "flat") text = "No change";
  const favorable = dir === "flat" ? null : (dir === "up") === (m.direction === "HIGHER_IS_BETTER");
  const vs = m.series.length >= 2 ? m.series[m.series.length - 2].date : null;
  const vsText = vs ? ` vs ${formatDay(vs, true)}` : "";
  const description =
    dir === "flat"
      ? `No change${vsText}`
      : `${dir === "up" ? "Up" : "Down"} ${text.slice(1)}${vsText} (${formatMetricValue(m.previous, m.unit)} → ${formatMetricValue(m.current, m.unit)}) — ${favorable ? "favorable" : "unfavorable"}, ${m.direction === "HIGHER_IS_BETTER" ? "higher is better" : "lower is better"}`;
  return { text, dir, favorable, vs, description };
}

type TargetSource = {
  current: number | null;
  target: number | null;
  targetDate: Date | null;
  targetProgress: number | null;
  unit: MetricUnit;
  direction: MetricDirection;
};

export interface TargetInfo {
  /** "Target $6M by Dec 31" */
  label: string;
  /** Right-aligned status text: "79%", "Target met", "Within target", "$50K over". */
  status: string;
  /** 0–100 or null when no meter makes sense. */
  progress: number | null;
  met: boolean;
  description: string;
}

export function targetInfo(m: TargetSource, today: Date): TargetInfo | null {
  if (m.target === null) return null;
  const lower = m.direction === "LOWER_IS_BETTER";
  const byDate = m.targetDate ? ` by ${formatDay(m.targetDate, m.targetDate.getUTCFullYear() !== today.getUTCFullYear())}` : "";
  const label = `Target ${lower ? "≤ " : ""}${formatMetricValue(m.target, m.unit)}${byDate}`;
  if (m.current === null) return { label, status: "No data", progress: null, met: false, description: `${label}. No value recorded yet.` };
  const gap = m.target - m.current;
  if (lower) {
    const met = m.current <= m.target;
    const status = met ? "Within target" : `${formatMetricValue(-gap, m.unit)} over`;
    const days = m.targetDate ? daysBetween(today, m.targetDate) : null;
    return {
      label,
      status,
      progress: m.targetProgress,
      met,
      description: `${label}. Currently ${formatMetricValue(m.current, m.unit)} — ${met ? "within target" : `${formatMetricValue(-gap, m.unit)} above target`}${days !== null && days >= 0 ? `, ${days} days left` : ""}.`,
    };
  }
  const met = m.current >= m.target;
  const status = met ? "Target met" : m.targetProgress !== null ? `${m.targetProgress}%` : `${formatMetricValue(gap, m.unit)} to go`;
  const days = m.targetDate ? daysBetween(today, m.targetDate) : null;
  return {
    label,
    status,
    progress: m.targetProgress,
    met,
    description: `${label}. Currently ${formatMetricValue(m.current, m.unit)}${met ? " — target met" : ` — ${formatMetricValue(gap, m.unit)} to go`}${days !== null && days >= 0 && !met ? `, ${days} days left` : ""}.`,
  };
}

/** "today", "yesterday", "5d ago", or a date for older values. */
export function updatedLabel(day: Date, today: Date): string {
  const d = daysBetween(day, today);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 60) return `${d}d ago`;
  return formatDay(day, true);
}
