/**
 * Seeds the CytoHub sample workspace, then runs the real Daily Brain Refresh
 * twice — once as of yesterday morning and once now — so the dashboard opens
 * with a genuine "since yesterday" brief produced by the pipeline.
 *
 *   npm run db:seed
 */
import "dotenv/config";
import type { FocusArea, Prisma } from "../src/generated/prisma/client";
import { db } from "../src/lib/db";
import {
  addDays,
  dayKey,
  dayStartInstant,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  today as todayIn,
} from "../src/lib/dates";
import { runBrainRefresh } from "../src/server/brain/refresh";
import { DEFAULT_WEIGHTS, scoreTask } from "../src/server/brain/scoring";
import { DEFAULT_THRESHOLDS } from "../src/server/settings";
import { CONNECTOR_DEFINITIONS } from "../src/server/brain/connectors";
import {
  ATTENTION_TARGETS,
  CANCELLED_TASKS,
  COMPANIES,
  COMPLETED_CEO_TASKS,
  DEALS,
  DECISIONS,
  DELEGATED_TASKS,
  EXTERNAL_PEOPLE,
  GOALS,
  MEETINGS,
  METRICS,
  MILESTONES,
  OPEN_CEO_TASKS,
  PILLARS,
  RESOURCES,
  SIGNALS,
  TEAM,
  TEAM_TASKS,
  type TaskSeed,
} from "./seed-data";

const TZ = process.env.SEED_TIMEZONE || process.env.DEFAULT_TIMEZONE || "America/New_York";
const CEO_NAME = process.env.CEO_NAME || "CEO";
const NOW = new Date();
const TODAY = todayIn(TZ, NOW);
const HOUR = 3_600_000;

// Deterministic noise so every seed looks the same.
let rngState = 20261006;
function rand() {
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const day = (offset: number) => addDays(TODAY, offset);
/** Offset that lands on a weekday (forward for future, backward for past). */
function workday(offset: number): Date {
  let d = day(offset);
  const dow = d.getUTCDay();
  if (offset >= 0) {
    if (dow === 6) d = addDays(d, 2);
    if (dow === 0) d = addDays(d, 1);
  } else {
    if (dow === 6) d = addDays(d, -1);
    if (dow === 0) d = addDays(d, -2);
  }
  return d;
}
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * HOUR);
function atLocal(d: Date, hour: number, minute = 0) {
  return new Date(dayStartInstant(d, TZ).getTime() + hour * HOUR + minute * 60_000);
}
const due = (offset: number | null | undefined) => (offset == null ? null : offset === 0 ? TODAY : workday(offset));

async function wipe() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    await db.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  }
}

