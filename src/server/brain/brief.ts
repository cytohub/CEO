/**
 * CEO Daily Intelligence Brief: a compressed, executive-friendly summary of
 * what changed since the last refresh, composed from the insights the
 * pipeline produced plus the deadlines that are now close.
 */
import type { BrainInsight, Prisma } from "@/generated/prisma/client";
import type { Db } from "@/lib/db";
import { addDays, daysBetween, formatDay } from "@/lib/dates";
import { OPEN_TASK_STATUSES } from "@/lib/domain";
import { generateText } from "@/server/ai/claude";
import type { BrainContext, BriefItem, BriefSectionKey, BriefSections } from "./types";
import { BRIEF_SECTIONS } from "./types";

const SECTION_FOR: Record<BrainInsight["type"], BriefSectionKey> = {
  DEVELOPMENT: "developments",
  OPPORTUNITY: "opportunities",
  RISK: "risks",
  DEAL_PROGRESS: "dealsProgressing",
  DEAL_SLOWING: "dealsSlowing",
  COMMUNICATION: "communications",
  MILESTONE_REACHED: "milestonesReached",
  MILESTONE_AT_RISK: "milestonesAtRisk",
  DECISION_NEEDED: "decisionsNeeded",
  DEADLINE: "deadlines",
  FOLLOW_UP: "followUps",
  COMMITMENT: "commitments",
  DELEGATION: "followUps",
  ATTENTION: "attention",
  CHANGE: "changes",
};

export function insightHref(
  i: Pick<BrainInsight, "taskId" | "goalId" | "milestoneId" | "decisionId" | "companyId" | "personId" | "dealId"> &
    Partial<Pick<BrainInsight, "documentId" | "meetingId" | "commitmentId" | "riskId" | "opportunityId" | "sourceItemId">>,
): string | undefined {
  if (i.decisionId) return `/decisions/${i.decisionId}`;
  if (i.taskId) return `/tasks?task=${i.taskId}`;
  if (i.milestoneId) return `/milestones?milestone=${i.milestoneId}`;
  if (i.documentId) return `/documents/${i.documentId}`;
  if (i.meetingId) return `/upcoming?meeting=${i.meetingId}`;
  if (i.commitmentId) return "/commitments";
  if (i.riskId || i.opportunityId) return "/risks";
  if (i.goalId) return `/goals/${i.goalId}`;
  if (i.companyId) return `/resources/companies/${i.companyId}`;
  if (i.personId) return `/resources/people/${i.personId}`;
  if (i.sourceItemId) return `/sources/${i.sourceItemId}`;
  return undefined;
}

