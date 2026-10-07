"use client";

import { Check, CheckCircle2, Loader2, NotebookPen } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Panel } from "@/components/common/bits";
import { useAction } from "@/components/common/use-action";
import type { ReviewType } from "@/generated/prisma/enums";
import { formatDay } from "@/lib/dates";
import { completeReview, saveReflection } from "@/server/actions/reviews";
import type { ReflectionField, SnapshotSection } from "@/server/queries/reviews";

type Values = Record<ReflectionField, string>;

const PROMPTS: Record<ReviewType, { field: ReflectionField; label: string; placeholder: string }[]> = {
  WEEKLY: [
    { field: "whatWorked", label: "What worked?", placeholder: "Wins, decisions and habits worth repeating…" },
    { field: "whatDidnt", label: "What didn’t?", placeholder: "Where time or momentum leaked…" },
    { field: "learned", label: "What did I learn?", placeholder: "About the company, the market, the team, myself…" },
    { field: "changeNext", label: "What should change next week?", placeholder: "One or two concrete changes…" },
  ],
  MONTHLY: [
    { field: "whatWorked", label: "What worked?", placeholder: "What moved the company forward this month…" },
    { field: "whatDidnt", label: "What didn’t?", placeholder: "Misses, stalls and avoidable problems…" },
    { field: "learned", label: "What did I learn?", placeholder: "Patterns across the month…" },
    { field: "changeNext", label: "What should change next month?", placeholder: "Operating changes, priorities to protect, things to stop…" },
  ],
};

const SNAPSHOT_LABELS: [string, string][] = [
  ["wins", "wins"],
  ["milestonesCompleted", "milestones"],
  ["goals", "goals moved"],
  ["strategicProgress", "goals moved"],
  ["misses", "misses"],
  ["milestonesMissed", "missed"],
  ["problems", "problems"],
  ["decisionsMade", "decisions"],
  ["decisions", "decisions"],
  ["bottlenecks", "bottlenecks"],
  ["delegate", "to delegate"],
  ["risks", "risks"],
  ["opportunities", "opportunities"],
  ["nextWeek", "next-week priorities"],
  ["nextMonth", "next-month priorities"],
];

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; at: Date } | { kind: "error" };

export function ReflectionForm({
  type,
  periodStart,
  initial,
  completedAt,
  snapshot,
  canComplete,
}: {
  type: ReviewType;
  periodStart: string;
  initial: Record<ReflectionField, string | null>;
  completedAt: Date | null;
  snapshot: { generatedAt: string; sections: Record<string, SnapshotSection> } | null;
  canComplete: boolean;
}) {
  const toValues = (r: Record<ReflectionField, string | null>): Values => ({
    whatWorked: r.whatWorked ?? "",
    whatDidnt: r.whatDidnt ?? "",
    learned: r.learned ?? "",
    changeNext: r.changeNext ?? "",
  });
  const [values, setValues] = useState<Values>(() => toValues(initial));
  const saved = useRef<Values>(toValues(initial));
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const { pending, run } = useAction();
  const prompts = PROMPTS[type];
  const filled = prompts.filter((p) => values[p.field].trim()).length;

  async function save(field: ReflectionField) {
    const value = values[field];
    if (value === saved.current[field]) return;
    setState({ kind: "saving" });
    const res = await saveReflection({ type, periodStart, field, value: value.trim() ? value : null });
    if (res.ok) {
      saved.current = { ...saved.current, [field]: value };
      setState({ kind: "saved", at: new Date() });
    } else {
      setState({ kind: "error" });
      toast.error(res.error);
    }
  }

  const complete = () =>
    run(
      () =>
        completeReview({
          type,
          periodStart,
          reflection: Object.fromEntries(prompts.map((p) => [p.field, values[p.field].trim() ? values[p.field] : null])),
        }),
      { success: completedAt ? "Review snapshot updated" : undefined },
    ).then((res) => {
      if (res.ok) {
        saved.current = { ...values };
        setState({ kind: "idle" });
      }
    });

  // JSONB does not keep key order, so summarize sections in a fixed order.
  const sectionCounts = snapshot
    ? SNAPSHOT_LABELS.filter(([k]) => (snapshot.sections[k]?.count ?? 0) > 0)
        .slice(0, 5)
        .map(([k, label]) => `${label} ${snapshot.sections[k].count}`)
        .join(" · ")
    : null;

  return (
    <Panel
      id="reflection"
      title="CEO reflection"
      icon={NotebookPen}
      actions={
        <span className="px-1 text-2xs text-muted-foreground" aria-live="polite">
          {state.kind === "saving" ? "Saving…" : state.kind === "saved" ? "Saved" : state.kind === "error" ? "Not saved" : `${filled}/4 answered`}
        </span>
      }
    >
      <form
        className="grid gap-3 px-3.5 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          complete();
        }}
      >
        {prompts.map((p) => {
          const id = `reflection-${p.field}`;
          return (
            <div key={p.field} className="grid gap-1">
              <label htmlFor={id} className="text-xs font-medium text-ink-2">
                {p.label}
              </label>
              <Textarea
                id={id}
                rows={3}
                value={values[p.field]}
                placeholder={p.placeholder}
                maxLength={5000}
                onChange={(e) => setValues((v) => ({ ...v, [p.field]: e.target.value }))}
                onBlur={() => save(p.field)}
                className="min-h-[68px] text-[15px] md:text-[15px]"
              />
            </div>
          );
        })}

        <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
          {completedAt ? (
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-xs font-medium text-good-ink">
                <CheckCircle2 className="size-3.5" aria-hidden /> Review completed {formatDay(completedAt)}
              </p>
              <p className="mt-0.5 text-2xs text-muted-foreground">
                {snapshot ? `Snapshot saved${sectionCounts ? ` — ${sectionCounts}` : ""}.` : "Completed before snapshots were recorded."} Edits to your reflection still save automatically.
              </p>
            </div>
          ) : (
            <p className="min-w-0 flex-1 text-2xs text-muted-foreground">
              Answers save when you leave a field. Completing freezes a snapshot of this review and logs it to your history.
            </p>
          )}
          {completedAt ? (
            <Button type="submit" variant="ghost" size="sm" disabled={pending || !canComplete}>
              {pending ? <Loader2 className="animate-spin" /> : <Check />}
              Update snapshot
            </Button>
          ) : (
            <Button type="submit" size="sm" disabled={pending || !canComplete}>
              {pending ? <Loader2 className="animate-spin" /> : <Check />}
              Complete review
            </Button>
          )}
        </div>
      </form>
    </Panel>
  );
}
