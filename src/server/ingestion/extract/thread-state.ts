/**
 * Thread status and summary rules (pure). threads.ts loads a thread and its
 * open commitments, calls computeThreadState and persists the result.
 *
 * Status:
 *  - RESOLVED      closing language in the last human message (and no new ask),
 *                  or every commitment in the thread is fulfilled/cancelled.
 *  - AWAITING_CEO  the last human message is not the CEO's, and since the CEO's
 *                  last message someone asked the CEO something (a task for the
 *                  CEO, a decision request, a meeting request or a question).
 *  - AWAITING_THEM the CEO's last message asked for something, or an INBOUND
 *                  commitment in the thread is still open.
 *  - FYI           only automated mail, or the CEO is merely copied and has
 *                  never written in the thread.
 *  - ACTIVE        everything else.
 */
import type { CommitmentDirection, CommitmentStatus, MessageDirection, ReplyStatus, ThreadStatus } from "@/generated/prisma/enums";
import { addDays, dayKeyInTz, toDay } from "@/lib/dates";
import type { IntelligenceExtraction } from "../extraction-schema";
import type { Participant } from "../types";
import { formatDayShort } from "./dates";
import { splitSentences } from "./sentences";
import { firstNameOf, lcFirst, nameFromEmail, normalizeName, truncateWords } from "./text";

export interface ThreadMessageFacts {
  id: string;
  fromEmail: string;
  fromName: string | null;
  fromCeo: boolean;
  direction: MessageDirection;
  isAutomated: boolean;
  sentAt: Date;
  to: Participant[];
  cc: Participant[];
  text: string;
  extraction: IntelligenceExtraction | null;
}

export interface ThreadCommitmentFacts {
  id: string;
  direction: CommitmentDirection;
  status: CommitmentStatus;
  title: string;
  dueDate: Date | null;
  committedAt: Date;
  ownerName: string | null;
  counterpartyName: string | null;
}

export interface KeyParticipant {
  name: string;
  role: string | null;
  personId: string | null;
}

export interface ThreadStateInput {
  subject: string;
  messages: ThreadMessageFacts[];
  commitments: ThreadCommitmentFacts[];
  ceo: { name: string; firstName: string; email: string | null };
  timezone: string;
  now: Date;
}

export interface ThreadState {
  status: ThreadStatus;
  awaitingSince: Date | null;
  /** Who the thread is waiting on / who is waiting (not the CEO). */
  counterpart: string | null;
  openQuestions: string[];
  decisionsSummary: string[];
  nextStep: string | null;
  recommendedAction: string | null;
  summary: string;
  currentStatus: string;
  /** replyStatus for the latest message. */
  latestReplyStatus: ReplyStatus;
}

