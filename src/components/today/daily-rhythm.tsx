import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface RhythmStep {
  label: string;
  detail: string;
  state: "done" | "current" | "upcoming";
}

/**
 * The CEO operating rhythm: refresh → review → prioritize → execute → close.
 * A swipeable row on phones, five columns from `sm` up. `embedded` drops the
 * outer frame so it can sit inside another panel.
 */
export function DailyRhythm({ steps, embedded = false }: { steps: RhythmStep[]; embedded?: boolean }) {
  return (
    <ol
      className={cn(
        "flex snap-x gap-px overflow-x-auto [scrollbar-width:none] sm:grid sm:grid-cols-5 sm:overflow-visible",
        embedded ? "border-t border-hairline bg-hairline" : "rounded-lg border border-border bg-border sm:overflow-hidden",
      )}
      aria-label="Daily CEO workflow"
    >
      {steps.map((s, i) => (
        <li
          key={s.label}
          className={cn("flex min-w-[46%] shrink-0 snap-start items-center gap-2.5 bg-surface px-3 py-2 sm:min-w-0", s.state === "current" && "bg-brand-soft/60")}
          aria-current={s.state === "current" ? "step" : undefined}
        >
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
            <div className={cn("text-xs font-medium text-balance", s.state === "upcoming" ? "text-muted-foreground" : "text-foreground")}>{s.label}</div>
            <div className="truncate text-2xs text-muted-foreground">{s.detail}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
