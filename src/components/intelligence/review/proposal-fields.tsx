"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CompanySelect, GoalSelect, PersonSelect, SimpleSelect } from "@/components/common/fields";
import { useLookups } from "@/components/shell/ui-context";
import { cn } from "@/lib/utils";
import { displayValue, getIn, isEmptyField, severityLabel, type ProposalField } from "../model";

type Names = Record<string, string>;

function useNameFor(names: Names) {
  const { people, companies, goals } = useLookups();
  return (type: ProposalField["type"], id: unknown): string | null => {
    if (typeof id !== "string") return null;
    if (type === "person") return names[id] ?? people.find((p) => p.id === id)?.name ?? null;
    if (type === "company") return companies.find((c) => c.id === id)?.name ?? null;
    if (type === "goal") return goals.find((g) => g.id === id)?.title ?? null;
    return null;
  };
}

/** Read-only key/value view of a proposal. */
export function ProposalFieldsView({ fields: all, names }: { fields: ProposalField[]; names: Names }) {
  const nameFor = useNameFor(names);
  const fields = all.filter((f) => !isEmptyField(f));
  if (!fields.length) return null;
  return (
    <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
      {fields.map((f) => {
        const wide = f.type === "textarea" || f.type === "list" || f.type === "json" || (typeof f.value === "string" && f.value.length > 60);
        let value: React.ReactNode = displayValue(f);
        if (f.type === "person" || f.type === "company" || f.type === "goal") {
          const name = nameFor(f.type, f.value);
          value = name ?? (f.nameValue ? <span>{f.nameValue} <span className="text-2xs text-muted-foreground">· not matched to a record</span></span> : "—");
        }
        return (
          <div key={f.key} className={cn("min-w-0", wide && "sm:col-span-2")}>
            <dt className="text-2xs font-medium text-muted-foreground">{f.label}</dt>
            <dd className={cn("mt-0.5 text-[15px] break-words text-foreground", (value === "—" || value == null) && "text-muted-foreground", f.type === "textarea" && "whitespace-pre-wrap")}>{value}</dd>
          </div>
        );
      })}
    </dl>
  );
}

