/**
 * Workspace analyzers: read the live execution graph and propose insights.
 * Each analyzer is independent and idempotent — fingerprints make repeated
 * refreshes update existing insights instead of duplicating them.
 */
import { addDays, dayKey, dayStartInstant, daysBetween, formatDateTime, formatDay, startOfWeek, toDay } from "@/lib/dates";
import { OPEN_TASK_STATUSES } from "@/lib/domain";
import { formatCurrency, formatPercent } from "@/lib/format";
import { computeAttention } from "../attention";
import { getMetricViews } from "../metrics";
import type { BrainContext, InsightDraft } from "../types";

const weekKey = (ctx: BrainContext) => dayKey(startOfWeek(ctx.today));

export async function analyzeExecution(ctx: BrainContext): Promise<InsightDraft[]> {
  const drafts: InsightDraft[] = [];
  const tasks = await ctx.tx.task.findMany({
    where: { ownerId: ctx.ceoPersonId, status: { in: OPEN_TASK_STATUSES }, delegation: { is: null } },
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      dueDate: true,
      hardDeadline: true,
      postponeCount: true,
      blocker: true,
      priorityScore: true,
      goalId: true,
      milestoneId: true,
      companyId: true,
    },
  });

  for (const t of tasks) {
    const days = t.dueDate ? daysBetween(ctx.today, t.dueDate) : null;
    const important = t.priority === "P0" || t.priority === "P1" || t.priorityScore >= 55;

    if (days !== null && days < 0 && important) {
      const critical = t.priority === "P0" || t.hardDeadline;
      drafts.push({
        type: "DEADLINE",
        fingerprint: `task-overdue:${t.id}:${dayKey(t.dueDate!)}`,
        title: `“${t.title}” is ${-days} day${days === -1 ? "" : "s"} overdue`,
        summary: t.blocker ? `Blocker: ${t.blocker}` : `Was due ${formatDay(t.dueDate)}.`,
        importance: critical ? 5 : 4,
        requiresCeo: true,
        recommendation: "Do it today, renegotiate the date explicitly, or delegate it.",
        taskId: t.id,
        goalId: t.goalId,
        milestoneId: t.milestoneId,
        companyId: t.companyId,
        inbox: critical
          ? {
              type: "DEADLINE_RISK",
              whyCeo: "A critical commitment you own is past due; the people depending on it are waiting on you.",
              recommendedAction: "Complete it today or reset expectations with the stakeholders now.",
              urgency: 5,
              dueDate: t.dueDate,
            }
          : undefined,
      });
    } else if (days !== null && days >= 0 && days <= 1 && t.hardDeadline) {
      drafts.push({
        type: "DEADLINE",
        fingerprint: `task-due:${t.id}:${dayKey(t.dueDate!)}`,
        title: `Hard deadline ${days === 0 ? "today" : "tomorrow"}: ${t.title}`,
        importance: 4,
        requiresCeo: true,
        taskId: t.id,
        goalId: t.goalId,
        companyId: t.companyId,
      });
    }

    if (t.postponeCount >= 3) {
      drafts.push({
        type: "RISK",
        fingerprint: `postponed:${t.id}:${t.postponeCount}`,
        title: `“${t.title}” has been postponed ${t.postponeCount} times`,
        summary: "Repeated postponement usually means the task is unclear, unimportant or should be owned by someone else.",
        importance: 2,
        recommendation: "Decide this week: do it, delegate it, or drop it.",
        taskId: t.id,
      });
    }

    if (t.status === "BLOCKED" && important) {
      drafts.push({
        type: "RISK",
        fingerprint: `task-blocked:${t.id}`,
        title: `Blocked: ${t.title}`,
        summary: t.blocker ?? "No blocker recorded.",
        importance: 3,
        recommendation: "Identify who can unblock this and ask today.",
        taskId: t.id,
        goalId: t.goalId,
      });
    }
  }
  ctx.log("execution", `${tasks.length} CEO tasks analyzed, ${drafts.length} signals raised`);
  return drafts;
}

