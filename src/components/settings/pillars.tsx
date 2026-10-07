"use client";

import { ArrowDown, ArrowUp, Check, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/common/bits";
import { Field } from "@/components/common/fields";
import { useAction } from "@/components/common/use-action";
import { PILLAR_COLORS, pillarColorVar, type PillarColor } from "@/lib/domain";
import { pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createPillar, deletePillar, movePillar, updatePillar } from "@/server/actions/settings";
import type { PillarRow } from "@/server/queries/settings";
import { SectionFooter } from "./section";

const COLOR_LABEL: Record<PillarColor, string> = {
  blue: "Blue",
  orange: "Orange",
  aqua: "Aqua",
  yellow: "Yellow",
  magenta: "Magenta",
  green: "Green",
  violet: "Violet",
  red: "Red",
};

function asColor(c: string): PillarColor {
  return (PILLAR_COLORS as readonly string[]).includes(c) ? (c as PillarColor) : "blue";
}

/** Eight-swatch picker from the validated categorical palette. */
function SwatchGrid({ value, onPick, disabled }: { value: PillarColor; onPick: (c: PillarColor) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Pillar color" className="grid grid-cols-8 gap-1.5">
      {PILLAR_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={COLOR_LABEL[c]}
          title={COLOR_LABEL[c]}
          disabled={disabled}
          onClick={() => onPick(c)}
          className={cn(
            "flex size-6 items-center justify-center rounded-md ring-offset-2 ring-offset-popover transition-shadow outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === c && "ring-2 ring-foreground",
          )}
          style={{ background: pillarColorVar(c) }}
        >
          {value === c && <Check className="size-3.5 text-white" aria-hidden />}
        </button>
      ))}
    </div>
  );
}

export function PillarsManager({ pillars }: { pillars: PillarRow[] }) {
  const [editing, setEditing] = useState<PillarRow | "new" | null>(null);
  const used = new Set(pillars.map((p) => p.color));
  const nextColor = PILLAR_COLORS.find((c) => !used.has(c)) ?? PILLAR_COLORS[pillars.length % PILLAR_COLORS.length];
  const activeCount = pillars.filter((p) => p.active).length;

  return (
    <div className="panel @container">
      <div className="hidden grid-cols-[52px_minmax(0,1fr)_220px_64px_72px] items-center gap-3 border-b border-hairline px-4 py-2 text-2xs font-medium text-muted-foreground @2xl:grid">
        <span>Order</span>
        <span>Pillar</span>
        <span>Linked work</span>
        <span>Active</span>
        <span className="sr-only">Actions</span>
      </div>
      {pillars.length === 0 ? (
        <EmptyState compact title="No strategic pillars yet" description="Pillars are the top of the execution graph: goals, milestones and tasks roll up to them." />
      ) : (
        <ul className="divide-y divide-hairline">
          {pillars.map((p, i) => (
            <PillarRowView key={p.id} pillar={p} first={i === 0} last={i === pillars.length - 1} onEdit={() => setEditing(p)} />
          ))}
        </ul>
      )}
      <SectionFooter hint={`${activeCount} active of ${pluralize(pillars.length, "pillar")} · deactivated pillars are hidden from pickers but keep their links.`}>
        <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
          <Plus /> Add pillar
        </Button>
      </SectionFooter>
      <PillarDialog key={editing === "new" ? "new" : (editing?.id ?? "closed")} editing={editing} defaultColor={nextColor} onClose={() => setEditing(null)} />
    </div>
  );
}

