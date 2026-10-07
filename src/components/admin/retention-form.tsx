"use client";

import { Eye, Loader2, Play, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useAction } from "@/components/common/use-action";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { previewRetentionPolicy, runRetentionSweepNow, saveRetentionPolicy } from "@/server/actions/retention";
import { DELETED_SOURCE_BEHAVIOR, type DeletedSourceBehavior, type RetentionPolicy } from "@/server/ingestion/retention-policy";
import type { RetentionPreviewRow } from "@/server/ingestion/retention";

type DayKey = "rawEmailDays" | "attachmentDays" | "rawDocumentDays" | "documentTextDays" | "extractionOutputDays";

const DAY_FIELDS: { key: DayKey; label: string; explain: string }[] = [
  {
    key: "rawEmailDays",
    label: "Raw email bodies",
    explain: "Message text, snippet and the encrypted original. Subjects, participants, dates, thread summaries and derived intelligence are kept.",
  },
  {
    key: "attachmentDays",
    label: "Email attachments",
    explain: "Encrypted attachment files. File names and sizes stay listed; a file shared by several messages is purged when the newest one ages out.",
  },
  { key: "rawDocumentDays", label: "Raw document copies", explain: "Encrypted original files of document versions. The extracted text of the current version is kept." },
  {
    key: "documentTextDays",
    label: "Superseded document text",
    explain: "Extracted text of older versions, counted from when a newer version replaced them. Change summaries and key facts stay.",
  },
  { key: "extractionOutputDays", label: "AI extraction outputs", explain: "The validated extraction JSON stored per source item. Records written to the Brain and their provenance stay." },
];

const MIN_AUDIT = 90;
const BEHAVIORS = Object.keys(DELETED_SOURCE_BEHAVIOR) as DeletedSourceBehavior[];

interface Draft {
  days: Record<DayKey, { value: string; forever: boolean }>;
  storeAttachments: boolean;
  onSourceDeleted: DeletedSourceBehavior;
  auditLogDays: string;
}

function toDraft(p: RetentionPolicy): Draft {
  const days = Object.fromEntries(DAY_FIELDS.map((f) => [f.key, { value: p[f.key] == null ? "365" : String(p[f.key]), forever: p[f.key] == null }])) as Draft["days"];
  return { days, storeAttachments: p.storeAttachments, onSourceDeleted: p.onSourceDeleted, auditLogDays: String(p.auditLogDays) };
}

function fromDraft(d: Draft): RetentionPolicy {
  const n = (k: DayKey) => (d.days[k].forever ? null : Number(d.days[k].value));
  return {
    rawEmailDays: n("rawEmailDays"),
    storeAttachments: d.storeAttachments,
    attachmentDays: n("attachmentDays"),
    rawDocumentDays: n("rawDocumentDays"),
    documentTextDays: n("documentTextDays"),
    extractionOutputDays: n("extractionOutputDays"),
    onSourceDeleted: d.onSourceDeleted,
    auditLogDays: Number(d.auditLogDays),
  };
}

const badDays = (v: string, min = 1) => {
  const n = Number(v);
  return v.trim() === "" || !Number.isInteger(n) || n < min || n > 3650;
};

function describeDays(days: number | null) {
  if (days == null) return "indefinitely";
  if (days % 365 === 0) return `${days / 365} year${days === 365 ? "" : "s"}`;
  return `${days} days`;
}