async function main() {
  console.log(`Seeding CytoHub workspace (today = ${dayKey(TODAY)}, ${TZ})`);
  await wipe();

  // ── Settings ──────────────────────────────────────────────────────────────
  await db.appSetting.createMany({
    data: [
      { key: "priorityWeights", value: DEFAULT_WEIGHTS },
      { key: "brainThresholds", value: { ...DEFAULT_THRESHOLDS } },
    ],
  });
  await db.attentionTarget.createMany({
    data: ATTENTION_TARGETS.map((t) => ({ focusArea: t.area, recommendedPct: t.pct, rationale: t.rationale })),
  });

  const pillarId: Record<string, string> = {};
  for (const [i, p] of PILLARS.entries()) {
    const row = await db.strategicPillar.create({ data: { name: p.name, description: p.description, color: p.color, order: i } });
    pillarId[p.key] = row.id;
  }

  // ── People & companies ────────────────────────────────────────────────────
  const companyId: Record<string, string> = {};
  for (const c of COMPANIES) {
    const row = await db.company.create({
      data: {
        name: c.name,
        type: c.type,
        industry: c.industry,
        location: c.location,
        website: c.website,
        description: c.description,
        relationship: c.relationship,
        lastActivityAt: c.lastActivityDaysAgo != null ? hoursAgo(c.lastActivityDaysAgo * 24 + 2) : null,
      },
    });
    companyId[c.key] = row.id;
  }

  const personId: Record<string, string> = {};
  const ceo = await db.person.create({
    data: { name: CEO_NAME, title: "Chief Executive Officer", type: "TEAM", isCeo: true, department: "Office of the CEO", email: "ceo@cytohub.example" },
  });
  personId.ceo = ceo.id;
  await db.user.create({ data: { name: CEO_NAME, email: "ceo@cytohub.example", timezone: TZ, personId: ceo.id } });

  for (const p of [...TEAM, ...EXTERNAL_PEOPLE]) {
    const row = await db.person.create({
      data: {
        name: p.name,
        title: p.title,
        type: p.type,
        department: p.department,
        expertise: p.expertise ?? [],
        companyId: p.company ? companyId[p.company] : null,
        lastContactAt: p.lastContactDaysAgo != null ? hoursAgo(p.lastContactDaysAgo * 24 + 3) : null,
        notesText: p.notes,
        email: `${p.key}@${p.company ?? "cytohub"}.example`,
      },
    });
    personId[p.key] = row.id;
  }

  // ── Goals ─────────────────────────────────────────────────────────────────
  const yearStart = new Date(Date.UTC(TODAY.getUTCFullYear(), 0, 1));
  const yearEnd = new Date(Date.UTC(TODAY.getUTCFullYear(), 11, 31));
  const qStart = startOfQuarter(TODAY);
  const qEnd = addDays(new Date(Date.UTC(qStart.getUTCFullYear(), qStart.getUTCMonth() + 3, 1)), -1);
  const prevQStart = startOfQuarter(addDays(qStart, -1));
  const quarterLabel = (d: Date) => `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
  const resolveDate = (v: number | string | undefined) =>
    v === undefined ? null : v === "yearStart" ? yearStart : v === "yearEnd" ? yearEnd : v === "quarterStart" ? qStart : v === "quarterEnd" ? qEnd : day(v as number);

  const goalId: Record<string, string> = {};
  for (const g of GOALS) {
    const row = await db.goal.create({
      data: {
        title: g.title,
        description: g.description,
        type: g.type,
        status: g.status,
        progress: g.progress,
        confidence: g.confidence,
        department: g.department,
        period: g.period === "quarter" ? quarterLabel(TODAY) : g.period === "prevQuarter" ? quarterLabel(prevQStart) : String(TODAY.getUTCFullYear()),
        startDate: resolveDate(g.start),
        targetDate: resolveDate(g.target),
        risks: g.risks,
        notesText: g.notes,
        pillarId: pillarId[g.pillar],
        ownerId: personId[g.owner],
        completedAt: g.completedDaysAgo != null ? hoursAgo(g.completedDaysAgo * 24) : null,
        createdAt: g.start === "quarterStart" ? qStart : yearStart,
      },
    });
    goalId[g.key] = row.id;
  }
  for (const g of GOALS.filter((g) => g.parent)) {
    await db.goal.update({ where: { id: goalId[g.key] }, data: { parentId: goalId[g.parent!] } });
  }
  const goalPillar = (key?: string) => (key ? pillarId[GOALS.find((g) => g.key === key)!.pillar] : null);

  // ── Milestones ────────────────────────────────────────────────────────────
  const milestoneId: Record<string, string> = {};
  for (const m of MILESTONES) {
    const row = await db.milestone.create({
      data: {
        title: m.title,
        description: m.description,
        type: m.type,
        status: m.status,
        progress: m.progress,
        dueDate: due(m.due)!,
        completedAt: m.completedHoursAgo != null ? hoursAgo(m.completedHoursAgo) : null,
        blocker: m.blocker,
        successMetric: m.successMetric,
        goalId: goalId[m.goal],
        pillarId: goalPillar(m.goal),
        ownerId: personId[m.owner],
        createdAt: addDays(TODAY, -90),
      },
    });
    milestoneId[m.key] = row.id;
  }

  // ── Decisions ─────────────────────────────────────────────────────────────
  const decisionId: Record<string, string> = {};
  for (const d of DECISIONS) {
    const row = await db.decision.create({
      data: {
        title: d.title,
        context: d.context,
        status: d.status,
        raisedAt: hoursAgo(d.raisedDaysAgo * 24 + 4),
        deadline: due(d.deadline),
        strategicImpact: d.impact,
        supportingInfo: d.supportingInfo,
        recommendation: d.recommendation,
        waitingOn: d.waitingOn,
        finalDecision: d.finalDecision,
        decidedAt: d.decidedDaysAgo != null ? hoursAgo(d.decidedDaysAgo * 24) : null,
        outcome: d.outcome,
        lessonsLearned: d.lessons,
        goalId: d.goal ? goalId[d.goal] : null,
        pillarId: pillarId[d.pillar],
        ownerId: personId.ceo,
        companies: d.companies ? { connect: d.companies.map((c) => ({ id: companyId[c] })) } : undefined,
        options: {
          create: d.options.map((o, i) => ({ title: o.title, description: o.description, pros: o.pros, cons: o.cons, risks: o.risks, recommended: o.recommended ?? false, order: i })),
        },
      },
    });
    decisionId[d.key] = row.id;
  }

  // ── Deals ─────────────────────────────────────────────────────────────────
  const dealId: Record<string, string> = {};
  for (const d of DEALS) {
    const row = await db.deal.create({
      data: {
        name: d.name,
        type: d.type,
        status: d.status ?? "OPEN",
        stage: d.stage,
        stageOrder: d.stageOrder,
        value: d.value,
        probability: d.probability,
        expectedClose: d.expectedClose != null ? day(d.expectedClose) : null,
        stageChangedAt: hoursAgo(d.stageChangedHoursAgo),
        lastActivityAt: d.lastActivityLocal ? atLocal(day(d.lastActivityLocal[0]), d.lastActivityLocal[1]) : hoursAgo(d.lastActivityHoursAgo),
        nextStep: d.nextStep,
        companyId: companyId[d.company],
        ownerId: personId[d.owner],
        createdAt: hoursAgo(Math.max(d.stageChangedHoursAgo, 30 * 24)),
      },
    });
    dealId[d.key] = row.id;
  }

  // ── Tasks ─────────────────────────────────────────────────────────────────
  const taskId: Record<string, string> = {};
  async function createTask(t: TaskSeed) {
    const owner = t.owner ?? "ceo";
    const completedAt = t.completedDaysAgo != null ? atLocal(day(-t.completedDaysAgo), 10 + Math.floor(rand() * 7), Math.floor(rand() * 60)) : null;
    const status = t.status ?? (t.completedDaysAgo != null ? "DONE" : "TODO");
    const dueDate = t.due !== undefined ? due(t.due) : completedAt ? day(-t.completedDaysAgo! + Math.round(rand() * 2)) : null;
    const createdAt = t.createdDaysAgo != null ? hoursAgo(t.createdDaysAgo * 24 + 5) : completedAt ? new Date(completedAt.getTime() - (3 + Math.round(rand() * 10)) * 24 * HOUR) : hoursAgo(72);
    const [s, r, f, c, sci, risk, u, opp] = t.impact;
    const row = await db.task.create({
      data: {
        title: t.title,
        description: t.description,
        status,
        priority: t.priority ?? (s >= 5 ? "P1" : s >= 3 ? "P2" : "P3"),
        focusArea: t.focus,
        dueDate,
        originalDueDate: t.originalDue != null ? due(t.originalDue) : dueDate,
        postponeCount: t.postponed ?? 0,
        hardDeadline: t.hard ?? false,
        completedAt,
        estimatedMinutes: t.est,
        actualMinutes: t.act ?? (status === "DONE" ? t.est : null),
        blocker: t.blocker,
        source: t.source ?? "MANUAL",
        notesText: t.notes,
        tags: t.tags ?? [],
        strategicImpact: s,
        revenueImpact: r,
        fundraisingImpact: f,
        customerImpact: c,
        scientificImpact: sci,
        riskLevel: risk,
        ceoUniqueness: u,
        opportunityCost: opp,
        ownerId: personId[owner],
        goalId: t.goal ? goalId[t.goal] : null,
        milestoneId: t.ms ? milestoneId[t.ms] : null,
        pillarId: t.pillar ? pillarId[t.pillar] : goalPillar(t.goal),
        companyId: t.company ? companyId[t.company] : null,
        decisionId: t.decision ? decisionId[t.decision] : null,
        people: t.people ? { connect: t.people.map((p) => ({ id: personId[p] })) } : undefined,
        createdAt,
      },
    });
    taskId[t.key] = row.id;
    return row;
  }

  const allTasks = [...OPEN_CEO_TASKS, ...DELEGATED_TASKS, ...TEAM_TASKS, ...COMPLETED_CEO_TASKS, ...CANCELLED_TASKS];
  for (const t of allTasks) await createTask(t);
  for (const t of allTasks.filter((t) => t.dependsOn)) {
    await db.task.update({ where: { id: taskId[t.key] }, data: { dependsOn: { connect: t.dependsOn!.map((k) => ({ id: taskId[k] })) } } });
  }

  // Delegations
  for (const t of DELEGATED_TASKS) {
    const d = t.delegation!;
    const delegation = await db.delegation.create({
      data: {
        taskId: taskId[t.key],
        delegateId: personId[t.owner!],
        status: d.status ?? "ACTIVE",
        expectations: d.expectations,
        delegatedAt: hoursAgo(d.delegatedDaysAgo * 24 + 2),
        dueDate: due(d.due),
        lastUpdateAt: d.lastUpdateDaysAgo != null ? hoursAgo(d.lastUpdateDaysAgo * 24 + 1) : null,
        lastUpdateNote: d.note,
        completedAt: d.status === "COMPLETED" && t.completedDaysAgo != null ? hoursAgo(t.completedDaysAgo * 24) : null,
      },
    });
    await db.activity.create({
      data: { type: "TASK_DELEGATED", summary: `Delegated “${t.title}” to ${TEAM.find((p) => p.key === t.owner)!.name}`, taskId: taskId[t.key], delegationId: delegation.id, personId: personId[t.owner!], createdAt: hoursAgo(d.delegatedDaysAgo * 24 + 2) },
    });
    if (d.note && d.lastUpdateDaysAgo != null) {
      await db.activity.create({
        data: { type: "DELEGATION_UPDATED", summary: d.note, actor: TEAM.find((p) => p.key === t.owner)!.name, taskId: taskId[t.key], delegationId: delegation.id, createdAt: hoursAgo(d.lastUpdateDaysAgo * 24 + 1) },
      });
    }
  }

  // ── Resources ─────────────────────────────────────────────────────────────
  for (const r of RESOURCES) {
    const connect = (keys: string[] | undefined, ids: Record<string, string>) => (keys?.length ? { connect: keys.map((k) => ({ id: ids[k] })) } : undefined);
    await db.resource.create({
      data: {
        title: r.title,
        type: r.type,
        url: r.url,
        description: r.description,
        summary: r.summary,
        tags: r.tags ?? [],
        source: r.source ?? "MANUAL",
        goals: connect(r.goals, goalId),
        tasks: connect(r.tasks, taskId),
        milestones: connect(r.milestones, milestoneId),
        decisions: connect(r.decisions, decisionId),
        people: connect(r.people, personId),
        companies: connect(r.companies, companyId),
        createdAt: hoursAgo(24 * (3 + Math.floor(rand() * 30))),
      },
    });
  }

  // ── Meetings ──────────────────────────────────────────────────────────────
  for (const m of MEETINGS) {
    const d = m.day === 0 ? TODAY : workday(m.day);
    const startsAt = atLocal(d, m.hour, m.minute ?? 0);
    const row = await db.meeting.create({
      data: {
        title: m.title,
        type: m.type,
        focusArea: m.focus,
        startsAt,
        endsAt: new Date(startsAt.getTime() + m.durationMin * 60_000),
        location: m.location,
        description: m.description,
        objective: m.objective,
        importance: m.importance,
        companyId: m.company ? companyId[m.company] : null,
        goalId: m.goal ? goalId[m.goal] : null,
        externalId: `sample-${m.key}`,
        attendees: { connect: [personId.ceo, ...m.attendees.map((a) => personId[a])].map((id) => ({ id })) },
      },
    });
    if (m.notes) {
      await db.note.create({ data: { body: m.notes, meetingId: row.id, companyId: m.company ? companyId[m.company] : null, createdAt: new Date(startsAt.getTime() + m.durationMin * 60_000) } });
    }
  }

  // ── Metrics ───────────────────────────────────────────────────────────────
  const monthStarts = Array.from({ length: 12 }, (_, i) => startOfMonth(new Date(Date.UTC(TODAY.getUTCFullYear(), TODAY.getUTCMonth() - (11 - i), 1))));
  for (const [i, m] of METRICS.entries()) {
    const metric = await db.metric.create({
      data: {
        key: m.key,
        name: m.name,
        category: m.category,
        unit: m.unit,
        direction: m.direction ?? "HIGHER_IS_BETTER",
        target: m.target,
        targetDate: m.target != null ? yearEnd : null,
        sourceKey: m.sourceKey ?? "manual",
        description: m.description,
        order: i,
        pillarId: m.pillar ? pillarId[m.pillar] : null,
        goalId: m.goal ? goalId[m.goal] : null,
      },
    });
    const values: Prisma.MetricValueCreateManyInput[] = [];
    m.monthly?.forEach((v, idx) => {
      if (monthStarts[idx] <= TODAY) values.push({ metricId: metric.id, recordedAt: monthStarts[idx], value: v, source: m.sourceKey ?? "manual" });
    });
    if (m.latest) {
      const at = day(-m.latest.daysAgo);
      if (!values.some((v) => (v.recordedAt as Date).getTime() === at.getTime())) {
        values.push({ metricId: metric.id, recordedAt: at, value: m.latest.value, source: m.sourceKey ?? "manual" });
      }
    }
    if (values.length) await db.metricValue.createMany({ data: values });
    if (m.weeklyFactors) await seedDerivedHistory(metric.id, m.key, m.weeklyFactors);
  }

  // ── CEO time allocation (calendar + task effort) ─────────────────────────
  const recentMix: Partial<Record<FocusArea, number>> = { FUNDRAISING: 13, REVENUE: 12, CUSTOMERS: 11, PRODUCT: 8, CYTOHUB_AI: 6, SCIENCE: 5, PARTNERSHIPS: 4, TEAM: 9, FINANCE: 6, OPERATIONS: 14, LEGAL: 4, RECRUITING: 3, STRATEGY: 3, CEO_DEVELOPMENT: 2 };
  const earlierMix: Partial<Record<FocusArea, number>> = { FUNDRAISING: 20, REVENUE: 13, CUSTOMERS: 10, PRODUCT: 6, CYTOHUB_AI: 7, SCIENCE: 6, PARTNERSHIPS: 5, TEAM: 9, FINANCE: 5, OPERATIONS: 8, LEGAL: 3, RECRUITING: 4, STRATEGY: 3, CEO_DEVELOPMENT: 1 };
  const entries: Prisma.TimeEntryCreateManyInput[] = [];
  for (let back = 1; back <= 63; back++) {
    const d = day(-back);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const mix = back <= 14 ? recentMix : earlierMix;
    const total = 520 + Math.round(rand() * 80);
    for (const [area, pct] of Object.entries(mix) as [FocusArea, number][]) {
      const minutes = Math.round(((total * pct) / 100) * (0.75 + rand() * 0.5));
      if (minutes < 5) continue;
      entries.push({ date: d, minutes, focusArea: area, source: rand() < 0.7 ? "CALENDAR" : "TASK", description: "Sample calendar and task time" });
    }
  }
  await db.timeEntry.createMany({ data: entries });

  // ── Brain sources & signals ───────────────────────────────────────────────
  const sampleSources = new Set(["outlook-mail", "outlook-calendar", "teams", "sharepoint", "hubspot", "granola"]);
  const sourceId: Record<string, string> = {};
  for (const c of CONNECTOR_DEFINITIONS) {
    const row = await db.brainSource.create({
      data: {
        key: c.key,
        name: c.name,
        category: c.category,
        description: c.description,
        status: c.key === "workspace" || sampleSources.has(c.key) ? "CONNECTED" : "NOT_CONNECTED",
        config: sampleSources.has(c.key) ? { mode: "sample", provider: c.provider } : { provider: c.provider },
        lastSyncAt: sampleSources.has(c.key) ? hoursAgo(25) : null,
      },
    });
    sourceId[c.key] = row.id;
  }

  const resolveLinks = (links?: Record<string, string>) => {
    if (!links) return undefined;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(links)) {
      out[k] = k === "decisionId" ? decisionId[v] : k === "milestoneId" ? milestoneId[v] : k === "goalId" ? goalId[v] : k === "taskId" ? taskId[v] : v;
    }
    return out;
  };
  for (const [i, s] of SIGNALS.entries()) {
    const meta = { ...s.meta } as Record<string, unknown>;
    if (meta.links) meta.links = resolveLinks(meta.links as Record<string, string>);
    if (typeof meta.dueOffset === "number") meta.dueDate = dayKey(workday(meta.dueOffset as number));
    if (meta.commitment) {
      const c = { ...(meta.commitment as Record<string, unknown>) };
      if (typeof c.dueOffset === "number") c.dueDate = dayKey(workday(c.dueOffset as number));
      meta.commitment = c;
    }
    await db.brainSignal.create({
      data: {
        sourceId: sourceId[s.source],
        externalId: `sample-${i}`,
        kind: s.kind,
        title: s.title,
        body: s.body,
        occurredAt: hoursAgo(s.hoursAgo),
        ingestedAt: hoursAgo(Math.max(0.2, s.hoursAgo - 0.1)),
        metadata: meta as Prisma.InputJsonValue,
        personId: s.person ? personId[s.person] : null,
        companyId: s.company ? companyId[s.company] : null,
        dealId: s.deal ? dealId[s.deal] : null,
      },
    });
  }
  for (const key of sampleSources) {
    await db.brainSource.update({ where: { key }, data: { itemsIndexed: await db.brainSignal.count({ where: { sourceId: sourceId[key] } }) * 37 + 120 } });
  }

  // ── History: activities, goals, day plans, reviews ───────────────────────
  await seedHistory({ taskId, goalId, milestoneId, decisionId, personId });

  // ── Brain: yesterday's and today's refresh through the real pipeline ─────
  const yesterdayRun = hoursAgo(24);
  const y = await runBrainRefresh({ trigger: "SCHEDULED", now: yesterdayRun });
  console.log(`  Yesterday's refresh: ${y.status}, ${y.insightsCreated} insights, ${y.inboxCreated} inbox items`);
  const yesterday = addDays(TODAY, -1);
  await db.dailyBrief.updateMany({ where: { date: yesterday }, data: { reviewedAt: new Date(yesterdayRun.getTime() + 0.4 * HOUR) } });
  await db.dayPlan.updateMany({
    where: { date: yesterday },
    data: {
      briefReviewedAt: new Date(yesterdayRun.getTime() + 0.4 * HOUR),
      top5ConfirmedAt: new Date(yesterdayRun.getTime() + 0.6 * HOUR),
      endOfDayAt: new Date(yesterdayRun.getTime() + 11 * HOUR),
      endOfDayNotes: "Calder closed. Brightwater redlines back. Protect Thursday prep time for Northbridge.",
    },
  });
  // A few inbox items from yesterday were handled.
  const handled = await db.inboxItem.findMany({ where: { status: "OPEN" }, orderBy: { urgency: "asc" }, take: 2 });
  for (const h of handled) {
    await db.inboxItem.update({ where: { id: h.id }, data: { status: "DONE", resolvedAt: new Date(yesterdayRun.getTime() + 6 * HOUR), resolution: "Handled yesterday." } });
  }

  const t = await runBrainRefresh({ trigger: "SCHEDULED" });
  console.log(`  Today's refresh: ${t.status}, ${t.insightsCreated} insights, ${t.inboxCreated} inbox items, ${t.tasksCreated} commitments captured`);

  const counts = await Promise.all([db.task.count(), db.goal.count(), db.milestone.count(), db.brainInsight.count(), db.inboxItem.count({ where: { status: "OPEN" } })]);
  console.log(`  ${counts[0]} tasks · ${counts[1]} goals · ${counts[2]} milestones · ${counts[3]} insights · ${counts[4]} open inbox items`);
}

