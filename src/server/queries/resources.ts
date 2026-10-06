import type { CompanyType, PersonType, Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { OPEN_TASK_STATUSES } from "@/lib/domain";
import { getCeoContext } from "@/server/context";

// ─── Documents ───────────────────────────────────────────────────────────────

export const resourceInclude = {
  goals: { select: { id: true, title: true }, orderBy: { title: "asc" } },
  milestones: { select: { id: true, title: true }, orderBy: { dueDate: "asc" } },
  tasks: { select: { id: true, title: true, status: true }, orderBy: { title: "asc" } },
  decisions: { select: { id: true, title: true }, orderBy: { title: "asc" } },
  people: { select: { id: true, name: true, isCeo: true }, orderBy: { name: "asc" } },
  companies: { select: { id: true, name: true }, orderBy: { name: "asc" } },
} satisfies Prisma.ResourceInclude;

export type ResourceRow = Prisma.ResourceGetPayload<{ include: typeof resourceInclude }>;

export async function getResourceRows(): Promise<ResourceRow[]> {
  return db.resource.findMany({ include: resourceInclude, orderBy: [{ createdAt: "desc" }, { title: "asc" }] });
}

// ─── Companies ───────────────────────────────────────────────────────────────

export interface CompanyRow {
  id: string;
  name: string;
  type: CompanyType;
  industry: string | null;
  location: string | null;
  relationship: number;
  lastActivityAt: Date | null;
  peopleCount: number;
  openTasks: number;
  openDeals: number;
  openDealValue: number;
}

export async function getCompanyRows(): Promise<CompanyRow[]> {
  const [companies, deals] = await Promise.all([
    db.company.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { people: true, tasks: { where: { status: { in: OPEN_TASK_STATUSES } } } } } },
    }),
    db.deal.groupBy({
      by: ["companyId"],
      where: { status: "OPEN", companyId: { not: null } },
      _count: { _all: true },
      _sum: { value: true },
      _max: { lastActivityAt: true },
    }),
  ]);
  const dealsByCompany = new Map(deals.map((d) => [d.companyId, d]));
  return companies.map((c) => {
    const d = dealsByCompany.get(c.id);
    const dealActivity = d?._max.lastActivityAt ?? null;
    const lastActivityAt = [c.lastActivityAt, dealActivity].filter((x): x is Date => Boolean(x)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    return {
      id: c.id,
      name: c.name,
      type: c.type,
      industry: c.industry,
      location: c.location,
      relationship: c.relationship,
      lastActivityAt,
      peopleCount: c._count.people,
      openTasks: c._count.tasks,
      openDeals: d?._count._all ?? 0,
      openDealValue: d?._sum.value ?? 0,
    };
  });
}

// ─── People ──────────────────────────────────────────────────────────────────

export interface PersonRow {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  type: PersonType;
  isCeo: boolean;
  company: { id: string; name: string } | null;
  lastContactAt: Date | null;
  openTasks: number;
}

export async function getPersonRows(): Promise<PersonRow[]> {
  const [people, tasks] = await Promise.all([
    db.person.findMany({
      orderBy: [{ isCeo: "desc" }, { name: "asc" }],
      select: { id: true, name: true, title: true, email: true, type: true, isCeo: true, lastContactAt: true, company: { select: { id: true, name: true } } },
    }),
    db.task.findMany({ where: { status: { in: OPEN_TASK_STATUSES } }, select: { id: true, ownerId: true, people: { select: { id: true } } } }),
  ]);
  // A task counts once per person, whether they own it or are attached to it.
  const byPerson = new Map<string, Set<string>>();
  const add = (personId: string, taskId: string) => {
    let set = byPerson.get(personId);
    if (!set) byPerson.set(personId, (set = new Set()));
    set.add(taskId);
  };
  for (const t of tasks) {
    if (t.ownerId) add(t.ownerId, t.id);
    for (const p of t.people) add(p.id, t.id);
  }
  return people.map((p) => ({ ...p, openTasks: byPerson.get(p.id)?.size ?? 0 }));
}

export async function getResourceCenterCounts() {
  const [documents, companies, people] = await Promise.all([db.resource.count(), db.company.count(), db.person.count()]);
  return { documents, companies, people };
}

// ─── Shared detail pieces ────────────────────────────────────────────────────

const taskSelect = {
  id: true,
  title: true,
  status: true,
  priority: true,
  dueDate: true,
  completedAt: true,
  priorityScore: true,
  owner: { select: { id: true, name: true, isCeo: true } },
} satisfies Prisma.TaskSelect;

