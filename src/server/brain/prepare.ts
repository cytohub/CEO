/**
 * Prepare Me — a meeting brief assembled from CytoHub Brain:
 * context, history, participants, objectives, open issues, talking points,
 * desired outcome, questions to ask, risks and next actions.
 *
 * The rules engine builds the brief from the workspace graph; when Claude is
 * configured it rewrites the same facts into a sharper brief (same schema).
 */
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { addDays, daysBetween, formatDateTime, formatDay } from "@/lib/dates";
import { MEETING_TYPES, OPEN_TASK_STATUSES, PERSON_TYPES } from "@/lib/domain";
import { formatCurrency, formatMetric } from "@/lib/format";
import { generateJson } from "@/server/ai/claude";
import { getCeoContext } from "@/server/context";
import { getMetricViews } from "./metrics";

export interface PrepBrief {
  generatedAt: string;
  engine: "claude" | "rules";
  context: string;
  history: { date: string; title: string; detail?: string }[];
  participants: { name: string; role: string; lastContact?: string; note?: string }[];
  objectives: string[];
  openIssues: { title: string; kind: string; href?: string }[];
  talkingPoints: string[];
  desiredOutcome: string;
  questions: string[];
  risks: string[];
  nextActions: string[];
}

const BRIEF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["context", "objectives", "talkingPoints", "desiredOutcome", "questions", "risks", "nextActions"],
  properties: {
    context: { type: "string" },
    objectives: { type: "array", items: { type: "string" } },
    talkingPoints: { type: "array", items: { type: "string" } },
    desiredOutcome: { type: "string" },
    questions: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    nextActions: { type: "array", items: { type: "string" } },
  },
} as const;

