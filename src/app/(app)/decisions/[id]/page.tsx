import { ArrowLeft, CircleMinus, CirclePlus, FileText, Gavel, ListChecks, Plus, ShieldAlert, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DueLabel, PageHeader, Panel, PersonName, PillarTag } from "@/components/common/bits";
import { CreateButton } from "@/components/common/create-button";
import { StatusPill, TONE_TEXT } from "@/components/common/status";
import { EditOptions, MakeDecision, OutcomeEditor, RecommendationEditor, StatusControls } from "@/components/decisions/decision-controls";
import { ViewSourceButton } from "@/components/intelligence/view-source";
import { TaskLink } from "@/components/tasks/task-link";
import { cn } from "@/lib/utils";
import { daysBetween, formatDateTime, formatDay } from "@/lib/dates";
import { DECISION_STATUS, INSIGHT_TYPES, RESOURCE_TYPES, TASK_STATUS } from "@/lib/domain";
import { getDecisionDetail } from "@/server/queries/decisions";
import { getProvenanceCounts } from "@/server/queries/provenance";
import { requirePage } from "@/server/security/session";

export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await props.params;
  const d = await getDecisionDetail(id);
  return { title: d?.decision.title ?? "Decision" };
}

export default async function DecisionPage(props: { params: Promise<{ id: string }> }) {
  const viewer = await requirePage("workspace.view", "/decisions");
  const { id } = await props.params;
  const data = await getDecisionDetail(id);
  if (!data) notFound();
  const sources = (await getProvenanceCounts(viewer, "DECISION", [id]))[id];
  const { decision: d, today, timezone, now } = data;
  const decided = d.status === "DECIDED";
  const status = DECISION_STATUS[d.status];

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <PageHeader
        eyebrow={
          <Link href="/decisions" className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="size-3" /> Decision Center
          </Link>
        }
        title={d.title}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusPill tone={status.tone} label={status.label} />
            <span>Strategic impact {d.strategicImpact}/5</span>
            <span>Raised {formatDay(d.raisedAt)} · open {daysBetween(d.raisedAt, decided && d.decidedAt ? d.decidedAt : now)}d</span>
            {d.deadline && !decided && (
              <span>
                Deadline <DueLabel date={d.deadline} today={today} />
              </span>
            )}
            {d.pillar && <PillarTag name={d.pillar.name} color={d.pillar.color} />}
          </span>
        }
        actions={
          <>
            {sources && <ViewSourceButton targetType="DECISION" targetId={d.id} count={sources.count} hidden={sources.hidden} variant="outline" />}
            <StatusControls decision={d} />
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="min-w-0 space-y-4 xl:col-span-8">
          {d.context && (
            <section className="panel p-4">
              <h2 className="eyebrow mb-1.5">Context</h2>
              <p className="text-[15px] leading-relaxed text-ink-2">{d.context}</p>
              {d.waitingOn && d.status === "WAITING_INFO" && (
                <p className="mt-3 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning-ink">
                  <span className="font-medium">Waiting on:</span> {d.waitingOn}
                </p>
              )}
            </section>
          )}

          <Panel title="Options" icon={Gavel} count={d.options.length} actions={<EditOptions decision={d} />}>
            {d.options.length === 0 ? (
              <p className="px-4 py-4 text-xs text-muted-foreground">No options recorded yet — add at least two to make the trade-offs explicit.</p>
            ) : (
              <div className="grid gap-3 p-3 md:grid-cols-2 2xl:grid-cols-3">
                {d.options.map((o, i) => (
                  <article key={o.id} className={cn("rounded-lg border p-3.5", o.recommended ? "border-brain/40 bg-brain-soft/40" : "border-border")}>
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-2xs font-semibold tabular">{String.fromCharCode(65 + i)}</span>
                      <h3 className="flex-1 text-[15px] leading-snug font-semibold">{o.title}</h3>
                    </div>
                    {o.recommended && (
                      <p className="mt-1.5 flex items-center gap-1 text-2xs font-medium text-brain">
                        <Sparkles className="size-3" aria-hidden /> {decided ? "Chosen" : "Recommended"}
                      </p>
                    )}
                    {o.description && <p className="mt-1.5 text-xs text-ink-2">{o.description}</p>}
                    <OptionList icon={CirclePlus} label="Pros" items={o.pros} className="text-good-ink" />
                    <OptionList icon={CircleMinus} label="Cons" items={o.cons} className="text-serious-ink" />
                    <OptionList icon={ShieldAlert} label="Risks" items={o.risks} className="text-critical-ink" />
                  </article>
                ))}
              </div>
            )}
          </Panel>

          <div className="grid gap-4 md:grid-cols-2">
            <section className="panel p-4">
              <h2 className="eyebrow mb-1.5">Supporting information</h2>
              {d.supportingInfo ? <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-ink-2">{d.supportingInfo}</p> : <p className="text-xs text-muted-foreground">None recorded.</p>}
            </section>
            <section className="panel p-4">
              <h2 className="mb-1.5 flex items-center gap-1.5 text-2xs font-semibold tracking-wide text-brain uppercase">
                <Sparkles className="size-3" aria-hidden /> Recommendation
              </h2>
              <RecommendationEditor decision={d} />
            </section>
          </div>

          <Panel title="Related tasks" icon={ListChecks} count={d.tasks.length} actions={<CreateButton kind="task" label="Add" icon={<Plus />} variant="ghost" size="xs" defaults={{ decisionId: d.id, goalId: d.goalId ?? undefined }} />}>
            {d.tasks.length === 0 ? (
              <p className="px-4 py-3 text-xs text-muted-foreground">No tasks linked.</p>
            ) : (
              <ul className="divide-y divide-hairline">
                {d.tasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-4 py-2 text-[15px]">
                    <StatusPill tone={TASK_STATUS[t.status].tone} label={TASK_STATUS[t.status].label} />
                    <TaskLink id={t.id} title={t.title} className="min-w-0 flex-1 truncate" />
                    <PersonName person={t.owner} className="hidden text-xs text-muted-foreground sm:inline-flex" />
                    <DueLabel date={t.dueDate} today={today} done={t.status === "DONE"} className="w-20 text-right text-xs" />
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Activity" icon={FileText}>
            <ul className="divide-y divide-hairline">
              {d.activities.map((a) => (
                <li key={a.id} className="flex justify-between gap-4 px-4 py-2 text-xs">
                  <span className="text-ink-2">{a.summary}</span>
                  <span className="shrink-0 text-muted-foreground">{formatDateTime(a.createdAt, timezone)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <aside className="min-w-0 space-y-4 xl:col-span-4">
          <section className={cn("panel p-4", !decided && "ring-1 ring-foreground/10")}>
            {decided ? (
              <>
                <h2 className="eyebrow mb-1.5">Final decision</h2>
                <p className="text-[17px] leading-snug font-semibold">{d.finalDecision}</p>
                <p className="mt-1 text-2xs text-muted-foreground">
                  Decided {formatDateTime(d.decidedAt, timezone)} · {daysBetween(d.raisedAt, d.decidedAt!)} days after it was raised
                </p>
                <div className="mt-4 border-t border-hairline pt-4">
                  <OutcomeEditor decision={d} />
                </div>
              </>
            ) : (
              <>
                <h2 className="mb-3 text-[15px] font-semibold">Make the decision</h2>
                <MakeDecision decision={d} />
              </>
            )}
          </section>

          <section className="panel p-4 text-[15px]">
            <h2 className="eyebrow mb-2">Links</h2>
            <dl className="space-y-2">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Goal</dt>
                <dd className="text-right">{d.goal ? <Link href={`/goals/${d.goal.id}`} className="hover:underline">{d.goal.title}</Link> : "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Owner</dt>
                <dd>
                  <PersonName person={d.owner} />
                </dd>
              </div>
              {d.companies.length > 0 && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Companies</dt>
                  <dd className="text-right">
                    {d.companies.map((c) => (
                      <Link key={c.id} href={`/resources/companies/${c.id}`} className="block hover:underline">
                        {c.name}
                      </Link>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
          </section>

          {d.insights.length > 0 && (
            <Panel title="Brain intelligence" icon={Sparkles}>
              <ul className="divide-y divide-hairline">
                {d.insights.map((i) => {
                  const meta = INSIGHT_TYPES[i.type];
                  return (
                    <li key={i.id} className="flex gap-2.5 px-4 py-2 text-xs">
                      <meta.icon className={cn("mt-0.5 size-3.5 shrink-0", TONE_TEXT[meta.tone])} aria-hidden />
                      <div>
                        <div className="text-ink-2">{i.title}</div>
                        {i.summary && <div className="text-2xs text-muted-foreground">{i.summary}</div>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          )}

          <Panel title="Supporting resources" icon={FileText} count={d.resources.length} actions={<CreateButton kind="resource" label="Add" icon={<Plus />} variant="ghost" size="xs" defaults={{ decisionId: d.id }} />}>
            {d.resources.length === 0 ? (
              <p className="px-4 py-3 text-xs text-muted-foreground">No resources linked.</p>
            ) : (
              <ul className="divide-y divide-hairline">
                {d.resources.map((r) => {
                  const Icon = RESOURCE_TYPES[r.type].icon;
                  return (
                    <li key={r.id}>
                      <a href={r.url ?? `/resources?resource=${r.id}`} target={r.url ? "_blank" : undefined} rel="noreferrer" className="flex gap-2 px-4 py-2 text-[15px] hover:bg-muted/40">
                        <Icon className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden />
                        <span className="min-w-0">
                          <span className="block truncate">{r.title}</span>
                          {r.summary && <span className="line-clamp-2 text-2xs text-muted-foreground">{r.summary}</span>}
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function OptionList({ icon: Icon, label, items, className }: { icon: typeof CirclePlus; label: string; items: string[]; className: string }) {
  if (!items.length) return null;
  return (
    <div className="mt-2.5">
      <div className="text-2xs font-medium text-muted-foreground">{label}</div>
      <ul className="mt-1 space-y-1">
        {items.map((p) => (
          <li key={p} className="flex gap-1.5 text-xs text-ink-2">
            <Icon className={cn("mt-0.5 size-3 shrink-0", className)} aria-hidden />
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}
