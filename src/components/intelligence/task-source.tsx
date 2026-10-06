"use client";

import { useEffect, useState } from "react";
import type { Confidence } from "@/generated/prisma/enums";
import { timeAgo } from "@/lib/dates";
import { fetchProvenance } from "@/server/actions/provenance";
import type { Provenance } from "@/server/queries/provenance";
import { ConfidenceBadge, Excerpt, HiddenSourcesNote, providerLabel, SourceKindIcon } from "./badges";
import { ViewSourceButton } from "./view-source";

/** "Source" section for the task sheet: where an extracted task came from, with the extraction confidence. */
export function TaskSourceSection({ taskId, confidence, updatedAt }: { taskId: string; confidence: Confidence | null; updatedAt?: Date }) {
  const [state, setState] = useState<{ id: string; data: Provenance | null } | null>(null);
  const stamp = updatedAt ? new Date(updatedAt).getTime() : 0;

  useEffect(() => {
    let cancelled = false;
    fetchProvenance("TASK", taskId)
      .then((data) => !cancelled && setState({ id: taskId, data }))
      .catch(() => !cancelled && setState({ id: taskId, data: null }));
    return () => {
      cancelled = true;
    };
  }, [taskId, stamp]);

  const data = state?.id === taskId ? state.data : null;
  if (!data || (data.refs.length === 0 && data.hidden === 0)) return null;
  const first = data.refs[0];
  return (
    <section aria-labelledby={`task-source-${taskId}`}>
      <div className="mb-2 flex items-center gap-2">
        <h3 id={`task-source-${taskId}`} className="eyebrow">
          Source
        </h3>
        {confidence && <ConfidenceBadge level={confidence} score={first?.confidence} />}
        <ViewSourceButton targetType="TASK" targetId={taskId} count={data.refs.length} hidden={data.hidden} label="View source" className="ml-auto" />
      </div>
      {first ? (
        <div className="rounded-lg border border-border p-3">
          <p className="flex items-center gap-1.5 text-2xs text-muted-foreground">
            <SourceKindIcon kind={first.kind} className="size-3" />
            <span className="font-medium text-ink-2">{providerLabel(first.provider)}</span>
            {first.author && <span className="truncate">· {first.author}</span>}
            <span className="shrink-0">· {timeAgo(new Date(first.occurredAt))}</span>
          </p>
          <p className="mt-1 truncate text-xs text-ink-2">{first.title}</p>
          {first.excerpt && <Excerpt className="mt-2">“{first.excerpt}”</Excerpt>}
          {data.refs.length > 1 && <p className="mt-2 text-2xs text-muted-foreground">+{data.refs.length - 1} more source{data.refs.length > 2 ? "s" : ""}</p>}
        </div>
      ) : null}
      <HiddenSourcesNote count={data.hidden} className="mt-1.5" />
    </section>
  );
}