export async function analyzeMilestones(ctx: BrainContext): Promise<{ drafts: InsightDraft[]; changed: number }> {
  const drafts: InsightDraft[] = [];
  const milestones = await ctx.tx.milestone.findMany({
    where: {
      OR: [{ status: { notIn: ["COMPLETED", "MISSED"] } }, { completedAt: { gt: ctx.since, lte: ctx.now } }],
    },
    include: { owner: { select: { name: true } }, goal: { select: { title: true } } },
  });
  let changed = 0;

  for (const m of milestones) {
    const days = daysBetween(ctx.today, m.dueDate);
    const owner = m.owner?.name ?? "unassigned";
    if (m.status === "COMPLETED") {
      if (m.completedAt && m.completedAt > ctx.since && m.completedAt <= ctx.now) {
        changed++;
        drafts.push({
          type: "MILESTONE_REACHED",
          fingerprint: `ms-done:${m.id}`,
          title: `Milestone reached: ${m.title}`,
          summary: m.goal ? `Advances “${m.goal.title}”.` : undefined,
          importance: 4,
          milestoneId: m.id,
          goalId: m.goalId,
          occurredAt: m.completedAt,
        });
      }
      continue;
    }
    if (days < 0) {
      drafts.push({
        type: "MILESTONE_AT_RISK",
        fingerprint: `ms-overdue:${m.id}:${dayKey(m.dueDate)}`,
        title: `Overdue milestone: ${m.title}`,
        summary: `Due ${formatDay(m.dueDate)} (${-days}d ago), ${m.progress}% complete. Owner: ${owner}.${m.blocker ? ` Blocker: ${m.blocker}` : ""}`,
        importance: 5,
        requiresCeo: true,
        recommendation: "Reset the date with a credible plan, or escalate the blocker personally.",
        milestoneId: m.id,
        goalId: m.goalId,
        inbox: {
          type: "DEADLINE_RISK",
          whyCeo: "A company milestone has slipped past its date; board and investor commitments may depend on it.",
          recommendedAction: `Meet ${owner} today: agree a new date and what it takes to hit it.`,
          urgency: 4,
          dueDate: m.dueDate,
        },
      });
    } else if (m.status === "AT_RISK" || m.status === "BLOCKED") {
      if (days <= 45) {
        drafts.push({
          type: "MILESTONE_AT_RISK",
          fingerprint: `ms-risk:${m.id}:${m.status}`,
          title: `${m.status === "BLOCKED" ? "Blocked" : "At risk"}: ${m.title}`,
          summary: `Due ${formatDay(m.dueDate)} (in ${days}d), ${m.progress}% complete.${m.blocker ? ` ${m.blocker}` : ""}`,
          importance: days <= 14 ? 5 : 4,
          requiresCeo: days <= 14,
          recommendation: m.blocker ? "Remove the blocker or re-scope the milestone." : "Review the plan with the owner this week.",
          milestoneId: m.id,
          goalId: m.goalId,
        });
      }
    } else if (days <= ctx.thresholds.milestoneDueSoonDays && m.progress < 60) {
      drafts.push({
        type: "MILESTONE_AT_RISK",
        fingerprint: `ms-lag:${m.id}:${weekKey(ctx)}`,
        title: `${m.title} due in ${days}d at ${m.progress}%`,
        summary: `Progress is behind what the date requires. Owner: ${owner}.`,
        importance: 3,
        recommendation: "Confirm the plan to finish, or move the date now rather than later.",
        milestoneId: m.id,
        goalId: m.goalId,
      });
    }
  }
  ctx.log("milestones", `${milestones.length} milestones analyzed`);
  return { drafts, changed };
}

export async function analyzeGoals(ctx: BrainContext): Promise<InsightDraft[]> {
  const goals = await ctx.tx.goal.findMany({
    where: { status: { in: ["AT_RISK", "OFF_TRACK"] } },
    include: { owner: { select: { name: true } } },
  });
  const drafts = goals
    .filter((g) => g.status === "OFF_TRACK" || g.confidence < 60)
    .map<InsightDraft>((g) => ({
      type: "RISK",
      fingerprint: `goal:${g.id}:${g.status}`,
      title: `Goal ${g.status === "OFF_TRACK" ? "off track" : "at risk"}: ${g.title}`,
      summary: `${g.progress}% complete, ${g.confidence}% confidence${g.targetDate ? `, target ${formatDay(g.targetDate, true)}` : ""}.${g.risks ? ` ${g.risks}` : ""}`,
      importance: g.status === "OFF_TRACK" ? 4 : 3,
      requiresCeo: g.status === "OFF_TRACK",
      recommendation: `Review with ${g.owner?.name ?? "the owner"}: re-scope, add resources, or reset the target.`,
      goalId: g.id,
    }));
  ctx.log("goals", `${goals.length} goals at risk or off track`);
  return drafts;
}

