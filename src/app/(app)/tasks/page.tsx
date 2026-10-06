import { History, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/common/bits";
import { CreateButton } from "@/components/common/create-button";
import { TaskTable } from "@/components/tasks/task-table";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getTaskView, getTaskViewCounts, TASK_VIEWS, type TaskView } from "@/server/queries/tasks";

export const metadata: Metadata = { title: "Tasks" };

const LABELS: Record<TaskView, string> = {
  today: "Today",
  upcoming: "Upcoming",
  overdue: "Overdue",
  waiting: "Waiting & blocked",
  delegated: "Delegated",
  someday: "Someday",
  completed: "Completed",
  all: "All open",
};

export default async function TasksPage(props: { searchParams: Promise<{ view?: string; scope?: string }> }) {
  const sp = await props.searchParams;
  const view: TaskView = (TASK_VIEWS as readonly string[]).includes(sp.view ?? "") ? (sp.view as TaskView) : "today";
  const scope = sp.scope === "everyone" ? "everyone" : "mine";
  const [{ tasks, top5, today }, counts] = await Promise.all([getTaskView(view, scope), getTaskViewCounts()]);

  const href = (v: TaskView, s = scope) => `/tasks?view=${v}${s === "everyone" ? "&scope=everyone" : ""}`;

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <PageHeader
        title="Tasks"
        description="Every commitment, ranked by the CEO Priority Score — impact and CEO-uniqueness first, not just deadlines."
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href="/tasks/history">
                <History /> Task history
              </Link>
            </Button>
            <CreateButton kind="task" label="New task" icon={<Plus />} />
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Task views" className="flex flex-wrap gap-1">
          {TASK_VIEWS.map((v) => {
            const count = v === "all" ? undefined : counts[v as Exclude<TaskView, "all">];
            const active = v === view;
            return (
              <Link
                key={v}
                href={href(v)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
                  active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {LABELS[v]}
                {count !== undefined && count > 0 && (
                  <span className={cn("tabular", active ? "text-background/70" : v === "overdue" ? "text-critical-ink" : "text-muted-foreground")}>{count}</span>
                )}
              </Link>
            );
          })}
        </nav>
        {view !== "delegated" && (
          <div className="flex rounded-md border border-border p-0.5 text-xs" role="group" aria-label="Scope">
            <Link href={href(view, "mine")} aria-current={scope === "mine" ? "true" : undefined} className={cn("rounded px-2 py-0.5", scope === "mine" ? "bg-muted font-medium text-foreground" : "text-muted-foreground")}>
              Mine
            </Link>
            <Link href={href(view, "everyone")} aria-current={scope === "everyone" ? "true" : undefined} className={cn("rounded px-2 py-0.5", scope === "everyone" ? "bg-muted font-medium text-foreground" : "text-muted-foreground")}>
              Everyone
            </Link>
          </div>
        )}
      </div>

      <TaskTable key={`${view}-${scope}`} tasks={tasks} today={today} top5={top5} view={view} defaultSort={view === "completed" ? "completed" : view === "upcoming" || view === "overdue" ? "due" : "score"} />
    </div>
  );
}
