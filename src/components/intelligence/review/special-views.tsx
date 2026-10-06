"use client";

import { ArrowRight, ArrowUpRight, Check, FileText, Lock } from "lucide-react";
import Link from "next/link";
import { useUI } from "@/components/shell/ui-context";
import { cn } from "@/lib/utils";
import type { DerivedRecord } from "@/server/queries/provenance";
import type { ReviewEntry } from "@/server/queries/review";
import { displayValue, fieldChangeLabel, fieldChangeSpec, getIn } from "../model";

/** Link to a record: opens the global sheet for tasks/meetings/milestones, navigates otherwise. */
export function RecordLink({ record, className }: { record: DerivedRecord; className?: string }) {
  const { openEntity } = useUI();
  const cls = cn("inline-flex max-w-full items-center gap-1 text-[13px] text-foreground hover:underline", className);
  if (record.sheet)
    return (
      <button type="button" onClick={() => openEntity(record.sheet!, record.id)} className={cls}>
        <span className="truncate">{record.title}</span>
        <ArrowUpRight className="size-3 shrink-0 text-ink-3" aria-hidden />
      </button>
    );
  if (!record.href) return <span className={cls}>{record.title}</span>;
  return (
    <Link href={record.href} className={cls}>
      <span className="truncate">{record.title}</span>
      <ArrowUpRight className="size-3 shrink-0 text-ink-3" aria-hidden />
    </Link>
  );
}

