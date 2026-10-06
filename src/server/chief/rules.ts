/**
 * Deterministic Chief of Staff: answers the core CEO questions directly from
 * CytoHub Brain when no LLM is configured. Every answer is grounded in the
 * same tool layer Claude uses.
 */
import type { CeoContext } from "@/server/context";
import type { PrepBrief } from "@/server/brain/prepare";
import * as tools from "./tools";
import type { Citation } from "./tools";

export interface RulesAnswer {
  markdown: string;
  citations: Citation[];
}

type Row = Record<string, unknown>;
const list = (items: string[], empty = "_Nothing to flag._") => (items.length ? items.map((i) => `- ${i}`).join("\n") : empty);

const INTENTS: { id: string; re: RegExp }[] = [
  { id: "prepare", re: /\b(prepare|prep me|brief me|next (important )?meeting)\b/i },
  { id: "forget", re: /\b(forget|forgetting|missing|overlook|slipp?ing through|dropp?ing)\b/i },
  { id: "stop", re: /\b(stop doing|time sink|waste|wasting|busy ?work)\b/i },
  { id: "avoid", re: /\b(avoid|avoiding|putting off|procrastinat)\w*\b/i },
  { id: "delegate", re: /\bdelegat\w*\b/i },
  { id: "investor", re: /\b(investor|fundrais\w*|vc|series b|raise)\b/i },
  { id: "customer", re: /\b(customer|client|account|pharma)s?\b/i },
  { id: "goals", re: /\b(goal|okr|on track|off track|slipping)s?\b/i },
  { id: "problem", re: /\b(problem|risk|worr\w*|go wrong|threat)\w*\b/i },
  { id: "changed", re: /\b(changed|change|new|this week|since|happened|update)\b/i },
  { id: "leverage", re: /\b(leverage|highest impact|most impact|move the needle)\b/i },
  { id: "decisions", re: /\bdecisions?\b/i },
  { id: "entity", re: /\b(everything (related to|about|on)|show me|tell me about|what do we know about)\b/i },
  { id: "focus", re: /\b(focus|today|priorit\w*|what should i (do|work))\b/i },
];

export function classify(question: string): string {
  for (const i of INTENTS) if (i.re.test(question)) return i.id;
  return "search";
}

