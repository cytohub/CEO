import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emailThreadWhere, sourceItemWhere, SYSTEM_SCOPE, type AccessScope } from "./access";
import { decryptJson, decryptString, encryptJson, encryptString, safeEqual, sha256 } from "./crypto";
import { hashPassword, passwordProblem, verifyPassword } from "./passwords";
import { clearanceAllows, homePathFor, roleCan, ROLE_CAPABILITIES, sensitivityLevelsFor } from "./rbac";
import { hasBearer, isSameOrigin } from "./request";

describe("roles and clearance", () => {
  it("gives the CEO everything and keeps CEO-private views from other roles", () => {
    assert.ok(roleCan("CEO", "performance.view"));
    for (const role of ["EXECUTIVE", "TEAM_MEMBER", "ADMIN", "ADVISOR"] as const) {
      assert.ok(!roleCan(role, "performance.view"), `${role} must not see CEO performance`);
      assert.ok(!roleCan(role, "cockpit.view"), `${role} must not see the CEO cockpit`);
    }
  });

  it("keeps admins out of company content and executives out of administration", () => {
    assert.ok(roleCan("ADMIN", "integrations.manage") && !roleCan("ADMIN", "workspace.view"));
    assert.ok(roleCan("EXECUTIVE", "workspace.view") && !roleCan("EXECUTIVE", "users.manage"));
  });

  it("orders sensitivity levels", () => {
    assert.deepEqual(sensitivityLevelsFor("CONFIDENTIAL"), ["INTERNAL", "CONFIDENTIAL"]);
    assert.deepEqual(sensitivityLevelsFor(null), []);
    assert.ok(clearanceAllows("RESTRICTED", "RESTRICTED"));
    assert.ok(!clearanceAllows("CONFIDENTIAL", "RESTRICTED"));
    assert.ok(!clearanceAllows(null, "INTERNAL"));
  });

  it("lands each role somewhere it can open", () => {
    assert.equal(homePathFor("CEO"), "/");
    assert.equal(homePathFor("EXECUTIVE"), "/tasks");
    assert.equal(homePathFor("ADMIN"), "/settings/integrations");
    assert.equal(homePathFor("ADVISOR"), "/search");
    for (const role of Object.keys(ROLE_CAPABILITIES) as (keyof typeof ROLE_CAPABILITIES)[]) assert.ok(ROLE_CAPABILITIES[role].includes("search.use"));
  });
});

describe("source access filters", () => {
  const exec: AccessScope = { all: false, levels: ["INTERNAL", "CONFIDENTIAL"], connectionIds: ["c1"], sourceItemIds: [], documentIds: ["d1"], threadIds: [] };
  const advisor: AccessScope = { all: false, levels: [], connectionIds: [], sourceItemIds: [], documentIds: [], threadIds: [] };

  it("is unrestricted only for the unrestricted scope", () => {
    assert.deepEqual(sourceItemWhere(SYSTEM_SCOPE), {});
  });

  it("combines clearance, owned connections and grants", () => {
    const w = sourceItemWhere(exec) as { OR: unknown[] };
    assert.equal(w.OR.length, 3);
    assert.deepEqual(w.OR[0], { sensitivity: { in: ["INTERNAL", "CONFIDENTIAL"] } });
  });

  it("matches nothing when a viewer has no clearance and no grants", () => {
    assert.deepEqual(sourceItemWhere(advisor), { id: "__no_access__" });
    assert.deepEqual(emailThreadWhere(advisor), { id: "__no_access__" });
  });
});

describe("encryption", () => {
  it("round-trips strings and JSON with authenticated, randomized ciphertext", () => {
    const a = encryptString("refresh-token");
    const b = encryptString("refresh-token");
    assert.notEqual(a, b);
    assert.equal(decryptString(a), "refresh-token");
    assert.deepEqual(decryptJson(encryptJson({ x: 1 })), { x: 1 });
  });

  it("rejects tampered ciphertext", () => {
    const token = encryptString("secret");
    const raw = Buffer.from(token.slice(3), "base64");
    raw[raw.length - 1] ^= 0xff;
    assert.throws(() => decryptString(`v1:${raw.toString("base64")}`));
  });

  it("compares in constant time regardless of length", () => {
    assert.ok(safeEqual("abc", "abc"));
    assert.ok(!safeEqual("abc", "abcd"));
    assert.equal(sha256("a").length, 64);
  });
});

describe("passwords", () => {
  it("hashes with a salt and verifies", async () => {
    const h1 = await hashPassword("correct horse battery staple");
    const h2 = await hashPassword("correct horse battery staple");
    assert.notEqual(h1, h2);
    assert.ok(await verifyPassword("correct horse battery staple", h1));
    assert.ok(!(await verifyPassword("wrong password", h1)));
    assert.ok(!(await verifyPassword("anything", null)));
  });

  it("rejects weak passwords", () => {
    assert.ok(passwordProblem("short"));
    assert.ok(passwordProblem("aaaaaaaaaaaaaaaa"));
    assert.equal(passwordProblem("a perfectly fine passphrase"), null);
  });
});

describe("request checks", () => {
  const req = (headers: Record<string, string>) => new Request("http://localhost:3000/api/x", { method: "POST", headers });

  it("accepts same-origin and rejects cross-site or missing Origin", () => {
    assert.ok(isSameOrigin(req({ origin: "http://localhost:3000", host: "localhost:3000" })));
    assert.ok(!isSameOrigin(req({ origin: "https://evil.example", host: "localhost:3000" })));
    assert.ok(!isSameOrigin(req({ host: "localhost:3000" })));
  });

  it("checks bearer secrets", () => {
    assert.ok(hasBearer(req({ authorization: "Bearer s3cret" }), "s3cret"));
    assert.ok(!hasBearer(req({ authorization: "Bearer nope" }), "s3cret"));
    assert.ok(!hasBearer(req({ authorization: "Bearer s3cret" }), undefined));
  });
});