async function seedDerivedHistory(metricId: string, key: string, factors: number[]) {
  // Approximate past snapshots of derived metrics so sparklines have shape.
  const metric = await db.metric.findUniqueOrThrow({ where: { id: metricId } });
  const { getMetricViews } = await import("../src/server/brain/metrics");
  const [view] = await getMetricViews(db, { today: TODAY, keys: [key] });
  const live = view?.current ?? null;
  if (live === null) return;
  const data = factors.map((f, i) => ({
    metricId,
    recordedAt: addDays(TODAY, -7 * (factors.length - i)),
    value: metric.unit === "COUNT" ? Math.round(live * f) : Math.round(live * f * 100) / 100,
    source: metric.sourceKey,
  }));
  await db.metricValue.createMany({ data });
}

async function seedHistory(ids: {
  taskId: Record<string, string>;
  goalId: Record<string, string>;
  milestoneId: Record<string, string>;
  decisionId: Record<string, string>;
  personId: Record<string, string>;
}) {
  const acts: Prisma.ActivityCreateManyInput[] = [];

  // Task lifecycle
  const tasks = await db.task.findMany({ select: { id: true, title: true, createdAt: true, completedAt: true, status: true, postponeCount: true, originalDueDate: true, dueDate: true, ownerId: true, priority: true } });
  for (const t of tasks) {
    acts.push({ type: "TASK_CREATED", summary: `Created “${t.title}”`, taskId: t.id, createdAt: t.createdAt });
    if (t.completedAt) acts.push({ type: "TASK_COMPLETED", summary: `Completed “${t.title}”`, taskId: t.id, createdAt: t.completedAt, actor: t.ownerId === ids.personId.ceo ? "CEO" : "Team" });
    if (t.postponeCount > 0 && t.originalDueDate && t.dueDate) {
      for (let i = 0; i < t.postponeCount; i++) {
        const from = addDays(t.originalDueDate, Math.round((i * (t.dueDate.getTime() - t.originalDueDate.getTime())) / t.postponeCount / 86_400_000));
        const to = addDays(t.originalDueDate, Math.round(((i + 1) * (t.dueDate.getTime() - t.originalDueDate.getTime())) / t.postponeCount / 86_400_000));
        acts.push({ type: "TASK_RESCHEDULED", summary: `Rescheduled “${t.title}” to ${dayKey(to)}`, taskId: t.id, metadata: { from: dayKey(from), to: dayKey(to) }, createdAt: new Date(dayStartInstant(from, TZ).getTime() + 17 * HOUR) });
      }
    }
    if (t.status === "CANCELLED") acts.push({ type: "TASK_UPDATED", summary: `Cancelled “${t.title}”`, taskId: t.id, metadata: { status: "CANCELLED" }, createdAt: hoursAgo(24 * 18) });
  }
  // Priority changes
  for (const [key, from, to, daysAgo] of [
    ["tDeck", "P1", "P0", 2],
    ["tVPOffer", "P1", "P0", 1],
    ["tStrategy2027", "P1", "P2", 6],
    ["tBioTravel", "P2", "P3", 4],
  ] as const) {
    acts.push({ type: "TASK_PRIORITY_CHANGED", summary: `Priority ${from} → ${to}`, taskId: ids.taskId[key], metadata: { from, to }, createdAt: hoursAgo(daysAgo * 24 + 3) });
  }
  // Goal progress movements (last four weeks)
  const goalMoves: [string, number, number, number][] = [
    ["arr", 55, 62, 1],
    ["dataset", 78, 82, 3],
    ["ai", 60, 64, 5],
    ["seriesB", 30, 38, 2],
    ["q4Brightwater", 55, 70, 1],
    ["q4VPSales", 70, 85, 2],
    ["heartready", 44, 46, 9],
    ["partners", 45, 50, 5],
    ["team", 50, 50, 12],
    ["ops", 66, 72, 10],
    ["q4TermSheet", 25, 35, 3],
    ["deptPaper", 60, 70, 10],
    ["seriesB", 22, 30, 16],
    ["arr", 50, 55, 15],
  ];
  for (const [g, from, to, daysAgo] of goalMoves) {
    acts.push({ type: "GOAL_UPDATED", summary: `Progress ${from}% → ${to}%`, goalId: ids.goalId[g], metadata: { field: "progress", from, to }, createdAt: hoursAgo(daysAgo * 24 + 6) });
  }
  acts.push({ type: "GOAL_UPDATED", summary: "Status On track → At risk", goalId: ids.goalId.seriesB, metadata: { field: "status", from: "ON_TRACK", to: "AT_RISK" }, createdAt: hoursAgo(9 * 24) });
  acts.push({ type: "GOAL_UPDATED", summary: "Status At risk → Off track", goalId: ids.goalId.team, metadata: { field: "status", from: "AT_RISK", to: "OFF_TRACK" }, createdAt: hoursAgo(12 * 24) });
  // Milestones & decisions
  for (const m of MILESTONES.filter((m) => m.completedHoursAgo != null)) {
    acts.push({ type: "MILESTONE_COMPLETED", summary: `Milestone reached: ${m.title}`, milestoneId: ids.milestoneId[m.key], createdAt: hoursAgo(m.completedHoursAgo!) });
  }
  for (const d of DECISIONS) {
    acts.push({ type: "DECISION_CREATED", summary: `Decision raised: ${d.title}`, decisionId: ids.decisionId[d.key], createdAt: hoursAgo(d.raisedDaysAgo * 24 + 4) });
    if (d.decidedDaysAgo != null) acts.push({ type: "DECISION_MADE", summary: `Decided: ${d.finalDecision}`, decisionId: ids.decisionId[d.key], createdAt: hoursAgo(d.decidedDaysAgo * 24) });
  }
  await db.activity.createMany({ data: acts });

  // Day plans for the last ten working days (priorities + end-of-day)
  const doneCeo = await db.task.findMany({
    where: { ownerId: ids.personId.ceo, completedAt: { not: null } },
    select: { id: true, completedAt: true, strategicImpact: true, revenueImpact: true, fundraisingImpact: true, customerImpact: true, scientificImpact: true, riskLevel: true, ceoUniqueness: true, opportunityCost: true, priority: true, status: true, dueDate: true, hardDeadline: true, postponeCount: true },
  });
  const openCeo = await db.task.findMany({
    where: { ownerId: ids.personId.ceo, status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] } },
    select: { id: true, createdAt: true, strategicImpact: true, revenueImpact: true, fundraisingImpact: true, customerImpact: true, scientificImpact: true, riskLevel: true, ceoUniqueness: true, opportunityCost: true, priority: true, status: true, dueDate: true, hardDeadline: true, postponeCount: true },
  });
  type Scorable = (typeof openCeo)[number] | (typeof doneCeo)[number];
  const scoreOn = (t: Scorable, d: Date) =>
    scoreTask({ ...t, status: t.status === "DONE" ? "TODO" : t.status, blocksCount: 0, milestone: null, goal: null }, d).score;

  let back = 2;
  let planned = 0;
  while (planned < 10 && back < 30) {
    const d = day(-back);
    back++;
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    planned++;
    const dayEnd = addDays(d, 1);
    const completedThatDay = doneCeo
      .filter((t) => t.completedAt! >= dayStartInstant(d, TZ) && t.completedAt! < dayStartInstant(addDays(d, 2), TZ))
      .sort((a, b) => scoreOn(b, d) - scoreOn(a, d))
      .slice(0, 3);
    const carry = openCeo
      .filter((t) => t.createdAt < dayEnd)
      .sort((a, b) => scoreOn(b, d) - scoreOn(a, d))
      .slice(0, 5 - completedThatDay.length);
    const picks = [...completedThatDay, ...carry];
    const plan = await db.dayPlan.create({
      data: {
        date: d,
        briefReviewedAt: atLocal(d, 7, 40),
        top5ConfirmedAt: atLocal(d, 7, 55),
        endOfDayAt: planned % 4 === 0 ? null : atLocal(d, 18, 30),
        endOfDayNotes: planned % 4 === 0 ? null : planned % 3 === 0 ? "Too much time in operational threads. Delegate more to Elena and Ben." : "Good progress on the critical path.",
      },
    });
    await db.dailyPriority.createMany({
      data: picks.map((p, i) => ({ dayPlanId: plan.id, taskId: p.id, rank: i + 1, score: scoreOn(p, d), source: i === 4 && planned % 2 === 0 ? "CEO" : "BRAIN", createdAt: atLocal(d, 7, 30) })),
    });
    await db.activity.create({ data: { type: "TOP5_CONFIRMED", summary: "Confirmed Today's Top 5", createdAt: atLocal(d, 7, 55) } });
  }

  // Completed reviews: last week and last month
  const lastWeekStart = addDays(startOfWeek(TODAY), -7);
  await db.review.create({
    data: {
      type: "WEEKLY",
      periodStart: lastWeekStart,
      periodEnd: addDays(lastWeekStart, 6),
      whatWorked: "Calder conversion and the Riverside site plan. Saying no to two non-critical meetings protected investor time.",
      whatDidnt: "Fundraising time slipped to 13% — operational threads (lease, payroll vendor, website copy) ate Tuesday and Wednesday.",
      learned: "Anything that isn't fundraising, Brightwater or the VP Sales hire needs an owner other than me this month.",
      changeNext: "Block three 2-hour fundraising sessions; hand travel, expenses and vendor issues to Ben and Elena.",
      completedAt: addDays(lastWeekStart, 7),
    },
  });
  const lastMonthStart = startOfMonth(addDays(startOfMonth(TODAY), -1));
  await db.review.create({
    data: {
      type: "MONTHLY",
      periodStart: lastMonthStart,
      periodEnd: addDays(startOfMonth(TODAY), -1),
      whatWorked: "Series B launched on schedule; ARR crossed $4M; CardioPredict v2 beta with three design partners.",
      whatDidnt: "VP Sales still open; Aster partnership stalled in legal.",
      learned: "The raise needs a weekly operating cadence with Jonas, not ad-hoc pushes.",
      changeNext: "Weekly fundraising stand-up; CEO personally owns the lead investor process.",
      completedAt: addDays(startOfMonth(TODAY), 2),
    },
  });
}

main()
  .then(async () => {
    await db.$disconnect();
    console.log("Seed complete.");
  })
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
