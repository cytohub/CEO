import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Participant } from "../types";
import { extractWithRules } from "./rules-extractor";
import { type ThreadCommitmentFacts, type ThreadMessageFacts, computeThreadState } from "./thread-state";
import { CEO, CEO_PARTY, KAREN, MAYA, NOW, SARAH, TZ, emailInput } from "./testing/fixtures";

let seq = 0;
function msg(from: Participant, text: string, sentAt: string, o: { to?: Participant[]; cc?: Participant[]; automated?: boolean; subject?: string } = {}): ThreadMessageFacts {
  const fromCeo = from.email === CEO.email;
  const to = o.to ?? (fromCeo ? [KAREN] : [CEO_PARTY]);
  const at = new Date(sentAt);
  const input = emailInput({ from, to, cc: o.cc, text, sentAt: at, subject: o.subject ?? "MSA redlines" });
  return {
    id: `m${++seq}`,
    fromEmail: from.email,
    fromName: from.name,
    fromCeo,
    direction: input.email!.direction,
    isAutomated: o.automated ?? false,
    sentAt: at,
    to,
    cc: o.cc ?? [],
    text,
    extraction: o.automated ? null : extractWithRules(input, NOW),
  };
}

const base = { subject: "Re: MSA redlines", ceo: { name: CEO.name, firstName: CEO.firstName, email: CEO.email }, timezone: TZ, now: NOW };
const state = (messages: ThreadMessageFacts[], commitments: ThreadCommitmentFacts[] = []) => computeThreadState({ ...base, messages, commitments });

const ASK = "Hi Rajib,\n\nOur counsel reviewed the MSA. Can you confirm clause 7.3 by Friday? Also, are the data rights exclusive?\n\nThanks,\nKaren";

