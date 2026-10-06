"use client";

import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/common/status";
import { useAction } from "@/components/common/use-action";
import type { FocusArea } from "@/generated/prisma/enums";
import { FOCUS_AREAS } from "@/lib/domain";
import { formatMinutes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { saveAttentionTargets } from "@/server/actions/settings";
import type { AttentionTargetRow } from "@/server/queries/settings";
import { SectionFooter } from "./section";

type Draft = { focusArea: FocusArea; pct: string; rationale: string };

const toDraft = (rows: AttentionTargetRow[]): Draft[] => rows.map((r) => ({ focusArea: r.focusArea, pct: String(r.recommendedPct), rationale: r.rationale }));

export function AttentionTargetsForm({ rows, windowDays, totalMinutes, strategicPct }: { rows: AttentionTargetRow[]; windowDays: number; totalMinutes: number; strategicPct: number }) {
  const [draft, setDraft] = useState<Draft[]>(() => toDraft(rows));
  const { pending, run } = useAction();

  const parsed = draft.map((d) => {
    const n = Number(d.pct);
    return Number.isFinite(n) && d.pct.trim() !== "" ? n : NaN;
  });
  const invalid = parsed.some((n) => Number.isNaN(n) || n < 0 || n > 100);
  const total = Math.round(parsed.reduce((s, n) => s + (Number.isNaN(n) ? 0 : n), 0) * 10) / 10;
  const balanced = Math.abs(total - 100) <= 0.5;
  const dirty = draft.some((d, i) => Number(d.pct) !== rows[i].recommendedPct || d.rationale !== rows[i].rationale);
  const actualBy = useMemo(() => new Map(rows.map((r) => [r.focusArea, r])), [rows]);
  const scaleMax = Math.max(10, ...rows.map((r) => r.actualPct), ...parsed.filter((n) => !Number.isNaN(n))) * 1.08;
  const strategicTarget = Math.round(draft.reduce((s, d, i) => s + (FOCUS_AREAS[d.focusArea].strategic && !Number.isNaN(parsed[i]) ? parsed[i] : 0), 0));

  const update = (i: number, patch: Partial<Draft>) => setDraft((all) => all.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  return (
    <form
      className="panel @container"
      onSubmit={(e) => {
        e.preventDefault();
        if (!balanced || invalid) return;
        run(() => saveAttentionTargets(draft.map((d, i) => ({ focusArea: d.focusArea, recommendedPct: parsed[i], rationale: d.rationale.trim() || null }))));
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b border-hairline px-4 py-2 text-2xs text-muted-foreground">
        <span>
          Actual = share of tracked time, last {windowDays} days ({formatMinutes(totalMinutes)} · {strategicPct}% strategic). Target {strategicTarget}% strategic.
        </span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-3 rounded-sm bg-brand" aria-hidden /> Actual
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-0.5 bg-foreground" aria-hidden /> Target
          </span>
        </span>
      </div>
      <div className="hidden grid-cols-[minmax(150px,200px)_92px_minmax(140px,220px)_minmax(0,1fr)] gap-3 border-b border-hairline px-4 py-1.5 text-2xs font-medium text-muted-foreground @3xl:grid">
        <span>Focus area</span>
        <span>Target</span>
        <span>Actual vs target</span>
        <span>Rationale</span>
      </div>
      <ul className="divide-y divide-hairline">
        {draft.map((d, i) => {
          const meta = FOCUS_AREAS[d.focusArea];
          const Icon = meta.icon;
          const actual = actualBy.get(d.focusArea);
          const target = parsed[i];
          const bad = Number.isNaN(target) || target < 0 || target > 100;
          return (
            <li key={d.focusArea} className="grid grid-cols-[minmax(0,1fr)_92px] items-center gap-x-3 gap-y-1.5 px-4 py-2 @xl:grid-cols-[minmax(130px,180px)_92px_minmax(0,1fr)] @3xl:grid-cols-[minmax(150px,200px)_92px_minmax(140px,220px)_minmax(0,1fr)]">
              <div className="flex min-w-0 items-center gap-2">
                <Icon className="size-3.5 shrink-0 text-ink-3" aria-hidden />
                <label htmlFor={`target-${d.focusArea}`} className="truncate text-[13px] text-foreground">
                  {meta.label}
                </label>
                <span className="hidden shrink-0 text-2xs text-muted-foreground @4xl:inline">{meta.strategic ? "Strategic" : "Operational"}</span>
              </div>
              <div className="relative">
                <Input
                  id={`target-${d.focusArea}`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step={0.5}
                  value={d.pct}
                  onChange={(e) => update(i, { pct: e.target.value })}
                  aria-invalid={bad || undefined}
                  className="h-7 pr-6 text-right text-[13px] tabular md:text-[13px]"
                />
                <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-2xs text-muted-foreground" aria-hidden>
                  %
                </span>
              </div>
              <div
                className="col-span-2 flex items-center gap-2 @xl:col-span-1"
                title={`${meta.label}: actual ${actual?.actualPct.toFixed(1) ?? 0}% · target ${Number.isNaN(target) ? "—" : target}%`}
              >
                <div className="relative h-2 flex-1 rounded-full bg-track" aria-hidden>
                  <div className="absolute inset-y-0 left-0 rounded-full bg-brand" style={{ width: `${((actual?.actualPct ?? 0) / scaleMax) * 100}%` }} />
                  {!Number.isNaN(target) && <div className="absolute -top-0.5 -bottom-0.5 w-0.5 rounded-full bg-foreground" style={{ left: `calc(${(Math.min(target, scaleMax) / scaleMax) * 100}% - 1px)` }} />}
                </div>
                <span className="w-[66px] shrink-0 text-right text-2xs tabular">
                  <span className="font-semibold text-foreground">{(actual?.actualPct ?? 0).toFixed(0)}%</span>
                  <span className="text-muted-foreground"> actual</span>
                </span>
              </div>
              <Input
                value={d.rationale}
                onChange={(e) => update(i, { rationale: e.target.value })}
                placeholder="Why this share of your time"
                aria-label={`Rationale for ${meta.label}`}
                maxLength={300}
                className="col-span-2 h-7 text-xs @xl:col-span-3 @3xl:col-span-1 md:text-xs"
              />
            </li>
          );
        })}
      </ul>
      <SectionFooter
        hint={
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-foreground">
              Total <span className={cn("font-semibold tabular", !balanced && "text-serious-ink")}>{total}%</span>
            </span>
            {invalid ? (
              <StatusPill tone="critical" label="Each target must be 0–100%" />
            ) : balanced ? (
              <StatusPill tone="good" label="Adds up to 100%" />
            ) : (
              <StatusPill tone="warning" label={total < 100 ? `${Math.round((100 - total) * 10) / 10}% left to allocate` : `${Math.round((total - 100) * 10) / 10}% over`} />
            )}
          </span>
        }
      >
        {dirty && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(toDraft(rows))}>
            Discard
          </Button>
        )}
        <Button type="submit" size="sm" disabled={pending || !dirty || !balanced || invalid}>
          {pending && <Loader2 className="animate-spin" />}
          Save targets
        </Button>
      </SectionFooter>
    </form>
  );
}