/** Editable form for a proposal; read-only fields render as text. */
export function ProposalFieldsEditor({
  fields,
  draft,
  onChange,
  errors,
  names,
  idPrefix,
}: {
  fields: ProposalField[];
  draft: Record<string, unknown>;
  onChange: (path: string[], value: unknown, nameKey?: { key: string; value: string | null }) => void;
  errors: Record<string, string>;
  names: Names;
  idPrefix: string;
}) {
  const nameFor = useNameFor(names);
  return (
    <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
      {fields.map((f) => {
        const value = getIn(draft, f.path);
        const wide = f.type === "textarea" || f.type === "list" || f.type === "json";
        const inputId = `${idPrefix}-${f.key}`;
        const error = errors[f.path[0]];
        return (
          <div key={f.key} className={cn("min-w-0", wide && "sm:col-span-2")}>
            <label htmlFor={f.editable ? inputId : undefined} className="mb-1 block text-2xs font-medium text-muted-foreground">
              {f.label}
              {!f.editable && <span className="ml-1 text-ink-3">· fixed</span>}
            </label>
            {f.editable ? (
              <FieldInput field={f} value={value} id={inputId} invalid={Boolean(error)} onChange={(v, nameValue) => onChange(f.path, v, f.spec?.nameKey && nameValue !== undefined ? { key: f.spec.nameKey, value: nameValue } : undefined)} nameFor={nameFor} />
            ) : (
              <p className="min-h-7 py-1 text-[15px] text-ink-2">{f.type === "person" || f.type === "company" ? (nameFor(f.type, value) ?? f.nameValue ?? "—") : displayValue({ ...f, value })}</p>
            )}
            {f.editable && f.type === "person" && !value && f.nameValue && <p className="mt-1 text-2xs text-muted-foreground">Written as “{f.nameValue}” — pick the matching person.</p>}
            {error && (
              <p role="alert" className="mt-1 text-2xs text-critical-ink">
                {error}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function FieldInput({
  field: f,
  value,
  id,
  invalid,
  onChange,
  nameFor,
}: {
  field: ProposalField;
  value: unknown;
  id: string;
  invalid: boolean;
  onChange: (v: unknown, nameValue?: string | null) => void;
  nameFor: (type: ProposalField["type"], id: unknown) => string | null;
}) {
  const str = value == null ? "" : String(value);
  const common = { id, "aria-invalid": invalid || undefined } as const;
  switch (f.type) {
    case "textarea":
      return <Textarea {...common} rows={3} value={str} onChange={(e) => onChange(e.target.value)} className="text-[15px]" />;
    case "date":
      return <Input {...common} type="date" className="h-8 w-full max-w-[200px]" value={/^\d{4}-\d{2}-\d{2}$/.test(str) ? str : ""} onChange={(e) => onChange(e.target.value || null)} />;
    case "number":
      return <Input {...common} type="number" inputMode="decimal" className="h-8" value={str} onChange={(e) => onChange(e.target.value)} />;
    case "money":
      return (
        <div className="relative max-w-[220px]">
          <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-muted-foreground" aria-hidden>
            $
          </span>
          <Input {...common} type="number" min={0} step={1000} inputMode="decimal" className="h-8 pl-6" value={str} onChange={(e) => onChange(e.target.value)} />
        </div>
      );
    case "boolean":
      return (
        <div className="flex h-8 items-center gap-2">
          <Switch id={id} checked={value === true} onCheckedChange={(v) => onChange(v)} />
          <span className="text-xs text-ink-2">{value === true ? "Yes" : "No"}</span>
        </div>
      );
    case "enum":
      return <SimpleSelect id={id} size="sm" value={str || null} onChange={(v) => onChange(v)} options={[...(f.spec?.options ?? [])]} allowNone={!f.spec?.always} noneLabel="—" />;
    case "rating":
      return <RatingSegments id={id} value={typeof value === "number" ? value : Number(value) || 0} onChange={(v) => onChange(v)} label={f.label} />;
    case "person":
      return <PersonSelect id={id} size="sm" value={str || null} allowNone onChange={(v) => onChange(v, v ? nameFor("person", v) : null)} placeholder={f.nameValue ? `“${f.nameValue}” — pick a person` : "Pick a person"} />;
    case "company":
      return <CompanySelect id={id} size="sm" value={str || null} onChange={(v) => onChange(v, v ? nameFor("company", v) : null)} />;
    case "goal":
      return <GoalSelect id={id} size="sm" value={str || null} onChange={(v) => onChange(v)} />;
    case "list":
      return <Textarea {...common} rows={3} value={Array.isArray(value) ? value.join("\n") : str} onChange={(e) => onChange(e.target.value.split("\n"))} placeholder="One per line" className="text-[15px]" />;
    case "json":
      return <pre className="max-h-32 overflow-auto rounded-md bg-muted p-2 font-mono text-2xs">{JSON.stringify(value, null, 2)}</pre>;
    default:
      return <Input {...common} className="h-8" value={str} placeholder={f.spec?.placeholder} onChange={(e) => onChange(e.target.value)} />;
  }
}

function RatingSegments({ id, value, onChange, label }: { id: string; value: number; onChange: (v: number) => void; label: string }) {
  const labelId = useId();
  return (
    <div className="flex items-center gap-2">
      <div id={id} role="radiogroup" aria-labelledby={labelId} className="flex overflow-hidden rounded-md border border-border">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} — ${severityLabel(n)}`}
            onClick={() => onChange(n)}
            className={cn(
              "h-7 w-7 border-r border-border text-2xs tabular transition-colors last:border-r-0 focus-visible:relative focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
              value === n ? "bg-foreground font-semibold text-background" : n <= value ? "bg-muted text-foreground" : "bg-surface text-muted-foreground hover:bg-muted",
            )}
          >
            {n}
          </button>
        ))}
      </div>
      <span id={labelId} className="text-2xs text-muted-foreground">
        <span className="sr-only">{label}: </span>
        {value ? severityLabel(value) : "—"}
      </span>
    </div>
  );
}
