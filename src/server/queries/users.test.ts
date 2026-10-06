import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { userChangeProblem, type RuleActor, type RuleTarget } from "./users";

const ceo: RuleActor = { userId: "ceo", role: "CEO" };
const admin: RuleActor = { userId: "admin", role: "ADMIN" };
const target = (id: string, role: RuleTarget["role"], active = true): RuleTarget => ({ id, role, active });

describe("userChangeProblem — creating users", () => {
  it("lets admins create any non-CEO role", () => {
    for (const role of ["EXECUTIVE", "TEAM_MEMBER", "ADMIN", "ADVISOR"] as const) {
      assert.equal(userChangeProblem(admin, null, { kind: "create", role }, 1), null, role);
    }
  });

  it("only the CEO can create a CEO", () => {
    assert.match(userChangeProblem(admin, null, { kind: "create", role: "CEO" }, 1)!, /Only the CEO/);
    assert.equal(userChangeProblem(ceo, null, { kind: "create", role: "CEO" }, 1), null);
  });
});

describe("userChangeProblem — roles", () => {
  it("lets an admin change a non-CEO role", () => {
    assert.equal(userChangeProblem(admin, target("ben", "TEAM_MEMBER"), { kind: "role", role: "EXECUTIVE" }, 1), null);
  });

  it("only the CEO can grant or remove the CEO role", () => {
    assert.match(userChangeProblem(admin, target("ben", "TEAM_MEMBER"), { kind: "role", role: "CEO" }, 1)!, /Only the CEO/);
    assert.match(userChangeProblem(admin, target("ceo2", "CEO"), { kind: "role", role: "EXECUTIVE" }, 2)!, /Only the CEO/);
    assert.equal(userChangeProblem(ceo, target("ben", "TEAM_MEMBER"), { kind: "role", role: "CEO" }, 1), null);
  });

  it("nobody changes their own role (no self-demotion, no self-promotion)", () => {
    assert.match(userChangeProblem(ceo, target("ceo", "CEO"), { kind: "role", role: "EXECUTIVE" }, 2)!, /your own role/);
    assert.match(userChangeProblem(admin, target("admin", "ADMIN"), { kind: "role", role: "EXECUTIVE" }, 1)!, /your own role/);
  });

  it("keeps at least one active CEO", () => {
    assert.match(userChangeProblem(ceo, target("ceo2", "CEO"), { kind: "role", role: "EXECUTIVE" }, 1)!, /at least one active CEO/);
    assert.equal(userChangeProblem(ceo, target("ceo2", "CEO"), { kind: "role", role: "EXECUTIVE" }, 2), null);
    // Demoting an inactive CEO never removes the last active one.
    assert.equal(userChangeProblem(ceo, target("old", "CEO", false), { kind: "role", role: "EXECUTIVE" }, 1), null);
  });

  it("rejects no-op role changes", () => {
    assert.match(userChangeProblem(admin, target("ben", "TEAM_MEMBER"), { kind: "role", role: "TEAM_MEMBER" }, 1)!, /already/);
  });

  it("reports a missing user", () => {
    assert.match(userChangeProblem(admin, null, { kind: "role", role: "ADMIN" }, 1)!, /not found/);
  });
});

describe("userChangeProblem — activation, passwords, unlock", () => {
  it("nobody deactivates themselves", () => {
    assert.match(userChangeProblem(admin, target("admin", "ADMIN"), { kind: "deactivate" }, 1)!, /your own account/);
    assert.match(userChangeProblem(ceo, target("ceo", "CEO"), { kind: "deactivate" }, 2)!, /your own account/);
  });

  it("only the CEO deactivates or reactivates a CEO, and never the last active one", () => {
    assert.match(userChangeProblem(admin, target("ceo", "CEO"), { kind: "deactivate" }, 2)!, /Only the CEO/);
    assert.match(userChangeProblem(ceo, target("ceo2", "CEO"), { kind: "deactivate" }, 1)!, /at least one active CEO/);
    assert.equal(userChangeProblem(ceo, target("ceo2", "CEO"), { kind: "deactivate" }, 2), null);
    assert.match(userChangeProblem(admin, target("ceo2", "CEO", false), { kind: "reactivate" }, 1)!, /Only the CEO/);
  });

  it("admins deactivate and reactivate everyone else", () => {
    assert.equal(userChangeProblem(admin, target("ben", "TEAM_MEMBER"), { kind: "deactivate" }, 1), null);
    assert.equal(userChangeProblem(admin, target("ben", "TEAM_MEMBER", false), { kind: "reactivate" }, 1), null);
    assert.match(userChangeProblem(admin, target("ben", "TEAM_MEMBER", false), { kind: "deactivate" }, 1)!, /already deactivated/);
    assert.match(userChangeProblem(admin, target("ben", "TEAM_MEMBER"), { kind: "reactivate" }, 1)!, /already active/);
  });

  it("protects CEO passwords from non-CEO resets and blocks self-reset", () => {
    assert.match(userChangeProblem(admin, target("ceo", "CEO"), { kind: "reset_password" }, 1)!, /Only the CEO/);
    assert.match(userChangeProblem(admin, target("admin", "ADMIN"), { kind: "reset_password" }, 1)!, /your own password/);
    assert.equal(userChangeProblem(admin, target("ben", "TEAM_MEMBER"), { kind: "reset_password" }, 1), null);
  });

  it("anyone with users.manage may unlock any account", () => {
    assert.equal(userChangeProblem(admin, target("ceo", "CEO"), { kind: "unlock" }, 1), null);
  });
});
