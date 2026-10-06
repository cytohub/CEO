import type { MetricUnit } from "@/generated/prisma/enums";

const fullCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const plainNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

// Intl compact notation differs between Node and browser ICU builds ("$6M" vs
// "$6.0M"), which breaks hydration — so compact values are formatted by hand.
const COMPACT_STEPS = [
  [1e12, "T"],
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "K"],
] as const;

function compactDigits(abs: number): string {
  for (const [n, suffix] of COMPACT_STEPS) {
    if (abs >= n) {
      const v = abs / n;
      return `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10}${suffix}`;
    }
  }
  return plainNumber.format(abs);
}

export function formatCurrency(value: number | null | undefined, compact = true): string {
  if (value == null || Number.isNaN(value)) return "—";
  return compact && Math.abs(value) >= 10_000 ? `${value < 0 ? "-" : ""}$${compactDigits(Math.abs(value))}` : fullCurrency.format(value);
}

export function formatNumber(value: number | null | undefined, compact = false): string {
  if (value == null || Number.isNaN(value)) return "—";
  return compact && Math.abs(value) >= 10_000 ? `${value < 0 ? "-" : ""}${compactDigits(Math.abs(value))}` : plainNumber.format(value);
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

/** 90 → "1h 30m", 45 → "45m", 120 → "2h". */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes == null) return "—";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function formatMetric(value: number | null | undefined, unit: MetricUnit): string {
  if (value == null || Number.isNaN(value)) return "—";
  switch (unit) {
    case "CURRENCY":
      return formatCurrency(value);
    case "PERCENT":
      return formatPercent(value, value < 10 ? 1 : 0);
    case "MONTHS":
      return `${plainNumber.format(value)} mo`;
    case "DAYS":
      return `${plainNumber.format(value)}d`;
    case "COUNT":
      return formatNumber(value, true);
    case "NUMBER":
      // Small ratios (e.g. AUC 0.88) need two decimals to compare against targets.
      return Math.abs(value) < 10 ? value.toLocaleString("en-US", { maximumFractionDigits: 2 }) : formatNumber(value, true);
    default:
      return formatNumber(value, true);
  }
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
