import { Inbox, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { BrainStrip, EndOfDayButton, Greeting, RefreshButton } from "@/components/today/today-header";
import { DailyRhythm, type RhythmStep } from "@/components/today/daily-rhythm";
import { SetupChecklist } from "@/components/today/setup-checklist";
import { CommitmentsPanel } from "@/components/today/commitments-panel";
import { AtRiskPanel, AttentionPanel, DecisionsPanel, GoalsPanel } from "@/components/today/panels";
import { SinceYesterday } from "@/components/today/since-yesterday";
import { TopFive } from "@/components/today/top-five";
import { UpcomingPanel } from "@/components/today/upcoming-panel";
import { INBOX_TYPES } from "@/lib/domain";
import { formatDayFull, formatTime } from "@/lib/dates";
import { getCockpitCommitments } from "@/server/queries/commitments";
import { getSetupProgress } from "@/server/queries/setup";
import { getTodayData } from "@/server/queries/today";
import { requirePage } from "@/server/security/session";

export const metadata: Metadata = { title: "Today" };

export default async function TodayPage() {
  await requirePage("cockpit.view", "/");
  const [d, commitments, setup] = await Promise.all([getTodayData(), getCockpitCommitments(), getSetupProgress()]);
  const showSetup = !setup.complete && !setup.dismissed;
  // A brand-new workspace has nothing to report yet: the checklist leads instead of a row of zeros.
  const showBrain = Boolean(d.lastRefresh) || !showSetup;
  const { ceo, plan, brief } = d;
  const priorities = plan?.priorities ?? [];
  const done = priorities.filter((p) => p.task.status === "DONE").length;
  const refreshedToday = Boolean(brief?.isToday);

  const steps: RhythmStep[] = [
    {
      label: "Brain refresh",
      detail: refreshedToday && d.lastRefresh ? `Ran ${formatTime(d.lastRefresh.startedAt, ceo.timezone)}` : "Not yet today",
      state: refreshedToday ? "done" : "current",
    },
    {
      label: "Review changes",
      detail: brief?.reviewedAt ? "Brief reviewed" : `${brief?.payload.stats.newInsights ?? 0} new insights`,
      state: brief?.reviewedAt ? "done" : refreshedToday ? "current" : "upcoming",
    },
    {
      label: "Confirm Top 5",
      detail: plan?.top5ConfirmedAt ? "Locked in" : "Review recommendations",
      state: plan?.top5ConfirmedAt ? "done" : brief?.reviewedAt ? "current" : "upcoming",
    },
    {
      label: "Execute",
      detail: `${done}/${priorities.length} priorities done`,
      state: priorities.length > 0 && done === priorities.length ? "done" : plan?.top5ConfirmedAt ? "current" : "upcoming",
    },
    {
      label: "End-of-day review",
      detail: plan?.endOfDayAt ? "Day closed" : "Reflect & roll over",
      state: plan?.endOfDayAt ? "done" : priorities.length > 0 && done === priorities.length ? "current" : "upcoming",
    },
  ];

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Greeting name={ceo.firstName} timezone={ceo.timezone} dateLabel={formatDayFull(ceo.today)} />
        <div className="flex items-center gap-2">
          <RefreshButton refreshedToday={refreshedToday} quiet={showSetup} />
          <EndOfDayButton
            done={Boolean(plan?.endOfDayAt)}
            notes={plan?.endOfDayNotes ?? null}
            tasks={priorities.map((p) => ({ id: p.taskId, title: p.task.title, done: p.task.status === "DONE" }))}
          />
        </div>
      </div>

      {showSetup && <SetupChecklist progress={setup} />}

      {showBrain && (
        <section className="panel overflow-hidden" aria-label="CytoHub Brain and today’s rhythm">
          <BrainStrip
            embedded
            lastRefreshAt={d.lastRefresh?.completedAt ?? d.lastRefresh?.startedAt ?? null}
            status={d.lastRefresh?.status ?? null}
            timezone={ceo.timezone}
            newInsights={brief?.payload.stats.newInsights ?? 0}
            needsYou={d.inbox.count}
            sources={d.sources}
            headline={brief?.headline ?? null}
            narrativeEngine={brief?.payload.narrativeEngine}
          />
          <DailyRhythm steps={steps} embedded />
        </section>
      )}

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="min-w-0 space-y-4 xl:col-span-8">
          <TopFive items={priorities} confirmedAt={plan?.top5ConfirmedAt ?? null} today={ceo.today} />
          {brief && (
            <SinceYesterday
              headline={brief.headline}
              summary={brief.summary}
              payload={brief.payload}
              reviewedAt={brief.reviewedAt}
              isToday={brief.isToday}
              date={brief.date}
            />
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <AtRiskPanel atRisk={d.atRisk} today={ceo.today} />
            <GoalsPanel goals={d.goals} />
          </div>
        </div>

        <div className="min-w-0 space-y-4 xl:col-span-4">
          <InboxNudge count={d.inbox.count} top={d.inbox.top} delegation={d.delegation} />
          <DecisionsPanel decisions={d.decisions} today={ceo.today} />
          <CommitmentsPanel data={commitments} />
          <UpcomingPanel events={d.upcoming} today={ceo.today} timezone={ceo.timezone} />
          <AttentionPanel attention={d.attention} />
        </div>
      </div>
    </div>
  );
}

function InboxNudge({ count, top, delegation }: { count: number; top: { id: string; title: string; type: keyof typeof INBOX_TYPES; urgency: number }[]; delegation: { recommendations: number; followUps: number } }) {
  return (
    <div className="panel divide-y divide-hairline">
      <Link href="/inbox" className="flex items-center gap-3 px-3.5 py-3 hover:bg-muted/50">
        <div className="flex size-8 items-center justify-center rounded-lg bg-serious-soft">
          <Inbox className="size-4 text-serious-ink" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold">
            {count} item{count === 1 ? "" : "s"} need your attention
          </div>
          <div className="truncate text-2xs text-muted-foreground">{top.map((t) => INBOX_TYPES[t.type].label).slice(0, 3).join(" · ") || "Inbox zero"}</div>
        </div>
        <span className="text-2xs font-medium text-brand">Open inbox →</span>
      </Link>
      {(delegation.recommendations > 0 || delegation.followUps > 0) && (
        <Link href="/delegation" className="flex items-center gap-3 px-3.5 py-2.5 hover:bg-muted/50">
          <Users className="size-4 text-brain" aria-hidden />
          <span className="flex-1 text-xs text-ink-2">
            {delegation.recommendations > 0 && (
              <>
                <span className="font-medium text-foreground">{delegation.recommendations}</span> task{delegation.recommendations === 1 ? "" : "s"} you could delegate
              </>
            )}
            {delegation.recommendations > 0 && delegation.followUps > 0 && " · "}
            {delegation.followUps > 0 && (
              <>
                <span className="font-medium text-foreground">{delegation.followUps}</span> delegation{delegation.followUps === 1 ? "" : "s"} need follow-up
              </>
            )}
          </span>
        </Link>
      )}
    </div>
  );
}
