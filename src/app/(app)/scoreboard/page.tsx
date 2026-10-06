import { BarChart3 } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/common/bits";
import { PipelineComposition } from "@/components/scoreboard/pipeline-table";
import { HeadlineStrip, MetricBoard, SourcesNote } from "@/components/scoreboard/scoreboard-sections";
import { formatDayFull } from "@/lib/dates";
import { getScoreboardData } from "@/server/queries/scoreboard";
import { requirePage } from "@/server/security/session";

export const metadata: Metadata = { title: "Scoreboard" };

/** Metric keys shown in the headline strip, in order. Missing keys are skipped. */
const HEADLINE_KEYS = ["arr", "pipeline_weighted", "round_committed", "runway", "donor_hearts"];

export default async function ScoreboardPage() {
  await requirePage("workspace.view", "/scoreboard");
  const data = await getScoreboardData();
  const { metrics, today } = data;
  const headline = HEADLINE_KEYS.map((k) => metrics.find((m) => m.key === k)).filter((m): m is NonNullable<typeof m> => Boolean(m));
  const derivedCount = metrics.filter((m) => m.derived).length;
  const manualCount = metrics.filter((m) => m.source.kind === "manual").length;
  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <PageHeader
        title="Company scoreboard"
        description={
          metrics.length
            ? `${metrics.length} metrics across revenue, science, product and team — each with its trend, target and source. As of ${formatDayFull(today)}.`
            : "The numbers that tell you whether CytoHub is winning."
        }
        className="pb-1"
      />

      {metrics.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={BarChart3}
            title="No metrics defined yet"
            description="Metrics appear here once they're defined — manually, from a connected system such as finance or CRM, or derived live from deals and cash."
          />
        </div>
      ) : (
        <>
          <SourcesNote sources={data.sources} derivedCount={derivedCount} manualCount={manualCount} />
          <HeadlineStrip metrics={headline} today={today} />
          <MetricBoard metrics={metrics} today={today} />
          <PipelineComposition deals={data.deals} today={today} />
        </>
      )}
    </div>
  );
}
