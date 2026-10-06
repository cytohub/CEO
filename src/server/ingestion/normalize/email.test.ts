import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { baseSubject, decodeHtmlEntities, decodeMimeWords, emailDirection, extractNewContent, htmlToText, isAutomatedEmail, parseAddress, parseAddressList } from "./email";

describe("htmlToText", () => {
  it("drops script/style/head, keeps block structure and decodes entities", () => {
    const html = `<html><head><title>x</title><style>p{color:red}</style></head><body>
      <script>alert('x')</script>
      <p>Hi Alex,</p><div>Please send the revised data package by Friday.<br>Thanks &amp; regards</div>
      <ul><li>Item one</li><li>Item &#8220;two&#8221;</li></ul>
      <table><tr><td>AUC</td><td>0.88</td></tr></table>
      <p>Caf&eacute; &nbsp;&lt;meeting&gt; &hellip;</p><img src="pixel.gif"></body></html>`;
    const text = htmlToText(html);
    assert.ok(!text.includes("alert"));
    assert.ok(!text.includes("color:red"));
    assert.ok(!/<\/?(p|div|ul|li|table|tr|td|img|script|style|html|body)\b/i.test(text), "no tags left");
    assert.match(text, /^Hi Alex,\n+Please send the revised data package by Friday\.\nThanks & regards/);
    assert.match(text, /- Item one\n- Item “two”/);
    assert.match(text, /AUC 0\.88/);
    assert.match(text, /Café <meeting> …/);
  });

  it("decodes numeric, hex and named entities and leaves unknown ones", () => {
    assert.equal(decodeHtmlEntities("&#36;4M &#x2014; &rsquo;s &unknown; &amp;amp;"), "$4M — ’s &unknown; &amp;");
  });
});

describe("extractNewContent", () => {
  it("strips Gmail-style quoted history and the signature", () => {
    const body = [
      "Hi Alex,",
      "",
      "Thanks for the update. Please send the revised data package by Friday. Once we review it, we can discuss expanding the study.",
      "",
      "Best regards,",
      "Henrik",
      "",
      "Dr. Henrik Sørensen",
      "Chief Scientific Officer | Calder Biosciences",
      "+1 617 555 0142",
      "",
      "On Mon, Oct 5, 2026 at 9:14 AM Alex <ceo@cytohub.example> wrote:",
      "> We will provide the updated SOW next week.",
      ">",
      "> Best,",
      "> Alex",
    ].join("\n");
    const out = extractNewContent(body);
    assert.equal(out.text, "Hi Alex,\n\nThanks for the update. Please send the revised data package by Friday. Once we review it, we can discuss expanding the study.");
    assert.equal(out.quotedRemoved, true);
    assert.equal(out.signatureRemoved, true);
  });

  it("handles attribution lines that Gmail wraps over two lines", () => {
    const body = "Sounds good, see you Thursday.\n\nOn Tue, Oct 6, 2026 at 10:02 AM Sarah Chen <\nsarah@northbridge.example> wrote:\n> Partner meeting confirmed.";
    assert.equal(extractNewContent(body).text, "Sounds good, see you Thursday.");
  });

  it("strips Outlook-style header blocks and Original Message separators", () => {
    const outlook = [
      "Rachel,",
      "",
      "Understood. We'll come to the call with a dated recovery plan.",
      "",
      "________________________________",
      "From: Rachel Moore <rachel@lumen.example>",
      "Sent: Tuesday, October 6, 2026 9:00 AM",
      "To: Daniel Kim",
      "Subject: Escalation",
      "",
      "This is the third month in a row that we've missed the SLA.",
    ].join("\n");
    assert.equal(extractNewContent(outlook).text, "Rachel,\n\nUnderstood. We'll come to the call with a dated recovery plan.");

    const noSeparator = "Agreed.\n\nFrom: Priya Raman <priya@cytohub.example>\nSent: Wednesday, September 30, 2026 8:00 AM\nTo: CEO\nSubject: References\n\nAurelius agreed.";
    assert.equal(extractNewContent(noSeparator).text, "Agreed.");

    const original = "Approved.\n\n-----Original Message-----\nFrom: Jonas\nI need your approval.";
    assert.equal(extractNewContent(original).text, "Approved.");
  });

  it("removes '>' quoted lines, mobile footers and the RFC 3676 '-- ' delimiter", () => {
    assert.equal(extractNewContent("Yes, go ahead.\n\nSent from my iPhone\n\n> Can we sign?").text, "Yes, go ahead.");
    assert.equal(extractNewContent("See attached.\n-- \nMarcus Hale\nGeneral Counsel").text, "See attached.");
    assert.equal(extractNewContent("> earlier line one\n> earlier line two\nMy inline answer.").text, "My inline answer.");
  });

  it("keeps a sign-off that is followed by a long paragraph (not a signature)", () => {
    const body = "Thanks,\n\nThis is a long paragraph that continues the actual message content and is definitely not part of any signature block because it keeps going for a long while.";
    assert.equal(extractNewContent(body).text, body);
  });

  it("strips a closing block that starts with the sender's name when there is no sign-off phrase", () => {
    const body = "Happy to confirm the full pro-rata ($4M).\n\nMichael\n\nMichael Grant | Managing Partner | Granite Peak Capital";
    assert.equal(extractNewContent(body, { senderName: "Michael Grant" }).text, "Happy to confirm the full pro-rata ($4M).");
    const ingrid = "Comments by Friday, please.\n\nWith best regards,\nIngrid\n\nProf. Ingrid Holm\nDirector, Nordic Heart Institute";
    assert.equal(extractNewContent(ingrid, { senderName: "Prof. Ingrid Holm" }).text, "Comments by Friday, please.");
    // Without the sender name nothing name-based is removed.
    assert.match(extractNewContent(body).text, /Michael Grant \| Managing Partner/);
  });

  it("strips confidentiality footers", () => {
    const body = "Draft attached.\n\nCONFIDENTIALITY NOTICE: This e-mail is intended only for the named recipient.";
    assert.equal(extractNewContent(body).text, "Draft attached.");
  });

  it("falls back to the full body when everything would be stripped", () => {
    const fwd = "> only quoted\n> text here";
    assert.equal(extractNewContent(fwd).text, fwd);
    assert.equal(extractNewContent("Thanks,\nJonas").text, "Thanks,\nJonas");
    assert.equal(extractNewContent("").text, "");
  });
});

