import { Lock, Sparkles } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { SearchResponse } from "@/server/ingestion/search/types";
import { RESULT_ICONS } from "./highlight";
import { AskChiefButton } from "./search-results";

const INTENT_LABEL: Record<SearchResponse["plan"]["intent"], string> = {
  discussed: "Conversation history",
  related: "Everything related",
  commitments: "Commitments",
  status: "Status",
  deadlines: "Deadlines",
  waiting: "Who is waiting",
  conversations: "Conversations",
  list: "Records",
  keyword: "Keyword search",
};

/** The synthesized answer: text, engine, citations, interpretation and access notes. */
export function AnswerCard({ response }: { response: SearchResponse }) {
  const { answer, plan } = response;
  return (
    <section aria-labelledby="answer-title" className="rounded-lg border border-brain/20 bg-brain-soft/50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="size-3.5 text-brain" aria-hidden />
        <h2 id="answer-title" className="text-xs font-semibold text-brain">
          Answer
        </h2>
        <span
          className={cn("rounded-full border px-2 py-px text-2xs font-medium", answer.engine === "claude" ? "border-brain/30 text-brain" : "border-border bg-surface text-ink-2")}
          title={answer.engine === "claude" ? "Synthesized by Claude from the results below" : "Assembled by the CytoHub Brain rules engine"}
        >
          {answer.engine === "claude" ? "Claude" : "Brain rules"}
        </span>
        <span className="ml-auto">
          <AskChiefButton query={plan.query} />
        </span>
      </div>
      <p className="mt-2 text-[14.5px] leading-relaxed text-foreground">{answer.text}</p>

      {answer.citations.length > 0 && (
        <div className="mt-3">
          <h3 className="sr-only">Sources for this answer</h3>
          <ul className="flex flex-wrap gap-1.5">
            {answer.citations.map((c, i) => {
              const Icon = RESULT_ICONS[c.type as keyof typeof RESULT_ICONS];
              return (
                <li key={`${c.type}-${c.id}`} className="min-w-0 max-w-full">
                  <Link
                    href={c.href}
                    className="inline-flex h-6 max-w-full items-center gap-1 rounded-md border border-border bg-surface px-2 text-2xs text-ink-2 hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    <span className="tabular text-muted-foreground">{i + 1}</span>
                    {Icon && <Icon className="size-3 shrink-0 text-ink-3" aria-hidden />}
                    <span className="truncate">{c.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-brain/15 pt-2.5">
        <span className="text-2xs text-muted-foreground">Interpreted as</span>
        <span className="rounded bg-surface px-1.5 py-px text-2xs font-medium text-foreground">{INTENT_LABEL[plan.intent]}</span>
        {plan.explanation
          .filter((e) => e !== INTENT_LABEL[plan.intent] && e !== "Status" && e !== "Commitments" && e !== "Deadlines" && e !== "Conversations")
          .map((e) => (
            <span key={e} className="max-w-full truncate rounded bg-surface px-1.5 py-px text-2xs text-ink-2">
              {e}
            </span>
          ))}
        {plan.engine === "claude" && <span className="text-2xs text-muted-foreground">· planned by Claude</span>}
      </div>

      {(response.hiddenByAccess || response.structuredExcluded) && (
        <p className="mt-2 flex items-start gap-1.5 text-2xs text-muted-foreground">
          <Lock className="mt-px size-3 shrink-0" aria-hidden />
          {response.structuredExcluded
            ? "Results are limited to sources shared with your role; workspace records (tasks, commitments, meetings) aren’t included."
            : "Some matching sources are restricted and aren’t shown at your access level."}
        </p>
      )}
    </section>
  );
}