export async function answerWithRules(ceo: CeoContext, question: string): Promise<RulesAnswer> {
  const intent = classify(question);
  const citations: Citation[] = [];
  const use = <T>(r: tools.ToolResult<T>) => {
    citations.push(...r.citations);
    return r.data;
  };

  switch (intent) {
    case "focus": {
      const o = use(await tools.getTodayOverview(ceo)) as { top5: Row[]; inbox: Row[]; nextMeetings: Row[]; brief: { headline: string } | null; top5Confirmed: boolean };
      const a = use(await tools.getAttention(ceo)) as { areas: Row[] };
      const under = a.areas.filter((x) => x.flag === "under").map((x) => `${x.area} (${x.actual} vs ${x.recommended})`);
      return {
        markdown: [
          o.brief ? `**${o.brief.headline}**` : null,
          "### Your Top 5 today",
          o.top5.map((t, i) => `${i + 1}. **${t.title}** — score ${t.score}${t.due ? `, due ${t.due}` : ""}\n   ${t.why ?? ""}`).join("\n"),
          o.top5Confirmed ? null : "_You haven’t confirmed this list yet — adjust it on Today, then lock it in._",
          o.nextMeetings.length ? `### Next on the calendar\n${list(o.nextMeetings.map((m) => `${m.at} — ${m.title}${m.objective ? ` (${m.objective})` : ""}`))}` : null,
          o.inbox.length ? `### Needs you (${o.inbox.length} in inbox)\n${list(o.inbox.slice(0, 4).map((i) => `${i.title} → ${i.recommendedAction}`))}` : null,
          under.length ? `### Attention check\nYou’re under-investing in ${under.join(", ")}. Protect time for it today.` : null,
        ]
          .filter(Boolean)
          .join("\n\n"),
        citations,
      };
    }
    case "forget": {
      const overdue = use(await tools.listTasks(ceo, "overdue", 6)) as Row[];
      const postponed = use(await tools.listTasks(ceo, "postponed", 5)) as Row[];
      const follow = use(await tools.getFollowUps(ceo)) as Row[];
      const del = use(await tools.getDelegations(ceo)) as { delegated: Row[] };
      const waiting = use(await tools.getDecisions(ceo, "waiting")) as Row[];
      return {
        markdown: [
          "Here’s what’s at risk of slipping through the cracks:",
          `### Overdue commitments\n${list(overdue.map((t) => `**${t.title}** — ${t.due}${t.postponed ? `, postponed ${t.postponed}×` : ""}`))}`,
          `### Relationships going cold\n${list(follow.map((p) => `${p.person} (${p.company}) — no contact for ${p.lastContactDaysAgo} days; ${(p.openDeals as string[] | undefined)?.join(", ") ?? ""}`))}`,
          `### Delegations needing follow-up\n${list(del.delegated.filter((d) => d.status === "NEEDS_FOLLOW_UP").map((d) => `${d.task} — ${d.owner}, last update ${d.lastUpdate}`))}`,
          `### Repeatedly postponed\n${list(postponed.map((t) => `${t.title} (${t.postponed}×) — decide: do it, delegate it, or drop it`))}`,
          waiting.length ? `### Decisions stuck waiting for information\n${list(waiting.map((d) => `${d.title} — waiting on ${d.waitingOn ?? "input"} (${d.daysPending}d)`))}` : null,
        ]
          .filter(Boolean)
          .join("\n\n"),
        citations,
      };
    }
    case "problem": {
      const goals = use(await tools.getGoalsStatus(ceo, true)) as Row[];
      const ms = use(await tools.getMilestones(ceo, "at_risk")) as Row[];
      const overdueMs = use(await tools.getMilestones(ceo, "overdue")) as Row[];
      const changes = use(await tools.getRecentChanges(ceo, 7)) as { insights: Row[] };
      const risks = changes.insights.filter((i) => ["Risk", "Deal slowing", "Milestone at risk"].includes(String(i.type))).slice(0, 6);
      return {
        markdown: [
          "Most likely to become a problem, in order of consequence:",
          `### Milestones at risk\n${list([...overdueMs, ...ms].slice(0, 6).map((m) => `**${m.title}** — ${m.status}, due ${m.due}${m.blocker ? `. Blocker: ${m.blocker}` : ""}`))}`,
          `### Goals losing confidence\n${list(goals.map((g) => `**${g.title}** — ${g.status}, ${g.progress} done, ${g.confidence} confidence${g.risks ? `. ${g.risks}` : ""}`))}`,
          `### Fresh risk signals\n${list(risks.map((r) => `${r.title}${r.summary ? ` — ${r.summary}` : ""}`))}`,
        ].join("\n\n"),
        citations,
      };
    }
    case "delegate": {
      const d = use(await tools.getDelegations(ceo)) as { shouldDelegate: Row[]; delegated: Row[] };
      return {
        markdown: [
          `### Hand these off\n${list(d.shouldDelegate.map((t) => `**${t.task}** → ${t.suggestedOwner ?? "a team member"}${t.freesUp ? ` (frees ~${t.freesUp})` : ""}`), "_Nothing obvious — your plate is CEO-only work._")}`,
          `### Already delegated (${d.delegated.length})\n${list(d.delegated.map((t) => `${t.task} — ${t.owner}, ${t.status === "NEEDS_FOLLOW_UP" ? "**needs follow-up**" : "on track"}, due ${t.due ?? "—"}`))}`,
          "Open the Delegation Center to hand off with one click.",
        ].join("\n\n"),
        citations,
      };
    }
    case "investor": {
      const p = use(await tools.getPipeline(ceo, "FUNDRAISING")) as Row[];
      const f = (use(await tools.getFollowUps(ceo)) as Row[]).filter((x) => x.role === "INVESTOR" || x.role === "BOARD");
      return {
        markdown: [
          `### Follow up now\n${list(f.map((x) => `**${x.person}** (${x.company}) — silent for ${x.lastContactDaysAgo} days`), "_All active investors contacted recently._")}`,
          `### Investor pipeline\n${list(p.map((d) => `**${d.deal}** — ${d.stage}, ${d.value ?? "—"} at ${d.probability}${d.daysSinceActivity != null ? `, ${d.daysSinceActivity}d since activity` : ""}${d.nextStep ? `. Next: ${d.nextStep}` : ""}`))}`,
        ].join("\n\n"),
        citations,
      };
    }
    case "customer": {
      const p = use(await tools.getPipeline(ceo, "SALES")) as Row[];
      const o = use(await tools.getTodayOverview(ceo)) as { inbox: Row[] };
      const issues = o.inbox.filter((i) => ["CUSTOMER_ISSUE", "ESCALATION"].includes(String(i.type)));
      return {
        markdown: [
          issues.length ? `### Escalations\n${list(issues.map((i) => `**${i.title}** → ${i.recommendedAction}`))}` : null,
          `### Accounts that need you\n${list(
            p
              .filter((d) => Number(d.daysSinceActivity ?? 0) > 10 || String(d.stage).toLowerCase().includes("renewal") || String(d.stage).toLowerCase().includes("contract"))
              .map((d) => `**${d.deal}** — ${d.stage}, ${d.value ?? "—"}${d.daysSinceActivity != null ? `, ${d.daysSinceActivity}d since activity` : ""}${d.nextStep ? `. Next: ${d.nextStep}` : ""}`),
          )}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
        citations,
      };
    }
    case "goals": {
      const g = use(await tools.getGoalsStatus(ceo, true)) as Row[];
      return {
        markdown: `### Goals slipping\n${list(g.map((x) => `**${x.title}** — ${x.status}, ${x.progress} complete, ${x.confidence} confidence (owner: ${x.owner ?? "—"})${(x.nextMilestones as string[]).length ? `\n  - ${(x.nextMilestones as string[]).join("\n  - ")}` : ""}`), "_Every goal is on track._")}`,
        citations,
      };
    }
    case "changed": {
      const c = use(await tools.getRecentChanges(ceo, 7)) as { insights: Row[]; completedByCeo: string[]; decisionsMade: string[]; milestonesReached: string[] };
      return {
        markdown: [
          "### This week in CytoHub Brain",
          list(c.insights.slice(0, 10).map((i) => `**${i.type}:** ${i.title}`)),
          c.milestonesReached.length ? `### Milestones reached\n${list(c.milestonesReached)}` : null,
          c.decisionsMade.length ? `### Decisions made\n${list(c.decisionsMade)}` : null,
          c.completedByCeo.length ? `### You completed\n${list(c.completedByCeo.slice(0, 8))}` : null,
        ]
          .filter(Boolean)
          .join("\n\n"),
        citations,
      };
    }
    case "prepare": {
      const r = use(await tools.prepareNextMeeting(ceo)) as { meeting?: string; at?: string; brief?: PrepBrief; message?: string };
      if (!r.brief) return { markdown: r.message ?? "No important meetings coming up.", citations };
      const b = r.brief;
      return {
        markdown: [
          `### ${r.meeting} — ${r.at}`,
          b.context,
          `**Desired outcome:** ${b.desiredOutcome}`,
          `### Talking points\n${b.talkingPoints.map((t, i) => `${i + 1}. ${t}`).join("\n")}`,
          `### Questions to ask\n${list(b.questions)}`,
          b.risks.length ? `### Risks\n${list(b.risks)}` : null,
          b.openIssues.length ? `### Open issues\n${list(b.openIssues.map((o) => `${o.kind}: ${o.title}`))}` : null,
          "Open the meeting in Upcoming for the full Prepare Me brief.",
        ]
          .filter(Boolean)
          .join("\n\n"),
        citations,
      };
    }
    case "leverage": {
      const top = use(await tools.listTasks(ceo, "top", 7)) as Row[];
      const decisions = use(await tools.getDecisions(ceo, "pending")) as Row[];
      return {
        markdown: [
          "Highest-leverage actions right now — CEO-only work with the largest strategic effect:",
          list(top.map((t) => `**${t.title}** (score ${t.score}) — ${t.recommendation ?? ""}`)),
          decisions.length ? `### Decisions that unblock others\n${list(decisions.slice(0, 3).map((d) => `${d.title} — impact ${d.impact}${d.recommendation ? `. Recommendation: ${d.recommendation}` : ""}`))}` : null,
        ]
          .filter(Boolean)
          .join("\n\n"),
        citations,
      };
    }
    case "stop": {
      const sinks = use(await tools.getTimeSinks(ceo)) as Row[];
      const a = use(await tools.getAttention(ceo)) as { areas: Row[] };
      const over = a.areas.filter((x) => x.flag === "over");
      const d = use(await tools.getDelegations(ceo)) as { shouldDelegate: Row[] };
      return {
        markdown: [
          `### Where your time leaked\n${list(sinks.map((s) => `**${s.task}** — ${s.actual} (estimated ${s.estimate ?? "—"}), strategic impact ${s.strategicImpact}`))}`,
          over.length ? `### Over-invested areas\n${list(over.map((x) => `${x.area}: ${x.actual} vs ${x.recommended} recommended`))}` : null,
          `### Stop doing personally\n${list(d.shouldDelegate.map((t) => `${t.task} → ${t.suggestedOwner ?? "delegate"}`))}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
        citations,
      };
    }
    case "avoid":
    case "decisions": {
      const pending = use(await tools.getDecisions(ceo, "pending")) as Row[];
      const waiting = use(await tools.getDecisions(ceo, "waiting")) as Row[];
      const sorted = [...pending].sort((a, b) => Number(b.daysPending) - Number(a.daysPending));
      return {
        markdown: [
          intent === "avoid" ? "Decisions that have been open longest — the ones most likely being avoided:" : "Open decisions:",
          list(sorted.map((d) => `**${d.title}** — open ${d.daysPending}d, impact ${d.impact}${d.deadline ? `, deadline ${d.deadline}` : ""}${d.recommendation ? `\n  Recommendation: ${d.recommendation}` : ""}`)),
          waiting.length ? `### Waiting for information\n${list(waiting.map((d) => `${d.title} — ${d.waitingOn ?? "input pending"}`))}` : null,
        ]
          .filter(Boolean)
          .join("\n\n"),
        citations,
      };
    }
    case "entity": {
      const m = /(?:about|related to|on|show me|know about)\s+(.+?)[?.!]*$/i.exec(question);
      const target = (m?.[1] ?? question).replace(/^(everything|all)\s+/i, "").replace(/\b(related to|about)\b/gi, "").trim();
      const ctx = use(await tools.getEntityContext(ceo, target)) as Row;
      return { markdown: renderEntity(ctx, target), citations };
    }
    default: {
      const hits = use(await tools.searchBrainTool(question)) as Row[];
      return {
        markdown: hits.length
          ? `Here’s what CytoHub Brain found for “${question}”:\n\n${list(hits.map((h) => `**${h.title}** — ${h.type}${h.detail ? ` · ${h.detail}` : ""}`))}`
          : `I couldn’t find anything for “${question}”. Try asking:\n\n- What should I focus on today?\n- What am I forgetting?\n- What is most likely to become a problem?\n- Show me everything related to Brightwater`,
        citations,
      };
    }
  }
}

function renderEntity(ctx: Row, target: string): string {
  if (Array.isArray(ctx)) {
    return ctx.length ? `Matches for “${target}”:\n\n${list(ctx.map((h: Row) => `**${h.title}** — ${h.type}${h.detail ? ` · ${h.detail}` : ""}`))}` : `Nothing found for “${target}”.`;
  }
  const sections: string[] = [];
  for (const [key, value] of Object.entries(ctx)) {
    if (value == null || (Array.isArray(value) && value.length === 0)) continue;
    const title = key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
    if (Array.isArray(value)) {
      sections.push(`### ${title}\n${list(value.map((v) => (typeof v === "string" ? v : Object.values(v as Row).filter((x) => x != null && x !== "").join(" · "))))}`);
    } else if (typeof value === "object") {
      sections.push(
        `### ${title}\n${Object.entries(value as Row)
          .filter(([, v]) => v != null && v !== "")
          .map(([k, v]) => `- **${k}:** ${v}`)
          .join("\n")}`,
      );
    }
  }
  return sections.join("\n\n");
}
