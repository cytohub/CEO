"use client";

import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FOCUS_AREA_ORDER, FOCUS_AREAS, PERSON_TYPES, PRIORITY } from "@/lib/domain";
import { pillarColorVar } from "@/lib/domain";
import { useLookups } from "@/components/shell/ui-context";
import type { FocusArea, Priority } from "@/generated/prisma/enums";

export const NONE = "__none";

export function Field({ label, htmlFor, hint, children, className }: { label: string; htmlFor?: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-xs font-medium text-ink-2">
        {label}
      </Label>
      {children}
      {hint && <p className="text-2xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

type Opt = { value: string; label: React.ReactNode; group?: string };

export function SimpleSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  allowNone,
  noneLabel = "None",
  id,
  className,
  size = "default",
  ariaLabel,
}: {
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  options: Opt[];
  placeholder?: string;
  allowNone?: boolean;
  noneLabel?: string;
  id?: string;
  className?: string;
  size?: "sm" | "default";
  ariaLabel?: string;
}) {
  const groups = [...new Set(options.map((o) => o.group ?? ""))];
  return (
    <Select value={value ?? (allowNone ? NONE : undefined)} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger id={id} size={size} className={cn("w-full text-[13px]", className)} aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-80">
        {allowNone && <SelectItem value={NONE}>{noneLabel}</SelectItem>}
        {groups.map((g) =>
          g ? (
            <SelectGroup key={g}>
              <SelectLabel>{g}</SelectLabel>
              {options
                .filter((o) => o.group === g)
                .map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
            </SelectGroup>
          ) : (
            options
              .filter((o) => !o.group)
              .map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))
          ),
        )}
      </SelectContent>
    </Select>
  );
}

export function PersonSelect(props: { value: string | null | undefined; onChange: (v: string | null) => void; teamOnly?: boolean; allowNone?: boolean; id?: string; placeholder?: string; size?: "sm" | "default" }) {
  const { people } = useLookups();
  const list = props.teamOnly ? people.filter((p) => p.type === "TEAM") : people;
  return (
    <SimpleSelect
      {...props}
      placeholder={props.placeholder ?? "Select person"}
      options={list.map((p) => ({
        value: p.id,
        label: p.isCeo ? "You (CEO)" : `${p.name}${p.title ? ` — ${p.title}` : ""}`,
        group: p.isCeo || p.type === "TEAM" ? "Team" : PERSON_TYPES[p.type as keyof typeof PERSON_TYPES]?.label ?? "Other",
      }))}
    />
  );
}

export function GoalSelect(props: { value: string | null | undefined; onChange: (v: string | null) => void; id?: string; size?: "sm" | "default" }) {
  const { goals } = useLookups();
  return (
    <SimpleSelect
      {...props}
      allowNone
      placeholder="Link to a goal"
      options={goals.map((g) => ({ value: g.id, label: g.title, group: g.type.charAt(0) + g.type.slice(1).toLowerCase() }))}
    />
  );
}

export function MilestoneSelect(props: { value: string | null | undefined; onChange: (v: string | null) => void; goalId?: string | null; id?: string; size?: "sm" | "default" }) {
  const { milestones } = useLookups();
  const list = props.goalId ? milestones.filter((m) => m.goalId === props.goalId) : milestones;
  return <SimpleSelect {...props} allowNone placeholder="Link to a milestone" options={list.map((m) => ({ value: m.id, label: m.title }))} />;
}

export function PillarSelect(props: { value: string | null | undefined; onChange: (v: string | null) => void; id?: string; allowNone?: boolean; size?: "sm" | "default" }) {
  const { pillars } = useLookups();
  return (
    <SimpleSelect
      {...props}
      placeholder="Strategic pillar"
      options={pillars.map((p) => ({
        value: p.id,
        label: (
          <span className="flex items-center gap-2">
            <span className="size-2 rounded-[3px]" style={{ background: pillarColorVar(p.color) }} />
            {p.name}
          </span>
        ),
      }))}
    />
  );
}

export function CompanySelect(props: { value: string | null | undefined; onChange: (v: string | null) => void; id?: string; size?: "sm" | "default" }) {
  const { companies } = useLookups();
  return <SimpleSelect {...props} allowNone placeholder="Related company" options={companies.map((c) => ({ value: c.id, label: c.name, group: c.type.charAt(0) + c.type.slice(1).toLowerCase() }))} />;
}

export function FocusAreaSelect(props: { value: FocusArea | null | undefined; onChange: (v: FocusArea) => void; id?: string; size?: "sm" | "default" }) {
  return (
    <SimpleSelect
      {...props}
      onChange={(v) => v && props.onChange(v as FocusArea)}
      options={FOCUS_AREA_ORDER.map((f) => ({ value: f, label: FOCUS_AREAS[f].label }))}
    />
  );
}

export function PrioritySelect(props: { value: Priority; onChange: (v: Priority) => void; id?: string; size?: "sm" | "default"; className?: string }) {
  return (
    <SimpleSelect
      {...props}
      onChange={(v) => v && props.onChange(v as Priority)}
      options={(["P0", "P1", "P2", "P3"] as Priority[]).map((p) => ({ value: p, label: `${p} · ${PRIORITY[p].label}` }))}
    />
  );
}

/** 0–5 rating as a compact segmented control. */
export function RatingInput({ value, onChange, label, description }: { value: number; onChange: (v: number) => void; label: string; description?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-xs font-medium text-ink-2">{label}</div>
        {description && <div className="truncate text-2xs text-muted-foreground">{description}</div>}
      </div>
      <div role="radiogroup" aria-label={label} className="flex shrink-0 overflow-hidden rounded-md border border-border">
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            onClick={() => onChange(n)}
            className={cn(
              "h-6 w-6 border-r border-border text-2xs tabular transition-colors last:border-r-0",
              value === n ? "bg-foreground font-semibold text-background" : n <= value ? "bg-muted text-foreground" : "bg-surface text-muted-foreground hover:bg-muted",
            )}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}
