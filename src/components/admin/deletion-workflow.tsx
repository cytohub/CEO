"use client";

import { Eraser, Loader2, Lock, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { StatusPill } from "@/components/common/status";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { EntityType } from "@/generated/prisma/enums";
import { formatDateTime } from "@/lib/dates";
import { SENSITIVITY, SOURCE_ITEM_KINDS, SOURCE_PROVIDERS } from "@/lib/intelligence";
import { cn } from "@/lib/utils";
import { deleteSourceItem, previewSourceItemDeletion, searchSourceItemsForDeletion, type DeletionCandidate, type MaskedDeletionPlan } from "@/server/actions/retention";

const TYPE_LABEL: Partial<Record<EntityType, string>> = {
  TASK: "Task",
  COMMITMENT: "Commitment",
  RISK: "Risk",
  OPPORTUNITY: "Opportunity",
  DECISION: "Decision",
  INSIGHT: "Insight",
  INBOX_ITEM: "Inbox item",
  MEETING: "Meeting",
  PERSON: "Person",
  COMPANY: "Company",
  PROJECT: "Project",
  DOCUMENT: "Document",
  DEAL: "Deal",
  GOAL: "Goal",
  MILESTONE: "Milestone",
};

const MODES = [
  {
    value: "REDACT_CONTENT",
    icon: Eraser,
    label: "Redact content",
    description: "Purge the text, raw copy, files and AI extraction, and clear quoted excerpts. Metadata, derived intelligence and provenance stay.",
  },
  {
    value: "DELETE_DERIVED",
    icon: Trash2,
    label: "Delete derived data",
    description: "Redact, then delete unconfirmed records created only from this item and its pending review items. Records a person confirmed or edited are kept.",
  },
] as const;

type Mode = (typeof MODES)[number]["value"];

export function DeletionWorkflow({ timezone }: { timezone: string }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<DeletionCandidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<DeletionCandidate | null>(null);
  const [plan, setPlan] = useState<MaskedDeletionPlan | null>(null);
  const [mode, setMode] = useState<Mode>("REDACT_CONTENT");
  const [confirm, setConfirm] = useState("");
  const [reload, setReload] = useState(0);
  const load = useAction();
  const apply = useAction();

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      setSearching(true);
      const res = await searchSourceItemsForDeletion(q);
      if (!cancelled) {
        setResults(res.ok ? res.data : []);
        setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, reload]);

  function choose(item: DeletionCandidate) {
    setSelected(item);
    setPlan(null);
    setConfirm("");
    load.run(() => previewSourceItemDeletion(item.id), { success: false, onSuccess: setPlan });
  }

  const doomed = plan?.records.filter((r) => r.action === "delete") ?? [];
  const kept = plan?.records.filter((r) => r.action === "keep") ?? [];

  return (
    <div className="panel grid @container lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
      <div className="min-w-0 border-b border-hairline lg:border-r lg:border-b-0">
        <div className="p-3">
          <label htmlFor="deletion-search" className="text-2xs font-medium text-muted-foreground">
            Find a source item
          </label>
          <div className="relative mt-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
            <Input id="deletion-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title or exact item id" className="h-8 pl-8 text-[13px]" autoComplete="off" />
            {searching && <Loader2 className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 animate-spin text-ink-3" aria-hidden />}
          </div>
          <p className="mt-1 text-2xs text-muted-foreground">Titles you can’t read are hidden; find those by exact id.</p>
        </div>
        <ul className="max-h-[420px] overflow-y-auto border-t border-hairline scrollbar-thin" aria-label="Source items">
          {results === null ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">Loading…</li>
          ) : results.length === 0 ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">No matching items.</li>
          ) : (
            results.map((r) => (
              <li key={r.id} className="border-b border-hairline last:border-0">
                <button
                  type="button"
                  aria-pressed={selected?.id === r.id}
                  onClick={() => choose(r)}
                  className={cn("block w-full px-3 py-2 text-left hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none", selected?.id === r.id && "bg-brand-soft")}
                >
                  <span className={cn("flex items-center gap-1 truncate text-[13px]", r.restricted ? "text-muted-foreground italic" : "text-foreground")}>
                    {r.restricted && <Lock className="size-3 shrink-0" aria-hidden />}
                    <span className="truncate">{r.title}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-2xs text-muted-foreground">
                    {SOURCE_ITEM_KINDS[r.kind].label} · {r.providerLabel} · {formatDateTime(r.occurredAt, timezone)}
                    {r.contentPurgedAt ? " · content purged" : ""}
                    {r.deletedAtSource ? " · deleted at source" : ""}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>

      <div className="min-w-0 p-4" aria-live="polite">
        {!selected ? (
          <p className="text-xs text-muted-foreground">Choose an item to see everything derived from it before redacting or deleting.</p>
        ) : load.pending || !plan ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden /> Tracing derived data…
          </p>
        ) : (
          <div className="space-y-4">
            <div>
              <h3 className={cn("text-[13px] font-semibold", plan.restricted ? "text-muted-foreground italic" : "text-foreground")}>{plan.item.title}</h3>
              <p className="mt-0.5 text-2xs text-muted-foreground">
                {SOURCE_ITEM_KINDS[plan.item.kind].label} from {SOURCE_PROVIDERS[plan.item.provider].label} ({plan.item.connectionLabel}) · {formatDateTime(plan.item.occurredAt, timezone)} ·{" "}
                {SENSITIVITY[selected.sensitivity].label} · <span className="font-mono">{plan.item.id}</span>
              </p>
              {plan.restricted && <p className="mt-1 text-2xs text-muted-foreground">You can’t read this item: derived record titles are hidden; types and counts are shown.</p>}
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs @lg:grid-cols-4">
              <div>
                <dt className="text-2xs text-muted-foreground">Content</dt>
                <dd className="text-foreground">
                  {plan.item.contentPurgedAt ? "Purged" : [plan.content.text && "text", plan.content.raw && "raw copy", plan.content.extraction && "extraction"].filter(Boolean).join(", ") || "none stored"}
                </dd>
              </div>
              <div>
                <dt className="text-2xs text-muted-foreground">Files</dt>
                <dd className="text-foreground tabular">{plan.content.attachments + plan.content.versions}</dd>
              </div>
              <div>
                <dt className="text-2xs text-muted-foreground">Provenance links</dt>
                <dd className="text-foreground tabular">{plan.references}</dd>
              </div>
              <div>
                <dt className="text-2xs text-muted-foreground">Mentions · graph edges</dt>
                <dd className="text-foreground tabular">
                  {plan.mentions} · {plan.relationships.total}
                </dd>
              </div>
            </dl>

            <div>
              <h4 className="text-2xs font-medium text-muted-foreground">Derived records ({plan.records.length})</h4>
              {plan.records.length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">Nothing in the Brain was derived from this item.</p>
              ) : (
                <ul className="mt-1 divide-y divide-hairline rounded-lg border border-border" data-testid="derived-records">
                  {plan.records.map((r) => (
                    <li key={`${r.type}:${r.id}`} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-1.5 text-xs">
                      <span className="w-24 shrink-0 text-ink-2">{TYPE_LABEL[r.type] ?? r.type}</span>
                      <span className={cn("min-w-0 flex-1 truncate", r.label ? "text-foreground" : "text-muted-foreground italic")} title={r.label ?? undefined}>
                        {r.label ?? "Restricted item"}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <StatusPill tone={r.action === "delete" ? "critical" : "neutral"} label={r.action === "delete" ? "Deleted with “Delete derived”" : "Kept"} />
                      </span>
                      <span className="basis-full pl-[108px] text-2xs text-muted-foreground max-sm:pl-0">{r.reason}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1.5 text-2xs text-muted-foreground">
                Pending review items: {plan.reviewItems.pending.length} (deleted with “Delete derived”) · resolved: {plan.reviewItems.resolved} (kept) · graph edges only this item supports:{" "}
                {plan.relationships.deletable}
              </p>
            </div>

            <fieldset className="grid gap-2 @lg:grid-cols-2">
              <legend className="mb-1.5 text-2xs font-medium text-muted-foreground">Action</legend>
              {MODES.map((m) => (
                <label
                  key={m.value}
                  className={cn(
                    "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                    mode === m.value ? "border-destructive/50 bg-critical-soft" : "border-border hover:bg-muted/50",
                  )}
                >
                  <input type="radio" name="deletion-mode" value={m.value} checked={mode === m.value} onChange={() => setMode(m.value)} className="mt-0.5 accent-[var(--destructive)]" />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                      <m.icon className="size-3.5 text-ink-3" aria-hidden /> {m.label}
                    </span>
                    <span className="mt-0.5 block text-2xs text-muted-foreground">
                      {m.description}
                      {m.value === "DELETE_DERIVED" && ` Here: ${doomed.length} record${doomed.length === 1 ? "" : "s"} deleted, ${kept.length} kept.`}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>

            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (confirm !== "DELETE" || !selected) return;
                const res = await apply.run(() => deleteSourceItem(selected.id, { mode, confirmation: "DELETE" }));
                if (res.ok) {
                  setConfirm("");
                  setReload((n) => n + 1);
                  load.run(() => previewSourceItemDeletion(selected.id), { success: false, onSuccess: setPlan });
                }
              }}
            >
              <div className="grid gap-1">
                <label htmlFor="deletion-confirm" className="text-2xs font-medium text-muted-foreground">
                  Type <span className="font-mono font-semibold text-foreground">DELETE</span> to confirm
                </label>
                <Input id="deletion-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" spellCheck={false} className="h-8 w-40 font-mono text-[13px]" />
              </div>
              <Button type="submit" variant="destructive" size="sm" className="h-8" disabled={confirm !== "DELETE" || apply.pending}>
                {apply.pending && <Loader2 className="animate-spin" aria-hidden />}
                {mode === "REDACT_CONTENT" ? "Redact content" : "Delete derived data"}
              </Button>
              <span className="text-2xs text-muted-foreground">Audited as source.delete. This can’t be undone.</span>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
