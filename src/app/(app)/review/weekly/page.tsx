import type { Metadata } from "next";
import { PageHeader } from "@/components/common/bits";
import { ReflectionForm } from "@/components/review/reflection";
import { PeriodNav, ReviewStatus, StatStrip } from "@/components/review/review-bits";
import {
  BottlenecksPanel,
  DecisionsReviewPanel,
  DelegationPanel,
  MissesPanel,
  NextWeekPanel,
  StrategicProgressPanel,
  WinsPanel,
} from "@/components/review/weekly-sections";
import { addDays, dayKey, formatDay } from "@/lib/dates";
import { pluralize } from "@/lib/format";
import { getCeoContext } from "@/server/context";
import { getWeeklyReview, resolveWeek, weekLabel } from "@/server/queries/reviews";
import { requirePage } from "@/server/security/session";

export const metadata: Metadata = { title: "Weekly CEO Review" };

export default async function WeeklyReviewPage(props: { searchParams: Promise<{ week?: string }> }) {
  await requirePage("cockpit.view", "/review/weekly");
  const sp = await props.searchParams;
  const ceo = await getCeoContext();
  const weekStart = resolveWeek(sp.week, ceo.today);
  const r = await getWeeklyReview(weekStart);
  const { period, stats, review } = r;

  const currentWeek = resolveWeek(undefined, ceo.today);
  const prev = addDays(weekStart, -7);
  const next = addDays(weekStart, 7);
  const isCurrent = weekStart.getTime() === currentWeek.getTime();
  const hasDraft = Object.values(review.reflection).some(Boolean);
  const top5 = stats.top5;
  const judged = top5.done + top5.missed;

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <PageHeader
        className="pb-1"
        eyebrow="CEO review · weekly"
        title="Weekly CEO Review"
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium text-foreground">{weekLabel(weekStart, ceo.today)}</span>
            <ReviewStatus completedAt={review.completedAt} hasDraft={hasDraft} isCurrent={isCurrent} />
            {period.isCurrent && <span className="text-2xs">Week in progress — through {formatDay(ceo.today)}</span>}
          </span>
        }
        actions={
          <PeriodNav
            prevHref={`/review/weekly?week=${dayKey(prev)}`}
            nextHref={isCurrent ? null : `/review/weekly?week=${dayKey(next)}`}
            currentHref={isCurrent ? null : "/review/weekly"}
            prevLabel={`Previous week (${formatDay(prev)})`}
            nextLabel={`Next week (${formatDay(next)})`}
            currentLabel="This week"
          />
        }
      />

      <StatStrip
        stats={[
          {
            label: "Top priorities completed",
            value: judged ? (
              <>
                {top5.done}/{judged} <span className="text-sm font-medium text-muted-foreground">· {top5.rate}%</span>
              </>
            ) : (
              "—"
            ),
            meter: top5.rate,
            hint: top5.pending ? `${top5.pending} still in play` : top5.days.length ? `Across ${pluralize(top5.days.length, "planned day")}` : "No Top 5 planned",
            title: "Daily Top 5 priorities completed by the end of the following day",
          },
          {
            label: "High-impact tasks completed",
            value: stats.highImpactDone,
            hint: `of ${pluralize(stats.completedCount, "completed task")}`,
            title: "Strategic impact ≥ 4/5 or CEO Priority Score ≥ 60",
          },
          { label: "Decisions made", value: stats.decisionsMade, hint: `${r.decisions.pending.length} still open` },
          { label: "Milestones achieved", value: stats.milestonesAchieved, hint: r.wins.milestones[0]?.title ?? "None this week" },
          {
            label: "Time on strategic work",
            value: stats.strategicPct === null ? "—" : `${stats.strategicPct}%`,
            meter: stats.strategicPct,
            target: stats.targetStrategicPct,
            hint: stats.strategicPct === null ? "No time tracked yet" : `Recommended ${stats.targetStrategicPct}%`,
            title: "Share of tracked CEO time in strategic focus areas; the tick marks the recommended share",
          },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="min-w-0 space-y-4 xl:col-span-8">
          <div className="grid gap-4 lg:grid-cols-2">
            <WinsPanel wins={r.wins} />
            <MissesPanel misses={r.misses} />
          </div>
          <StrategicProgressPanel goals={r.progress} />
          <div className="grid gap-4 lg:grid-cols-2">
            <BottlenecksPanel b={r.bottlenecks} today={ceo.today} live={period.isPast} />
            <DecisionsReviewPanel decisions={r.decisions} />
          </div>
          <DelegationPanel delegation={r.delegation} today={ceo.today} />
        </div>
        <div className="min-w-0 space-y-4 xl:col-span-4">
          <NextWeekPanel tasks={r.nextWeek} today={ceo.today} weekLabel={`Week of ${formatDay(r.nextWeekStart)} – ${formatDay(r.nextWeekEnd)}`} basedOnToday={period.isPast} />
          <ReflectionForm
            key={dayKey(weekStart)}
            type="WEEKLY"
            periodStart={dayKey(weekStart)}
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
