"use client";

import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import type { ScoreBreakdown } from "@/server/brain/scoring";

export function scoreTone(score: number) {
  return score >= 75 ? "text-critical-ink" : score >= 55 ? "text-serious-ink" : score >= 35 ? "text-foreground" : "text-muted-foreground";
}

/** CEO Priority Score with an explainable breakdown on hover. */
export function ScoreChip({ score, breakdown, className }: { score: number; breakdown?: ScoreBreakdown | null; className?: string }) {
  const chip = (
    <span
      className={cn(
        "inline-flex h-6 min-w-9 items-center justify-center rounded-md border border-border bg-surface px-1.5 font-mono text-xs font-semibold tabular",
        scoreTone(score),
        className,
      )}
      aria-label={`CEO Priority Score ${Math.round(score)} of 100`}
    >
      {Math.round(score)}
    </span>
  );
  if (!breakdown) return chip;
  return (
    <HoverCard openDelay={150} closeDelay={60}>
      <HoverCardTrigger asChild>
        <button type="button" className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {chip}
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-80 p-3">
        <ScoreBreakdownView breakdown={breakdown} />
      </HoverCardContent>
    </HoverCard>
  );
}

export function ScoreBreakdownView({ breakdown, className }: { breakdown: ScoreBreakdown; className?: string }) {
  const factors = [...breakdown.factors].sort((a, b) => b.points - a.points);
  const maxPoints = Math.max(...factors.map((f) => f.weight), 1);
  return (
    <div className={cn("text-xs", className)}>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="font-medium text-foreground">CEO Priority Score</span>
        <span className="font-mono text-sm font-semibold tabular">{Math.round(breakdown.score)}</span>
      </div>
      <ul className="space-y-1">
        {factors.map((f) => (
          <li key={f.key} className="grid grid-cols-[112px_1fr_34px] items-center gap-2">
            <span className={cn("truncate", f.value >= 3 ? "text-ink-2" : "text-muted-foreground")}>{f.label}</span>
            <span className="relative h-1.5 rounded-full bg-track" aria-hidden>
              <span className="absolute inset-y-0 left-0 rounded-full bg-brand/30" style={{ width: `${(f.weight / maxPoints) * 100}%` }} />
              <span className="absolute inset-y-0 left-0 rounded-full bg-brand" style={{ width: `${(f.points / maxPoints) * 100}%` }} />
            </span>
            <span className="text-right font-mono text-2xs text-muted-foreground tabular">{f.points.toFixed(1)}</span>
          </li>
        ))}
      </ul>
      {breakdown.modifiers.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-t border-border pt-2">
          {breakdown.modifiers.map((m) => (
            <li key={m.label} className="flex justify-between gap-2 text-2xs text-muted-foreground">
              <span className="truncate">{m.label}</span>
              <span className="font-mono tabular">{m.kind === "multiplier" ? `×${m.value.toFixed(2)}` : `+${m.value}`}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 flex gap-1.5 border-t border-border pt-2 text-2xs text-muted-foreground">
        <Info className="mt-px size-3 shrink-0" aria-hidden />
        Bars show each factor’s points against its weight. Weights are configurable in Settings.
      </p>
    </div>
  );
}
