/**
 * Claude-powered Chief of Staff: a tool-using agent over CytoHub Brain.
 * Streams text deltas and tool-status events; collects citations from every
 * tool call so answers link back to their sources.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { formatDayFull } from "@/lib/dates";
import { CLAUDE_BETAS, CLAUDE_MODEL, getClaude } from "@/server/ai/claude";
import type { CeoContext } from "@/server/context";
import * as tools from "./tools";
import type { Citation, ToolResult } from "./tools";

export type ChiefEvent = { type: "status"; text: string } | { type: "delta"; text: string };

const SYSTEM = `You are the Chief of Staff to the CEO of CytoHub — a biotech/AI company building a proprietary human heart dataset, CytoHub.AI (CardioPredict cardiac-safety models), pharma revenue, strategic partnerships, the HeartReady program, and currently raising a Series B.

You have read access to CytoHub Brain through tools: priorities, tasks, goals, milestones, decisions, upcoming events, CEO attention allocation, pipelines, delegations, recent changes, metrics and entity context. Use them — never answer from assumption, and never invent numbers, names or dates.

How to answer:
- Lead with the answer in one or two sentences, then the specifics.
- Be concise and executive: short markdown sections, tight bullets, bold the item names.
- Rank by consequence for the company, not by deadline alone. Say what the CEO should personally do next, and what to delegate.
- If the data is thin or a source isn't connected, say so plainly.
- You are read-only: when an action is needed, recommend it (e.g. "delegate to Priya", "decide by Friday") rather than claiming to have done it.`;

const TOOL_STATUS: Record<string, string> = {
  get_today_overview: "Reviewing today’s priorities and inbox",
  list_tasks: "Checking tasks",
  get_goals_status: "Reviewing goals and milestones",
  get_milestones: "Checking milestones",
  get_decisions: "Reviewing decisions",
  get_upcoming: "Scanning the calendar",
  get_attention: "Analyzing your time allocation",
  get_pipeline: "Reviewing the pipeline",
  get_delegations: "Reviewing delegation",
  get_recent_changes: "Reading recent intelligence",
  get_follow_ups: "Checking relationships",
  get_metrics: "Reading the scoreboard",
  get_time_sinks: "Finding time sinks",
  search_brain: "Searching CytoHub Brain",
  get_entity_context: "Gathering everything related",
  prepare_next_meeting: "Preparing your next meeting",
};

function buildTools(ceo: CeoContext, citations: Citation[]) {
  const wrap =
    <I>(fn: (input: I) => Promise<ToolResult>) =>
    async (input: I) => {
      const r = await fn(input);
      citations.push(...r.citations);
      return JSON.stringify(r.data);
    };
  const defs = [
    betaZodTool({
      name: "get_today_overview",
      description: "Today's Top 5 priorities with rationale, the daily brief headline, open CEO inbox items and the next meetings. Start here for 'what should I focus on'.",
      inputSchema: z.object({}),
      run: wrap(() => tools.getTodayOverview(ceo)),
    }),
    betaZodTool({
      name: "list_tasks",
      description: "List CEO tasks by filter: overdue, due_soon (7 days), delegable (Brain recommends delegating), waiting, postponed (2+ reschedules), blocked, top (highest priority score), completed_recent (last 14 days).",
      inputSchema: z.object({
        filter: z.enum(["overdue", "due_soon", "delegable", "waiting", "postponed", "blocked", "top", "completed_recent"]),
        limit: z.number().int().min(1).max(25).optional(),
      }),
      run: wrap(({ filter, limit }) => tools.listTasks(ceo, filter, limit ?? 10)),
    }),
    betaZodTool({
      name: "get_goals_status",
      description: "Company, annual, quarterly and CEO goals with status, progress, confidence, risks and next milestones.",
      inputSchema: z.object({ only_at_risk: z.boolean().optional() }),
      run: wrap(({ only_at_risk }) => tools.getGoalsStatus(ceo, only_at_risk ?? false)),
    }),
    betaZodTool({
      name: "get_milestones",
      description: "Milestones by filter: at_risk, overdue, due_soon (30 days), recent_completed (30 days).",
      inputSchema: z.object({ filter: z.enum(["at_risk", "overdue", "due_soon", "recent_completed"]) }),
      run: wrap(({ filter }) => tools.getMilestones(ceo, filter)),
    }),
    betaZodTool({
      name: "get_decisions",
      description: "CEO decisions: pending (needed now, with days pending and recommendation), waiting (blocked on information), decided (last 60 days with outcomes and lessons).",
      inputSchema: z.object({ status: z.enum(["pending", "waiting", "decided"]) }),
      run: wrap(({ status }) => tools.getDecisions(ceo, status)),
    }),
    betaZodTool({
      name: "get_upcoming",
      description: "Upcoming meetings, milestones, decision deadlines, priority task deadlines, delegated deadlines and expected deal closes within N days.",
      inputSchema: z.object({ days: z.number().int().min(1).max(90) }),
      run: wrap(({ days }) => tools.getUpcoming(ceo, days)),
    }),
    betaZodTool({
      name: "get_attention",
      description: "Where the CEO's time actually went (by focus area) versus the recommended allocation, with under/over flags.",
      inputSchema: z.object({}),
      run: wrap(() => tools.getAttention(ceo)),
    }),
    betaZodTool({
      name: "get_pipeline",
      description: "Open deals of a type (SALES = pharma customers, FUNDRAISING = investors, PARTNERSHIP) with stage, value, probability, staleness and contacts.",
      inputSchema: z.object({ type: z.enum(["SALES", "FUNDRAISING", "PARTNERSHIP"]) }),
      run: wrap(({ type }) => tools.getPipeline(ceo, type)),
    }),
    betaZodTool({
      name: "get_delegations",
      description: "Tasks the Brain recommends delegating (with suggested owners) and work already delegated, including items needing follow-up.",
      inputSchema: z.object({}),
      run: wrap(() => tools.getDelegations(ceo)),
    }),
    betaZodTool({
      name: "get_recent_changes",
      description: "What changed in the last N days: Brain insights (risks, opportunities, deal movement, commitments), milestones reached, decisions made, CEO work completed.",
      inputSchema: z.object({ days: z.number().int().min(1).max(60) }),
      run: wrap(({ days }) => tools.getRecentChanges(ceo, days)),
    }),
    betaZodTool({
      name: "get_follow_ups",
      description: "Investors, board members, customers and partners with open deals who haven't been contacted recently.",
      inputSchema: z.object({}),
      run: wrap(() => tools.getFollowUps(ceo)),
    }),
    betaZodTool({
      name: "get_metrics",
      description: "Company scoreboard: ARR, revenue, pipeline, customers, fundraising, cash/runway, product, AI, science, therapeutics, partnerships, team — current values, targets and change.",
      inputSchema: z.object({}),
      run: wrap(() => tools.getMetrics(ceo)),
    }),
    betaZodTool({
      name: "get_time_sinks",
      description: "Completed CEO tasks that consumed disproportionate time relative to their impact or estimate (last 45 days).",
      inputSchema: z.object({}),
      run: wrap(() => tools.getTimeSinks(ceo)),
    }),
    betaZodTool({
      name: "search_brain",
      description: "Full-text search across tasks, goals, milestones, decisions, people, companies, resources, insights and meetings.",
      inputSchema: z.object({ query: z.string().min(2).max(200) }),
      run: wrap(({ query }) => tools.searchBrainTool(query)),
    }),
    betaZodTool({
      name: "get_entity_context",
      description: "Everything related to a company, person or goal/project by name: people, deals, tasks, meetings and notes, decisions, recent intelligence, resources.",
      inputSchema: z.object({ name: z.string().min(2).max(200) }),
      run: wrap(({ name }) => tools.getEntityContext(ceo, name)),
    }),
    betaZodTool({
      name: "prepare_next_meeting",
      description: "Build a Prepare Me brief (context, history, participants, objectives, open issues, talking points, questions, risks, next actions) for the CEO's next important meeting.",
      inputSchema: z.object({}),
      run: wrap(() => tools.prepareNextMeeting(ceo)),
    }),
  ];
  // Stream tool inputs as generated; the runner validates them against the Zod schema.
  return defs.map((t) => ({ ...t, eager_input_streaming: true }));
}

export async function* streamClaudeAnswer(
  ceo: CeoContext,
  history: { role: "user" | "assistant"; content: string }[],
  question: string,
  citations: Citation[],
): AsyncGenerator<ChiefEvent> {
  const client = getClaude();
  const runner = client.beta.messages.toolRunner({
    model: CLAUDE_MODEL,
    max_tokens: 32000,
    betas: CLAUDE_BETAS,
    fallbacks: "default",
    output_config: { effort: (process.env.CYTOHUB_CHIEF_EFFORT as "low" | "medium" | "high" | undefined) ?? "medium" },
    cache_control: { type: "ephemeral" },
    system: SYSTEM,
    tools: buildTools(ceo, citations),
    max_iterations: 10,
    stream: true,
    messages: [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: `[Today is ${formatDayFull(ceo.today)}; CEO timezone ${ceo.timezone}.]\n\n${question}` },
    ],
  });

  yield { type: "status", text: "Thinking" };
  for await (const messageStream of runner) {
    for await (const event of messageStream) {
      if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
        yield { type: "status", text: TOOL_STATUS[event.content_block.name] ?? "Consulting CytoHub Brain" };
      } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield { type: "delta", text: event.delta.text };
      }
    }
    const message = await messageStream.finalMessage();
    if (message.stop_reason === "refusal") {
      yield { type: "delta", text: "\n\n_I can’t help with that request._" };
      break;
    }
    if (message.stop_reason === "max_tokens") {
      yield { type: "delta", text: "\n\n_(Answer truncated.)_" };
      break;
    }
  }
}

export function isAnthropicError(e: unknown): e is InstanceType<typeof Anthropic.APIError> {
  return e instanceof Anthropic.APIError;
}
