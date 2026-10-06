import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface RhythmStep {
  label: string;
  detail: string;
  state: "done" | "current" | "upcoming";
}

/** The CEO operating rhythm: refresh → review → prioritize → execute → close. */
export function DailyRhythm({ steps }: { steps: RhythmStep[] }) {
  return (
    <ol className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-5" aria-label="Daily CEO workflow">
      {steps.map((s, i) => (
        <li key={s.label} className={cn("flex items-center gap-2.5 bg-surface px-3 py-2", s.state === "current" && "bg-brand-soft/60")} aria-current={s.state === "current" ? "step" : undefined}>
          <span
            className={cn(
              "flex size-5 shrink-0 items-center justify-center rounded-full text-2xs font-semibold tabular",
              s.state === "done" && "bg-good-soft text-good-ink",
              s.state === "current" && "bg-brand text-white",
              s.state === "upcoming" && "border border-border text-muted-foreground",
            )}
          >
            {s.state === "done" ? <Check className="size-3" aria-hidden /> : i + 1}
          </span>
          <div className="min-w-0 leading-tight">
            <div className={cn("truncate text-xs font-medium", s.state === "upcoming" ? "text-muted-foreground" : "text-foreground")}>{s.label}</div>
            <div className="truncate text-2xs text-muted-foreground">{s.detail}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
