import { CheckCircle2, ClipboardCheck, History } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/common/bits";
import { Kbd } from "@/components/common/status";
import { ReviewHistory } from "@/components/intelligence/review/review-history";
import { ReviewQueue } from "@/components/intelligence/review/review-queue";
import { TabLink, UrlSelect } from "@/components/intelligence/url-filters";
import { ReviewKind } from "@/generated/prisma/enums";
import { REVIEW_KINDS } from "@/lib/intelligence";
import { getReviewQueue, type ReviewTab } from "@/server/queries/review";
import { requirePage } from "@/server/security/session";

export const metadata: Metadata = { title: "Review Queue" };

const IMPACT_OPTIONS = [
  { value: "5", label: "Impact 5 only" },
  { value: "4", label: "Impact 4+" },
  { value: "3", label: "Impact 3+" },
];

export default async function ReviewQueuePage(props: { searchParams: Promise<{ tab?: string; kind?: string; impact?: string }> }) {
  const viewer = await requirePage("review.resolve", "/brain/review");
  const sp = await props.searchParams;
  const tab: ReviewTab = sp.tab === "resolved" ? "resolved" : "pending";
  const kind = sp.kind && sp.kind in ReviewKind ? (sp.kind as ReviewKind) : null;
  const impact = sp.impact && /^[1-5]$/.test(sp.impact) ? Number(sp.impact) : null;
  const data = await getReviewQueue(viewer, { tab, kind, minImpact: impact });
  const kindOptions = (Object.keys(REVIEW_KINDS) as ReviewKind[])
    .filter((k) => tab === "resolved" || data.kindCounts[k] || k === kind)
    .map((k) => ({ value: k, label: `${REVIEW_KINDS[k].label}${tab === "pending" && data.kindCounts[k] ? ` · ${data.kindCounts[k]}` : ""}` }));
  const filtered = Boolean(kind || impact);

  return (
    <div className="mx-auto max-w-[1100px] space-y-4">
      <PageHeader
        eyebrow="CytoHub Brain"
        title="Review Queue"
        description={
          <>
            Uncertain or high-impact conclusions wait here before they become company truth. Approve, edit, reject, merge or ignore — approval runs the same writer as automatic creation.
            <span className="mt-1.5 hidden items-center gap-1.5 text-2xs sm:flex">
              <Kbd>J</Kbd>
              <Kbd>K</Kbd> move · <Kbd>A</Kbd> approve · <Kbd>R</Kbd> reject · <Kbd>E</Kbd> edit
            </span>
          </>
        }
      />
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-border">
        <nav aria-label="Review status" className="flex gap-1">
          <TabLink href="/brain/review" active={tab === "pending"} count={data.pendingCount}>
            <ClipboardCheck className="size-3.5" aria-hidden /> Pending
          </TabLink>
          <TabLink href="/brain/review?tab=resolved" active={tab === "resolved"} count={data.resolvedCount}>
            <History className="size-3.5" aria-hidden /> Resolved
          </TabLink>
        </nav>
        <div className="flex flex-wrap items-center gap-2 pb-1.5">
          <Suspense>
            <UrlSelect param="kind" options={kindOptions} allLabel="All kinds" ariaLabel="Filter by kind" className="w-[200px]" />
            <UrlSelect param="impact" options={IMPACT_OPTIONS} allLabel="Any impact" ariaLabel="Filter by impact" className="w-[140px]" />
          </Suspense>
        </div>
      </div>

      {tab === "pending" ? (
        data.items.length === 0 && filtered ? (
          <p className="panel flex items-center gap-2 px-4 py-6 text-[14px] text-muted-foreground">
            <CheckCircle2 className="size-4 text-good" aria-hidden /> Nothing pending matches these filters.
          </p>
        ) : (
          <ReviewQueue key={`${kind}-${impact}`} items={data.items} names={data.personNames} />
        )
      ) : (
        <ReviewHistory items={data.items} timezone={data.timezone} />
      )}
    </div>
  );
}
