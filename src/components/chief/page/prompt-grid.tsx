"use client";

import { ArrowUpRight, Compass, type LucideIcon, ShieldAlert, Target, Users } from "lucide-react";

const GROUPS: { theme: string; icon: LucideIcon; prompts: string[] }[] = [
  { theme: "Focus", icon: Target, prompts: ["What should I focus on today?", "What are my highest leverage actions?"] },
  {
    theme: "Risks",
    icon: ShieldAlert,
    prompts: ["What am I forgetting?", "What is most likely to become a problem?", "What goals are slipping?", "What decisions am I avoiding?"],
  },
  {
    theme: "People",
    icon: Users,
    prompts: ["Which investor needs follow-up?", "What customers require attention?", "What should I delegate?", "What should I stop doing?"],
  },
  {
    theme: "Context",
    icon: Compass,
    prompts: ["What changed this week?", "Prepare me for my next important meeting.", "Show me everything related to Brightwater"],
  },
];

/** Suggested questions for an empty thread, grouped by theme. */
export function PromptGrid({ onPick, disabled }: { onPick: (q: string) => void; disabled?: boolean }) {
  return (
    <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
      {GROUPS.map((g) => {
        const Icon = g.icon;
        return (
          <section key={g.theme} aria-labelledby={`prompts-${g.theme}`} className="min-w-0">
            <h3 id={`prompts-${g.theme}`} className="eyebrow mb-1.5 flex items-center gap-1.5">
              <Icon className="size-3" aria-hidden />
              {g.theme}
            </h3>
            <ul className="space-y-1.5">
              {g.prompts.map((p) => (
                <li key={p}>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onPick(p)}
                    className="group flex w-full items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-left text-[15px] text-ink-2 transition-colors outline-none hover:border-input hover:bg-muted/60 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                  >
                    <span className="min-w-0 flex-1">{p}</span>
                    <ArrowUpRight className="size-3.5 shrink-0 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