const meetingSelect = {
  id: true,
  title: true,
  type: true,
  startsAt: true,
  endsAt: true,
  objective: true,
  description: true,
  importance: true,
  preparedAt: true,
  company: { select: { id: true, name: true } },
  attendees: { select: { id: true, name: true, isCeo: true }, orderBy: { name: "asc" } },
  notes: { select: { id: true, body: true, author: true, createdAt: true }, orderBy: { createdAt: "desc" } },
} satisfies Prisma.MeetingSelect;

const resourceSelect = { id: true, title: true, type: true, url: true, summary: true, createdAt: true } satisfies Prisma.ResourceSelect;

const insightSelect = {
  id: true,
  type: true,
  status: true,
  title: true,
  summary: true,
  recommendation: true,
  importance: true,
  requiresCeo: true,
  occurredAt: true,
} satisfies Prisma.BrainInsightSelect;

const signalSelect = {
  id: true,
  kind: true,
  title: true,
  body: true,
  occurredAt: true,
  source: { select: { key: true, name: true, config: true } },
} satisfies Prisma.BrainSignalSelect;

const decisionSelect = {
  id: true,
  title: true,
  status: true,
  deadline: true,
  strategicImpact: true,
  finalDecision: true,
  decidedAt: true,
} satisfies Prisma.DecisionSelect;

export type DetailTask = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;
export type DetailMeeting = Prisma.MeetingGetPayload<{ select: typeof meetingSelect }>;
export type DetailResource = Prisma.ResourceGetPayload<{ select: typeof resourceSelect }>;
export type DetailDecision = Prisma.DecisionGetPayload<{ select: typeof decisionSelect }>;
export type DetailNote = { id: string; body: string; author: string; createdAt: Date };
export type DetailActivity = { id: string; summary: string; actor: string; createdAt: Date; type: string };

export type IntelItem =
  | ({ entry: "insight" } & Prisma.BrainInsightGetPayload<{ select: typeof insightSelect }>)
  | ({ entry: "signal"; sample: boolean } & Prisma.BrainSignalGetPayload<{ select: typeof signalSelect }>);

function mergeIntel(
  insights: Prisma.BrainInsightGetPayload<{ select: typeof insightSelect }>[],
  signals: Prisma.BrainSignalGetPayload<{ select: typeof signalSelect }>[],
  limit = 30,
): IntelItem[] {
  return [
    ...insights.map((i): IntelItem => ({ entry: "insight", ...i })),
    ...signals.map((s): IntelItem => ({ entry: "signal", sample: (s.source.config as { mode?: string } | null)?.mode === "sample", ...s })),
  ]
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .slice(0, limit);
}

function splitMeetings(meetings: DetailMeeting[], now: Date) {
  const upcoming = meetings.filter((m) => m.endsAt >= now).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const past = meetings.filter((m) => m.endsAt < now).sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
  return { upcoming, past };
}

// ─── Company detail ──────────────────────────────────────────────────────────

export async function getCompanyDetail(id: string) {
  const ceo = await getCeoContext();
  const company = await db.company.findUnique({
    where: { id },
    include: {
      people: {
        orderBy: { name: "asc" },
        select: { id: true, name: true, title: true, type: true, email: true, isCeo: true, lastContactAt: true },
      },
    },
  });
  if (!company) return null;
  const peopleIds = company.people.map((p) => p.id);

  const deals = await db.deal.findMany({
    where: { companyId: id },
    orderBy: [{ status: "asc" }, { stageOrder: "desc" }, { value: "desc" }],
    include: { owner: { select: { id: true, name: true, isCeo: true } } },
  });
  const dealIds = deals.map((d) => d.id);
  const related = [
    { companyId: id },
    ...(peopleIds.length ? [{ personId: { in: peopleIds } }] : []),
    ...(dealIds.length ? [{ dealId: { in: dealIds } }] : []),
  ];

  const [openTasks, recentDone, meetings, decisions, insights, signals, resources, notes, activities] = await Promise.all([
    db.task.findMany({
      where: { status: { in: OPEN_TASK_STATUSES }, OR: [{ companyId: id }, { people: { some: { companyId: id } } }] },
      orderBy: [{ priorityScore: "desc" }],
      take: 40,
      select: taskSelect,
    }),
    db.task.count({ where: { status: "DONE", OR: [{ companyId: id }, { people: { some: { companyId: id } } }] } }),
    db.meeting.findMany({
      where: { OR: [{ companyId: id }, { attendees: { some: { companyId: id } } }] },
      orderBy: { startsAt: "desc" },
      take: 40,
      select: meetingSelect,
    }),
    db.decision.findMany({ where: { companies: { some: { id } } }, orderBy: [{ status: "asc" }, { deadline: "asc" }], select: decisionSelect }),
    db.brainInsight.findMany({ where: { OR: related, status: { not: "DISMISSED" } }, orderBy: { occurredAt: "desc" }, take: 30, select: insightSelect }),
    db.brainSignal.findMany({ where: { OR: related }, orderBy: { occurredAt: "desc" }, take: 30, select: signalSelect }),
    db.resource.findMany({ where: { companies: { some: { id } } }, orderBy: { createdAt: "desc" }, select: resourceSelect }),
    db.note.findMany({ where: { companyId: id }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, body: true, author: true, createdAt: true } }),
    db.activity.findMany({
      where: { OR: [{ companyId: id }, ...(peopleIds.length ? [{ personId: { in: peopleIds } }] : [])] },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { id: true, summary: true, actor: true, createdAt: true, type: true },
    }),
  ]);

  return {
    company,
    deals,
    openTasks,
    completedTasks: recentDone,
    meetings: splitMeetings(meetings, ceo.now),
    decisions,
    intel: mergeIntel(insights, signals),
    resources,
    notes,
    activities,
    today: ceo.today,
    now: ceo.now,
    timezone: ceo.timezone,
  };
}