export async function analyzeDecisions(ctx: BrainContext): Promise<InsightDraft[]> {
  const decisions = await ctx.tx.decision.findMany({ where: { status: { in: ["NEEDED", "WAITING_INFO"] } } });
  const drafts: InsightDraft[] = [];
  for (const d of decisions) {
    const days = d.deadline ? daysBetween(ctx.today, d.deadline) : null;
    if (d.status === "NEEDED" && ((days !== null && days <= 7) || d.strategicImpact >= 4)) {
      drafts.push({
        type: "DECISION_NEEDED",
        fingerprint: `decision:${d.id}`,
        title: d.title,
        summary: d.recommendation ? `Recommendation: ${d.recommendation}` : (d.context ?? undefined),
        importance: Math.max(3, d.strategicImpact),
        requiresCeo: true,
        decisionId: d.id,
        goalId: d.goalId,
        inbox: {
          type: "DECISION",
          whyCeo: `Strategic impact ${d.strategicImpact}/5${days !== null ? `; deadline ${days <= 0 ? "is today" : `in ${days}d`}` : ""}. Only you can make this call.`,
          recommendedAction: d.recommendation ? `Decide — the recommendation is: ${d.recommendation}` : "Review options and decide, or name what information is missing.",
          urgency: days !== null && days <= 2 ? 5 : 4,
          dueDate: d.deadline,
        },
      });
    } else if (d.status === "WAITING_INFO" && daysBetween(d.raisedAt, ctx.now) >= 7) {
      drafts.push({
        type: "FOLLOW_UP",
        fingerprint: `decision-wait:${d.id}:${weekKey(ctx)}`,
        title: `Decision waiting on information: ${d.title}`,
        summary: d.waitingOn ? `Waiting on: ${d.waitingOn}` : undefined,
        importance: 2,
        recommendation: "Chase the missing input or set a date to decide with what you have.",
        decisionId: d.id,
      });
    }
  }
  ctx.log("decisions", `${decisions.length} open decisions analyzed`);
  return drafts;
}

export async function analyzeDelegations(ctx: BrainContext): Promise<InsightDraft[]> {
  const delegations = await ctx.tx.delegation.findMany({
    where: { status: { in: ["ACTIVE", "NEEDS_FOLLOW_UP"] } },
    include: { task: { select: { id: true, title: true, goalId: true } }, delegate: { select: { id: true, name: true } } },
  });
  const drafts: InsightDraft[] = [];
  for (const d of delegations) {
    const last = d.lastUpdateAt ?? d.delegatedAt;
    const silentDays = daysBetween(last, ctx.now);
    const overdue = d.dueDate ? daysBetween(ctx.today, d.dueDate) < 0 : false;
    if (silentDays >= ctx.thresholds.delegationFollowUpDays || overdue) {
      if (d.status !== "NEEDS_FOLLOW_UP") {
        await ctx.tx.delegation.update({ where: { id: d.id }, data: { status: "NEEDS_FOLLOW_UP" } });
      }
      drafts.push({
        type: "FOLLOW_UP",
        fingerprint: `deleg:${d.id}:${weekKey(ctx)}`,
        title: `Follow up with ${d.delegate.name}: ${d.task.title}`,
        summary: overdue ? `Past due (${formatDay(d.dueDate)}).` : `No update in ${silentDays} days.`,
        importance: overdue ? 3 : 2,
        recommendation: "Ask for a status update and a committed date.",
        taskId: d.task.id,
        personId: d.delegate.id,
        goalId: d.task.goalId,
      });
    }
  }

  const recs = await ctx.tx.task.count({ where: { delegationRecommended: true, status: { in: OPEN_TASK_STATUSES } } });
  if (recs > 0) {
    drafts.push({
      type: "DELEGATION",
      fingerprint: `deleg-recs:${weekKey(ctx)}`,
      title: `${recs} task${recs === 1 ? "" : "s"} on your plate could be delegated`,
      summary: "These don't require you personally and are crowding out CEO-only work.",
      importance: 2,
      recommendation: "Open the Delegation Center and hand them off with clear expectations.",
    });
  }
  ctx.log("delegation", `${delegations.length} active delegations, ${recs} delegation recommendations`);
  return drafts;
}

