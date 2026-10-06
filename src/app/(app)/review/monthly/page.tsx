import type { Metadata } from "next";
import { PageHeader } from "@/components/common/bits";
import {
  FundraisingPanel,
  GoalProgressPanel,
  ImpactfulDecisionsPanel,
  InsightPanel,
  MilestoneProgressPanel,
  NextMonthPanel,
  ProblemsPanel,
  RevenuePanel,
  riskMilestoneItems,
  StrategicWinsPanel,
  TimeAllocationPanel,
} from "@/components/review/monthly-sections";
import { ReflectionForm } from "@/components/review/reflection";
import { PeriodNav, ReviewStatus, StatStrip } from "@/components/review/review-bits";
import { dayKey, formatDay, formatMonth } from "@/lib/dates";
import { formatMetric, pluralize } from "@/lib/format";
import { getCeoContext } from "@/server/context";
import { getMonthlyReview, monthKey, resolveMonth } from "@/server/queries/reviews";

export const metadata: Metadata = { title: "Monthly CEO Review" };

function shiftMonth(start: Date, by: number): Date {
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + by, 1));
}

export default async function MonthlyReviewPage(props: { searchParams: Promise<{ month?: string }> }) {
  const sp = await props.searchParams;
  const ceo = await getCeoContext();
  const monthStart = resolveMonth(sp.month, ceo.today);
  const r = await getMonthlyReview(monthStart);
  const { period, stats, review } = r;

  const current = resolveMonth(undefined, ceo.today);
  const isCurrent = monthStart.getTime() === current.getTime();
  const prev = shiftMonth(monthStart, -1);
  const next = shiftMonth(monthStart, 1);
  const hasDraft = Object.values(review.reflection).some(Boolean);
  const monthName = formatMonth(monthStart);
  const nextMonthName = formatMonth(r.nextStart).split(" ")[0];
  const arr = stats.arr;
  const committed = stats.committed;
  const top5Judged = stats.top5.done + stats.top5.missed;

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <PageHeader
        className="pb-1"
        eyebrow="CEO review · monthly"
        title="Monthly CEO Review"
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium text-foreground">{monthName}</span>
            <ReviewStatus completedAt={review.completedAt} hasDraft={hasDraft} isCurrent={isCurrent} />
            {period.isCurrent && <span className="text-2xs">Month in progress — through {formatDay(ceo.today)}</span>}
          </span>
        }
        actions={
          <PeriodNav
            prevHref={`/review/monthly?month=${monthKey(prev)}`}
            nextHref={isCurrent ? null : `/review/monthly?month=${monthKey(next)}`}
            currentHref={isCurrent ? null : "/review/monthly"}
            prevLabel={`Previous month (${formatMonth(prev)})`}
            nextLabel={`Next month (${formatMonth(next)})`}
            currentLabel="This month"
          />
        }
      />

      <StatStrip
        stats={[
          {
            label: "Milestones achieved",
            value: (
              <>
                {stats.milestonesAchieved}
                {stats.milestonesMissed > 0 && <span className="text-sm font-medium text-muted-foreground"> · {stats.milestonesMissed} missed</span>}
              </>
            ),
            hint: r.milestones.completed[0]?.title ?? "None reached yet",
          },
          {
            label: "Goals moved forward",
            value: stats.goalsImproved,
            hint: `Average ${stats.avgGoalDelta >= 0 ? "+" : "−"}${Math.abs(stats.avgGoalDelta)} pts across ${pluralize(r.goals.filter((g) => g.status !== "PAUSED").length, "goal")}`,
          },
          {
            label: "ARR",
            value: arr ? formatMetric(arr.end, arr.unit) : "—",
            hint: arr && arr.change !== null ? `${arr.change >= 0 ? "+" : "−"}${formatMetric(Math.abs(arr.change), arr.unit)} from ${formatMetric(arr.start, arr.unit)}` : "No ARR recorded",
          },
          {
            label: "Series B committed",
            value: committed ? formatMetric(committed.end, committed.unit) : "—",
            meter: committed?.target && committed.end !== null ? (committed.end / committed.target) * 100 : undefined,
            hint: committed?.target ? `of ${formatMetric(committed.target, committed.unit)} target` : pluralize(stats.investorMeetings, "investor meeting"),
          },
          {
            label: "Top priorities completed",
            value: top5Judged ? `${stats.top5.rate}%` : "—",
            meter: stats.top5.rate,
            hint: `${top5Judged ? `${stats.top5.done}/${top5Judged} · ` : ""}${pluralize(stats.decisionsMade, "decision")} made`,
          },
          {
            label: "Time on strategic work",
            value: stats.strategicPct === null ? "—" : `${stats.strategicPct}%`,
            meter: stats.strategicPct,
            target: stats.targetStrategicPct,
            hint: `Recommended ${stats.targetStrategicPct}%`,
            title: "Share of tracked CEO time in strategic focus areas; the tick marks the recommended share",
          },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="min-w-0 space-y-4 xl:col-span-8">
          <GoalProgressPanel goals={r.goals} />
          <MilestoneProgressPanel milestones={r.milestones} today={ceo.today} nextLabel={`Due in ${nextMonthName}`} />
          <div className="grid gap-4 lg:grid-cols-2">
            <RevenuePanel revenue={r.revenue} />
            <FundraisingPanel f={r.fundraising} timezone={ceo.timezone} periodPast={period.isPast} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <StrategicWinsPanel wins={r.wins} />
            <ProblemsPanel problems={r.problems} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <InsightPanel id="opportunities" title="Biggest opportunities" kind="opportunity" insights={r.opportunities} empty="No opportunities surfaced this month" />
            <InsightPanel id="risks" title="Biggest risks ahead" kind="risk" insights={r.risks.insights} extra={riskMilestoneItems(r.risks.milestones, ceo.today)} empty="No open risks" />
          </div>
        </div>
        <div className="min-w-0 space-y-4 xl:col-span-4">
          <TimeAllocationPanel attention={r.attention} title={`CEO time · ${monthName.split(" ")[0]}`} />
          <ImpactfulDecisionsPanel decisions={r.decisions} timezone={ceo.timezone} />
          <NextMonthPanel next={r.nextMonth} today={ceo.today} label={formatMonth(r.nextStart)} />
          <ReflectionForm
            key={dayKey(monthStart)}
            type="MONTHLY"
            periodStart={dayKey(monthStart)}
            initial={review.reflection}
            completedAt={review.completedAt}
            snapshot={review.snapshot}
            canComplete
          />
        </div>
      </div>
    </div>
  );
}
