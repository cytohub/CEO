"use client";

import { Download, Loader2, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { SimpleSelect } from "@/components/common/fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/server/actions/result";

export interface AuditFilterValues {
  action?: string;
  actor?: string;
  outcome?: string;
  from?: string;
  to?: string;
}

const OUTCOMES = [
  { value: "SUCCESS", label: "Success" },
  { value: "DENIED", label: "Denied" },
  { value: "FAILURE", label: "Failure" },
];

type Exporter = (filters: Record<string, string | undefined>) => Promise<ActionResult<{ csv: string; filename: string; rows: number; truncated: boolean }>>;

/** One filter row above the log. Filters live in the URL so a view can be shared and paginated. */
export function AuditFilters({ initial, actions, exporter }: { initial: AuditFilterValues; actions: { action: string; count: number }[]; exporter: Exporter }) {
  const router = useRouter();
  const pathname = usePathname();
  const [f, setF] = useState<AuditFilterValues>(initial);
  const [navigating, startNav] = useTransition();
  const [exporting, startExport] = useTransition();
  const active = Object.values(initial).filter(Boolean).length;

  function apply(next: AuditFilterValues) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) sp.set(k, v);
    startNav(() => router.push(sp.size ? `${pathname}?${sp}` : pathname));
  }

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        apply(f);
      }}
      aria-label="Filter the audit log"
    >
      <div className="grid w-full gap-1 sm:w-48">
        <span id="audit-action-label" className="text-2xs font-medium text-muted-foreground">
          Action
        </span>
        <SimpleSelect
          size="sm"
          ariaLabel="Action"
          value={f.action ?? null}
          allowNone
          noneLabel="All actions"
          placeholder="All actions"
          onChange={(v) => setF((s) => ({ ...s, action: v ?? undefined }))}
          options={actions.map((a) => ({ value: a.action, label: `${a.action} (${a.count})` }))}
        />
      </div>
      <div className="grid w-full gap-1 sm:w-48">
        <label htmlFor="audit-actor" className="text-2xs font-medium text-muted-foreground">
          Actor
        </label>
        <Input id="audit-actor" value={f.actor ?? ""} onChange={(e) => setF((s) => ({ ...s, actor: e.target.value || undefined }))} placeholder="Email contains…" className="h-7 text-[15px]" maxLength={200} />
      </div>
      <div className="grid w-[calc(50%-4px)] gap-1 sm:w-36">
        <span className="text-2xs font-medium text-muted-foreground">Outcome</span>
        <SimpleSelect size="sm" ariaLabel="Outcome" value={f.outcome ?? null} allowNone noneLabel="Any outcome" placeholder="Any outcome" onChange={(v) => setF((s) => ({ ...s, outcome: v ?? undefined }))} options={OUTCOMES} />
      </div>
      <div className="grid w-[calc(50%-4px)] gap-1 sm:w-36">
        <label htmlFor="audit-from" className="text-2xs font-medium text-muted-foreground">
          From
        </label>
        <Input id="audit-from" type="date" value={f.from ?? ""} max={f.to} onChange={(e) => setF((s) => ({ ...s, from: e.target.value || undefined }))} className="h-7 text-[15px]" />
      </div>
      <div className="grid w-[calc(50%-4px)] gap-1 sm:w-36">
        <label htmlFor="audit-to" className="text-2xs font-medium text-muted-foreground">
          To
        </label>
        <Input id="audit-to" type="date" value={f.to ?? ""} min={f.from} onChange={(e) => setF((s) => ({ ...s, to: e.target.value || undefined }))} className="h-7 text-[15px]" />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button type="submit" size="sm" disabled={navigating}>
          {navigating && <Loader2 className="animate-spin" aria-hidden />}
          Apply
        </Button>
        {active > 0 && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setF({});
              apply({});
            }}
          >
            <X aria-hidden /> Clear {active}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={exporting}
          onClick={() =>
            startExport(async () => {
              const res = await exporter({ ...initial });
              if (!res.ok) {
                toast.error(res.error);
                return;
              }
              const url = URL.createObjectURL(new Blob([res.data.csv], { type: "text/csv;charset=utf-8" }));
              const a = document.createElement("a");
              a.href = url;
              a.download = res.data.filename;
              document.body.appendChild(a);
              a.click();
              a.remove();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
              toast.success(res.message ?? "Exported");
            })
          }
        >
          {exporting ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
          Export CSV
        </Button>
      </div>
    </form>
  );
}
