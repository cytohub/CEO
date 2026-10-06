import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { sha256 } from "@/server/security/crypto";
import { newWebhookSecret, safeEchoToken, verifyDropboxSignature, verifySharedToken, verifyWebhookSecret } from "./webhook-verify";

describe("per-connection webhook secrets", () => {
  it("stores only a hash and verifies the echoed secret", () => {
    const { secret, hash } = newWebhookSecret();
    assert.equal(hash, sha256(secret));
    assert.notEqual(hash, secret);
    assert.equal(verifyWebhookSecret(secret, hash), true);
    assert.equal(verifyWebhookSecret(`${secret}x`, hash), false);
    assert.equal(verifyWebhookSecret(null, hash), false);
    assert.equal(verifyWebhookSecret(secret, null), false);
    assert.equal(verifyWebhookSecret("x".repeat(600), sha256("x".repeat(600))), false, "oversized values are rejected");
  });
});

describe("Dropbox signatures", () => {
  const appSecret = "dropbox-app-secret";
  const body = JSON.stringify({ list_folder: { accounts: ["dbid:AAH4f99T0taONIb-OurWxbNQ6ywGRopQngc"] }, delta: { users: [12345678] } });
  const valid = createHmac("sha256", appSecret).update(body).digest("hex");

  it("accepts the HMAC-SHA256 of the raw body", () => {
    assert.equal(verifyDropboxSignature(body, valid, appSecret), true);
    assert.equal(verifyDropboxSignature(Buffer.from(body), valid.toUpperCase(), appSecret), true);
  });

  it("rejects a wrong signature, a modified body, or a missing secret", () => {
    assert.equal(verifyDropboxSignature(body, valid.replace(/^./, valid[0] === "a" ? "b" : "a"), appSecret), false);
    assert.equal(verifyDropboxSignature(`${body} `, valid, appSecret), false);
    assert.equal(verifyDropboxSignature(body, valid, "other-secret"), false);
    assert.equal(verifyDropboxSignature(body, null, appSecret), false);
    assert.equal(verifyDropboxSignature(body, valid, undefined), false);
  });
});

describe("shared tokens and echo tokens", () => {
  it("compares Pub/Sub verification tokens", () => {
    assert.equal(verifySharedToken("tok-123", "tok-123"), true);
    assert.equal(verifySharedToken("tok-124", "tok-123"), false);
    assert.equal(verifySharedToken("tok-123", undefined), false, "not configured → reject");
  });

  it("only echoes bounded, markup-free challenge tokens", () => {
    assert.equal(safeEchoToken("Validation: Testing client application reachability for subscription Request-Id: 1234"), "Validation: Testing client application reachability for subscription Request-Id: 1234");
    assert.equal(safeEchoToken("<script>alert(1)</script>"), null);
    assert.equal(safeEchoToken("line\nbreak"), null);
    assert.equal(safeEchoToken("x".repeat(2000)), null);
    assert.equal(safeEchoToken(null), null);
  });
});