const CLOSING =
  /\b(?:all set|that (?:works|resolves (?:it|this))|sounds good,? thanks|closing the loop|no further action|consider (?:this|it) (?:done|closed)|we'?re (?:all )?good|(?:this is|it'?s) resolved|signed and returned|fully executed|no need to (?:reply|respond)|no reply needed|thanks,? (?:that'?s|this is) (?:all|everything) (?:we|i) needed)\b/i;
const PLEASANTRY_QUESTION = /^(?:how are you|how(?:'s| is) it going|hope (?:you're|you are|all is) well|how was your (?:weekend|trip))\b/i;
const SIGN_OFF = /^(?:best(?: regards)?|kind regards|regards|thanks(?: again)?|thank you|cheers|sincerely|warmly|all the best)\s*[,!.]?$/i;

function stripSubject(s: string): string {
  return s.replace(/^(?:(?:re|fwd?|aw|sv)\s*:\s*)+/i, "").trim() || s;
}

function senderName(m: ThreadMessageFacts): string {
  return m.fromName?.trim() || nameFromEmail(m.fromEmail);
}

function isCeoAddress(input: ThreadStateInput, email: string): boolean {
  return Boolean(input.ceo.email && email.toLowerCase() === input.ceo.email.toLowerCase());
}

/** The message's body sentences (greeting and signature dropped). */
function bodySentences(text: string) {
  const all = splitSentences(text);
  const stop = all.findIndex((s) => SIGN_OFF.test(s.text.trim()) || /^on .{6,80} wrote:$/i.test(s.text.trim()));
  return (stop >= 0 ? all.slice(0, stop) : all).filter((s) => !/^(?:hi|hello|hey|dear)\b[^.?!]{0,60}[,!]?$/i.test(s.text.trim()));
}

function addressedToCeo(input: ThreadStateInput, m: ThreadMessageFacts): boolean {
  if (m.to.some((p) => isCeoAddress(input, p.email))) return true;
  const first = input.ceo.firstName;
  return Boolean(first && new RegExp(`^\\s*(?:hi|hello|hey|dear)?\\s*${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(m.text));
}

function questionsIn(m: ThreadMessageFacts): string[] {
  return bodySentences(m.text)
    .map((s) => s.text.trim())
    .filter((t) => /\?["')\]]*$/.test(t) && !PLEASANTRY_QUESTION.test(t));
}

function ceoAsks(m: ThreadMessageFacts) {
  const x = m.extraction;
  return {
    // Dated, confident asks first ("confirm clause 7.3 by Friday" over "send them to me").
    task: [...(x?.tasks ?? [])].filter((t) => t.ownerIsCeo).sort((a, b) => (b.dueDate ? 1 : 0) + b.confidence - ((a.dueDate ? 1 : 0) + a.confidence))[0] ?? null,
    decision: x?.decisions.find((d) => d.status === "NEEDED") ?? null,
    meeting: x?.meetingRequests[0] ?? null,
  };
}

function asksCeo(input: ThreadStateInput, m: ThreadMessageFacts): boolean {
  if (m.fromCeo || m.isAutomated) return false;
  const a = ceoAsks(m);
  if (a.task || a.decision || a.meeting) return true;
  return addressedToCeo(input, m) && questionsIn(m).length > 0;
}

/** The CEO's message asks the other side for something (a question, a request, a meeting). */
function ceoAskedThem(m: ThreadMessageFacts): boolean {
  const x = m.extraction;
  if (x && (x.tasks.some((t) => !t.ownerIsCeo) || x.meetingRequests.length > 0)) return true;
  return questionsIn(m).length > 0;
}

/** Add business days (skipping weekends) to a calendar day. */
function businessDaysAfter(day: Date, n: number): Date {
  let d = day;
  let left = n;
  while (left > 0) {
    d = addDays(d, 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) left--;
  }
  return d;
}

export function computeThreadState(input: ThreadStateInput): ThreadState {
  const tz = input.timezone;
  const msgs = [...input.messages].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
  const human = msgs.filter((m) => !m.isAutomated);
  const last = human.at(-1) ?? null;
  const latest = msgs.at(-1) ?? null;
  const topic = stripSubject(input.subject);
  const fmt = (d: Date) => formatDayShort(dayKeyInTz(d, tz));

  let lastCeoIdx = -1;
  human.forEach((m, i) => {
    if (m.fromCeo) lastCeoIdx = i;
  });
  const sinceCeo = human.slice(lastCeoIdx + 1);
  const others = human.filter((m) => !m.fromCeo);
  const mainOther = (sinceCeo.at(-1) ?? others.at(-1)) ?? null;
  let counterpart: string | null = mainOther ? senderName(mainOther) : null;
  if (!counterpart && last?.fromCeo) {
    const r = last.to.find((p) => !isCeoAddress(input, p.email));
    counterpart = r ? r.name ?? nameFromEmail(r.email) : null;
  }

  const openInbound = input.commitments.filter((c) => c.direction === "INBOUND" && c.status === "OPEN");
  const allClosed = input.commitments.length > 0 && input.commitments.every((c) => c.status !== "OPEN");

  // Questions addressed to the CEO after the CEO's last message.
  const openQuestions: string[] = [];
  for (const m of sinceCeo) {
    if (m.fromCeo || !addressedToCeo(input, m)) continue;
    for (const q of questionsIn(m)) if (openQuestions.length < 5 && !openQuestions.includes(q)) openQuestions.push(truncateWords(q, 240));
  }

  const decisions: string[] = [];
  const pushDecision = (s: string) => {
    if (decisions.length < 6 && !decisions.some((d) => normalizeName(d) === normalizeName(s))) decisions.push(truncateWords(s, 240));
  };
  for (const m of human) for (const d of m.extraction?.decisions ?? []) if (d.status === "MADE") pushDecision(`Decided: ${d.title}`);
  for (const m of sinceCeo) for (const d of m.extraction?.decisions ?? []) if (d.status === "NEEDED") pushDecision(`Needs your decision: ${d.title}${d.deadline ? ` (by ${formatDayShort(d.deadline)})` : ""}`);

  let status: ThreadStatus;
  let awaitingSince: Date | null = null;
  const askers = sinceCeo.filter((m) => asksCeo(input, m));
  if (!last) {
    status = "FYI";
  } else if (CLOSING.test(last.text) && !(asksCeo(input, last) && !last.fromCeo)) {
    status = "RESOLVED";
  } else if (!last.fromCeo && askers.length) {
    status = "AWAITING_CEO";
    awaitingSince = askers[0].sentAt;
    counterpart = senderName(askers.at(-1)!);
  } else if (last.fromCeo && ceoAskedThem(last)) {
    status = "AWAITING_THEM";
    awaitingSince = last.sentAt;
  } else if (openInbound.length) {
    status = "AWAITING_THEM";
    awaitingSince = openInbound.reduce((min, c) => (c.committedAt < min ? c.committedAt : min), openInbound[0].committedAt);
    counterpart = openInbound[0].ownerName ?? counterpart;
  } else if (allClosed) {
    status = "RESOLVED";
  } else if (lastCeoIdx < 0 && !human.some((m) => addressedToCeo(input, m))) {
    status = "FYI";
  } else {
    status = "ACTIVE";
  }

  // ── Next step and recommended action ──
  const first = counterpart ? firstNameOf(counterpart) : "they";
  let nextStep: string | null = null;
  let recommendedAction: string | null = null;
  if (status === "AWAITING_CEO") {
    const asks = askers.map(ceoAsks);
    const task = [...asks].reverse().find((a) => a.task)?.task ?? null;
    const decision = [...asks].reverse().find((a) => a.decision)?.decision ?? null;
    const meeting = [...asks].reverse().find((a) => a.meeting)?.meeting ?? null;
    const q = openQuestions.at(-1) ?? null;
    if (task) {
      const due = task.dueDate ? ` by ${formatDayShort(task.dueDate)}` : task.dueText ? ` ${task.dueText}` : "";
      nextStep = `${task.title}${due}`;
      recommendedAction = `Reply to ${counterpart} about ${topic} — ${first} asked you to ${lcFirst(task.title)}${task.dueText ? ` ${task.dueText}` : due}`;
    } else if (decision) {
      nextStep = `${decision.title}${decision.deadline ? ` by ${formatDayShort(decision.deadline)}` : ""}`;
      recommendedAction = `Reply to ${counterpart} about ${topic} — ${first} needs your decision${decision.deadline ? ` by ${formatDayShort(decision.deadline)}` : ""}: ${lcFirst(decision.title)}`;
    } else if (meeting) {
      nextStep = `Propose times to ${counterpart}`;
      recommendedAction = `Reply to ${counterpart} about ${topic} — ${first} asked to meet${meeting.proposedTimes.length ? ` (${meeting.proposedTimes.slice(0, 2).join(", ")})` : ""}`;
    } else {
      nextStep = q ? `Answer ${first}: “${truncateWords(q, 120)}”` : `Reply to ${counterpart}`;
      recommendedAction = `Reply to ${counterpart} about ${topic}${q ? ` — ${first} asked: “${truncateWords(q, 140)}”` : ""}`;
    }
  } else if (status === "AWAITING_THEM") {
    const c = openInbound[0];
    if (c) {
      const due = c.dueDate ? c.dueDate : null;
      const chase = due ? addDays(due, 1) : businessDaysAfter(toDay(c.committedAt, tz), 3);
      nextStep = `Waiting on ${c.ownerName ?? counterpart ?? "them"} to ${lcFirst(c.title)}${due ? ` (due ${formatDayShort(due.toISOString().slice(0, 10))})` : ""}`;
      recommendedAction = `Follow up with ${c.ownerName ?? counterpart ?? "them"} on “${c.title}” if nothing arrives by ${formatDayShort(chase.toISOString().slice(0, 10))}`;
    } else {
      const chase = businessDaysAfter(toDay(awaitingSince ?? input.now, tz), 3);
      nextStep = `Waiting on ${counterpart ?? "a reply"}${counterpart ? " to reply" : ""}`;
      recommendedAction = `Follow up with ${counterpart ?? "them"} about ${topic} if there is no reply by ${formatDayShort(chase.toISOString().slice(0, 10))}`;
    }
  } else if (status === "RESOLVED") {
    nextStep = "No action needed";
    recommendedAction = "No action needed — the thread is resolved";
  } else if (status === "FYI") {
    nextStep = "No reply needed";
    recommendedAction = "No action needed — you're copied for information";
  } else {
    const rec = [...human].reverse().find((m) => m.extraction?.recommendedActions.length)?.extraction?.recommendedActions[0];
    nextStep = rec?.action ?? null;
    recommendedAction = rec?.action ?? (counterpart ? `Keep the thread with ${counterpart} moving` : null);
  }

  // ── Narrative (rules template from per-message extraction summaries) ──
  const lines: string[] = [];
  const summarized = human.filter((m) => m.extraction?.summary?.trim());
  const pick = summarized.length <= 3 ? summarized : [summarized[0], ...summarized.slice(-2)];
  for (const m of pick) lines.push(`${fmt(m.sentAt)} — ${m.extraction!.summary.trim()}`);
  if (!lines.length && last) {
    const names = [...new Set(human.map((m) => (m.fromCeo ? "you" : senderName(m))))];
    lines.push(`${human.length} message${human.length === 1 ? "" : "s"} about “${topic}” between ${names.slice(0, 4).join(", ")}.`);
  }
  if (summarized.length > 3) lines.splice(1, 0, `(${summarized.length - 3} more message${summarized.length - 3 === 1 ? "" : "s"})`);
  const summary = truncateWords(lines.join(" "), 1200);

  const days = awaitingSince ? Math.max(0, Math.round((toDay(input.now, tz).getTime() - toDay(awaitingSince, tz).getTime()) / 86_400_000)) : 0;
  const currentStatus =
    status === "AWAITING_CEO"
      ? `Awaiting your reply since ${fmt(awaitingSince!)}${days ? ` (${days} day${days === 1 ? "" : "s"})` : ""}.`
      : status === "AWAITING_THEM"
        ? `Waiting on ${counterpart ?? "them"} since ${fmt(awaitingSince ?? last!.sentAt)}.`
        : status === "RESOLVED"
          ? `Resolved${last ? ` ${fmt(last.sentAt)}` : ""}.`
          : status === "FYI"
            ? "FYI — no reply expected from you."
            : `Active — ${human.length} message${human.length === 1 ? "" : "s"}${last ? `, last from ${last.fromCeo ? "you" : senderName(last)} on ${fmt(last.sentAt)}` : ""}.`;

  let latestReplyStatus: ReplyStatus = "NO_REPLY_NEEDED";
  if (latest && !latest.isAutomated) {
    if (status === "AWAITING_CEO" && !latest.fromCeo) latestReplyStatus = "AWAITING_CEO";
    else if (status === "AWAITING_THEM" && latest.fromCeo) latestReplyStatus = "AWAITING_THEM";
  }

  return { status, awaitingSince, counterpart, openQuestions, decisionsSummary: decisions, nextStep, recommendedAction, summary, currentStatus, latestReplyStatus };
}
