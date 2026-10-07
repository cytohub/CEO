"use client";

import { ArrowUpRight, FolderOpen, Link2, Loader2, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/common/bits";
import { useAction } from "@/components/common/use-action";
import { useUI } from "@/components/shell/ui-context";
import type { ResourceType } from "@/generated/prisma/enums";
import { formatDay } from "@/lib/dates";
import { RESOURCE_TYPES, SOURCES } from "@/lib/domain";
import { pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { deleteResource } from "@/server/actions/resources";
import type { ResourceRow } from "@/server/queries/resources";
import { EntityChip } from "./chips";
import { FilterToolbar } from "./filter-toolbar";
import { safeHref } from "./links";
import { ResourceEditDialog, type EditTab } from "./resource-edit-dialog";
import { returnFocus } from "@/components/scoreboard/focus";

function haystack(r: ResourceRow): string {
  return [
    r.title,
    r.summary,
    r.description,
    RESOURCE_TYPES[r.type].label,
    ...r.tags,
    ...r.goals.map((x) => x.title),
    ...r.milestones.map((x) => x.title),
    ...r.tasks.map((x) => x.title),
    ...r.decisions.map((x) => x.title),
    ...r.people.map((x) => (x.isCeo ? `you ${x.name}` : x.name)),
    ...r.companies.map((x) => x.name),
  ]
    .filter(Boolean)
    .join(" \n ")
    .toLowerCase();
}

export function ResourceList({ resources, highlightId }: { resources: ResourceRow[]; highlightId: string | null }) {
  const { openCreate } = useUI();
  const [query, setQuery] = useState("");
  const [type, setType] = useState<ResourceType | null>(null);
  const [editing, setEditing] = useState<{ id: string; tab: EditTab } | null>(null);
  const [deleting, setDeleting] = useState<ResourceRow | null>(null);
  // Where focus returns when a dialog launched from a row closes.
  const returnRef = useRef<HTMLElement | null>(null);

  const index = useMemo(() => new Map(resources.map((r) => [r.id, haystack(r)])), [resources]);
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = resources.filter((r) => (!type || r.type === type) && terms.every((t) => index.get(r.id)?.includes(t)));
  const typeCounts = useMemo(() => {
    const m = new Map<ResourceType, number>();
    for (const r of resources) m.set(r.type, (m.get(r.type) ?? 0) + 1);
    return m;
  }, [resources]);

  useEffect(() => {
    if (!highlightId) return;
    const el = document.getElementById(`resource-${highlightId}`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.focus({ preventScroll: true });
  }, [highlightId]);

  const editingRow = editing ? (resources.find((r) => r.id === editing.id) ?? null) : null;

  return (
    <div className="space-y-3">
      <FilterToolbar
        query={query}
        onQuery={setQuery}
        searchLabel="Search resources"
        placeholder="Search titles, summaries, tags, linked work…"
        type={type}
        onType={(t) => setType(t as ResourceType | null)}
        typeOptions={(Object.keys(RESOURCE_TYPES) as ResourceType[])
          .filter((t) => typeCounts.has(t))
          .map((t) => ({ value: t, label: `${RESOURCE_TYPES[t].label} · ${typeCounts.get(t)}` }))}
        shown={filtered.length}
        total={resources.length}
        noun={resources.length === 1 ? "resource" : "resources"}
      />

      <div className="panel overflow-hidden">
        {resources.length === 0 ? (
          <EmptyState
            icon={FolderOpen}
            title="No resources yet"
            description="Add the decks, models, contracts and papers you work from, and link them to the goals, milestones and decisions they support."
            action={
              <Button size="sm" onClick={() => openCreate("resource")}>
                <Plus /> Add resource
              </Button>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            compact
            icon={FolderOpen}
            title="No resources match"
            description={query ? `Nothing matches “${query.trim()}”${type ? ` in ${RESOURCE_TYPES[type].label.toLowerCase()}s` : ""}.` : "No resources of this type."}
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setQuery("");
                  setType(null);
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-hairline">
            {filtered.map((r) => (
              <ResourceItem
                key={r.id}
                resource={r}
                highlighted={r.id === highlightId}
                onTag={(tag) => setQuery(tag)}
                onEdit={(tab, from) => {
                  returnRef.current = from;
                  setEditing({ id: r.id, tab });
                }}
                onDelete={(from) => {
                  returnRef.current = from;
                  setDeleting(r);
                }}
              />
            ))}
          </ul>
        )}
      </div>

      <ResourceEditDialog resource={editingRow} tab={editing?.tab ?? "links"} onOpenChange={(o) => !o && setEditing(null)} returnFocusTo={returnRef} />
      <DeleteResourceDialog resource={deleting} onClose={() => setDeleting(null)} returnFocusTo={returnRef} />
    </div>
  );
}

function ResourceItem({
  resource: r,
  highlighted,
  onTag,
  onEdit,
  onDelete,
}: {
  resource: ResourceRow;
  highlighted: boolean;
  onTag: (tag: string) => void;
  onEdit: (tab: EditTab, returnTo: HTMLElement | null) => void;
  onDelete: (returnTo: HTMLElement | null) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  // A menu item that opens a dialog must not let the menu pull focus back to its trigger.
  const launching = useRef(false);
  const meta = RESOURCE_TYPES[r.type];
  const Icon = meta.icon;
  const href = safeHref(r.url);
  const linkCount = r.goals.length + r.milestones.length + r.tasks.length + r.decisions.length + r.people.length + r.companies.length;
  const titleId = `resource-${r.id}-title`;

  return (
    <li
      id={`resource-${r.id}`}
      tabIndex={-1}
      aria-labelledby={titleId}
      aria-current={highlighted ? "true" : undefined}
      className={cn(
        "group flex scroll-mt-24 gap-3 px-3.5 py-3 outline-none",
        highlighted ? "bg-brand-soft/60 shadow-[inset_2px_0_0_var(--brand)]" : "hover:bg-muted/30",
      )}
    >
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2" aria-hidden>
        <Icon className="size-3.5 text-ink-2" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h3 id={titleId} className="text-[15px] leading-snug font-medium text-foreground">
              {href ? (
                <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-baseline gap-1 hover:underline">
                  <span className="min-w-0 break-words">{r.title}</span>
                  <ArrowUpRight className="size-3 shrink-0 self-center text-ink-3" aria-hidden />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              ) : (
                r.title
              )}
            </h3>
            <p className="mt-0.5 text-2xs text-muted-foreground">
              {meta.label}
              {r.source !== "MANUAL" && <> · via {SOURCES[r.source].label}</>}
              {" · "}Added {formatDay(r.createdAt, true)}
            </p>
          </div>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button ref={triggerRef} variant="ghost" size="icon-xs" className="text-ink-3" aria-label={`Actions for ${r.title}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-44"
              onCloseAutoFocus={(e) => {
                if (launching.current) {
                  e.preventDefault();
                  launching.current = false;
                }
              }}
            >
              <DropdownMenuItem
                onSelect={() => {
                  launching.current = true;
                  onEdit("links", triggerRef.current);
                }}
              >
                <Link2 /> Edit links…
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  launching.current = true;
                  onEdit("details", triggerRef.current);
                }}
              >
                <Pencil /> Edit details…
              </DropdownMenuItem>
              {href && (
                <DropdownMenuItem asChild>
                  <a href={href} target="_blank" rel="noopener noreferrer">
                    <ArrowUpRight /> Open link
                  </a>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => {
                  launching.current = true;
                  onDelete(triggerRef.current);
                }}
              >
                <Trash2 /> Delete…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {(r.summary || r.description) && <p className="mt-1.5 line-clamp-2 max-w-3xl text-xs text-ink-2">{r.summary ?? r.description}</p>}

        <div className="mt-2 flex flex-wrap items-center gap-1">
          {r.tags.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onTag(t)}
              className="inline-flex h-5 items-center rounded bg-muted px-1.5 text-2xs text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={`Filter by tag ${t}`}
            >
              #{t}
            </button>
          ))}
          {r.tags.length > 0 && linkCount > 0 && <span className="mx-0.5 h-3 w-px bg-border" aria-hidden />}
          {r.goals.map((x) => (
            <EntityChip key={x.id} kind="goal" id={x.id} label={x.title} />
          ))}
          {r.milestones.map((x) => (
            <EntityChip key={x.id} kind="milestone" id={x.id} label={x.title} />
          ))}
          {r.tasks.map((x) => (
            <EntityChip key={x.id} kind="task" id={x.id} label={x.title} muted={x.status === "DONE" || x.status === "CANCELLED"} />
          ))}
          {r.decisions.map((x) => (
            <EntityChip key={x.id} kind="decision" id={x.id} label={x.title} />
          ))}
          {r.companies.map((x) => (
            <EntityChip key={x.id} kind="company" id={x.id} label={x.name} />
          ))}
          {r.people.map((x) => (
            <EntityChip key={x.id} kind="person" id={x.id} label={x.isCeo ? "You" : x.name} />
          ))}
          {linkCount === 0 && (
            <button type="button" onClick={(e) => onEdit("links", e.currentTarget)} className="inline-flex h-5 items-center gap-1 rounded px-1 text-2xs text-muted-foreground hover:bg-muted hover:text-foreground">
              <Link2 className="size-3" aria-hidden /> Not linked to any work — link it
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function DeleteResourceDialog({
  resource,
  onClose,
  returnFocusTo,
}: {
  resource: ResourceRow | null;
  onClose: () => void;
  returnFocusTo: React.RefObject<HTMLElement | null>;
}) {
  const { pending, run } = useAction();
  const links = resource ? resource.goals.length + resource.milestones.length + resource.tasks.length + resource.decisions.length + resource.people.length + resource.companies.length : 0;
  return (
    <AlertDialog open={resource !== null} onOpenChange={(o) => !o && !pending && onClose()}>
      <AlertDialogContent onCloseAutoFocus={returnFocus(returnFocusTo)}>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this resource?</AlertDialogTitle>
          <AlertDialogDescription>
            “{resource?.title}” will be removed from the Resource Center
            {links > 0 ? ` and unlinked from ${pluralize(links, "item")}` : ""}. The linked goals, tasks and decisions are not affected. The original file or link is untouched.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={async () => {
              if (!resource) return;
              const res = await run(() => deleteResource(resource.id));
              if (res.ok) onClose();
            }}
          >
            {pending && <Loader2 className="animate-spin" />}
            Delete resource
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
