"use client";

import { Loader2, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAction } from "@/components/common/use-action";
import { cn } from "@/lib/utils";
import { DEFAULT_WEIGHTS, FACTOR_KEYS, FACTOR_META, normalizeWeights, type FactorKey, type PriorityWeights } from "@/server/brain/scoring";
import { savePriorityWeights } from "@/server/actions/settings";
import { SectionFooter } from "./section";

const SLIDER_MAX = 30;

/** Stored weights are normalized to 100; scale them into the slider range without changing shares. */
function toSliderValues(w: PriorityWeights): PriorityWeights {
  const max = Math.max(...FACTOR_KEYS.map((k) => w[k]));
  const scale = max > SLIDER_MAX ? SLIDER_MAX / max : 1;
  return Object.fromEntries(FACTOR_KEYS.map((k) => [k, Math.round(w[k] * scale * 10) / 10])) as PriorityWeights;
}

export function PriorityWeightsForm({ weights, openTaskCount }: { weights: PriorityWeights; openTaskCount: number }) {
  const initial = useMemo(() => toSliderValues(weights), [weights]);
  const [draft, setDraft] = useState<PriorityWeights>(initial);
  const { pending, run } = useAction();

  const total = FACTOR_KEYS.reduce((s, k) => s + draft[k], 0);
  const shares = total > 0 ? normalizeWeights(draft) : null;
  const storedShares = normalizeWeights(weights);
  const dirty = shares ? FACTOR_KEYS.some((k) => Math.abs(shares[k] - storedShares[k]) >= 0.05) : true;
  const isDefault = FACTOR_KEYS.every((k) => Math.abs((shares?.[k] ?? 0) - DEFAULT_WEIGHTS[k]) < 0.05);
  const maxShare = shares ? Math.max(...FACTOR_KEYS.map((k) => shares[k])) : 1;

  const set = (k: FactorKey, v: number) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <form
      className="panel @container"
      onSubmit={(e) => {
        e.preventDefault();
        if (!shares) return;
        run(() => savePriorityWeights(draft));
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-hairline px-4 py-2 text-2xs text-muted-foreground">
        <span>
          Score = Σ weight × factor ÷ 5 (0–100), then modifiers for manual priority, goal health, delegability and repeated postponement.
        </span>
        <span>Weights are relative — shares always sum to 100%.</span>
      </div>
      <div className="hidden grid-cols-[minmax(0,1fr)_minmax(140px,240px)_40px_112px] items-center gap-4 border-b border-hairline px-4 py-1.5 text-2xs font-medium text-muted-foreground @2xl:grid">
        <span>Factor</span>
        <span>Weight (0–{SLIDER_MAX})</span>
        <span className="text-right">Raw</span>
        <span className="text-right">Share of score</span>
      </div>
      <ul className="divide-y divide-hairline">
        {FACTOR_KEYS.map((k) => {
          const meta = FACTOR_META[k];
          const share = shares?.[k] ?? 0;
          const delta = share - storedShares[k];
          return (
            <li key={k} className="grid grid-cols-[minmax(0,1fr)_40px_112px] items-center gap-x-4 gap-y-2 px-4 py-2.5 @2xl:grid-cols-[minmax(0,1fr)_minmax(140px,240px)_40px_112px]">
              <div className="col-span-3 min-w-0 @2xl:col-span-1">
                <div className="flex items-center gap-2">
                  <span id={`weight-${k}-label`} className="text-[14px] font-medium text-foreground">
                    {meta.label}
                  </span>
                  {meta.derived && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span tabIndex={0} className="rounded bg-brain-soft px-1.5 text-2xs font-medium text-brain outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          Derived
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>Computed by CytoHub Brain from dates and dependencies — not rated per task.</TooltipContent>
                    </Tooltip>
                  )}
                </div>
                <p className="text-2xs text-muted-foreground">{meta.description}</p>
              </div>
              <Slider
                value={[draft[k]]}
                min={0}
                max={SLIDER_MAX}
                step={1}
                onValueChange={([v]) => set(k, v)}
                aria-labelledby={`weight-${k}-label`}
                className="py-1.5"
              />
              <span className="text-right font-mono text-xs text-ink-2 tabular">{Math.round(draft[k] * 10) / 10}</span>
              <span className="flex items-center justify-end gap-2" title={`${meta.label}: ${share.toFixed(1)}% of the score`}>
                <span className="relative hidden h-1.5 w-10 rounded-full bg-track @md:block" aria-hidden>
                  <span className="absolute inset-y-0 left-0 rounded-full bg-brand" style={{ width: `${(share / maxShare) * 100}%` }} />
                </span>
                <span className="w-12 text-right text-xs font-semibold text-foreground tabular">{share.toFixed(1)}%</span>
              </span>
              {Math.abs(delta) >= 0.05 && (
                <span className={cn("col-span-3 -mt-1 text-right text-2xs tabular @2xl:col-span-4", delta > 0 ? "text-good-ink" : "text-serious-ink")}>
                  {delta > 0 ? "+" : "−"}
                  {Math.abs(delta).toFixed(1)} pts vs saved
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <SectionFooter
        hint={
          <>
            Saving rescores {openTaskCount} open tasks immediately. Today’s Top 5 is re-ranked on the next Brain refresh, or via <span className="font-medium text-ink-2">Re-rank</span> on Today.
          </>
        }
      >
        <Button type="button" variant="ghost" size="sm" disabled={isDefault} onClick={() => setDraft({ ...DEFAULT_WEIGHTS })}>
          <RotateCcw /> Reset to defaults
        </Button>
        {dirty && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(initial)}>
            Discard
          </Button>
        )}
        <Button type="submit" size="sm" disabled={pending || !dirty || !shares}>
          {pending && <Loader2 className="animate-spin" />}
          {pending ? "Rescoring…" : "Save & rescore"}
        </Button>
      </SectionFooter>
    </form>
  );
}
