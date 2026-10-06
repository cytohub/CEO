import { cn } from "@/lib/utils";

export const RELATIONSHIP_LABEL = ["Unknown", "Cold", "Cool", "Neutral", "Warm", "Strong"] as const;

/** Relationship strength 1–5 as filled dots; the count of filled dots carries the value, not color. */
export function RelationshipDots({ value, showLabel, className }: { value: number; showLabel?: boolean; className?: string }) {
  const v = Math.max(0, Math.min(5, Math.round(value)));
  const label = RELATIONSHIP_LABEL[v];
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)} title={`Relationship ${v} of 5 — ${label}`}>
      <span className="inline-flex items-center gap-0.5" aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={cn("size-1.5 rounded-full", i <= v ? "bg-brand" : "bg-track")} />
        ))}
      </span>
      {showLabel ? <span className="text-xs text-ink-2">{label}</span> : <span className="sr-only">Relationship {v} of 5, {label}</span>}
    </span>
  );
}
