import { HelpCircle, Sparkles } from "lucide-react";
import Link from "next/link";
import { Avatar } from "@/components/common/bits";
import { StatusPill } from "@/components/common/status";
import { formatDateTime, timeAgo } from "@/lib/dates";
import { COMMITMENT_DIRECTION, COMMITMENT_STATUS, THREAD_STATUS } from "@/lib/intelligence";
import type { ThreadDetail } from "@/server/queries/threads";
import { commitmentDue, readPeople } from "./model";

/** The thread's evolving summary: status, people, open questions, commitments, decisions and the recommended CEO action. */
export function ThreadSummaryCard({ data }: { data: ThreadDetail }) {
  const t = data.thread;
  const st = THREAD_STATUS[t.status];
  const keyPeople = readPeople(t.keyParticipants);
  return (
    <section className="panel overflow-hidden" aria-labelledby="thread-summary-title">
      <header className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-2.5">
        <Sparkles className="size-3.5 text-brain" aria-hidden />
        <h2 id="thread-summary-title" className="text-[14.5px] font-semibold">
          Thread summary
        </h2>
        <StatusPill tone={st.tone} label={st.label} />
        <span className="ml-auto text-2xs text-muted-foreground">
          {t.summarizedAt ? (
            <>
              {t.summaryEngine === "claude" ? "Summarized by Claude" : "Summarized by Brain rules"} · {timeAgo(t.summarizedAt)}
              {t.summarizedMessages < t.messageCount && ` · ${t.messageCount - t.summarizedMessages} new since`}
            </>
          ) : (
            "Not summarized yet"
          )}
        </span>
      </header>
      <div className="space-y-4 p-4">
        {t.summary ? <p className="text-[15px] leading-relaxed">{t.summary}</p> : <p className="text-xs text-muted-foreground">CytoHub Brain will summarize this thread on the next refresh.</p>}

        {t.recommendedAction && (
          <div className="rounded-lg border border-brain/25 bg-brain-soft/60 p-3">
            <h3 className="flex items-center gap-1.5 text-2xs font-semibold tracking-wide text-brain uppercase">
              <Sparkles className="size-3" aria-hidden /> Recommended action
            </h3>
            <p className="mt-1 text-[15px] leading-relaxed font-medium">{t.recommendedAction}</p>
          </div>
        )}

        <dl className="grid gap-x-6 gap-y-3 text-[15px] sm:grid-cols-2">
          {t.currentStatus && (
            <div>
              <dt className="eyebrow mb-0.5">Current status</dt>
              <dd className="text-ink-2">{t.currentStatus}</dd>
            </div>
          )}
          {t.nextStep && (
            <div>
              <dt className="eyebrow mb-0.5">Next step</dt>
              <dd className="text-ink-2">{t.nextStep}</dd>
            </div>
          )}
          <div>
            <dt className="eyebrow mb-0.5">Last activity</dt>
            <dd className="text-ink-2">
              {formatDateTime(t.lastMessageAt, data.timezone)} · {timeAgo(t.lastMessageAt)}
              {t.awaitingSince && t.status === "AWAITING_CEO" && <span className="text-serious-ink"> · waiting on you since {timeAgo(t.awaitingSince).replace(" ago", "")}</span>}
            </dd>
          </div>
          {keyPeople.length > 0 && (
            <div>
              <dt className="eyebrow mb-1">Key participants</dt>
              <dd>
                <ul className="space-y-1">
                  {keyPeople.map((p, i) => (
                    <li key={`${p.name}-${i}`} className="flex items-start gap-2 text-xs">
                      <Avatar name={p.name ?? "?"} className="mt-0.5" />
                      <span className="min-w-0">
                        <span className="block font-medium">{p.name}</span>
                        {p.role && <span className="block text-2xs text-muted-foreground">{p.role}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
        </dl>

        {t.openQuestions.length > 0 && (
          <div>
            <h3 className="eyebrow mb-1.5">Open questions</h3>
            <ul className="space-y-1">
              {t.openQuestions.map((q) => (
                <li key={q} className="flex gap-2 text-[15px]">
                  <HelpCircle className="mt-0.5 size-3.5 shrink-0 text-warning-ink" aria-hidden />
                  {q}
                </li>
              ))}
            </ul>
          </div>
        )}

        {t.decisionsSummary.length > 0 && (
          <div>
            <h3 className="eyebrow mb-1.5">Decisions</h3>
            <ul className="space-y-1 text-[15px]">
              {t.decisionsSummary.map((d) => (
                <li key={d} className="flex gap-2">
                  <span className="mt-2 size-1 shrink-0 rounded-full bg-ink-3" aria-hidden />
                  {d}
                </li>
              ))}
            </ul>
          </div>
        )}

        {t.commitments.length > 0 && (
          <div>
            <h3 className="eyebrow mb-1.5">Commitments in this thread</h3>
            <ul className="divide-y divide-hairline rounded-lg border border-border">
              {t.commitments.map((c) => {
                const due = commitmentDue(c.dueDate, data.today, c.status === "OPEN");
                const other = c.direction === "INBOUND" ? c.owner : c.counterparty;
                return (
                  <li key={c.id}>
                    <Link href={`/commitments?highlight=${c.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[15px] hover:bg-muted/40">
                      <span className="w-[76px] shrink-0 text-2xs text-muted-foreground">{COMMITMENT_DIRECTION[c.direction].label}</span>
                      <span className="min-w-0 flex-1 truncate">{c.title}</span>
                      {other && <span className="text-2xs text-muted-foreground">{other.isCeo ? "You" : other.name}</span>}
                      <span className={due.overdue ? "text-2xs font-medium text-critical-ink" : "text-2xs text-muted-foreground"}>{due.label}</span>
                      <StatusPill tone={COMMITMENT_STATUS[c.status].tone} label={COMMITMENT_STATUS[c.status].label} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
