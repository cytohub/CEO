"use client";

import { BarChart3, Table2 } from "lucide-react";
import { useState } from "react";
import { dayFromKey, formatDay, formatDayLong } from "@/lib/dates";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { niceAxis } from "./axis";

const PLOT_H = 140;

/**
 * Items processed per day — one series, so no legend (the title names it).
 * Thin columns (≤ 24 px, 4 px rounded data-end, square at the baseline) in the
 * brand blue, hairline solid gridlines, labelled ticks, a per-bar tooltip on
 * hover and keyboard focus, and a table view with the same numbers.
 */
export function ProcessedChart({ series }: { series: { day: string; count: number }[] }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(0, ...series.map((s) => s.count));
  const axis = niceAxis(max);
  const ticks = Array.from({ length: Math.floor(axis.max / axis.step) + 1 }, (_, i) => i * axis.step);
  const total = series.reduce((s, x) => s + x.count, 0);
  const peak = series.reduce((best, x, i) => (x.count > series[best].count ? i : best), 0);
  const last = series.length - 1;
  const label = (key: string, i: number) => {
    const d = dayFromKey(key);
    const prev = i > 0 ? dayFromKey(series[i - 1].day) : null;
    return i === 0 || (prev && prev.getUTCMonth() !== d.getUTCMonth()) ? formatDay(d) : String(d.getUTCDate());
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2 px-3.5 pt-2.5">
        <p className="text-2xs text-muted-foreground">
          <span className="font-medium text-foreground tabular">{formatNumber(total)}</span> items in {series.length} days · processed or skipped as noise, by day in your timezone
        </p>
        <div className="flex rounded-md border border-border p-0.5" role="group" aria-label="View">
          {(["chart", "table"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={cn("flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs font-medium", view === v ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {v === "chart" ? <BarChart3 className="size-3" aria-hidden /> : <Table2 className="size-3" aria-hidden />}
              {v === "chart" ? "Chart" : "Table"}
            </button>
          ))}
        </div>
      </div>

      {view === "chart" ? (
        <div className="px-3.5 pt-3 pb-3">
          <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
            {/* Y axis ticks */}
            <div className="relative w-7" style={{ height: PLOT_H }} aria-hidden>
              {ticks.map((t) => (
                <span key={t} className="absolute right-0 -translate-y-1/2 text-[12px] text-muted-foreground tabular" style={{ top: PLOT_H - (t / axis.max) * PLOT_H }}>
                  {formatNumber(t, true)}
                </span>
              ))}
            </div>
            <div className="relative" style={{ height: PLOT_H }} onPointerLeave={() => setActive(null)}>
              {ticks.map((t) => (
                <div key={t} aria-hidden className={cn("absolute inset-x-0 h-px", t === 0 ? "bg-border" : "bg-hairline")} style={{ top: PLOT_H - (t / axis.max) * PLOT_H }} />
              ))}
              <ul className="absolute inset-0 flex items-end gap-0.5" aria-label="Items processed per day">
                {series.map((s, i) => {
                  const h = axis.max ? (s.count / axis.max) * PLOT_H : 0;
                  const showLabel = (i === peak && s.count > 0) || (i === last && s.count > 0);
                  return (
                    <li key={s.day} className="relative flex h-full flex-1 justify-center">
                      <button
                        type="button"
                        className="group relative flex h-full w-full items-end justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`${formatDayLong(dayFromKey(s.day))}: ${formatNumber(s.count)} items`}
                        onPointerEnter={() => setActive(i)}
                        onFocus={() => setActive(i)}
                        onBlur={() => setActive(null)}
                      >
                        <span
                          aria-hidden
                          className={cn("block w-full max-w-6 rounded-t-[4px] bg-brand transition-[filter]", active === i && "brightness-110", s.count > 0 && "min-h-px")}
                          style={{ height: h }}
                        />
                        {showLabel && active !== i && (
                          <span aria-hidden className="pointer-events-none absolute text-[12px] font-medium text-ink-2 tabular" style={{ bottom: h + 3 }}>
                            {formatNumber(s.count)}
                          </span>
                        )}
                      </button>
                      {active === i && (
                        <div
                          role="tooltip"
                          className={cn(
                            "pointer-events-none absolute z-10 rounded-md border border-border bg-popover px-2 py-1 text-left whitespace-nowrap shadow-sm",
                            i < 3 ? "left-0" : i > series.length - 4 ? "right-0" : "left-1/2 -translate-x-1/2",
                          )}
                          style={{ bottom: Math.min(PLOT_H - 30, h + 6) }}
                        >
                          <div className="text-xs font-semibold text-foreground tabular">{formatNumber(s.count)} items</div>
                          <div className="text-[12px] text-muted-foreground">{formatDayLong(dayFromKey(s.day))}</div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
            {/* X axis labels */}
            <div aria-hidden />
            <div className="mt-1 flex gap-0.5" aria-hidden>
              {series.map((s, i) => (
                <span key={s.day} className={cn("flex-1 truncate text-center text-[12px] text-muted-foreground tabular", (last - i) % 2 === 1 && "max-sm:invisible")}>
                  {label(s.day, i)}
                </span>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="max-h-[220px] overflow-y-auto px-3.5 pt-2 pb-3 scrollbar-thin">
          <table className="w-full text-xs">
            <caption className="sr-only">Items processed per day</caption>
            <thead>
              <tr className="border-b border-hairline text-left text-2xs text-muted-foreground">
                <th scope="col" className="py-1 font-medium">Day</th>
                <th scope="col" className="py-1 text-right font-medium">Items</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {[...series].reverse().map((s) => (
                <tr key={s.day}>
                  <td className="py-1 text-ink-2">{formatDayLong(dayFromKey(s.day))}</td>
                  <td className="py-1 text-right tabular">{formatNumber(s.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