/** Side-by-side compare of two possibly-duplicate records, with a choice of which to keep. */
export function MergeCompare({ merge, keepId, onKeep, disabled }: { merge: NonNullable<ReviewEntry["merge"]>; keepId: string | null; onKeep: (id: string) => void; disabled?: boolean }) {
  const sides = [merge.keep, merge.other];
  if (!merge.keep || !merge.other) {
    return <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">One of these records no longer exists — ignore this suggestion.</p>;
  }
  return (
    <div>
      <div role="radiogroup" aria-label="Record to keep" className="grid gap-2 sm:grid-cols-2">
        {sides.map((s, i) => {
          if (!s) return null;
          const selected = keepId === s.id;
          return (
            <div
              key={s.id}
              role="radio"
              aria-checked={selected}
              aria-disabled={disabled || undefined}
              tabIndex={selected || (!keepId && i === 0) ? 0 : -1}
              onClick={() => !disabled && onKeep(s.id)}
              onKeyDown={(e) => {
                if (disabled) return;
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  onKeep(s.id);
                }
                if (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const other = sides[i === 0 ? 1 : 0]!;
                  onKeep(other.id);
                  (e.currentTarget.parentElement?.children[i === 0 ? 1 : 0] as HTMLElement | undefined)?.focus();
                }
              }}
              className={cn(
                "cursor-pointer rounded-lg border p-3 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                selected ? "border-brand bg-brand-soft/50" : "border-border hover:bg-muted/40",
              )}
            >
              <div className="flex items-start gap-2">
                <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border", selected ? "border-brand bg-brand text-white" : "border-input")} aria-hidden>
                  {selected && <Check className="size-2.5" strokeWidth={3} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-semibold">{s.label}</span>
                    <Link href={s.href} onClick={(e) => e.stopPropagation()} className="shrink-0 text-ink-3 hover:text-foreground" aria-label={`Open ${s.label}`}>
                      <ArrowUpRight className="size-3" />
                    </Link>
                  </div>
                  <div className="text-2xs text-muted-foreground">{selected ? "Keep this record" : "Merge into the other"}</div>
                </div>
              </div>
              <dl className="mt-2.5 space-y-1 text-xs">
                {s.fields.map((f) => {
                  const otherVal = sides[i === 0 ? 1 : 0]?.fields.find((x) => x.label === f.label)?.value;
                  const differs = otherVal !== undefined && otherVal !== f.value;
                  return (
                    <div key={f.label} className="grid grid-cols-[72px_1fr] gap-2">
                      <dt className="text-muted-foreground">{f.label}</dt>
                      <dd className={cn("min-w-0 truncate", differs ? "font-medium text-foreground" : "text-ink-2")} title={f.value}>
                        {f.value}
                      </dd>
                    </div>
                  );
                })}
              </dl>
              <ul className="mt-2.5 flex flex-wrap gap-1">
                {s.counts.map((c) => (
                  <li key={c.label[1]} className={cn("rounded px-1.5 py-0.5 text-2xs tabular", c.value ? "bg-muted text-ink-2" : "bg-muted/50 text-muted-foreground")}>
                    {c.value} {c.value === 1 ? c.label[0] : c.label[1]}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      {(merge.reason || merge.score != null) && (
        <p className="mt-2 text-2xs text-muted-foreground">
          {merge.reason}
          {merge.score != null && ` · similarity ${Math.round(merge.score * 100)}%`}
        </p>
      )}
    </div>
  );
}

/** "Due date: Oct 9 → Oct 8" on the target record. */
export function FieldChangeView({ item, draftTo, names }: { item: ReviewEntry; draftTo?: unknown; names: Record<string, string> }) {
  const p = item.proposal;
  const spec = fieldChangeSpec(p.targetType, p.field);
  const fmt = (v: unknown, label: unknown) => {
    if (typeof label === "string" && label) return label;
    if (spec.type === "person" && typeof v === "string") return names[v] ?? v;
    return displayValue({ type: spec.type, value: v, spec });
  };
  const to = draftTo !== undefined ? draftTo : p.to;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>{typeof p.targetType === "string" ? p.targetType.charAt(0) + p.targetType.slice(1).toLowerCase().replace("_", " ") : "Record"}</span>
        {item.target ? <RecordLink record={item.target} /> : <span className="text-[13px] text-foreground">{typeof p.targetLabel === "string" ? p.targetLabel : "Unknown record"}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-2/50 px-3 py-2">
        <span className="text-2xs font-medium text-muted-foreground">{fieldChangeLabel(p.field)}</span>
        <span className="text-[13px] text-muted-foreground line-through decoration-ink-3/60">{fmt(p.from, p.fromLabel)}</span>
        <ArrowRight className="size-3.5 text-ink-3" aria-label="changes to" />
        <span className="text-[13px] font-semibold text-foreground">{fmt(to, draftTo !== undefined ? null : p.toLabel)}</span>
      </div>
      {typeof getIn(p, ["changeKind"]) === "string" && <p className="text-2xs text-muted-foreground">Detected: {String(p.changeKind).replace(/_/g, " ")}</p>}
    </div>
  );
}

/** Significant changes between document versions. */
export function DocumentChangeView({ item }: { item: ReviewEntry }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <FileText className="size-3.5 text-ink-3" aria-hidden />
        {item.document ? (
          <Link href={`/documents/${item.document.id}`} className="inline-flex items-center gap-1 text-[13px] hover:underline">
            {item.document.title} <span className="text-2xs text-muted-foreground">v{item.document.currentVersion}</span>
            <ArrowUpRight className="size-3 text-ink-3" aria-hidden />
          </Link>
        ) : item.documentHidden ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Lock className="size-3" aria-hidden /> Document hidden by your access level
          </span>
        ) : (
          <span className="text-[13px]">{typeof item.proposal.title === "string" ? item.proposal.title : "Document"}</span>
        )}
      </div>
      {item.changes.length === 0 ? (
        <p className="text-xs text-muted-foreground">No itemized changes.</p>
      ) : (
        <ul className="divide-y divide-hairline rounded-md border border-border">
          {item.changes.map((c, i) => (
            <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-[13px]">
              <span className="min-w-0 flex-1 text-ink-2">{c.label}</span>
              <span className="text-muted-foreground line-through decoration-ink-3/60">{c.from ?? "—"}</span>
              <ArrowRight className="size-3.5 text-ink-3" aria-label="changed to" />
              <span className="font-semibold">{c.to ?? "—"}</span>
              {c.significance && <span className="rounded bg-serious-soft px-1.5 text-2xs font-medium text-serious-ink">{c.significance.toLowerCase()}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
