"use client";

import { useRef, useState } from "react";
import type { MetricUnit } from "@/generated/prisma/enums";
import { formatDay } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { formatMetricValue } from "./metric-format";

/**
 * Responsive sparkline with a hover read-out. Same visual grammar as the
 * shared <Sparkline>: de-emphasis stroke, accent dot on the latest point.
 * The plot stretches to its container; dots are HTML so they never distort.
 */
export function TrendSparkline({
  points,
  unit,
  label,
  height = 32,
  className,
  endLabel,
}: {
  points: { date: Date; value: number }[];
  unit: MetricUnit;
  label: string;
  height?: number;
  className?: string;
  /** Replaces the default last-date label on the right of the axis (e.g. freshness). */
  endLabel?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const n = points.length;

  if (n < 2) {
    return (
      <div className={cn("flex items-center text-2xs text-muted-foreground", className)} style={{ height: height + 18 }}>
        {n === 1 ? `One value so far (${formatDay(points[0].date, true)}) — trend appears after the next.` : "No history yet."}
      </div>
    );
  }

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const pad = 4;
  const xs = points.map((_, i) => (i / (n - 1)) * 100);
  const ys = values.map((v) => (span === 0 ? height / 2 : pad + (1 - (v - min) / span) * (height - pad * 2)));
  const d = xs.map((x, i) => `${i ? "L" : "M"}${x.toFixed(2)},${ys[i].toFixed(2)}`).join(" ");

  const first = points[0];
  const last = points[n - 1];
  const active = hover === null ? null : points[hover];

  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHover(Math.round(ratio * (n - 1)));
  }

  return (
    <div className={cn("min-w-0", className)}>
      <div ref={ref} className="relative touch-pan-y" style={{ height }} onPointerMove={onMove} onPointerLeave={() => setHover(null)} aria-hidden>
        <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
          {hover !== null && <line x1={xs[hover]} x2={xs[hover]} y1={0} y2={height} className="stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
          <path d={d} fill="none" className="stroke-ink-3" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span
          className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand ring-[1.5px] ring-surface"
          style={{ left: `${xs[n - 1]}%`, top: ys[n - 1] }}
        />
        {hover !== null && hover !== n - 1 && (
          <span
            className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-[1.5px] ring-surface"
            style={{ left: `${xs[hover]}%`, top: ys[hover] }}
          />
        )}
      </div>
      <div className="mt-1 flex h-4 items-center justify-between gap-2 text-2xs text-muted-foreground tabular">
        {active ? (
          <span className="truncate text-foreground" aria-hidden>
            {formatDay(active.date, true)} · <span className="font-medium">{formatMetricValue(active.value, unit)}</span>
          </span>
        ) : (
          <>
            <span aria-hidden className="min-w-0 truncate">
              {formatDay(first.date)}
              {first.date.getUTCFullYear() !== last.date.getUTCFullYear() && ` ’${String(first.date.getUTCFullYear()).slice(2)}`}
            </span>
            <span className="shrink-0 whitespace-nowrap">{endLabel ?? formatDay(last.date)}</span>
          </>
        )}
      </div>
      <span className="sr-only">
        {label} trend: {formatMetricValue(first.value, unit)} on {formatDay(first.date, true)} to {formatMetricValue(last.value, unit)} on {formatDay(last.date, true)}, low{" "}
        {formatMetricValue(min, unit)}, high {formatMetricValue(max, unit)}.
      </span>
    </div>
  );
}