function PillarRowView({ pillar: p, first, last, onEdit }: { pillar: PillarRow; first: boolean; last: boolean; onEdit: () => void }) {
  const { pending, run } = useAction();
  const [colorOpen, setColorOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const color = asColor(p.color);
  const linkedDetail = [p.counts.decisions ? pluralize(p.counts.decisions, "decision") : null, p.counts.metrics ? pluralize(p.counts.metrics, "metric") : null].filter(Boolean).join(" · ");

  return (
    <li className={cn("grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-2.5 @2xl:grid-cols-[52px_minmax(0,1fr)_220px_64px_72px]", !p.active && "bg-surface-2/60")}>
      <div className="row-span-2 flex items-center gap-0.5 @2xl:row-span-1">
        <Button variant="ghost" size="icon-xs" disabled={first || pending} onClick={() => run(() => movePillar(p.id, "up"), { success: false })} aria-label={`Move ${p.name} up`}>
          <ArrowUp />
        </Button>
        <Button variant="ghost" size="icon-xs" disabled={last || pending} onClick={() => run(() => movePillar(p.id, "down"), { success: false })} aria-label={`Move ${p.name} down`}>
          <ArrowDown />
        </Button>
      </div>

      <div className="flex min-w-0 items-start gap-2.5">
        <Popover open={colorOpen} onOpenChange={setColorOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Change color for ${p.name} (currently ${COLOR_LABEL[color]})`}
              className="mt-0.5 size-4 shrink-0 rounded-[4px] ring-offset-2 ring-offset-surface outline-none hover:ring-2 hover:ring-border focus-visible:ring-2 focus-visible:ring-ring"
              style={{ background: pillarColorVar(color) }}
            />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-2.5">
            <div className="mb-2 text-2xs font-medium text-muted-foreground">Pillar color</div>
            <SwatchGrid
              value={color}
              disabled={pending}
              onPick={(c) => {
                setColorOpen(false);
                if (c !== color) run(() => updatePillar(p.id, { color: c }), { success: "Color updated" });
              }}
            />
          </PopoverContent>
        </Popover>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn("truncate text-[14px] font-medium", p.active ? "text-foreground" : "text-muted-foreground")}>{p.name}</span>
            {!p.active && <span className="shrink-0 rounded bg-muted px-1.5 text-2xs font-medium text-muted-foreground">Inactive</span>}
          </div>
          {p.description && <p className="line-clamp-1 text-2xs text-muted-foreground">{p.description}</p>}
        </div>
      </div>

      <div className="col-start-2 text-2xs text-muted-foreground tabular @2xl:col-start-auto" title={linkedDetail || undefined}>
        <span className="text-ink-2">{p.counts.goals}</span> {p.counts.goals === 1 ? "goal" : "goals"} · <span className="text-ink-2">{p.counts.milestones}</span>{" "}
        {p.counts.milestones === 1 ? "milestone" : "milestones"} · <span className="text-ink-2">{p.counts.tasks}</span> {p.counts.tasks === 1 ? "task" : "tasks"}
      </div>

      <div className="col-start-3 row-start-1 flex items-center @2xl:col-start-auto @2xl:row-start-auto">
        <Switch
          size="sm"
          checked={p.active}
          disabled={pending}
          onCheckedChange={(v) => run(() => updatePillar(p.id, { active: v }))}
          aria-label={`${p.name} active`}
        />
      </div>

      <div className="col-start-3 row-start-2 flex items-center justify-end gap-0.5 @2xl:col-start-auto @2xl:row-start-auto">
        <Button variant="ghost" size="icon-xs" onClick={onEdit} aria-label={`Edit ${p.name}`}>
          <Pencil />
        </Button>
        {p.linked > 0 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} className="inline-flex rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`${p.name} can’t be deleted: ${pluralize(p.linked, "linked item")}`}>
                <Button variant="ghost" size="icon-xs" disabled aria-hidden tabIndex={-1}>
                  <Trash2 />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>Linked to {pluralize(p.linked, "item")} — deactivate instead</TooltipContent>
          </Tooltip>
        ) : (
          <Button variant="ghost" size="icon-xs" onClick={() => setConfirmDelete(true)} aria-label={`Delete ${p.name}`}>
            <Trash2 />
          </Button>
        )}
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{p.name}”?</AlertDialogTitle>
            <AlertDialogDescription>Nothing is linked to this pillar. Deleting it removes it permanently.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => run(() => deletePillar(p.id))}>
              Delete pillar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

function PillarDialog({ editing, defaultColor, onClose }: { editing: PillarRow | "new" | null; defaultColor: PillarColor; onClose: () => void }) {
  const existing = editing && editing !== "new" ? editing : null;
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [color, setColor] = useState<PillarColor>(existing ? asColor(existing.color) : defaultColor);
  const { pending, run } = useAction();

  return (
    <Dialog open={editing !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit pillar" : "Add strategic pillar"}</DialogTitle>
          <DialogDescription>Pillars are CytoHub’s strategic themes. Goals, milestones and tasks roll up to them.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const payload = { name, description: description.trim() || null, color };
            const res = existing ? await run(() => updatePillar(existing.id, payload)) : await run(() => createPillar(payload));
            if (res.ok) onClose();
          }}
        >
          <Field label="Name" htmlFor="pillar-name">
            <Input id="pillar-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoFocus />
          </Field>
          <Field label="Description" htmlFor="pillar-description">
            <Textarea id="pillar-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={3} placeholder="What winning looks like for this pillar" />
          </Field>
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-ink-2">Color</span>
            <SwatchGrid value={color} onPick={setColor} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending && <Loader2 className="animate-spin" />}
              {existing ? "Save pillar" : "Create pillar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
