import { CalendarRange, Columns3, GanttChart, Plus, Target } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/common/bits";
import { CreateButton } from "@/components/common/create-button";
import { MilestoneViews, type MilestoneView } from "@/components/milestones/milestone-views";
import { addDays } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { getCeoContext } from "@/server/context";
import { getMilestones, type MilestoneRow } from "@/server/queries/milestones";
import { requirePage } from "@/server/security/session";

export const metadata: Metadata = { title: "Milestones" };

const VIEWS: { key: MilestoneView; label: string; icon: typeof GanttChart }[] = [
  { key: "timeline", label: "Timeline", icon: GanttChart },
  { key: "quarter", label: "Quarter", icon: CalendarRange },
  { key: "goal", label: "By goal", icon: Target },
  { key: "status", label: "By status", icon: Columns3 },
];

type Highlight = "dueSoon" | "atRisk" | "overdue" | "blocked" | "completed";

const HIGHLIGHTS: { key: Highlight; label: string; className: string; test: (m: MilestoneRow, today: Date) => boolean }[] = [
  { key: "overdue", label: "Overdue", className: "text-critical-ink", test: (m, t) => !["COMPLETED", "MISSED"].includes(m.status) && m.dueDate < t },
  { key: "blocked", label: "Blocked", className: "text-critical-ink", test: (m) => m.status === "BLOCKED" },
  { key: "atRisk", label: "At risk", className: "text-warning-ink", test: (m) => m.status === "AT_RISK" },
  { key: "dueSoon", label: "Due in 14 days", className: "text-serious-ink", test: (m, t) => !["COMPLETED", "MISSED"].includes(m.status) && m.dueDate >= t && m.dueDate <= addDays(t, 14) },
  { key: "completed", label: "Completed", className: "text-good-ink", test: (m) => m.status === "COMPLETED" },
];

export default async function MilestonesPage(props: { searchParams: Promise<{ view?: string; filter?: string }> }) {
  await requirePage("workspace.view", "/milestones");
  const sp = await props.searchParams;
  const view = (VIEWS.find((v) => v.key === sp.view)?.key ?? "timeline") as MilestoneView;
  const filter = HIGHLIGHTS.find((h) => h.key === sp.filter);
  const [milestones, ceo] = await Promise.all([getMilestones(), getCeoContext()]);
  const visible = filter ? milestones.filter((m) => filter.test(m, ceo.today)) : milestones;
  const qs = (patch: { view?: string; filter?: string | null }) => {
    const p = new URLSearchParams();
    const v = patch.view ?? view;
    const f = patch.filter === undefined ? sp.filter : patch.filter;
    if (v !== "timeline") p.set("view", v);
    if (f) p.set("filter", f);
    const s = p.toString();
    return s ? `/milestones?${s}` : "/milestones";
  };

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <PageHeader
        title="Milestones"
        description="Dated, verifiable checkpoints — ARR targets, pharma contracts, the raise, model releases, scientific and regulatory proof points."
        actions={<CreateButton kind="milestone" label="New milestone" icon={<Plus />} />}
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" role="group" aria-label="Highlights">
        {HIGHLIGHTS.map((h) => {
          const count = milestones.filter((m) => h.test(m, ceo.today)).length;
          const active = filter?.key === h.key;
          return (
            <Link
              key={h.key}
              href={qs({ filter: active ? null : h.key })}
              aria-pressed={active}
              className={cn("panel flex items-baseline justify-between gap-2 px-3 py-2.5 transition-colors hover:bg-muted/40", active && "border-foreground ring-1 ring-foreground")}
            >
              <span className="text-xs text-ink-2">{h.label}</span>
              <span className={cn("text-xl font-semibold tabular", count > 0 ? h.className : "text-muted-foreground")}>{count}</span>
            </Link>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="Milestone views" className="flex gap-1">
          {VIEWS.map((v) => (
            <Link
              key={v.key}
              href={qs({ view: v.key })}
              aria-current={v.key === view ? "page" : undefined}
              className={cn("inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium", v.key === view ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
            >
              <v.icon className="size-3.5" aria-hidden /> {v.label}
            </Link>
          ))}
        </nav>
        {filter && (
          <Link href={qs({ filter: null })} className="text-xs text-muted-foreground hover:text-foreground">
            Showing {filter.label.toLowerCase()} · clear
          </Link>
        )}
      </div>

      <MilestoneViews view={view} milestones={visible} today={ceo.today} />
    </div>
  );
}
