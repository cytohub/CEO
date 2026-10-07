"use client";

import { ArrowRight, CalendarDays, Check, FileText, Layers, Loader2, Mail, Rocket, Sparkles, Target, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useAction } from "@/components/common/use-action";
import { Meter } from "@/components/common/status";
import { cn } from "@/lib/utils";
import { dismissSetupChecklist, runDailyRefresh } from "@/server/actions/brain";
import type { SetupProgress, SetupStepId } from "@/server/queries/setup";

const STEPS: Record<SetupStepId, { title: string; why: string; icon: LucideIcon; cta: string; href?: string }> = {
  email: { title: "Connect your email", why: "Brain reads threads for requests, promises and decisions.", icon: Mail, cta: "Connect", href: "/settings/integrations#email" },
  calendar: { title: "Connect your calendar", why: "Every meeting gets a Prepare Me brief and follow-ups.", icon: CalendarDays, cta: "Connect", href: "/settings/integrations#calendar" },
  documents: { title: "Connect your documents", why: "Board decks, contracts and plans become key facts.", icon: FileText, cta: "Connect", href: "/settings/integrations#documents" },
  pillars: { title: "Set your strategic pillars", why: "Every task and goal is ranked against what matters most.", icon: Layers, cta: "Add pillars", href: "/settings#pillars" },
  goals: { title: "Add your goals", why: "Priorities roll up into progress you can track.", icon: Target, cta: "Add goals", href: "/goals" },
  team: { title: "Invite your leadership team", why: "Executives work from the same picture; private stays private.", icon: Users, cta: "Invite", href: "/settings/users" },
  refresh: { title: "Run your first morning refresh", why: "Brain turns your sources into a daily brief and Top 5.", icon: Sparkles, cta: "Run refresh" },
};

/** First-run checklist on Today: what a new workspace still needs before the Brain can brief the CEO. */
export function SetupChecklist({ progress }: { progress: SetupProgress }) {
  const { pending, run } = useAction();
  const next = progress.steps.find((s) => !s.done)?.id;
  const pct = Math.round((progress.done / progress.total) * 100);

  return (
    <section className="panel overflow-hidden" aria-labelledby="setup-title">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-hairline px-4 py-3.5">
        <div className="flex min-w-0 flex-1 basis-72 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft">
            <Rocket className="size-4 text-brand" aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 id="setup-title" className="text-[15px] font-semibold tracking-tight">
              Set up your command center
            </h2>
            <p className="text-xs text-muted-foreground">Connect your sources and set what matters. CytoHub Brain then briefs you every morning.</p>
          </div>
        </div>
        <div className="flex w-full items-center gap-3 sm:w-auto">
          <div className="flex-1 sm:w-32 sm:flex-none">
            <div className="mb-1 text-2xs font-medium text-muted-foreground tabular sm:text-right">
              {progress.done} of {progress.total} done
            </div>
            <Meter value={pct} tone="info" label="Setup progress" />
          </div>
          <Button variant="ghost" size="xs" className="text-muted-foreground" disabled={pending} onClick={() => run(() => dismissSetupChecklist())}>
            Hide
          </Button>
        </div>
      </div>

      <ol className="divide-y divide-hairline">
        {progress.steps.map((s, i) => {
          const step = STEPS[s.id];
          const isNext = s.id === next;
          const Icon = step.icon;
          return (
            <li key={s.id} className={cn("flex items-center gap-3 px-4 py-2.5", isNext && "bg-brand-soft/40")}>
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-2xs font-semibold tabular",
                  s.done ? "bg-good-soft text-good-ink" : isNext ? "bg-brand text-white" : "border border-border text-muted-foreground",
                )}
                aria-hidden
              >
                {s.done ? <Check className="size-3.5" /> : i + 1}
              </span>
              <Icon className={cn("hidden size-4 shrink-0 sm:block", s.done ? "text-ink-3" : "text-ink-2")} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className={cn("text-[13px] font-medium", s.done ? "text-muted-foreground" : "text-foreground")}>
                  {step.title}
                  {s.done && <span className="sr-only"> (done)</span>}
                </div>
                {!s.done && <div className="text-xs text-muted-foreground">{step.why}</div>}
              </div>
              {s.done ? (
                <span className="text-2xs font-medium text-good-ink">Done</span>
              ) : step.href ? (
                <Button asChild size="xs" variant={isNext ? "default" : "outline"}>
                  <Link href={step.href}>
                    {step.cta}
                    <ArrowRight aria-hidden />
                  </Link>
                </Button>
              ) : (
                <Button size="xs" variant={isNext ? "default" : "outline"} disabled={pending} onClick={() => run(() => runDailyRefresh())}>
                  {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
                  {pending ? "Refreshing…" : step.cta}
                </Button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
