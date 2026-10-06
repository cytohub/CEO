import { CheckCircle2, Sparkles, Users } from "lucide-react";
import type { Metadata } from "next";
import { Avatar, PageHeader, Panel } from "@/components/common/bits";
import { DelegatedTable, Recommendations } from "@/components/delegation/delegation-center";
import { TaskLink } from "@/components/tasks/task-link";
import { daysBetween, formatDay } from "@/lib/dates";
import { formatMinutes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getDelegationCenter } from "@/server/queries/delegation";

export const metadata: Metadata = { title: "Delegation" };

export default async function DelegationPage() {
  const { recommendations, delegations, completed, team, today, now } = await getDelegationCenter();
  const followUps = delegations.filter((d) => d.status === "NEEDS_FOLLOW_UP" || (d.dueDate && daysBetween(today, d.dueDate) < 0)).length;
  const freed = recommendations.reduce((s, t) => s + (t.estimatedMinutes ?? 0), 0);
  const onTime = completed.filter((d) => !d.task.dueDate || (d.completedAt && d.completedAt <= new Date(d.task.dueDate.getTime() + 86_400_000))).length;

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <PageHeader title="Delegation Center" description="Hand off what doesn’t need you, and keep delegated work from going quiet. CytoHub Brain flags tasks where CEO involvement is unnecessary." />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Should delegate", recommendations.length, freed ? `frees ~${formatMinutes(freed)}` : "—", recommendations.length > 0],
          ["Delegated & active", delegations.length, `${team.filter((t) => t._count.delegationsIn > 0).length} people`, false],
          ["Follow-up required", followUps, followUps ? "going quiet or late" : "all current", followUps > 0],
          ["Completed (30 days)", completed.length, completed.length ? `${onTime}/${completed.length} on time` : "—", false],
        ].map(([label, value, hint, warn]) => (
          <div key={label as string} className="panel px-3.5 py-3">
            <div className="text-2xs text-muted-foreground">{label}</div>
            <div className={cn("mt-0.5 text-xl font-semibold tabular", warn && "text-serious-ink")}>{value}</div>
            <div className="text-2xs text-muted-foreground">{hint}</div>
          </div>
        ))}
      </div>

      <Panel title="Tasks you should delegate" icon={Sparkles} count={recommendations.length}>
        <Recommendations items={recommendations} today={today} />
      </Panel>

      <Panel title="Delegated" icon={Users} count={delegations.length}>
        <DelegatedTable items={delegations} today={today} now={now} />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Team load" icon={Users}>
          <ul className="divide-y divide-hairline">
            {team.map((p) => {
              const load = p._count.ownedTasks;
              return (
                <li key={p.id} className="flex items-center gap-3 px-4 py-2 text-[13px]">
                  <Avatar name={p.name} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{p.name}</div>
                    <div className="truncate text-2xs text-muted-foreground">{p.title}</div>
                  </div>
                  <div className="w-36" title={`${load} open tasks, ${p._count.delegationsIn} delegated by you`}>
                    <div className="h-1.5 rounded-full bg-track">
                      <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, (load / 8) * 100)}%` }} />
                    </div>
                  </div>
                  <span className="w-28 text-right text-2xs text-muted-foreground tabular">
                    {load} open · {p._count.delegationsIn} from you
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>
        <Panel title="Recently completed" icon={CheckCircle2} count={completed.length}>
          {completed.length === 0 ? (
            <p className="px-4 py-4 text-xs text-muted-foreground">Nothing completed in the last 30 days.</p>
          ) : (
            <ul className="divide-y divide-hairline">
              {completed.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-4 py-2 text-[13px]">
                  <CheckCircle2 className="size-3.5 shrink-0 text-good" aria-hidden />
                  <TaskLink id={d.task.id} title={d.task.title} className="min-w-0 flex-1 truncate" />
                  <span className="shrink-0 text-2xs text-muted-foreground">
                    {d.delegate.name} · {formatDay(d.completedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