describe("thread status", () => {
  it("AWAITING_CEO: the last message asks the CEO and the CEO has not replied", () => {
    const s = state([msg(KAREN, ASK, "2026-10-05T14:00:00Z")]);
    assert.equal(s.status, "AWAITING_CEO");
    assert.equal(s.awaitingSince?.toISOString(), "2026-10-05T14:00:00.000Z");
    assert.equal(s.counterpart, "Karen Liu");
    assert.equal(s.latestReplyStatus, "AWAITING_CEO");
    assert.deepEqual(s.openQuestions, ["Can you confirm clause 7.3 by Friday?", "Also, are the data rights exclusive?"]);
    assert.equal(s.nextStep, "Confirm clause 7.3 by Fri, Oct 9");
    assert.equal(s.recommendedAction, "Reply to Karen Liu about MSA redlines — Karen asked you to confirm clause 7.3 by Friday");
    assert.equal(s.currentStatus, "Awaiting your reply since Mon, Oct 5 (1 day).");
  });

  it("awaitingSince is the first unanswered ask after the CEO's last message", () => {
    const s = state([
      msg(KAREN, "Hi Rajib,\n\nCan you send the SOW?\n\nKaren", "2026-10-01T14:00:00Z"),
      msg(CEO_PARTY, "Hi Karen,\n\nSent — see attached.\n\nRajib", "2026-10-02T14:00:00Z"),
      msg(KAREN, ASK, "2026-10-05T14:00:00Z"),
      msg(KAREN, "Hi Rajib,\n\nFollowing up on my note below.\n\nKaren", "2026-10-06T13:00:00Z"),
    ]);
    assert.equal(s.status, "AWAITING_CEO");
    assert.equal(s.awaitingSince?.toISOString(), "2026-10-05T14:00:00.000Z");
    assert.ok(!s.openQuestions.includes("Can you send the SOW?"), "answered questions are not open");
  });

  it("AWAITING_THEM: the CEO's last message asks for something", () => {
    const s = state([msg(KAREN, ASK, "2026-10-05T14:00:00Z"), msg(CEO_PARTY, "Hi Karen,\n\nClause 7.3 works for us. Could you send the signed MSA back by Thursday?\n\nRajib", "2026-10-06T13:00:00Z")]);
    assert.equal(s.status, "AWAITING_THEM");
    assert.equal(s.awaitingSince?.toISOString(), "2026-10-06T13:00:00.000Z");
    assert.equal(s.latestReplyStatus, "AWAITING_THEM");
    assert.equal(s.counterpart, "Karen Liu");
    assert.match(s.recommendedAction!, /^Follow up with Karen Liu about MSA redlines if there is no reply by /);
    assert.deepEqual(s.openQuestions, []);
  });

  it("AWAITING_THEM: an open inbound commitment", () => {
    const commitments: ThreadCommitmentFacts[] = [
      { id: "c1", direction: "INBOUND", status: "OPEN", title: "Send term sheet", dueDate: new Date("2026-10-12T00:00:00Z"), committedAt: new Date("2026-10-05T14:00:00Z"), ownerName: "Sarah Chen", counterpartyName: CEO.name },
    ];
    const s = state(
      [msg(SARAH, "Hi Rajib,\n\nWe will send the term sheet next week.\n\nSarah", "2026-10-05T14:00:00Z", { subject: "Series B" }), msg(CEO_PARTY, "Thanks Sarah, sounds great.", "2026-10-05T16:00:00Z", { to: [SARAH] })],
      commitments,
    );
    assert.equal(s.status, "AWAITING_THEM");
    assert.equal(s.nextStep, "Waiting on Sarah Chen to send term sheet (due Mon, Oct 12)");
    assert.equal(s.recommendedAction, "Follow up with Sarah Chen on “Send term sheet” if nothing arrives by Tue, Oct 13");
  });

  it("RESOLVED: closing language, or every commitment fulfilled", () => {
    assert.equal(state([msg(KAREN, ASK, "2026-10-05T14:00:00Z"), msg(CEO_PARTY, "Confirmed.", "2026-10-05T16:00:00Z"), msg(KAREN, "Thanks Rajib, we're all set.", "2026-10-06T13:00:00Z")]).status, "RESOLVED");
    const done: ThreadCommitmentFacts[] = [{ id: "c1", direction: "OUTBOUND", status: "FULFILLED", title: "Send data package", dueDate: null, committedAt: new Date("2026-10-01T00:00:00Z"), ownerName: CEO.name, counterpartyName: "Karen Liu" }];
    const s = state([msg(CEO_PARTY, "Hi Karen,\n\nHere is the package.\n\nRajib", "2026-10-05T14:00:00Z")], done);
    assert.equal(s.status, "RESOLVED");
    assert.equal(s.nextStep, "No action needed");
  });

  it("FYI: the CEO is only copied and never wrote; automated-only threads", () => {
    const fyi = state([msg(KAREN, "Hi Maya,\n\nCan you send the assay timing?\n\nKaren", "2026-10-05T14:00:00Z", { to: [MAYA], cc: [CEO_PARTY] })]);
    assert.equal(fyi.status, "FYI");
    assert.equal(fyi.latestReplyStatus, "NO_REPLY_NEEDED");
    assert.equal(state([msg({ name: "DocuSign", email: "dse@docusign.example" }, "Your envelope was completed.", "2026-10-05T14:00:00Z", { automated: true })]).status, "FYI");
  });

  it("ACTIVE: ongoing exchange without a pending ask", () => {
    const s = state([msg(KAREN, ASK, "2026-10-05T14:00:00Z"), msg(CEO_PARTY, "Hi Karen,\n\nI'll send our position on clause 7.3 by Thursday.\n\nRajib", "2026-10-05T16:00:00Z")]);
    assert.equal(s.status, "ACTIVE");
    assert.match(s.currentStatus, /^Active — 2 messages, last from you on Mon, Oct 5\.$/);
  });
});

describe("thread narrative", () => {
  it("summarizes from per-message extraction summaries with dates", () => {
    const s = state([msg(KAREN, ASK, "2026-10-05T14:00:00Z")]);
    assert.ok(s.summary.startsWith("Mon, Oct 5 — Karen Liu (Brightwater Therapeutics) asks you to confirm clause 7.3"), s.summary);
  });

  it("lists decisions made and pending", () => {
    const s = state([
      msg(SARAH, "Hi Rajib,\n\nThe IC approved moving forward. Should we target a $40M or $45M round?\n\nSarah", "2026-10-05T14:00:00Z", { subject: "Series B" }),
    ]);
    assert.ok(s.decisionsSummary.includes("Decided: The IC approved moving forward"), s.decisionsSummary.join(" | "));
    assert.ok(s.decisionsSummary.some((d) => d.startsWith("Needs your decision: Decide whether to target")));
    assert.equal(s.status, "AWAITING_CEO");
  });

  it("caps open questions at five and skips pleasantries", () => {
    const text = `Hi Rajib,\n\nHow are you? ${["A", "B", "C", "D", "E", "F"].map((x) => `Can you check item ${x}?`).join(" ")}\n\nKaren`;
    const s = state([msg(KAREN, text, "2026-10-05T14:00:00Z")]);
    assert.equal(s.openQuestions.length, 5);
    assert.ok(!s.openQuestions.includes("How are you?"));
  });
});