export async function composeBrief(
  ctx: BrainContext,
  input: {
    newInsights: BrainInsight[];
    stats: BriefSections["stats"];
    topPriorityTaskIds: string[];
  },
) {
  const sections: Partial<Record<BriefSectionKey, BriefItem[]>> = {};
  const push = (key: BriefSectionKey, item: BriefItem) => {
    (sections[key] ??= []).push(item);
  };

  for (const i of input.newInsights) {
    push(SECTION_FOR[i.type], {
      insightId: i.id,
      title: i.title,
      detail: i.summary ?? undefined,
      href: insightHref(i),
      importance: i.importance,
      isNew: true,
    });
  }

  // Still-open items that matter regardless of when they were first seen.
  const pendingDecisions = await ctx.tx.decision.findMany({
    where: { status: "NEEDED", OR: [{ deadline: { lte: addDays(ctx.today, 7) } }, { strategicImpact: { gte: 4 } }] },
    orderBy: [{ deadline: "asc" }, { strategicImpact: "desc" }],
    take: 5,
    select: { id: true, title: true, deadline: true, strategicImpact: true, recommendation: true },
  });
  for (const d of pendingDecisions) {
    if ((sections.decisionsNeeded ?? []).some((x) => x.href === `/decisions/${d.id}`)) continue;
    const days = d.deadline ? daysBetween(ctx.today, d.deadline) : null;
    push("decisionsNeeded", {
      title: d.title,
      detail: days === null ? undefined : days < 0 ? `${-days}d past deadline` : days === 0 ? "Deadline today" : `Deadline in ${days}d`,
      href: `/decisions/${d.id}`,
      importance: d.strategicImpact,
      isNew: false,
    });
  }
  const riskyMilestones = await ctx.tx.milestone.findMany({
    where: { status: { in: ["AT_RISK", "BLOCKED", "IN_PROGRESS", "PLANNED"] }, OR: [{ status: { in: ["AT_RISK", "BLOCKED"] } }, { dueDate: { lt: ctx.today } }] },
    orderBy: { dueDate: "asc" },
    take: 4,
    select: { id: true, title: true, dueDate: true, progress: true, status: true },
  });
  for (const m of riskyMilestones) {
    if ((sections.milestonesAtRisk ?? []).some((x) => x.href === `/milestones?milestone=${m.id}`)) continue;
    const days = daysBetween(ctx.today, m.dueDate);
    push("milestonesAtRisk", {
      title: m.title,
      detail: `${days < 0 ? `${-days}d overdue` : `Due in ${days}d`} · ${m.progress}%`,
      href: `/milestones?milestone=${m.id}`,
      importance: days < 0 ? 5 : 4,
      isNew: false,
    });
  }

  // Deadlines approaching in the next 72h (state, not only deltas).
  const horizon = addDays(ctx.today, 3);
  // Sequential on purpose: queries inside an interactive transaction share one connection.
  const tasksDue = await ctx.tx.task.findMany({
      where: { ownerId: ctx.ceoPersonId, status: { in: OPEN_TASK_STATUSES }, dueDate: { gte: ctx.today, lte: horizon } },
      orderBy: [{ dueDate: "asc" }, { priorityScore: "desc" }],
      take: 6,
      select: { id: true, title: true, dueDate: true, priorityScore: true },
    });
  const msDue = await ctx.tx.milestone.findMany({
      where: { status: { notIn: ["COMPLETED", "MISSED"] }, dueDate: { gte: ctx.today, lte: addDays(ctx.today, 7) } },
      orderBy: { dueDate: "asc" },
      take: 4,
      select: { id: true, title: true, dueDate: true, progress: true },
    });
  const decisionsDue = await ctx.tx.decision.findMany({
      where: { status: "NEEDED", deadline: { gte: ctx.today, lte: horizon } },
      take: 4,
      select: { id: true, title: true, deadline: true },
    });
  const seen = new Set((sections.deadlines ?? []).map((d) => d.title));
  const dueLabel = (d: Date) => {
    const n = daysBetween(ctx.today, d);
    return n === 0 ? "today" : n === 1 ? "tomorrow" : formatDay(d);
  };
  for (const t of tasksDue) {
    const title = `${t.title} — due ${dueLabel(t.dueDate!)}`;
    if (!seen.has(title)) push("deadlines", { title, href: `/tasks?task=${t.id}`, importance: t.priorityScore >= 60 ? 4 : 3, isNew: false });
  }
  for (const m of msDue) {
    push("deadlines", { title: `Milestone: ${m.title} — ${dueLabel(m.dueDate)} (${m.progress}%)`, href: `/milestones?milestone=${m.id}`, importance: 4, isNew: false });
  }
  for (const d of decisionsDue) {
    push("deadlines", { title: `Decision: ${d.title} — ${dueLabel(d.deadline!)}`, href: `/decisions/${d.id}`, importance: 4, isNew: false });
  }

  for (const key of Object.keys(sections) as BriefSectionKey[]) {
    sections[key] = sections[key]!.sort((a, b) => Number(b.isNew ?? false) - Number(a.isNew ?? false) || b.importance - a.importance).slice(0, 6);
  }

  const { headline, summary } = composeNarrative(sections, input.stats);
  const payload: BriefSections = {
    sections,
    stats: input.stats,
    topPriorityTaskIds: input.topPriorityTaskIds,
    since: ctx.since.toISOString(),
    narrativeEngine: "rules",
  };

  return ctx.tx.dailyBrief.upsert({
    where: { date: ctx.today },
    create: {
      date: ctx.today,
      headline,
      summary,
      sections: payload as unknown as Prisma.InputJsonValue,
      refreshId: ctx.refreshId,
      createdAt: ctx.now,
    },
    update: {
      headline,
      summary,
      sections: payload as unknown as Prisma.InputJsonValue,
      refreshId: ctx.refreshId,
      reviewedAt: null,
    },
  });
}

/**
 * Upgrade the brief's headline and summary with Claude. Runs after the
 * refresh transaction commits so a slow model call never holds a lock.
 */
