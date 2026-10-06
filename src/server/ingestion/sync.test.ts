import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

// sync.ts imports the Prisma client; no connection is opened by these tests.
process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:1/unused";
let firstPassThreadStatus: typeof import("./sync").firstPassThreadStatus;

before(async () => {
  ({ firstPassThreadStatus } = await import("./sync"));
});

const p = (email: string) => ({ name: null, email });
const ACCOUNT = "ceo@cytohub.example";

describe("firstPassThreadStatus", () => {
  it("our side spoke last → waiting on them", () => {
    assert.equal(firstPassThreadStatus({ direction: "OUTBOUND", fromEmail: ACCOUNT, to: [p("henrik@calder.example")], cc: [] }, ACCOUNT), "AWAITING_THEM");
    // A teammate answered the customer with the CEO copied.
    assert.equal(firstPassThreadStatus({ direction: "INBOUND", fromEmail: "daniel@cytohub.example", to: [p("rachel@lumen.example")], cc: [p(ACCOUNT)] }, ACCOUNT), "AWAITING_THEM");
  });

  it("addressed to the CEO → awaiting the CEO; only copied → FYI", () => {
    assert.equal(firstPassThreadStatus({ direction: "INBOUND", fromEmail: "karen@brightwater.example", to: [p(ACCOUNT)], cc: [] }, ACCOUNT), "AWAITING_CEO");
    assert.equal(firstPassThreadStatus({ direction: "INTERNAL", fromEmail: "jonas@cytohub.example", to: [p(ACCOUNT)], cc: [] }, ACCOUNT), "AWAITING_CEO");
    assert.equal(firstPassThreadStatus({ direction: "INBOUND", fromEmail: "karen@brightwater.example", to: [p("priya@cytohub.example")], cc: [p(ACCOUNT)] }, ACCOUNT), "FYI");
    assert.equal(firstPassThreadStatus(null, ACCOUNT), "FYI");
  });
});
