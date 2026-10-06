import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AUDIT_CSV_COLUMNS, auditCsv, auditWhere, csvCell, parseAuditFilters, type AuditRow } from "./audit";

describe("csvCell", () => {
  it("leaves plain values alone", () => {
    assert.equal(csvCell("auth.login"), "auth.login");
    assert.equal(csvCell(42), "42");
    assert.equal(csvCell(null), "");
    assert.equal(csvCell(undefined), "");
  });

  it("quotes commas, quotes and newlines (RFC 4180)", () => {
    assert.equal(csvCell("a,b"), '"a,b"');
    assert.equal(csvCell('say "hi"'), '"say ""hi"""');
    assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
  });

  it("neutralizes spreadsheet formulas from attacker-controlled values", () => {
    assert.equal(csvCell("=HYPERLINK(\"http://evil\")"), "\"'=HYPERLINK(\"\"http://evil\"\")\"");
    assert.equal(csvCell("+1+1"), "'+1+1");
    assert.equal(csvCell("-2"), "'-2");
    assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
  });

  it("serializes dates as ISO and objects as JSON", () => {
    assert.equal(csvCell(new Date("2026-10-06T12:00:00Z")), "2026-10-06T12:00:00.000Z");
    assert.equal(csvCell({ a: 1 }), '"{""a"":1}"');
  });
});

describe("auditCsv", () => {
  const row: AuditRow = {
    id: "1",
    at: new Date("2026-10-06T12:00:00Z"),
    action: "auth.login",
    outcome: "FAILURE",
    actorLabel: "=cmd|' /C calc'!A0",
    actorName: null,
    targetType: null,
    targetId: null,
    ip: "127.0.0.1",
    userAgent: "Mozilla/5.0, test",
    metadata: { reason: "bad password" },
  };

  it("writes a header and CRLF-terminated rows", () => {
    const csv = auditCsv([row]);
    const lines = csv.split("\r\n");
    assert.equal(lines[0], AUDIT_CSV_COLUMNS.join(","));
    assert.equal(lines.length, 3);
    assert.equal(lines[2], "");
    assert.ok(lines[1].startsWith("2026-10-06T12:00:00.000Z,auth.login,FAILURE,'=cmd"));
    assert.ok(lines[1].includes('"Mozilla/5.0, test"'));
  });
});

describe("parseAuditFilters", () => {
  it("keeps valid filters", () => {
    const f = parseAuditFilters({ action: "auth.login", actor: "ceo@", outcome: "DENIED", from: "2026-10-01", to: "2026-10-06", page: "3" });
    assert.deepEqual(f, { action: "auth.login", actor: "ceo@", outcome: "DENIED", from: "2026-10-01", to: "2026-10-06", page: 3 });
  });

  it("drops invalid values instead of throwing", () => {
    const f = parseAuditFilters({ action: "auth.login; DROP TABLE", outcome: "MAYBE", from: "yesterday", to: "2026-13-45", page: "-2" });
    assert.deepEqual(f, { action: undefined, actor: undefined, outcome: undefined, from: undefined, to: undefined, page: 1 });
  });

  it("uses the first value of repeated params", () => {
    assert.equal(parseAuditFilters({ outcome: ["SUCCESS", "DENIED"] }).outcome, "SUCCESS");
  });
});

describe("auditWhere", () => {
  it("is empty without filters", () => {
    assert.deepEqual(auditWhere({}, "America/New_York"), {});
  });

  it("covers whole CEO-local days, inclusive of the end day", () => {
    const w = auditWhere({ from: "2026-10-06", to: "2026-10-06" }, "America/New_York");
    const [gte, lt] = (w.AND as { at: { gte?: Date; lt?: Date } }[]).map((c) => c.at);
    // Midnight in New York (EDT, UTC−4) on Oct 6 and Oct 7.
    assert.equal(gte.gte?.toISOString(), "2026-10-06T04:00:00.000Z");
    assert.equal(lt.lt?.toISOString(), "2026-10-07T04:00:00.000Z");
  });

  it("matches the actor case-insensitively by substring", () => {
    const w = auditWhere({ actor: "Admin@" }, "UTC");
    assert.deepEqual(w, { AND: [{ actorLabel: { contains: "Admin@", mode: "insensitive" } }] });
  });
});
