import { CalendarClock, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Panel } from "@/components/common/bits";
import { MeetingLink } from "@/components/tasks/task-link";
import { UpcomingTimeline } from "@/components/upcoming/upcoming-timeline";
import { cn } from "@/lib/utils";
import { addDays, formatDateTime } from "@/lib/dates";
import { getCeoContext } from "@/server/context";
import { getUpcomingEvents } from "@/server/queries/today";
import { requirePage } from "@/server/security/session";

export const metadata: Metadata = { title: "Upcoming" };

const HORIZONS = [
  { key: "24h", label: "Next 24 hours", days: 1 },
  { key: "7d", label: "Next 7 days", days: 7 },
  { key: "30d", label: "Next 30 days", days: 30 },
  { key: "90d", label: "Next 90 days", days: 90 },
] as const;

export default async function UpcomingPage(props: { searchParams: Promise<{ h?: string }> }) {
  await requirePage("workspace.view", "/upcoming");
  const sp = await props.searchParams;
  const horizon = HORIZONS.find((h) => h.key === sp.h) ?? HORIZONS[1];
  const ceo = await getCeoContext();
  const events = await getUpcomingEvents({ from: ceo.now, to: addDays(ceo.today, horizon.days), today: ceo.today, timezone: ceo.timezone, ceoPersonId: ceo.personId });
  const major = events.filter((e) => e.kind === "meeting" && e.prepareable).slice(0, 8);
  const counts = {
    meetings: events.filter((e) => e.kind === "meeting").length,
    milestones: events.filter((e) => e.kind === "milestone").length,
    decisions: events.filter((e) => e.kind === "decision").length,
    deadlines: events.filter((e) => e.kind === "task").length,
  };

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <PageHeader title="Upcoming" description="Meetings, deadlines, milestones, decisions, investor and customer commitments — with a Prepare Me brief for every major event." />

      <nav aria-label="Horizon" className="flex flex-wrap gap-1">
        {HORIZONS.map((h) => (
          <Link
            key={h.key}
            href={h.key === "7d" ? "/upcoming" : `/upcoming?h=${h.key}`}
            aria-current={h.key === horizon.key ? "page" : undefined}
            className={cn("inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium", h.key === horizon.key ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
          >
            {h.label}
          </Link>
        ))}
      </nav>

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="min-w-0 xl:col-span-8">
          <UpcomingTimeline events={events} today={ceo.today} timezone={ceo.timezone} groupByWeek={horizon.days >= 30} />
        </div>
        <aside className="min-w-0 space-y-4 xl:col-span-4">
          <div className="grid grid-cols-2 gap-2">
            {[
              ["Meetings", counts.meetings],
              ["Milestones due", counts.milestones],
              ["Decision deadlines", counts.decisions],
              ["Priority deadlines", counts.deadlines],
            ].map(([l, v]) => (
              <div key={l as string} className="panel px-3 py-2.5">
                <div className="text-2xs text-muted-foreground">{l}</div>
                <div className="text-lg font-semibold tabular">{v}</div>
              </div>
            ))}
          </div>
          <Panel title="Prepare for these" icon={Sparkles} count={major.length}>
            {major.length === 0 ? (
              <p className="px-4 py-4 text-xs text-muted-foreground">No major external meetings in this window.</p>
            ) : (
              <ul className="divide-y divide-hairline">
                {major.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                    <CalendarClock className="size-3.5 shrink-0 text-ink-3" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <MeetingLink id={m.id} title={m.title} className="block w-full truncate text-[13px] font-medium" />
                      <span className="text-2xs text-muted-foreground">{formatDateTime(m.at, ceo.timezone)}</span>
                    </div>
                    <span className={cn("shrink-0 text-2xs font-medium", m.prepared ? "text-good-ink" : "text-serious-ink")}>{m.prepared ? "Brief ready" : "Not prepared"}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="border-t border-hairline px-4 py-2 text-2xs text-muted-foreground">
              Prepare Me gathers context, history, participants, open issues, talking points, questions, risks and next actions from CytoHub Brain.
            </p>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
