import type { MetricUnit } from "@/generated/prisma/enums";

const compactCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
const fullCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const compactNumber = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const plainNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

export function formatCurrency(value: number | null | undefined, compact = true): string {
  if (value == null || Number.isNaN(value)) return "—";
  return compact && Math.abs(value) >= 10_000 ? compactCurrency.format(value) : fullCurrency.format(value);
}

export function formatNumber(value: number | null | undefined, compact = false): string {
  if (value == null || Number.isNaN(value)) return "—";
  return compact && Math.abs(value) >= 10_000 ? compactNumber.format(value) : plainNumber.format(value);
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
