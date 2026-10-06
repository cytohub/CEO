import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyRewrite, briefVisibleTo, isRichBrief, maxSensitivity, normalizePrepBrief } from "./prep-brief";

// A brief exactly as v1 stored it on Meeting.prepBrief (before ingestion).
const V1 = {
  generatedAt: "2026-10-01T10:00:00.000Z",
  engine: "rules",
  context: "Top-tier life-science fund.",
  history: [{ date: "Sep 16, 2026", title: "Northbridge Ventures — intro", detail: "Thesis fit." }],
  participants: [{ name: "Sarah Chen", role: "Partner · Northbridge Ventures · Investor", lastContact: "1 days ago" }],
  objectives: ["Earn a term sheet"],
  openIssues: [{ title: "Finalize deck v7", kind: "Your task", href: "/tasks?task=t1" }],
  talkingPoints: ["Traction"],
  desiredOutcome: "A term sheet",
  questions: ["What would you need to lead?"],
  risks: ["Deal slowing"],
  nextActions: ["Follow up within 24h"],
};

describe("prep brief backward compatibility", () => {
  it("renders a stored v1 brief with empty v2 sections", () => {
    const b = normalizePrepBrief(V1)!;
    assert.ok(b);
    assert.equal(isRichBrief(b), false);
    assert.deepEqual(b.talkingPoints, ["Traction"]);
    assert.deepEqual(b.openIssues[0], { title: "Finalize deck v7", kind: "Your task", href: "/tasks?task=t1" });
    for (const k of ["participantContext", "relationshipHistory", "recentEmails", "openTasks", "commitments", "openQuestions", "documents", "potentialRisks"] as const) assert.deepEqual(b[k], [], k);
    assert.equal(b.companyContext, null);
    assert.equal(b.strategicImportance, null);
    assert.equal(b.maxSensitivity, undefined);
  });
  it("drops malformed entries instead of failing", () => {
    const b = normalizePrepBrief({ ...V1, engine: "gpt", talkingPoints: ["ok", 3, null], participants: [{ bad: true }, { name: "B", role: "r" }], commitments: [{ id: "c", title: "T", href: "/c", direction: "SIDEWAYS", state: "open" }] })!;
    assert.equal(b.engine, "rules");
    assert.deepEqual(b.talkingPoints, ["ok"]);
    assert.deepEqual(b.participants.map((p) => p.name), ["B"]);
    assert.equal(b.commitments[0].direction, "INTERNAL");
    assert.equal(normalizePrepBrief(null), null);
    assert.equal(normalizePrepBrief("brief"), null);
    assert.equal(normalizePrepBrief([V1]), null);
  });
  it("keeps v2 sections", () => {
    const b = normalizePrepBrief({ ...V1, version: 2, maxSensitivity: "RESTRICTED", objective: "Earn a term sheet", recentEmails: [{ id: "t", subject: "S", status: "AWAITING_CEO", statusLabel: "Awaiting your reply", lastMessageAt: "2026-10-05T00:00:00Z", href: "/brain/threads/t" }] })!;
    assert.equal(isRichBrief(b), true);
    assert.equal(b.recentEmails[0].subject, "S");
    assert.equal(b.maxSensitivity, "RESTRICTED");
  });
});

describe("prep brief visibility", () => {
  const exec = { all: false, levels: ["INTERNAL", "CONFIDENTIAL"] as const };
  it("restricted-source briefs are hidden from executives, legacy briefs are not", () => {
    assert.equal(briefVisibleTo({ maxSensitivity: "RESTRICTED" }, { ...exec, levels: [...exec.levels] }), false);
    assert.equal(briefVisibleTo({ maxSensitivity: "CONFIDENTIAL" }, { ...exec, levels: [...exec.levels] }), true);
    assert.equal(briefVisibleTo({ maxSensitivity: undefined }, { all: false, levels: [] }), true);
    assert.equal(briefVisibleTo({ maxSensitivity: "RESTRICTED" }, { all: true, levels: [] }), true);
  });
  it("max sensitivity", () => {
    assert.equal(maxSensitivity(["INTERNAL", null, "RESTRICTED", "CONFIDENTIAL"]), "RESTRICTED");
    assert.equal(maxSensitivity([null, undefined]), null);
  });
});

describe("Claude rewrite", () => {
  it("applies a valid rewrite and keeps structured sections", () => {
    const base = normalizePrepBrief({ ...V1, version: 2, objective: "Old", strategicImportance: { goal: null, pillar: null, deal: null, whyNow: ["old"] } })!;
    const out = applyRewrite(base, { context: "C", objective: "New objective", talkingPoints: ["a"], questions: ["q"], desiredOutcome: "d", risks: [], nextActions: ["n"], whyNow: ["now"] });
    assert.equal(out.engine, "claude");
    assert.equal(out.objective, "New objective");
    assert.deepEqual(out.strategicImportance?.whyNow, ["now"]);
    assert.deepEqual(out.openIssues, base.openIssues);
  });
  it("falls back to the rules brief on invalid output", () => {
    const base = normalizePrepBrief(V1)!;
    assert.equal(applyRewrite(base, { context: "", talkingPoints: [] }), base);
    assert.equal(applyRewrite(base, null), base);
  });
});