export function RetentionForm({ policy: initial, defaults }: { policy: RetentionPolicy; defaults: RetentionPolicy }) {
  // The last saved policy: updated on a successful save, before the page's refreshed props arrive.
  const [policy, setPolicy] = useState(initial);
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial));
  const [preview, setPreview] = useState<{ rows: RetentionPreviewRow[]; forDraft: string } | null>(null);
  const [lastSweep, setLastSweep] = useState<Record<string, number> | null>(null);
  const [confirmSweep, setConfirmSweep] = useState(false);
  const save = useAction();
  const previewAction = useAction();
  const sweep = useAction();

  const errors = {
    ...Object.fromEntries(DAY_FIELDS.map((f) => [f.key, !draft.days[f.key].forever && badDays(draft.days[f.key].value) ? "Enter 1–3650 whole days" : null])),
    auditLogDays: badDays(draft.auditLogDays, MIN_AUDIT) ? `Enter ${MIN_AUDIT}–3650 whole days` : null,
  } as Record<DayKey | "auditLogDays", string | null>;
  const invalid = Object.values(errors).some(Boolean);
  const current = invalid ? null : fromDraft(draft);
  const savedJson = JSON.stringify(policy);
  const draftJson = current ? JSON.stringify(current) : "";
  const dirty = !current || draftJson !== savedJson;
  const isDefault = draftJson === JSON.stringify(defaults);
  const previewStale = preview && preview.forDraft !== draftJson;

  const setDay = (k: DayKey, patch: Partial<{ value: string; forever: boolean }>) => setDraft((d) => ({ ...d, days: { ...d.days, [k]: { ...d.days[k], ...patch } } }));

  return (
    <form
      className="panel @container"
      onSubmit={(e) => {
        e.preventDefault();
        if (current) save.run(() => saveRetentionPolicy(current), { onSuccess: () => setPolicy(current) });
      }}
    >
      <ul className="divide-y divide-hairline">
        {DAY_FIELDS.map((f) => {
          const field = draft.days[f.key];
          const disabled = f.key === "attachmentDays" && !draft.storeAttachments;
          const id = `retention-${f.key}`;
          return (
            <li key={f.key} className="grid gap-3 px-4 py-3 @2xl:grid-cols-[minmax(0,1fr)_auto]">
              <div className="min-w-0">
                <label htmlFor={id} className="text-[14px] font-medium text-foreground">
                  {f.label}
                </label>
                <p id={`${id}-hint`} className="mt-0.5 text-2xs text-muted-foreground">
                  {f.explain}
                  <span className="text-ink-3"> Default {describeDays(defaults[f.key])}.</span>
                </p>
                {errors[f.key] && !disabled && <p className="mt-1 text-2xs text-critical-ink">{errors[f.key]}</p>}
                {f.key === "attachmentDays" && (
                  <div className="mt-2 flex items-center gap-2">
                    <Switch
                      id="retention-storeAttachments"
                      size="sm"
                      checked={draft.storeAttachments}
                      onCheckedChange={(v) => setDraft((d) => ({ ...d, storeAttachments: v }))}
                      aria-describedby="retention-storeAttachments-hint"
                    />
                    <label htmlFor="retention-storeAttachments" className="text-xs text-foreground">
                      Store email attachments
                    </label>
                    <span id="retention-storeAttachments-hint" className="text-2xs text-muted-foreground">
                      {draft.storeAttachments ? "" : "Off — new attachments aren’t stored and existing copies are purged at the next sweep."}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3 @2xl:justify-end">
                <div className="relative w-[112px] shrink-0">
                  <Input
                    id={id}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={3650}
                    step={1}
                    disabled={field.forever || disabled}
                    value={field.forever ? "" : field.value}
                    placeholder={field.forever ? "∞" : undefined}
                    onChange={(e) => setDay(f.key, { value: e.target.value })}
                    aria-describedby={`${id}-hint`}
                    aria-invalid={Boolean(errors[f.key] && !disabled) || undefined}
                    className="h-7 pr-11 text-right text-[14px] tabular md:text-[14px]"
                  />
                  <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-2xs text-muted-foreground" aria-hidden>
                    days
                  </span>
                </div>
                <label className={cn("flex items-center gap-1.5 text-xs whitespace-nowrap text-ink-2", disabled && "opacity-50")}>
                  <Checkbox checked={field.forever} disabled={disabled} onCheckedChange={(v) => setDay(f.key, { forever: v === true })} />
                  Keep indefinitely
                </label>
              </div>
            </li>
          );
        })}

        <li className="px-4 py-3">
          <fieldset>
            <legend className="text-[14px] font-medium text-foreground">When an item is deleted at its source</legend>
            <p className="mt-0.5 text-2xs text-muted-foreground">Applies when a synced message, event or file disappears upstream. Records you confirmed or edited are always kept.</p>
            <div className="mt-2 grid gap-2 @3xl:grid-cols-3">
              {BEHAVIORS.map((b) => (
                <label
                  key={b}
                  className={cn(
                    "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                    draft.onSourceDeleted === b ? "border-ring/50 bg-brand-soft" : "border-border hover:bg-muted/50",
                  )}
                >
                  <input
                    type="radio"
                    name="onSourceDeleted"
                    value={b}
                    checked={draft.onSourceDeleted === b}
                    onChange={() => setDraft((d) => ({ ...d, onSourceDeleted: b }))}
                    className="mt-0.5 accent-[var(--brand)]"
                  />
                  <span className="min-w-0">
                    <span className="block text-[14px] font-medium text-foreground">
                      {DELETED_SOURCE_BEHAVIOR[b].label}
                      {defaults.onSourceDeleted === b && <span className="ml-1.5 text-2xs font-normal text-muted-foreground">Default</span>}
                    </span>
                    <span className="mt-0.5 block text-2xs text-muted-foreground">{DELETED_SOURCE_BEHAVIOR[b].description}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </li>

        <li className="grid gap-3 px-4 py-3 @2xl:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <label htmlFor="retention-auditLogDays" className="text-[14px] font-medium text-foreground">
              Audit log
            </label>
            <p id="retention-auditLogDays-hint" className="mt-0.5 text-2xs text-muted-foreground">
              Sign-ins, permission changes, source views and purges. At least {MIN_AUDIT} days so a policy change can’t erase recent evidence.
              <span className="text-ink-3"> Default {describeDays(defaults.auditLogDays)}.</span>
            </p>
            {errors.auditLogDays && <p className="mt-1 text-2xs text-critical-ink">{errors.auditLogDays}</p>}
          </div>
          <div className="relative h-7 w-[112px] shrink-0 self-start @2xl:justify-self-end">
            <Input
              id="retention-auditLogDays"
              type="number"
              inputMode="numeric"
              min={MIN_AUDIT}
              max={3650}
              step={1}
              value={draft.auditLogDays}
              onChange={(e) => setDraft((d) => ({ ...d, auditLogDays: e.target.value }))}
              aria-describedby="retention-auditLogDays-hint"
              aria-invalid={Boolean(errors.auditLogDays) || undefined}
              className="h-7 pr-11 text-right text-[14px] tabular md:text-[14px]"
            />
            <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-2xs text-muted-foreground" aria-hidden>
              days
            </span>
          </div>
        </li>
      </ul>

      {preview && (
        <div className={cn("border-t border-hairline", previewStale && "opacity-60")} aria-live="polite">
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-3 pb-1">
            <h3 className="text-xs font-semibold text-foreground">Would be purged now</h3>
            <span className="text-2xs text-muted-foreground">{previewStale ? "Policy changed since this preview — run it again." : dirty ? "Preview of your unsaved changes." : "Preview of the saved policy."}</span>
          </div>
          <div className="relative overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[520px] text-xs">
              <caption className="sr-only">Records each retention rule would purge now</caption>
              <thead>
                <tr className="border-b border-hairline text-left text-2xs font-medium text-muted-foreground">
                  <th scope="col" className="px-4 py-1.5 font-medium">Rule</th>
                  <th scope="col" className="px-4 py-1.5 text-right font-medium">Records</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {preview.rows.map((r) => (
                  <tr key={r.key} data-rule={r.key}>
                    <td className="px-4 py-1.5">
                      <div className="text-foreground">{r.label}</div>
                      <div className="text-2xs text-muted-foreground">{r.description}</div>
                    </td>
                    <td className={cn("px-4 py-1.5 text-right tabular", r.count ? "font-semibold text-foreground" : "text-muted-foreground")}>{r.count == null ? "Off" : formatNumber(r.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {lastSweep && (
        <p className="border-t border-hairline px-4 py-2 text-2xs text-muted-foreground" aria-live="polite">
          Last sweep:{" "}
          {Object.entries(lastSweep)
            .filter(([, v]) => v > 0)
            .map(([k, v]) => `${formatNumber(v)} ${k.replace(/([A-Z])/g, " $1").toLowerCase()}`)
            .join(" · ") || "nothing to purge"}
          .
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-hairline px-4 py-2.5">
        <div className="min-w-0 text-2xs text-muted-foreground">
          {dirty ? "Unsaved changes. The nightly sweep uses the saved policy." : "A sweep runs nightly; provenance snapshots and metadata are always kept."}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={isDefault} onClick={() => setDraft(toDraft(defaults))}>
            <RotateCcw aria-hidden /> Defaults
          </Button>
          {dirty && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(toDraft(policy))}>
              Discard
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!current || previewAction.pending}
            onClick={() => current && previewAction.run(() => previewRetentionPolicy(current), { success: false, onSuccess: (rows) => setPreview({ rows, forDraft: draftJson }) })}
          >
            {previewAction.pending ? <Loader2 className="animate-spin" aria-hidden /> : <Eye aria-hidden />}
            Preview
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={dirty || sweep.pending} onClick={() => setConfirmSweep(true)} title={dirty ? "Save the policy first" : undefined}>
            {sweep.pending ? <Loader2 className="animate-spin" aria-hidden /> : <Play aria-hidden />}
            Run retention sweep now
          </Button>
          <Button type="submit" size="sm" disabled={save.pending || !dirty || invalid}>
            {save.pending && <Loader2 className="animate-spin" aria-hidden />}
            Save policy
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmSweep} onOpenChange={setConfirmSweep}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run the retention sweep now?</AlertDialogTitle>
            <AlertDialogDescription>Purged content can’t be recovered. Metadata and provenance snapshots stay. Use Preview to see the counts first.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                sweep.run(() => runRetentionSweepNow(), {
                  onSuccess: (counts) => {
                    setLastSweep(counts);
                    setPreview(null);
                  },
                });
              }}
            >
              Run sweep
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