export type CompanyDetail = NonNullable<Awaited<ReturnType<typeof getCompanyDetail>>>;

// ─── Person detail ───────────────────────────────────────────────────────────

export async function getPersonDetail(id: string) {
  const ceo = await getCeoContext();
  const person = await db.person.findUnique({
    where: { id },
    include: { company: { select: { id: true, name: true, type: true, industry: true } } },
  });
  if (!person) return null;
  const involved: Prisma.TaskWhereInput = { OR: [{ ownerId: id }, { people: { some: { id } } }] };

  const [openTasks, doneTasks, meetings, delegations, decisions, deals, insights, signals, resources, notes, activities] = await Promise.all([
    db.task.findMany({ where: { ...involved, status: { in: OPEN_TASK_STATUSES } }, orderBy: [{ priorityScore: "desc" }], take: 40, select: taskSelect }),
    db.task.findMany({ where: { ...involved, status: "DONE" }, orderBy: { completedAt: "desc" }, take: 6, select: taskSelect }),
    db.meeting.findMany({ where: { attendees: { some: { id } } }, orderBy: { startsAt: "desc" }, take: 40, select: meetingSelect }),
    person.type === "TEAM"
      ? db.delegation.findMany({
          where: { delegateId: id },
          orderBy: [{ status: "asc" }, { dueDate: "asc" }],
          take: 30,
          include: { task: { select: { id: true, title: true, status: true, dueDate: true } } },
        })
      : Promise.resolve([]),
    db.decision.findMany({ where: { ownerId: id }, orderBy: [{ status: "asc" }, { deadline: "asc" }], take: 20, select: decisionSelect }),
    db.deal.findMany({
      where: { OR: [{ ownerId: id }, ...(person.companyId ? [{ companyId: person.companyId }] : [])] },
      orderBy: [{ status: "asc" }, { stageOrder: "desc" }],
      take: 20,
      include: { company: { select: { id: true, name: true } }, owner: { select: { id: true, name: true, isCeo: true } } },
    }),
    db.brainInsight.findMany({ where: { personId: id, status: { not: "DISMISSED" } }, orderBy: { occurredAt: "desc" }, take: 30, select: insightSelect }),
    db.brainSignal.findMany({ where: { personId: id }, orderBy: { occurredAt: "desc" }, take: 30, select: signalSelect }),
    db.resource.findMany({ where: { people: { some: { id } } }, orderBy: { createdAt: "desc" }, select: resourceSelect }),
    db.note.findMany({ where: { personId: id }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, body: true, author: true, createdAt: true } }),
    db.activity.findMany({ where: { personId: id }, orderBy: { createdAt: "desc" }, take: 25, select: { id: true, summary: true, actor: true, createdAt: true, type: true } }),
  ]);

  return {
    person,
    openTasks,
    doneTasks,
    meetings: splitMeetings(meetings, ceo.now),
    delegations,
    decisions,
    deals,
    intel: mergeIntel(insights, signals),
    resources,
    notes,
    activities,
    today: ceo.today,
    now: ceo.now,
    timezone: ceo.timezone,
  };
}

export type PersonDetail = NonNullable<Awaited<ReturnType<typeof getPersonDetail>>>;
