"use client";

import { Loader2, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Field, SimpleSelect } from "@/components/common/fields";
import { useAction } from "@/components/common/use-action";
import { useLookups } from "@/components/shell/ui-context";
import type { ResourceType } from "@/generated/prisma/enums";
import { COMPANY_TYPES, DECISION_STATUS, GOAL_TYPES, MILESTONE_STATUS, PERSON_TYPES, RESOURCE_TYPES } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { updateResource } from "@/server/actions/resources";
import type { ResourceRow } from "@/server/queries/resources";
import { returnFocus } from "@/components/scoreboard/focus";
import { CHIP_META, type ChipKind } from "./chips";

type LinkKind = Exclude<ChipKind, "task">;
const LINK_KINDS: LinkKind[] = ["goal", "milestone", "decision", "company", "person"];

type Option = { id: string; label: string; hint?: string };

export type EditTab = "links" | "details";

export function ResourceEditDialog({
  resource,
  tab,
  onOpenChange,
  returnFocusTo,
}: {
  resource: ResourceRow | null;
  tab: EditTab;
  onOpenChange: (open: boolean) => void;
  returnFocusTo?: React.RefObject<HTMLElement | null>;
}) {
  return (
    <Dialog open={resource !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl" onCloseAutoFocus={returnFocus(returnFocusTo)}>
        {resource && <EditForm key={resource.id} resource={resource} initialTab={tab} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function useLinkOptions(resource: ResourceRow): Record<LinkKind, Option[]> {
  const lookups = useLookups();
  return useMemo(() => {
    const goalTitle = new Map(lookups.goals.map((g) => [g.id, g.title]));
    // Lookups only carry active records; keep anything already linked so saving never drops it.
    const withLinked = (opts: Option[], linked: { id: string; label: string }[], hint: string) => {
      const ids = new Set(opts.map((o) => o.id));
      return [...opts, ...linked.filter((l) => !ids.has(l.id)).map((l) => ({ id: l.id, label: l.label, hint }))];
    };
    return {
      goal: withLinked(
        lookups.goals.map((g) => ({ id: g.id, label: g.title, hint: GOAL_TYPES[g.type as keyof typeof GOAL_TYPES]?.label ?? g.type })),
        resource.goals.map((g) => ({ id: g.id, label: g.title })),
        "Completed",
      ),
      milestone: withLinked(
        lookups.milestones.map((m) => ({
          id: m.id,
          label: m.title,
          hint: [MILESTONE_STATUS[m.status as keyof typeof MILESTONE_STATUS]?.label, m.goalId ? goalTitle.get(m.goalId) : null].filter(Boolean).join(" · "),
        })),
        resource.milestones.map((m) => ({ id: m.id, label: m.title })),
        "Closed",
      ),
      decision: withLinked(
        lookups.decisions.map((d) => ({ id: d.id, label: d.title, hint: DECISION_STATUS[d.status as keyof typeof DECISION_STATUS]?.label })),
        resource.decisions.map((d) => ({ id: d.id, label: d.title })),
        "Decided",
      ),
      company: withLinked(
        lookups.companies.map((c) => ({ id: c.id, label: c.name, hint: COMPANY_TYPES[c.type as keyof typeof COMPANY_TYPES]?.label })),
        resource.companies.map((c) => ({ id: c.id, label: c.name })),
        "",
      ),
      person: withLinked(
        lookups.people.map((p) => {
          const company = p.companyId ? lookups.companies.find((c) => c.id === p.companyId)?.name : null;
          return {
            id: p.id,
            label: p.isCeo ? "You" : p.name,
            hint: [p.title, company ?? PERSON_TYPES[p.type as keyof typeof PERSON_TYPES]?.label].filter(Boolean).join(" · "),
          };
        }),
        resource.people.map((p) => ({ id: p.id, label: p.isCeo ? "You" : p.name })),
        "",
      ),
    };
  }, [lookups, resource]);
}

function EditForm({ resource, initialTab, onDone }: { resource: ResourceRow; initialTab: EditTab; onDone: () => void }) {
  const { pending, run } = useAction();
  const options = useLinkOptions(resource);
  const [tab, setTab] = useState<EditTab>(initialTab);
  const [kind, setKind] = useState<LinkKind>("goal");
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Record<LinkKind, Set<string>>>(() => ({
    goal: new Set(resource.goals.map((x) => x.id)),
    milestone: new Set(resource.milestones.map((x) => x.id)),
    decision: new Set(resource.decisions.map((x) => x.id)),
    company: new Set(resource.companies.map((x) => x.id)),
    person: new Set(resource.people.map((x) => x.id)),
  }));
  const [title, setTitle] = useState(resource.title);
  const [type, setType] = useState<ResourceType>(resource.type);
  const [url, setUrl] = useState(resource.url ?? "");
  const [summary, setSummary] = useState(resource.summary ?? "");
  const [tags, setTags] = useState(resource.tags.join(", "));

  const toggle = (k: LinkKind, id: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s[k]);
      if (on) next.add(id);
      else next.delete(id);
      return { ...s, [k]: next };
    });

  const q = filter.trim().toLowerCase();
  const visible = options[kind].filter((o) => !q || o.label.toLowerCase().includes(q) || o.hint?.toLowerCase().includes(q));
  const chosen = options[kind].filter((o) => selected[kind].has(o.id));
  const totalLinks = LINK_KINDS.reduce((n, k) => n + selected[k].size, 0);

  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await run(() =>
          updateResource(resource.id, {
            title,
            type,
            url: url.trim() || null,
            summary: summary.trim() || null,
            tags: tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean),
            goalIds: [...selected.goal],
            milestoneIds: [...selected.milestone],
            decisionIds: [...selected.decision],
            companyIds: [...selected.company],
            personIds: [...selected.person],
          }),
        );
        if (res.ok) onDone();
      }}
    >
      <DialogHeader>
        <DialogTitle className="pr-6 leading-snug">Edit resource</DialogTitle>
        <DialogDescription className="truncate">{resource.title}</DialogDescription>
      </DialogHeader>

      <Tabs value={tab} onValueChange={(v) => setTab(v as EditTab)}>
        <TabsList>
          <TabsTrigger value="links">
            Links <span className="text-muted-foreground tabular">{totalLinks}</span>
          </TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
        </TabsList>

        <TabsContent value="links" className="mt-2 grid gap-3">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Link type">
            {LINK_KINDS.map((k) => {
              const Icon = CHIP_META[k].icon;
              const active = k === kind;
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setKind(k);
                    setFilter("");
                  }}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors",
                    active ? "border-foreground bg-foreground text-background" : "border-border text-ink-2 hover:bg-muted",
                  )}
                >
                  <Icon className="size-3.5" aria-hidden />
                  {CHIP_META[k].plural}
                  <span className={cn("tabular", active ? "text-background/70" : "text-muted-foreground")}>{selected[k].size}</span>
                </button>
              );
            })}
          </div>

          {chosen.length > 0 && (
            <ul className="flex flex-wrap gap-1" aria-label={`Linked ${CHIP_META[kind].plural.toLowerCase()}`}>
              {chosen.map((o) => (
                <li key={o.id}>
                  <span className="inline-flex h-6 max-w-[260px] items-center gap-1 rounded-md bg-brand-soft pr-0.5 pl-2 text-2xs font-medium text-foreground">
                    <span className="truncate">{o.label}</span>
                    <button type="button" onClick={() => toggle(kind, o.id, false)} className="flex size-5 items-center justify-center rounded hover:bg-background/60" aria-label={`Unlink ${o.label}`}>
                      <X className="size-3" aria-hidden />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={`Filter ${CHIP_META[kind].plural.toLowerCase()}…`}
              aria-label={`Filter ${CHIP_META[kind].plural.toLowerCase()}`}
              className="h-7 pl-8 text-[15px]"
            />
          </div>

          <div className="max-h-64 overflow-y-auto rounded-lg border border-border scrollbar-thin" role="group" aria-label={`Choose ${CHIP_META[kind].plural.toLowerCase()}`}>
            {visible.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                {options[kind].length === 0 ? `No ${CHIP_META[kind].plural.toLowerCase()} to link yet.` : "Nothing matches that filter."}
              </p>
            ) : (
              <ul className="divide-y divide-hairline">
                {visible.map((o) => {
                  const id = `link-${kind}-${o.id}`;
                  return (
                    <li key={o.id}>
                      <label htmlFor={id} className="flex cursor-pointer items-start gap-2.5 px-3 py-2 hover:bg-muted/60">
                        <Checkbox id={id} className="mt-0.5" checked={selected[kind].has(o.id)} onCheckedChange={(v) => toggle(kind, o.id, v === true)} />
                        <span className="min-w-0">
                          <span className="block truncate text-[15px] text-foreground">{o.label}</span>
                          {o.hint && <span className="block truncate text-2xs text-muted-foreground">{o.hint}</span>}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {resource.tasks.length > 0 && (
            <p className="text-2xs text-muted-foreground">
              Also linked to {resource.tasks.length} task{resource.tasks.length === 1 ? "" : "s"} — manage those from the task itself.
            </p>
          )}
        </TabsContent>

        <TabsContent value="details" className="mt-2 grid gap-4">
          <Field label="Title" htmlFor="edit-res-title">
            <Input id="edit-res-title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={240} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type">
              <SimpleSelect
                value={type}
                onChange={(v) => v && setType(v as ResourceType)}
                ariaLabel="Resource type"
                options={(Object.keys(RESOURCE_TYPES) as ResourceType[]).map((t) => ({ value: t, label: RESOURCE_TYPES[t].label }))}
              />
            </Field>
            <Field label="Link" htmlFor="edit-res-url">
              <Input id="edit-res-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
            </Field>
          </div>
          <Field label="Summary" htmlFor="edit-res-summary">
            <Textarea id="edit-res-summary" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={5000} />
          </Field>
          <Field label="Tags" htmlFor="edit-res-tags" hint="Comma separated">
            <Input id="edit-res-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
          </Field>
        </TabsContent>
      </Tabs>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !title.trim()}>
          {pending && <Loader2 className="animate-spin" />}
          Save changes
        </Button>
      </DialogFooter>
    </form>
  );
}
