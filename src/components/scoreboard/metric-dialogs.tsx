"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, GoalSelect } from "@/components/common/fields";
import { useAction } from "@/components/common/use-action";
import { dayKey, formatDay } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { recordMetricValue, updateMetricTarget } from "@/server/actions/metrics";
import type { ScoreboardMetric } from "@/server/queries/scoreboard";
import { returnFocus } from "./focus";
import { displayName, formatMetricValue, parseMetricInput, UNIT_HINT } from "./metric-format";

function ValuePreview({ raw, value, unit }: { raw: string; value: number | null; unit: ScoreboardMetric["unit"] }) {
  if (!raw.trim()) return null;
  return (
    <span className={cn("text-2xs tabular", value === null ? "text-critical-ink" : "text-muted-foreground")} aria-live="polite">
      {value === null ? "Not a number" : `= ${formatMetricValue(value, unit)}`}
    </span>
  );
}

export function RecordValueDialog({
  metric,
  today,
  open,
  onOpenChange,
  returnFocusTo,
}: {
  metric: ScoreboardMetric;
  today: Date;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusTo?: React.RefObject<HTMLElement | null>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md" onCloseAutoFocus={returnFocus(returnFocusTo)}>
        {open && <RecordValueForm metric={metric} today={today} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function RecordValueForm({ metric, today, onDone }: { metric: ScoreboardMetric; today: Date; onDone: () => void }) {
  const { pending, run } = useAction();
  const todayKey = dayKey(today);
  const [date, setDate] = useState(todayKey);
  const [raw, setRaw] = useState("");
  const [note, setNote] = useState("");
  const value = parseMetricInput(raw);
  const existing = metric.series.find((p) => dayKey(p.date) === date);
  const recent = [...metric.series].reverse().slice(0, 5);
  const name = displayName(metric.name);
  const future = date > todayKey;

  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (value === null || !date || future) return;
        const res = await run(() => recordMetricValue(metric.id, { recordedAt: date, value, note: note.trim() || null }));
        if (res.ok) onDone();
      }}
    >
      <DialogHeader>
        <DialogTitle>Record value · {name}</DialogTitle>
        <DialogDescription>
          {metric.source.kind === "manual"
            ? "One value per day. Recording on a day that already has a value replaces it."
            : `${metric.source.detail} A value you record here is marked as a manual entry.`}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-3 sm:grid-cols-[150px_1fr]">
        <Field label="Date" htmlFor="metric-date" className="content-start">
          <Input id="metric-date" type="date" value={date} max={todayKey} onChange={(e) => setDate(e.target.value)} required aria-invalid={future || undefined} />
        </Field>
        <Field label="Value" htmlFor="metric-value" hint={UNIT_HINT[metric.unit]} className="content-start">
          <div className="flex items-center gap-2">
            <Input
              id="metric-value"
              autoFocus
              inputMode="decimal"
              autoComplete="off"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder={metric.current !== null ? String(metric.current) : "0"}
              aria-invalid={(raw.trim() !== "" && value === null) || undefined}
              aria-describedby="metric-value-preview"
              required
            />
            <span id="metric-value-preview" className="w-20 shrink-0">
              <ValuePreview raw={raw} value={value} unit={metric.unit} />
            </span>
          </div>
        </Field>
      </div>
      {future && <p className="-mt-2 text-2xs text-critical-ink">Values can only be recorded for today or earlier.</p>}
      {existing && !future && (
        <p className="-mt-2 text-2xs text-warning-ink">
          Replaces {formatMetricValue(existing.value, metric.unit)} already recorded for {formatDay(existing.date, true)}.
        </p>
      )}

      <Field label="Note (optional)" htmlFor="metric-note">
        <Textarea id="metric-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Source, context or why it moved" />
      </Field>

      {recent.length > 0 && (
        <div className="rounded-lg border border-border">
          <div className="border-b border-hairline px-3 py-1.5 text-2xs font-medium text-muted-foreground">Recent values</div>
          <table className="w-full text-xs">
            <caption className="sr-only">Recent values for {name}</caption>
            <thead className="sr-only">
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {recent.map((p) => (
                <tr key={p.date.toISOString()}>
                  <td className="px-3 py-1 text-muted-foreground tabular">{formatDay(p.date, true)}</td>
                  <td className="px-3 py-1 text-right font-medium tabular">{formatMetricValue(p.value, metric.unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || value === null || future || !date}>
          {pending && <Loader2 className="animate-spin" />}
          {existing ? "Replace value" : "Record value"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function EditTargetDialog({
  metric,
  open,
  onOpenChange,
  returnFocusTo,
}: {
  metric: ScoreboardMetric;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusTo?: React.RefObject<HTMLElement | null>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onCloseAutoFocus={returnFocus(returnFocusTo)}>{open && <EditTargetForm metric={metric} onDone={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function EditTargetForm({ metric, onDone }: { metric: ScoreboardMetric; onDone: () => void }) {
  const { pending, run } = useAction();
  const [raw, setRaw] = useState(metric.target !== null ? String(metric.target) : "");
  const [date, setDate] = useState(metric.targetDate ? dayKey(metric.targetDate) : "");
  const [goalId, setGoalId] = useState<string | null>(metric.goalId);
  const value = parseMetricInput(raw);
  const name = displayName(metric.name);
  const lower = metric.direction === "LOWER_IS_BETTER";

  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (value === null) return;
        const res = await run(() => updateMetricTarget(metric.id, { target: value, targetDate: date || null, goalId }));
        if (res.ok) onDone();
      }}
    >
      <DialogHeader>
        <DialogTitle>Edit target · {name}</DialogTitle>
        <DialogDescription>
          {metric.derived
            ? "This metric's value is computed from live data; only its target is set here."
            : lower
              ? "Lower is better for this metric — the target is a ceiling."
              : "The progress meter on the scoreboard measures the current value against this target."}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-[1fr_150px]">
        <Field label={lower ? "Target (at most)" : "Target"} htmlFor="target-value" hint={UNIT_HINT[metric.unit]} className="content-start">
          <div className="flex items-center gap-2">
            <Input
              id="target-value"
              autoFocus
              inputMode="decimal"
              autoComplete="off"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              aria-invalid={(raw.trim() !== "" && value === null) || undefined}
              required
            />
            <span className="w-20 shrink-0">
              <ValuePreview raw={raw} value={value} unit={metric.unit} />
            </span>
          </div>
        </Field>
        <Field label="By (optional)" htmlFor="target-date" className="content-start">
          <Input id="target-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <Field label="Measures goal (optional)" htmlFor="target-goal" hint="The goal's progress then follows this metric toward its target, updated from live data.">
        <GoalSelect id="target-goal" value={goalId} onChange={setGoalId} />
      </Field>
      {metric.current !== null && (
        <p className="text-2xs text-muted-foreground">
          Current value: <span className="font-medium text-foreground tabular">{formatMetricValue(metric.current, metric.unit)}</span>
        </p>
      )}
      <DialogFooter className="sm:justify-between">
        {metric.target !== null ? (
          <Button
            type="button"
            variant="ghost"
            className="text-muted-foreground"
            disabled={pending}
            onClick={async () => {
              const res = await run(() => updateMetricTarget(metric.id, { target: null, targetDate: null }));
              if (res.ok) onDone();
            }}
          >
            Clear target
          </Button>
        ) : (
          <span />
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending || value === null}>
            {pending && <Loader2 className="animate-spin" />}
            Save target
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
