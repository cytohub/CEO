"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/common/fields";
import { useLookups } from "@/components/shell/ui-context";
import type { FocusArea, TaskStatus } from "@/generated/prisma/enums";
import { FOCUS_AREA_ORDER, FOCUS_AREAS, PRIORITY, TASK_STATUS } from "@/lib/domain";
import type { HistoryFilters as Filters } from "@/server/queries/history";

export function HistoryFilters({ initial }: { initial: Filters }) {
  const router = useRouter();
  const pathname = usePathname();
  const { goals, milestones, pillars, people } = useLookups();
  const [f, setF] = useState<Filters>(initial);
  const set = <K extends keyof Filters>(k: K, v: Filters[K] | null) => setF((s) => ({ ...s, [k]: v ?? undefined }));

  function apply(e?: React.FormEvent) {
    e?.preventDefault();
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v && v !== "ANY" && !(k === "scope" && v === "mine")) params.set(k, String(v));
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <form onSubmit={apply} className="panel grid gap-2 p-2.5 sm:grid-cols-2 lg:grid-cols-6">
      <div className="relative sm:col-span-2">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input value={f.q ?? ""} onChange={(e) => set("q", e.target.value)} placeholder="Search titles, descriptions and notes…" className="h-8 pl-8" aria-label="Search history" />
      </div>
      <Input type="date" value={f.from ?? ""} onChange={(e) => set("from", e.target.value)} className="h-8" aria-label="From date" />
      <Input type="date" value={f.to ?? ""} onChange={(e) => set("to", e.target.value)} className="h-8" aria-label="To date" />
      <SimpleSelect size="sm" ariaLabel="Status" value={f.status === "ANY" ? null : (f.status ?? null)} onChange={(v) => set("status", (v as TaskStatus) ?? "ANY")} allowNone noneLabel="Any status" options={(Object.keys(TASK_STATUS) as TaskStatus[]).map((s) => ({ value: s, label: TASK_STATUS[s].label }))} />
      <SimpleSelect size="sm" ariaLabel="Priority" value={f.priority ?? null} onChange={(v) => set("priority", v as Filters["priority"])} allowNone noneLabel="Any priority" options={(["P0", "P1", "P2", "P3"] as const).map((p) => ({ value: p, label: `${p} · ${PRIORITY[p].label}` }))} />
      <SimpleSelect size="sm" ariaLabel="Goal" value={f.goal ?? null} onChange={(v) => set("goal", v)} allowNone noneLabel="Any goal" options={goals.map((g) => ({ value: g.id, label: g.title }))} />
      <SimpleSelect size="sm" ariaLabel="Project / milestone" value={f.milestone ?? null} onChange={(v) => set("milestone", v)} allowNone noneLabel="Any project" options={milestones.map((m) => ({ value: m.id, label: m.title }))} />
      <SimpleSelect size="sm" ariaLabel="Function" value={f.focus ?? null} onChange={(v) => set("focus", v as FocusArea)} allowNone noneLabel="Any function" options={FOCUS_AREA_ORDER.map((a) => ({ value: a, label: FOCUS_AREAS[a].label }))} />
      <SimpleSelect size="sm" ariaLabel="Strategic pillar" value={f.pillar ?? null} onChange={(v) => set("pillar", v)} allowNone noneLabel="Any pillar" options={pillars.map((p) => ({ value: p.id, label: p.name }))} />
      <SimpleSelect size="sm" ariaLabel="Person" value={f.person ?? null} onChange={(v) => set("person", v)} allowNone noneLabel="Any person" options={people.filter((p) => !p.isCeo).map((p) => ({ value: p.id, label: p.name }))} />
      <div className="flex items-center gap-2">
        <SimpleSelect size="sm" ariaLabel="Owner scope" value={f.scope ?? "mine"} onChange={(v) => set("scope", (v as "mine" | "everyone") ?? "mine")} options={[{ value: "mine", label: "My tasks" }, { value: "everyone", label: "Everyone" }]} />
        <Button type="submit" size="sm">
          Apply
        </Button>
      </div>
    </form>
  );
}
