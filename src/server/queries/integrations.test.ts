import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { connectUrl, describeScopes } from "./integrations";

describe("describeScopes", () => {
  it("renders Google scopes as read-only permissions", () => {
    const p = describeScopes(["openid", "email", "https://www.googleapis.com/auth/gmail.readonly"]);
    assert.deepEqual(
      p.map((x) => x.label),
      ["Confirm which account is connected", "See the account’s email address", "Read email messages and labels"],
    );
    assert.ok(p.every((x) => x.readOnly));
  });

  it("renders Microsoft Graph scopes, with or without the resource prefix", () => {
    const p = describeScopes(["offline_access", "User.Read", "https://graph.microsoft.com/Mail.Read", "Calendars.Read"]);
    assert.deepEqual(
      p.map((x) => x.label),
      ["Stay connected between syncs (refresh token)", "Sign in and read the account profile", "Read mail", "Read calendars"],
    );
  });

  it("renders Dropbox scopes", () => {
    assert.equal(describeScopes(["files.content.read"])[0].label, "View and download file contents");
  });

  it("shows unknown scopes verbatim and does not call them read-only", () => {
    const [p] = describeScopes(["https://www.googleapis.com/auth/gmail.modify"]);
    assert.equal(p.readOnly, false);
    assert.match(p.label, /gmail\.modify/);
  });

  it("describes the demo marker and de-duplicates equivalent scopes", () => {
    const p = describeScopes(["demo: read-only sample data", "email", "userinfo.email", " ", ""]);
    assert.equal(p.length, 2);
    assert.equal(p[0].readOnly, true);
    assert.match(p[0].label, /Sample CytoHub data/);
  });
});

describe("connectUrl", () => {
  it("builds the OAuth start URL from the provider slug", () => {
    assert.equal(connectUrl("OUTLOOK_MAIL"), "/api/integrations/outlook-mail/connect");
    assert.equal(connectUrl("GOOGLE_DRIVE", "abc123"), "/api/integrations/google-drive/connect?connectionId=abc123");
  });
});