export async function enhanceBriefWithClaude(client: Db, briefId: string): Promise<boolean> {
  const brief = await client.dailyBrief.findUnique({ where: { id: briefId } });
  if (!brief) return false;
  const payload = brief.sections as unknown as BriefSections;
  const llm = await synthesizeNarrative(payload.sections, payload.stats);
  if (!llm) return false;
  await client.dailyBrief.update({
    where: { id: briefId },
    data: {
      headline: llm.headline,
      summary: llm.summary,
      sections: { ...payload, narrativeEngine: "claude" } as unknown as Prisma.InputJsonValue,
    },
  });
  return true;
}

function count(sections: Partial<Record<BriefSectionKey, BriefItem[]>>, key: BriefSectionKey) {
  return sections[key]?.length ?? 0;
}

/** Deterministic headline + summary. */
export function composeNarrative(sections: Partial<Record<BriefSectionKey, BriefItem[]>>, stats: BriefSections["stats"]) {
  const decisions = sections.decisionsNeeded ?? [];
  const risks = [...(sections.risks ?? []), ...(sections.milestonesAtRisk ?? [])].filter((r) => r.isNew !== false).sort((a, b) => b.importance - a.importance);
  const wins = [...(sections.milestonesReached ?? []), ...(sections.dealsProgressing ?? [])];

  const headlineParts: string[] = [];
  if (decisions.length) headlineParts.push(`${decisions.length} decision${decisions.length === 1 ? "" : "s"} need you`);
  if (risks.length) headlineParts.push(`${risks.length} new risk${risks.length === 1 ? "" : "s"}`);
  if (wins.length) headlineParts.push(`${wins.length} win${wins.length === 1 ? "" : "s"}`);
  const headline = headlineParts.length
    ? `${headlineParts.join(" · ")}${risks[0] ? ` — most pressing: ${stripQuotes(risks[0].title)}` : ""}`
    : "A quiet night — no material changes since the last refresh.";

  const sentences: string[] = [];
  if (wins.length) sentences.push(`Progress: ${wins.slice(0, 2).map((w) => stripQuotes(w.title)).join("; ")}.`);
  if (count(sections, "dealsSlowing")) sentences.push(`${count(sections, "dealsSlowing")} deal${count(sections, "dealsSlowing") === 1 ? " is" : "s are"} losing momentum.`);
  if (count(sections, "opportunities")) sentences.push(`${count(sections, "opportunities")} new opportunit${count(sections, "opportunities") === 1 ? "y" : "ies"} worth a look.`);
  const attention = sections.attention?.[0];
  if (attention) sentences.push(`${attention.title}.`);
  if (stats.tasksCreated) sentences.push(`${stats.tasksCreated} new commitment${stats.tasksCreated === 1 ? "" : "s"} captured as tasks.`);
  const summary = sentences.length ? sentences.join(" ") : "Your Top 5 below reflects current priorities.";

  return { headline, summary };
}

function stripQuotes(s: string) {
  return s.replace(/[“”]/g, "");
}

async function synthesizeNarrative(
  sections: Partial<Record<BriefSectionKey, BriefItem[]>>,
  stats: BriefSections["stats"],
): Promise<{ headline: string; summary: string } | null> {
  const material = BRIEF_SECTIONS.filter((s) => sections[s.key]?.length)
    .map((s) => `${s.label}:\n${sections[s.key]!.map((i) => `- ${i.title}${i.detail ? ` (${i.detail})` : ""}`).join("\n")}`)
    .join("\n\n");
  if (!material) return null;
  const text = await generateText({
    system:
      "You are the chief of staff to the CEO of CytoHub, a biotech/AI company (human heart dataset, CytoHub.AI, pharma revenue, HeartReady). " +
      "Write in a calm, precise executive register. No hype, no emoji, no markdown.",
    prompt:
      `Overnight changes detected by CytoHub Brain (stats: ${JSON.stringify(stats)}):\n\n${material}\n\n` +
      'Return exactly two lines. Line 1: "HEADLINE: " followed by a headline of at most 16 words naming what matters most today. ' +
      'Line 2: "SUMMARY: " followed by at most 3 sentences on why, and where the CEO should spend attention.',
    maxTokens: 2000,
    effort: "low",
  });
  if (!text) return null;
  const headline = /HEADLINE:\s*(.+)/i.exec(text)?.[1]?.trim();
  const summary = /SUMMARY:\s*([\s\S]+)/i.exec(text)?.[1]?.trim();
  return headline && summary ? { headline, summary } : null;
}
