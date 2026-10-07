"use client";

import { Loader2, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAction } from "@/components/common/use-action";
import { saveThresholds } from "@/server/actions/settings";
import type { BrainThresholds } from "@/server/settings";
import { SectionFooter } from "./section";

type Key = keyof BrainThresholds;

/** UI metadata; attentionTolerance is stored as a fraction but edited as a percent. */
const FIELDS: { key: Key; label: string; unit: string; min: number; max: number; step: number; explain: string; percent?: boolean }[] = [
  { key: "dealStaleDays", label: "Deal goes stale after", unit: "days", min: 1, max: 180, step: 1, explain: "An open pharma, investor or partnership deal with no activity for this long is flagged as slowing." },
  { key: "investorFollowUpDays", label: "Investor follow-up after", unit: "days", min: 1, max: 180, step: 1, explain: "Investors in an active raise you haven’t contacted for this long land in your Inbox." },
  { key: "delegationFollowUpDays", label: "Delegation check-in after", unit: "days", min: 1, max: 90, step: 1, explain: "Delegated work without an update for this long is marked “needs follow-up”." },
  { key: "milestoneDueSoonDays", label: "Milestone “due soon” window", unit: "days", min: 1, max: 120, step: 1, explain: "Milestones due within this window get extra scrutiny and lift the urgency of their tasks." },
  { key: "runwayAlertMonths", label: "Runway alert below", unit: "months", min: 1, max: 60, step: 0.5, explain: "The Brain raises a cash risk when runway drops under this many months." },
  { key: "attentionWindowDays", label: "Attention measurement window", unit: "days", min: 7, max: 90, step: 1, explain: "Trailing window used to measure where your time actually went." },
  { key: "attentionTolerance", label: "Attention gap tolerance", unit: "%", min: 5, max: 100, step: 1, percent: true, explain: "How far actual time may drift from a target (relative) before it is flagged as over- or under-invested." },
];

function toDraft(t: BrainThresholds): Record<Key, string> {
  return Object.fromEntries(FIELDS.map((f) => [f.key, String(f.percent ? Math.round(t[f.key] * 100) : t[f.key])])) as Record<Key, string>;
}

export function ThresholdsForm({ thresholds, defaults }: { thresholds: BrainThresholds; defaults: BrainThresholds }) {
  const [draft, setDraft] = useState<Record<Key, string>>(() => toDraft(thresholds));
  const { pending, run } = useAction();
  const saved = toDraft(thresholds);
  const defaultDraft = toDraft(defaults);

  const errors = Object.fromEntries(
    FIELDS.map((f) => {
      const n = Number(draft[f.key]);
      const bad = draft[f.key].trim() === "" || !Number.isFinite(n) || n < f.min || n > f.max || (f.step === 1 && !Number.isInteger(n));
      return [f.key, bad ? `${f.min}–${f.max}${f.step === 1 ? ", whole numbers" : ""}` : null];
    }),
  ) as Record<Key, string | null>;
  const invalid = Object.values(errors).some(Boolean);
  const dirty = FIELDS.some((f) => Number(draft[f.key]) !== Number(saved[f.key]));
  const isDefault = FIELDS.every((f) => Number(draft[f.key]) === Number(defaultDraft[f.key]));

  return (
    <form
      className="panel @container"
      onSubmit={(e) => {
        e.preventDefault();
        if (invalid) return;
        const values = Object.fromEntries(FIELDS.map((f) => [f.key, f.percent ? Number(draft[f.key]) / 100 : Number(draft[f.key])])) as unknown as BrainThresholds;
        run(() => saveThresholds(values));
      }}
    >
      <ul className="grid divide-y divide-hairline @3xl:grid-cols-2 @3xl:divide-y-0">
        {FIELDS.map((f, i) => (
          <li key={f.key} className={`flex items-start gap-4 px-4 py-3 ${i >= 2 ? "@3xl:border-t @3xl:border-hairline" : ""} ${i % 2 === 1 ? "@3xl:border-l @3xl:border-hairline" : ""}`}>
            <div className="min-w-0 flex-1">
              <label htmlFor={`threshold-${f.key}`} className="text-[14px] font-medium text-foreground">
                {f.label}
              </label>
              <p id={`threshold-${f.key}-hint`} className="mt-0.5 text-2xs text-muted-foreground">
                {f.explain}
                <span className="text-ink-3"> Default {defaultDraft[f.key]}{f.unit === "%" ? "%" : ` ${f.unit}`}.</span>
              </p>
              {errors[f.key] && <p className="mt-1 text-2xs text-critical-ink">Enter {errors[f.key]}</p>}
            </div>
            <div className="relative w-[112px] shrink-0">
              <Input
                id={`threshold-${f.key}`}
                type="number"
                inputMode="decimal"
                min={f.min}
                max={f.max}
                step={f.step}
                value={draft[f.key]}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                aria-describedby={`threshold-${f.key}-hint`}
                aria-invalid={Boolean(errors[f.key]) || undefined}
                className="h-7 pr-14 text-right text-[14px] tabular md:text-[14px]"
              />
              <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-2xs text-muted-foreground" aria-hidden>
                {f.unit}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <SectionFooter hint="Thresholds apply on the next Brain refresh. Changing the attention window also changes what Today and Performance report.">
        <Button type="button" variant="ghost" size="sm" disabled={isDefault} onClick={() => setDraft(defaultDraft)}>
          <RotateCcw /> Defaults
        </Button>
        {dirty && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(saved)}>
            Discard
          </Button>
        )}
        <Button type="submit" size="sm" disabled={pending || !dirty || invalid}>
          {pending && <Loader2 className="animate-spin" />}
          Save thresholds
        </Button>
      </SectionFooter>
    </form>
  );
}