export async function analyzeDeals(ctx: BrainContext): Promise<InsightDraft[]> {
  const deals = await ctx.tx.deal.findMany({
    where: { OR: [{ status: "OPEN" }, { status: "WON", stageChangedAt: { gt: ctx.since, lte: ctx.now } }] },
    include: { company: { select: { name: true } } },
  });
  const drafts: InsightDraft[] = [];
  const staleBefore = dayStartInstant(addDays(ctx.today, -ctx.thresholds.dealStaleDays), ctx.timezone);
  for (const d of deals) {
    const label = d.type === "FUNDRAISING" ? "Investor" : d.type === "PARTNERSHIP" ? "Partnership" : "Deal";
    if (d.status === "OPEN" && d.lastActivityAt && d.lastActivityAt < staleBefore) {
      const idle = daysBetween(d.lastActivityAt, ctx.now);
      const big = (d.value ?? 0) >= 1_000_000 || d.type === "FUNDRAISING";
      drafts.push({
        type: "DEAL_SLOWING",
        fingerprint: `deal-stale:${d.id}:${dayKey(d.lastActivityAt)}`,
        title: `${label} slowing: ${d.name}`,
        summary: `No activity for ${idle} days at “${d.stage}”${d.value ? ` (${formatCurrency(d.value)})` : ""}.${d.nextStep ? ` Next step: ${d.nextStep}` : ""}`,
        importance: big ? 4 : 3,
        recommendation: d.type === "FUNDRAISING" ? "Re-engage with a concrete update or ask." : "Have the owner re-engage; consider a CEO-to-executive touch.",
        dealId: d.id,
        companyId: d.companyId,
      });
    }
    if (d.status === "OPEN" && d.stageChangedAt && d.stageChangedAt > ctx.since && d.stageChangedAt <= ctx.now) {
      drafts.push({
        type: "DEAL_PROGRESS",
        fingerprint: `deal-stage:${d.id}:${d.stage}`,
        title: `${label} advanced: ${d.name} → ${d.stage}`,
        summary: `${d.company?.name ?? d.name}${d.value ? `, ${formatCurrency(d.value)}` : ""} at ${d.probability}% probability.`,
        importance: 3,
        dealId: d.id,
        companyId: d.companyId,
      });
    }
    if (d.status === "WON") {
      drafts.push({
        type: "DEVELOPMENT",
        fingerprint: `deal-won:${d.id}`,
        title: `Won: ${d.name}${d.value ? ` (${formatCurrency(d.value)})` : ""}`,
        importance: 4,
        dealId: d.id,
        companyId: d.companyId,
      });
    }
  }
  ctx.log("deals", `${deals.length} deals analyzed`);
  return drafts;
}

export async function analyzeInvestors(ctx: BrainContext): Promise<InsightDraft[]> {
  const cutoff = dayStartInstant(addDays(ctx.today, -ctx.thresholds.investorFollowUpDays), ctx.timezone);
  const investors = await ctx.tx.person.findMany({
    where: {
      type: { in: ["INVESTOR", "BOARD"] },
      lastContactAt: { lt: cutoff },
      company: { deals: { some: { type: "FUNDRAISING", status: "OPEN" } } },
    },
    include: { company: { include: { deals: { where: { type: "FUNDRAISING", status: "OPEN" } } } } },
  });
  const drafts = investors.map<InsightDraft>((p) => {
    const deal = p.company?.deals[0];
    const idle = p.lastContactAt ? daysBetween(p.lastContactAt, ctx.now) : null;
    return {
      type: "FOLLOW_UP",
      fingerprint: `investor:${p.id}:${p.lastContactAt ? dayKey(p.lastContactAt) : "never"}`,
      title: `Investor follow-up: ${p.name} (${p.company?.name ?? "—"})`,
      summary: `Last contact ${idle !== null ? `${idle} days ago` : "unknown"}${deal ? `; ${deal.name} at “${deal.stage}”` : ""}.`,
      importance: deal && deal.probability >= 30 ? 4 : 3,
      requiresCeo: true,
      personId: p.id,
      companyId: p.companyId,
      dealId: deal?.id,
      inbox: {
        type: "INVESTOR_FOLLOW_UP",
        whyCeo: "Investor relationships in an active raise are CEO-owned; silence reads as lost momentum.",
        recommendedAction: `Send ${p.name.split(" ")[0]} a short update with one concrete proof point and a proposed next step.`,
        urgency: deal && deal.probability >= 30 ? 4 : 3,
      },
    };
  });
  ctx.log("investors", `${drafts.length} investor relationships need follow-up`);
  return drafts;
}

