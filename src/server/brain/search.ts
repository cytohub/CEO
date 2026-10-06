/**
 * Search across everything CytoHub Brain knows. Case-insensitive matching on
 * titles and bodies today; the result shape is stable so a vector index can
 * replace the matcher later without touching callers.
 */
import { db } from "@/lib/db";
import { formatDay } from "@/lib/dates";
import { DECISION_STATUS, GOAL_STATUS, INSIGHT_TYPES, MILESTONE_STATUS, RESOURCE_TYPES, TASK_STATUS } from "@/lib/domain";

export type SearchHitType = "task" | "goal" | "milestone" | "decision" | "person" | "company" | "resource" | "insight" | "meeting";

export interface SearchHit {
  type: SearchHitType;
  id: string;
  title: string;
  subtitle?: string;
  href: string;
}

const ci = (q: string) => ({ contains: q, mode: "insensitive" as const });

export async function searchWorkspace(query: string, opts: { limitPerType?: number; types?: SearchHitType[] } = {}): Promise<SearchHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const take = opts.limitPerType ?? 5;
  const want = (t: SearchHitType) => !opts.types || opts.types.includes(t);

  const [tasks, goals, milestones, decisions, people, companies, resources, insights, meetings] = await Promise.all([
    want("task")
      ? db.task.findMany({
          where: { OR: [{ title: ci(q) }, { description: ci(q) }, { tags: { has: q.toLowerCase() } }] },
          orderBy: [{ status: "asc" }, { priorityScore: "desc" }],
          take,
          select: { id: true, title: true, status: true, dueDate: true, owner: { select: { name: true, isCeo: true } } },
        })
      : [],
    want("goal") ? db.goal.findMany({ where: { OR: [{ title: ci(q) }, { description: ci(q) }] }, take, select: { id: true, title: true, status: true, progress: true } }) : [],
    want("milestone")
      ? db.milestone.findMany({ where: { OR: [{ title: ci(q) }, { description: ci(q) }] }, take, select: { id: true, title: true, status: true, dueDate: true } })
      : [],
    want("decision") ? db.decision.findMany({ where: { OR: [{ title: ci(q) }, { context: ci(q) }] }, take, select: { id: true, title: true, status: true } }) : [],
    want("person")
      ? db.person.findMany({
          where: { OR: [{ name: ci(q) }, { title: ci(q) }, { company: { name: ci(q) } }] },
          take,
          select: { id: true, name: true, title: true, company: { select: { name: true } } },
        })
      : [],
    want("company") ? db.company.findMany({ where: { OR: [{ name: ci(q) }, { description: ci(q) }] }, take, select: { id: true, name: true, type: true, industry: true } }) : [],
    want("resource")
      ? db.resource.findMany({ where: { OR: [{ title: ci(q) }, { summary: ci(q) }, { description: ci(q) }] }, take, select: { id: true, title: true, type: true } })
      : [],
    want("insight")
      ? db.brainInsight.findMany({ where: { OR: [{ title: ci(q) }, { summary: ci(q) }] }, orderBy: { createdAt: "desc" }, take, select: { id: true, title: true, type: true, createdAt: true } })
      : [],
    want("meeting")
      ? db.meeting.findMany({ where: { OR: [{ title: ci(q) }, { objective: ci(q) }] }, orderBy: { startsAt: "desc" }, take, select: { id: true, title: true, startsAt: true } })
      : [],
  ]);

  return [
    ...tasks.map<SearchHit>((t) => ({
      type: "task",
      id: t.id,
      title: t.title,
      subtitle: [TASK_STATUS[t.status].label, t.dueDate ? `due ${formatDay(t.dueDate)}` : null, t.owner ? (t.owner.isCeo ? "You" : t.owner.name) : null].filter(Boolean).join(" · "),
      href: `/tasks?task=${t.id}`,
    })),
    ...goals.map<SearchHit>((g) => ({ type: "goal", id: g.id, title: g.title, subtitle: `${GOAL_STATUS[g.status].label} · ${g.progress}%`, href: `/goals/${g.id}` })),
    ...milestones.map<SearchHit>((m) => ({ type: "milestone", id: m.id, title: m.title, subtitle: `${MILESTONE_STATUS[m.status].label} · ${formatDay(m.dueDate)}`, href: `/milestones?milestone=${m.id}` })),
    ...decisions.map<SearchHit>((d) => ({ type: "decision", id: d.id, title: d.title, subtitle: DECISION_STATUS[d.status].label, href: `/decisions/${d.id}` })),
    ...people.map<SearchHit>((p) => ({ type: "person", id: p.id, title: p.name, subtitle: [p.title, p.company?.name].filter(Boolean).join(" · "), href: `/resources/people/${p.id}` })),
    ...companies.map<SearchHit>((c) => ({ type: "company", id: c.id, title: c.name, subtitle: [c.type.toLowerCase(), c.industry].filter(Boolean).join(" · "), href: `/resources/companies/${c.id}` })),
    ...resources.map<SearchHit>((r) => ({ type: "resource", id: r.id, title: r.title, subtitle: RESOURCE_TYPES[r.type].label, href: `/resources?resource=${r.id}` })),
    ...insights.map<SearchHit>((i) => ({ type: "insight", id: i.id, title: i.title, subtitle: `${INSIGHT_TYPES[i.type].label} · ${formatDay(i.createdAt)}`, href: `/brain?insight=${i.id}` })),
    ...meetings.map<SearchHit>((m) => ({ type: "meeting", id: m.id, title: m.title, subtitle: formatDay(m.startsAt), href: `/upcoming?meeting=${m.id}` })),
  ];
}