describe("addresses", () => {
  it("parses display names, quotes, comments and case", () => {
    assert.deepEqual(parseAddress('"Chen, Sarah" <Sarah@Northbridge.example>'), { name: "Chen, Sarah", email: "sarah@northbridge.example" });
    assert.deepEqual(parseAddress("jonas@cytohub.example"), { name: null, email: "jonas@cytohub.example" });
    assert.deepEqual(parseAddress("maya@cytohub.example (Maya Lindqvist)"), { name: "Maya Lindqvist", email: "maya@cytohub.example" });
    assert.equal(parseAddress("not an address"), null);
  });

  it("splits lists on commas outside quotes and de-duplicates", () => {
    const list = parseAddressList('"Liu, Karen" <karen@brightwater.example>, Priya Raman <priya@cytohub.example>; PRIYA@cytohub.example');
    assert.deepEqual(list, [
      { name: "Liu, Karen", email: "karen@brightwater.example" },
      { name: "Priya Raman", email: "priya@cytohub.example" },
    ]);
    assert.deepEqual(parseAddressList(null), []);
  });

  it("decodes RFC 2047 encoded words", () => {
    assert.equal(decodeMimeWords("=?UTF-8?B?RHIuIEhlbnJpayBTw7hyZW5zZW4=?="), "Dr. Henrik Sørensen");
    assert.equal(decodeMimeWords("=?iso-8859-1?Q?Caf=E9_meeting?="), "Café meeting");
    assert.equal(decodeMimeWords("=?UTF-8?Q?a?= =?UTF-8?Q?b?="), "ab");
    assert.deepEqual(parseAddress("=?UTF-8?B?RHIuIEhlbnJpayBTw7hyZW5zZW4=?= <henrik@calder.example>"), { name: "Dr. Henrik Sørensen", email: "henrik@calder.example" });
  });

  it("normalizes thread subjects", () => {
    assert.equal(baseSubject("Re: RE: Fwd: Brightwater MSA v5"), "Brightwater MSA v5");
    assert.equal(baseSubject("AW: SV: Termin"), "Termin");
    assert.equal(baseSubject("  "), "(no subject)");
  });
});

describe("emailDirection", () => {
  const opts = { accountEmail: "ceo@cytohub.example", ceoEmail: "ceo@cytohub.example" };
  const p = (email: string) => ({ name: null, email });

  it("is OUTBOUND when the account (or the CEO) sent it", () => {
    assert.equal(emailDirection({ from: p("ceo@cytohub.example"), to: [p("henrik@calder.example")], cc: [] }, opts), "OUTBOUND");
    assert.equal(emailDirection({ from: p("CEO@cytohub.example"), to: [p("jonas@cytohub.example")], cc: [] }, opts), "OUTBOUND");
    assert.equal(emailDirection({ from: p("ceo@cytohub.example"), to: [], cc: [] }, { accountEmail: "assistant@cytohub.example", ceoEmail: "ceo@cytohub.example" }), "OUTBOUND");
  });

  it("is INTERNAL when every participant is on the account's domain", () => {
    assert.equal(emailDirection({ from: p("jonas@cytohub.example"), to: [p("ceo@cytohub.example")], cc: [p("maya@cytohub.example")] }, opts), "INTERNAL");
  });

  it("is INBOUND otherwise", () => {
    assert.equal(emailDirection({ from: p("karen@brightwater.example"), to: [p("ceo@cytohub.example")], cc: [] }, opts), "INBOUND");
    assert.equal(emailDirection({ from: p("elena@cytohub.example"), to: [p("jan@cellwave.example")], cc: [p("ceo@cytohub.example")] }, opts), "INBOUND");
  });
});

describe("isAutomatedEmail", () => {
  const from = (email: string) => ({ name: null, email });
  it("detects bulk headers", () => {
    assert.equal(isAutomatedEmail({ from: from("news@x.example"), headers: { "list-unsubscribe": "<https://x/u>" } }), true);
    assert.equal(isAutomatedEmail({ from: from("a@x.example"), headers: { precedence: "bulk" } }), true);
    assert.equal(isAutomatedEmail({ from: from("a@x.example"), headers: { precedence: "junk" } }), true);
    assert.equal(isAutomatedEmail({ from: from("a@x.example"), headers: { "auto-submitted": "auto-replied" } }), true);
    assert.equal(isAutomatedEmail({ from: from("a@x.example"), headers: { "auto-submitted": "no" } }), false);
  });

  it("detects automated senders", () => {
    for (const e of ["noreply@hubspot.example", "no-reply@x.example", "notifications@github.example", "newsletter@biopharmadaily.example", "mailer-daemon@cytohub.example", "do-not-reply@bank.example", "calendar-notification@google.example"]) {
      assert.equal(isAutomatedEmail({ from: from(e) }), true, e);
    }
  });

  it("does not flag people", () => {
    for (const e of ["karen@brightwater.example", "jake@growthleads.example", "news.anchor@tv.example".replace("news.anchor", "anchor"), "renew@x.example"]) {
      assert.equal(isAutomatedEmail({ from: from(e), headers: {} }), false, e);
    }
  });
});