export async function analyzeMeetings(ctx: BrainContext): Promise<InsightDraft[]> {
  const meetings = await ctx.tx.meeting.findMany({
    where: { startsAt: { gte: ctx.now, lte: new Date(ctx.now.getTime() + 48 * 3_600_000) }, importance: { gte: 4 }, preparedAt: null },
  });
  const drafts = meetings.map<InsightDraft>((m) => ({
    type: "DEADLINE",
    fingerprint: `meeting-prep:${m.id}`,
    title: `Meeting prep: ${m.title}`,
    summary: `${formatDateTime(m.startsAt, ctx.timezone)}${m.objective ? ` — objective: ${m.objective}` : ""}`,
    importance: m.importance,
    requiresCeo: true,
    recommendation: "Open Prepare Me for context, talking points and the outcome to drive.",
    companyId: m.companyId,
    goalId: m.goalId,
  }));
  ctx.log("meetings", `${meetings.length} high-stakes meetings in the next 48h need preparation`);
  return drafts;
}

export async function analyzeAttention(ctx: BrainContext): Promise<InsightDraft[]> {
  const summary = await computeAttention(ctx.tx, {
    today: ctx.today,
    windowDays: ctx.thresholds.attentionWindowDays,
    tolerance: ctx.thresholds.attentionTolerance,
  });
  const drafts = summary.misaligned
    .filter((a) => Math.abs(a.gap) >= 5)
    .slice(0, 3)
    .map<InsightDraft>((a) => ({
      type: "ATTENTION",
      fingerprint: `attention:${a.area}:${weekKey(ctx)}`,
      title: `${a.label}: ${formatPercent(a.actualPct)} of your time vs ${formatPercent(a.recommendedPct)} recommended`,
      summary:
        a.flag === "under"
          ? `Under-invested by ${Math.abs(a.gap).toFixed(0)} points over the last ${summary.windowDays} days.${a.rationale ? ` ${a.rationale}` : ""}`
          : `Over-invested by ${a.gap.toFixed(0)} points over the last ${summary.windowDays} days — candidates for delegation.`,
      importance: a.flag === "under" ? 4 : 3,
      recommendation:
        a.flag === "under" ? `Block focused time for ${a.label.toLowerCase()} this week.` : `Delegate ${a.label.toLowerCase()} work you don't uniquely own.`,
    }));
  ctx.log("attention", `${summary.misaligned.length} focus areas misaligned`);
  return drafts;
}

export async function analyzeMetrics(ctx: BrainContext): Promise<InsightDraft[]> {
  const views = await getMetricViews(ctx.tx, { today: ctx.today });
  const drafts: InsightDraft[] = [];
  const runway = views.find((v) => v.sourceKey === "derived:cash.runway");
  if (runway?.current != null && runway.current < ctx.thresholds.runwayAlertMonths) {
    drafts.push({
      type: "RISK",
      fingerprint: `runway:${dayKey(ctx.today).slice(0, 7)}`,
      title: `Runway is ${runway.current.toFixed(1)} months`,
      summary: `Below your ${ctx.thresholds.runwayAlertMonths}-month alert threshold, based on the latest recorded cash and burn.`,
      importance: runway.current < 12 ? 5 : 4,
      requiresCeo: true,
      recommendation: "Keep the raise on its critical path; review burn scenarios with the CFO.",
    });
  }
  const sinceDay = toDay(ctx.since, ctx.timezone);
  for (const v of views) {
    const last = v.series.at(-1);
    if (v.derived || v.change === null || !last || last.date < sinceDay || last.date > ctx.today) continue;
    if (Math.abs(v.change) < 0.1) continue;
    const good = (v.change > 0) === (v.direction === "HIGHER_IS_BETTER");
    drafts.push({
      type: good ? "DEVELOPMENT" : "RISK",
      fingerprint: `metric:${v.key}:${dayKey(last.date)}`,
      title: `${v.name} ${v.change > 0 ? "up" : "down"} ${Math.abs(v.change * 100).toFixed(0)}%`,
      importance: 3,
    });
  }
  return drafts;
}
