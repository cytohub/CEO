import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";
import { REQUEST_PATH_HEADER, pathOf } from "./server/security/request-path";

const BASE = "http://localhost:3000";

describe("requested path", () => {
  it("keeps the path and query but drops Next's _rsc cache-buster", () => {
    assert.equal(pathOf(new URL(`${BASE}/inbox`)), "/inbox");
    assert.equal(pathOf(new URL(`${BASE}/search?q=Series%20B&_rsc=abc123`)), "/search?q=Series+B");
    assert.equal(pathOf(new URL(`${BASE}/tasks?_rsc=abc123`)), "/tasks");
  });
});

describe("proxy", () => {
  it("sends requests without a session to sign-in, remembering the page", () => {
    const res = proxy(new NextRequest(`${BASE}/inbox?tab=snoozed&_rsc=x`));
    assert.equal(res.status, 307);
    assert.equal(new URL(res.headers.get("location")!).searchParams.get("next"), "/inbox?tab=snoozed");
  });

  it("answers APIs without a session with 401", () => {
    assert.equal(proxy(new NextRequest(`${BASE}/api/uploads`, { method: "POST" })).status, 401);
  });

  it("tells the server which page a signed-in request is for, overwriting any client value", () => {
    const res = proxy(new NextRequest(`${BASE}/brain/review?_rsc=x`, { headers: { cookie: "cytohub_session=t", [REQUEST_PATH_HEADER]: "/forged" } }));
    assert.equal(res.headers.get(`x-middleware-request-${REQUEST_PATH_HEADER}`), "/brain/review");
  });
});
