"use client";

import { Check, ExternalLink, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/common/bits";
import { ViewSourceButton } from "@/components/intelligence/view-source";
import { SimpleSelect } from "@/components/common/fields";
import { TONE_TEXT } from "@/components/common/status";
import { useAction } from "@/components/common/use-action";
import { useUI } from "@/components/shell/ui-context";
import type { InsightStatus, InsightType } from "@/generated/prisma/enums";
import { formatDateTime } from "@/lib/dates";
import { INSIGHT_TYPES } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { setInsightStatus } from "@/server/actions/brain";
import type { FeedInsight } from "@/server/queries/brain";

export function InsightFeed({ insights, timezone }: { insights: FeedInsight[]; timezone: string }) {
  const params = useSearchParams();
  const focus = params.get("insight");
  const [type, setType] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>("ACTIVE");
  const [ceoOnly, setCeoOnly] = useState(false);

  const visible = useMemo(
    () =>
      insights.filter(
        (i) =>
          (!type || i.type === type) &&
          (!status || (status === "ACTIVE" ? i.status === "NEW" || i.status === "ACKNOWLEDGED" : i.status === status)) &&
          (!ceoOnly || i.requiresCeo),
      ),
    [insights, type, status, ceoOnly],
  );

  useEffect(() => {
    if (focus) document.getElementById(`insight-${focus}`)?.scrollIntoView({ block: "center" });
  }, [focus]);

  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline p-2.5">
        <div className="w-[180px]">
          <SimpleSelect size="sm" ariaLabel="Insight type" value={type} onChange={setType} allowNone noneLabel="All types" options={(Object.keys(INSIGHT_TYPES) as InsightType[]).map((t) => ({ value: t, label: INSIGHT_TYPES[t].label }))} />
        </div>
        <div className="w-[160px]">
          <SimpleSelect
            size="sm"
            ariaLabel="Insight status"
            value={status}
            onChange={setStatus}
            allowNone
            noneLabel="Any status"
            options={[
              { value: "ACTIVE", label: "Active" },
              { value: "NEW", label: "New" },
              { value: "ACTIONED", label: "Actioned" },
              { value: "DISMISSED", label: "Dismissed" },
            ]}
          />
        </div>
        <Button variant={ceoOnly ? "secondary" : "ghost"} size="sm" aria-pressed={ceoOnly} onClick={() => setCeoOnly((v) => !v)}>
          Requires CEO
        </Button>
        <span className="ml-auto text-2xs text-muted-foreground tabular">{visible.length} insights · last 30 days</span>
      </div>
      {visible.length === 0 ? (
        <EmptyState title="No insights match" description="CytoHub Brain records insights on every refresh." />
      ) : (
        <ul className="divide-y divide-hairline">
          {visible.map((i) => (
            <InsightRow key={i.id} insight={i} timezone={timezone} focused={focus === i.id} />
          ))}
        </ul>
      )}
    </div>
  );
}

function InsightRow({ insight: i, timezone, focused }: { insight: FeedInsight; timezone: string; focused: boolean }) {
  const meta = INSIGHT_TYPES[i.type];
  const { openEntity } = useUI();
  const { pending, run } = useAction();
  const set = (s: InsightStatus) => run(() => setInsightStatus(i.id, s), { success: s === "DISMISSED" ? "Dismissed" : "Marked as actioned" });
  const related: { label: string; onClick?: () => void; href?: string }[] = [
    i.decision && { label: i.decision.title, href: `/decisions/${i.decision.id}` },
    i.task && { label: i.task.title, onClick: () => openEntity("task", i.task!.id) },
    i.milestone && { label: i.milestone.title, onClick: () => openEntity("milestone", i.milestone!.id) },
    i.goal && { label: i.goal.title, href: `/goals/${i.goal.id}` },
    i.company && { label: i.company.name, href: `/resources/companies/${i.company.id}` },
    i.person && { label: i.person.name, href: `/resources/people/${i.person.id}` },
  ].filter(Boolean) as { label: string; onClick?: () => void; href?: string }[];

  return (
    <li id={`insight-${i.id}`} className={cn("group flex gap-3 px-4 py-3", focused && "bg-brand-soft/50", (i.status === "DISMISSED" || i.status === "ACTIONED") && "opacity-60")}>
      <meta.icon className={cn("mt-0.5 size-4 shrink-0", TONE_TEXT[meta.tone])} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[14px] font-medium text-foreground">{i.title}</span>
          {i.status === "NEW" && <span className="rounded bg-brand-soft px-1 text-2xs font-medium text-brand">New</span>}
          {i.requiresCeo && <span className="rounded bg-serious-soft px-1 text-2xs font-medium text-serious-ink">Needs CEO</span>}
        </div>
        {i.summary && <p className="mt-0.5 text-xs text-ink-2">{i.summary}</p>}
        {i.recommendation && <p className="mt-1 text-xs text-brain">→ {i.recommendation}</p>}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
          <span>{meta.label}</span>
          <span>Importance {i.importance}/5</span>
          {i.sourceItemId ? (
            <ViewSourceButton targetType="INSIGHT" targetId={i.id} label="From source" className="-my-1 h-5 px-1 text-2xs" />
          ) : (
            <span>{i.signal ? `From ${i.signal.source.name}` : "Workspace analysis"}</span>
          )}
          <span>{formatDateTime(i.createdAt, timezone)}</span>
          {related.slice(0, 3).map((r) =>
            r.href ? (
              <Link key={r.label} href={r.href} className="inline-flex max-w-[220px] items-center gap-1 truncate text-ink-2 hover:underline">
                <ExternalLink className="size-3 shrink-0" aria-hidden /> {r.label}
              </Link>
            ) : (
              <button key={r.label} type="button" onClick={r.onClick} className="inline-flex max-w-[220px] items-center gap-1 truncate text-ink-2 hover:underline">
                <ExternalLink className="size-3 shrink-0" aria-hidden /> {r.label}
              </button>
            ),
          )}
        </div>
      </div>
      {(i.status === "NEW" || i.status === "ACKNOWLEDGED") && (
        <div className="flex shrink-0 items-start gap-0.5 sm:opacity-60 sm:group-hover:opacity-100">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" disabled={pending} onClick={() => set("ACTIONED")} aria-label="Mark actioned">
                <Check />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Mark actioned</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" disabled={pending} onClick={() => set("DISMISSED")} aria-label="Dismiss">
                <X />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Dismiss — not relevant</TooltipContent>
          </Tooltip>
        </div>
      )}
    </li>
  );
}