export async function buildPrepBrief(meetingId: string): Promise<PrepBrief> {
  const ceo = await getCeoContext();
  const meeting = await db.meeting.findUniqueOrThrow({
    where: { id: meetingId },
    include: {
      company: { include: { deals: { where: { status: "OPEN" } } } },
      goal: { select: { id: true, title: true, status: true, progress: true, confidence: true } },
      attendees: { include: { company: { select: { name: true } } } },
    },
  });
  const others = meeting.attendees.filter((a) => !a.isCeo);
  const personIds = others.map((p) => p.id);
  const companyId = meeting.companyId;

  const relatedWhere = (extra: Prisma.TaskWhereInput = {}): Prisma.TaskWhereInput => ({
    ...extra,
    OR: [...(companyId ? [{ companyId }] : []), ...(personIds.length ? [{ people: { some: { id: { in: personIds } } } }] : []), ...(meeting.goalId ? [{ goalId: meeting.goalId }] : [])],
  });

  const [pastMeetings, openTasks, decisions, inbox, signals, insights, riskyMilestones, metrics] = await Promise.all([
    db.meeting.findMany({
      where: {
        id: { not: meeting.id },
        startsAt: { lt: meeting.startsAt, gte: addDays(ceo.today, -120) },
        OR: [...(companyId ? [{ companyId }] : []), ...(personIds.length ? [{ attendees: { some: { id: { in: personIds } } } }] : [])],
      },
      orderBy: { startsAt: "desc" },
      take: 5,
      include: { notes: { orderBy: { createdAt: "desc" }, take: 1 } },
    }),
    companyId || personIds.length || meeting.goalId
      ? db.task.findMany({ where: relatedWhere({ status: { in: OPEN_TASK_STATUSES } }), orderBy: { priorityScore: "desc" }, take: 6, select: { id: true, title: true, dueDate: true, owner: { select: { name: true, isCeo: true } } } })
      : Promise.resolve([]),
    db.decision.findMany({
      where: { status: { in: ["NEEDED", "WAITING_INFO"] }, OR: [...(companyId ? [{ companies: { some: { id: companyId } } }] : []), ...(meeting.goalId ? [{ goalId: meeting.goalId }] : [])] },
      take: 4,
      select: { id: true, title: true, recommendation: true },
    }),
    db.inboxItem.findMany({
      where: { status: "OPEN", OR: [...(companyId ? [{ companyId }] : []), ...(personIds.length ? [{ personId: { in: personIds } }] : [])] },
      take: 4,
      select: { id: true, title: true, recommendedAction: true },
    }),
    db.brainSignal.findMany({
      where: { occurredAt: { gte: addDays(ceo.today, -30) }, OR: [...(companyId ? [{ companyId }] : []), ...(personIds.length ? [{ personId: { in: personIds } }] : [])] },
      orderBy: { occurredAt: "desc" },
      take: 6,
    }),
    db.brainInsight.findMany({
      where: { type: { in: ["RISK", "DEAL_SLOWING", "OPPORTUNITY"] }, createdAt: { gte: addDays(ceo.today, -21) }, OR: [...(companyId ? [{ companyId }] : []), { companyId: null, importance: { gte: 4 } }] },
      orderBy: { importance: "desc" },
      take: 5,
    }),
    meeting.goalId
      ? db.milestone.findMany({ where: { goalId: meeting.goalId, status: { in: ["AT_RISK", "BLOCKED"] } }, select: { title: true, blocker: true } })
      : Promise.resolve([]),
    getMetricViews(db, { today: ceo.today, keys: ["arr", "active_customers", "donor_hearts", "auc", "runway", "nrr", "round_committed"] }),
  ]);

  const metric = (key: string) => {
    const m = metrics.find((v) => v.key === key);
    return m?.current != null ? formatMetric(m.current, m.unit) : null;
  };
  const deal = meeting.company?.deals[0];

  // Context
  const contextParts = [
    meeting.description,
    meeting.company?.description,
    deal ? `${deal.name}: “${deal.stage}”, ${deal.value ? formatCurrency(deal.value) : "no value set"}, ${deal.probability}% probability${deal.nextStep ? `; next step — ${deal.nextStep}` : ""}.` : null,
    meeting.goal ? `Advances “${meeting.goal.title}” (${meeting.goal.progress}% complete, ${meeting.goal.confidence}% confidence).` : null,
  ].filter(Boolean);
  const context = contextParts.join(" ") || `${MEETING_TYPES[meeting.type].label} meeting on ${formatDateTime(meeting.startsAt, ceo.timezone)}.`;

  const history = [
    ...pastMeetings.map((m) => ({ date: formatDay(m.startsAt, true), title: m.title, detail: m.notes[0]?.body })),
    ...signals.map((s) => ({ date: formatDay(s.occurredAt, true), title: s.title, detail: (s.metadata as { summary?: string } | null)?.summary ?? s.body?.slice(0, 220) ?? undefined })),
  ].slice(0, 8);

  const participants = others.map((p) => ({
    name: p.name,
    role: [p.title, p.company?.name, PERSON_TYPES[p.type].label].filter(Boolean).join(" · "),
    lastContact: p.lastContactAt ? `${daysBetween(p.lastContactAt, new Date())} days ago` : undefined,
    note: p.notesText ?? undefined,
  }));

  const objectives = [
    meeting.objective,
    deal?.nextStep ? `Advance ${deal.name}: ${deal.nextStep}` : null,
    meeting.goal ? `Move “${meeting.goal.title}” forward` : null,
  ].filter((x): x is string => Boolean(x));

  const openIssues = [
    ...decisions.map((d) => ({ title: d.title, kind: "Decision", href: `/decisions/${d.id}` })),
    ...inbox.map((i) => ({ title: i.title, kind: "Inbox", href: "/inbox" })),
    ...openTasks.map((t) => ({ title: `${t.title}${t.dueDate ? ` (due ${formatDay(t.dueDate)})` : ""}`, kind: t.owner?.isCeo ? "Your task" : `Task · ${t.owner?.name ?? "unassigned"}`, href: `/tasks?task=${t.id}` })),
    ...riskyMilestones.map((m) => ({ title: `${m.title}${m.blocker ? ` — ${m.blocker}` : ""}`, kind: "Milestone at risk" })),
  ].slice(0, 10);

  const asks = signals
    .filter((s) => ["commitment", "investor_request", "response_needed", "escalation"].includes((s.metadata as { signalType?: string } | null)?.signalType ?? ""))
    .map((s) => (s.metadata as { summary?: string } | null)?.summary ?? s.title);

  const talkingPoints: string[] = [];
  const questions: string[] = [];
  let desiredOutcome = meeting.objective ?? "";
  switch (meeting.type) {
    case "INVESTOR":
      talkingPoints.push(
        `Traction: ${[metric("arr") && `${metric("arr")} ARR`, metric("active_customers") && `${metric("active_customers")} pharma customers`, metric("nrr") && `${metric("nrr")} net retention`].filter(Boolean).join(", ")}.`,
        `Moat: ${metric("donor_hearts") ?? "—"} human donor hearts profiled — data competitors trained on iPSC models cannot replicate.`,
        `CytoHub.AI: CardioPredict v2 hold-out AUC ${metric("auc") ?? "—"}; transparent path to ≥ 0.90.`,
        `Use of funds: dataset scale-up, CytoHub.AI v2 commercialization, HeartReady IND-enabling work.`,
      );
      if (metric("round_committed")) talkingPoints.push(`Round momentum: ${metric("round_committed")} committed from insiders.`);
      questions.push("What would you need to see to lead, and on what timeline?", "Who else at the firm needs to be convinced, and what are their concerns?", "How do you think about the data-licensing business model?");
      desiredOutcome ||= "A clear next step toward a term sheet, with the decision-makers and timeline named.";
      break;
    case "CUSTOMER":
      talkingPoints.push("Value delivered so far and the measurable impact on their safety pharmacology decisions.", "Our concrete plan for any open issue — with dates and a single owner.", "Where CardioPredict v2 and the human heart dataset can expand the relationship.");
      questions.push("What would make this partnership indispensable for your team next year?", "Who else in the organization should know about the results?", "What is your renewal / budget process and timing?");
      desiredOutcome ||= "Customer confidence restored or expanded, with an agreed next step and owner.";
      break;
    case "BOARD":
      talkingPoints.push(`Series B status and named lead candidates.`, `Runway: ${metric("runway") ?? "—"} at current burn.`, "Goals at risk and what you are doing about them.", "Decisions where you want board input.");
      questions.push("Where do you see the biggest risk to the plan?", "Which introductions could accelerate the raise?");
      desiredOutcome ||= "Board aligned on the raise timeline and the top risks.";
      break;
    case "PARTNER":
      talkingPoints.push("What each side contributes and the first joint milestone.", "Publication, IP and data-governance positions.", "Announcement plan and timing.");
      questions.push("What could slow signature on your side?", "Who owns the partnership day to day?");
      desiredOutcome ||= "Agreement on open terms and a signature date.";
      break;
    default:
      talkingPoints.push("Restate the decision or outcome this meeting exists for.", "Confirm owners and dates for every action.");
      questions.push("What would make this meeting a success for you?");
      desiredOutcome ||= "Clear decisions and owners.";
  }
  for (const a of asks.slice(0, 3)) talkingPoints.push(`They asked: ${a}`);

  const risks = [
    ...insights.map((i) => `${i.title}${i.summary ? ` — ${i.summary}` : ""}`),
    ...(deal && deal.lastActivityAt && daysBetween(deal.lastActivityAt, new Date()) > 14 ? [`${deal.name} has had no activity for ${daysBetween(deal.lastActivityAt, new Date())} days.`] : []),
  ].slice(0, 5);

  const nextActions = [
    "Send a written follow-up within 24 hours: decisions, owners, dates.",
    ...(deal?.nextStep ? [`Update the CRM: ${deal.nextStep}`] : []),
    ...openTasks.filter((t) => t.owner?.isCeo).slice(0, 2).map((t) => `Close out: ${t.title}`),
  ];

  const rules: PrepBrief = {
    generatedAt: new Date().toISOString(),
    engine: "rules",
    context,
    history,
    participants,
    objectives,
    openIssues,
    talkingPoints,
    desiredOutcome,
    questions,
    risks,
    nextActions,
  };

  const llm = await generateJson<Pick<PrepBrief, "context" | "objectives" | "talkingPoints" | "desiredOutcome" | "questions" | "risks" | "nextActions">>({
    system:
      "You are chief of staff to the CEO of CytoHub (human heart dataset, CytoHub.AI cardiac-safety models, pharma revenue, HeartReady program). " +
      "Prepare the CEO for a meeting using ONLY the facts provided. Be specific, concise and executive. No invented numbers.",
    prompt: `Meeting: ${meeting.title} (${MEETING_TYPES[meeting.type].label}) on ${formatDateTime(meeting.startsAt, ceo.timezone)}.\n\nFacts from CytoHub Brain (JSON):\n${JSON.stringify(rules)}\n\nRewrite the brief: context (≤3 sentences), 2–4 objectives, 4–7 talking points, one desired outcome, 3–5 sharp questions to ask, the top risks, and next actions.`,
    schema: BRIEF_SCHEMA,
    effort: "medium",
  });

  return llm ? { ...rules, ...llm, engine: "claude" } : rules;
}
