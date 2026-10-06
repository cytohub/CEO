import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dayStartInstant } from "@/lib/dates";
import { EXTERNAL_PEOPLE, MEETINGS, TEAM } from "../../../../../prisma/seed-data";
import { extractNewContent, isAutomatedEmail } from "../../normalize/email";
import type { NormalizedCalendarEvent, NormalizedEmail, ProviderContext } from "../../types";
import { demoClock } from "./clock";
import { buildCalendarFixtures } from "./calendar-fixtures";
import { mockCalendarProvider } from "./calendar";
import { buildEmailFixtures } from "./email-fixtures";
import { mockEmailProvider } from "./email";
import { type Revealable, revealPage } from "./reveal";
import { HELIX_MOVE } from "./scenario";
import { demoWorldFromSettings } from "./world";

const HOUR = 3_600_000;
const ANCHOR = new Date("2026-10-06T14:00:00Z"); // Tuesday 10:00 in New York
const settings = (extra: Record<string, unknown> = {}) => ({ demoAnchor: ANCHOR.toISOString(), timezone: "America/New_York", ...extra });
const world = (extra: Record<string, unknown> = {}) => demoWorldFromSettings(settings(extra));
const ctxAt = (now: Date, extra: Record<string, unknown> = {}): ProviderContext => ({
  connection: { id: "demo", provider: "GMAIL", mode: "DEMO", accountEmail: "ceo@cytohub.example", settings: settings(extra) },
  now,
  log: () => {},
  getAccessToken: async () => {
    throw new Error("no token");
  },
});

describe("revealPage", () => {
  const fx = (key: string, externalId: string, hours: number, item: string | null): Revealable<string> => ({ key, externalId, revealAt: new Date(ANCHOR.getTime() + hours * HOUR), item });
  const fixtures = [fx("a", "1", -5, "a"), fx("b", "2", -5, "b"), fx("c", "3", -1, "c"), fx("d", "1", 2, "a-v2"), fx("e", "4", 3, "e"), fx("f", "3", 4, null)];

  it("reveals only what is visible at `now`, in order, with stable paging", () => {
    const p1 = revealPage(fixtures, null, ANCHOR, 2);
    assert.deepEqual(p1.items, ["a", "b"]);
    assert.equal(p1.hasMore, true);
    assert.deepEqual(p1.cursor, { revealedUntil: new Date(ANCHOR.getTime() - 5 * HOUR).toISOString(), lastKey: "b" });
    const p2 = revealPage(fixtures, p1.cursor, ANCHOR, 2);
    assert.deepEqual(p2.items, ["c"]);
    assert.equal(p2.hasMore, false);
    assert.deepEqual(p2.cursor, { revealedUntil: ANCHOR.toISOString() });
    const again = revealPage(fixtures, p2.cursor, ANCHOR, 2);
    assert.deepEqual(again.items, [], "a re-sync at the same time sees nothing new");
  });

  it("later syncs reveal new items, new versions and deletions", () => {
    const later = revealPage(fixtures, { revealedUntil: ANCHOR.toISOString() }, new Date(ANCHOR.getTime() + 24 * HOUR), 10);
    assert.deepEqual(later.items, ["a-v2", "e"]);
    assert.deepEqual(later.deletedExternalIds, ["3"]);
  });

  it("collapses versions on one page to the latest", () => {
    const fresh = revealPage(fixtures, null, new Date(ANCHOR.getTime() + 24 * HOUR), 10);
    assert.deepEqual(fresh.items.sort(), ["a-v2", "b", "e"]);
    assert.deepEqual(fresh.deletedExternalIds, ["3"]);
  });

  it("ignores time running backwards and malformed cursors", () => {
    const cursor = { revealedUntil: new Date(ANCHOR.getTime() + 10 * HOUR).toISOString() };
    const back = revealPage(fixtures, cursor, ANCHOR, 10);
    assert.deepEqual(back.items, []);
    assert.deepEqual(back.cursor, cursor);
    assert.equal(revealPage(fixtures, { revealedUntil: "garbage" }, ANCHOR, 10).items.length, 3);
  });
});

describe("demo clock", () => {
  it("places seed meetings exactly like prisma/seed.ts", () => {
    const c = demoClock(ANCHOR, "America/New_York");
    // day 2 at 10:00 → Thursday Oct 8, 10:00 New York (14:00 UTC)
    assert.equal(c.seedMeeting(2, 10).toISOString(), "2026-10-08T14:00:00.000Z");
    // day 0 stays today even on weekends; day -3 from Tuesday is Saturday → Friday
    assert.equal(c.seedMeeting(-3, 17).toISOString(), "2026-10-02T21:00:00.000Z");
    // day 4 from Tuesday is Saturday → Monday
    assert.equal(c.workday(4).toISOString().slice(0, 10), "2026-10-12");
  });

  it("phrases dates naturally", () => {
    const c = demoClock(ANCHOR, "America/New_York");
    assert.equal(c.nextWeekdayPhrase(ANCHOR, "Friday"), "Friday");
    assert.equal(c.nextWeekdayPhrase(ANCHOR, "Tuesday"), "next Tuesday");
    assert.equal(c.monthDay(c.workday(8)), "October 14");
    assert.equal(c.dayPhrase(ANCHOR, c.dayOf(c.seedMeeting(2, 10))), "Thursday");
    assert.equal(c.dayPhrase(ANCHOR, c.workday(10)), "Friday, October 16");
    assert.equal(c.clockTime(c.seedMeeting(2, 14)), "2:00 pm");
  });
});

describe("demo mailbox", () => {
  const all = buildEmailFixtures(world());
  const emails = all.filter((f): f is Revealable<NormalizedEmail> & { item: NormalizedEmail } => f.item !== null).map((f) => f.item);
  const after = emails.filter((e) => e.sentAt > ANCHOR);
  const before = emails.filter((e) => e.sentAt <= ANCHOR);

  it("has ~45 business messages in ~20 threads over ten days, 5–8 after the anchor, and 7–8 noise", () => {
    const noise = emails.filter((e) => e.externalId.includes("noise"));
    const business = emails.filter((e) => !e.externalId.includes("noise"));
    assert.ok(business.length >= 40 && business.length <= 50, `business ${business.length}`);
    assert.ok(new Set(business.map((e) => e.threadExternalId)).size >= 18, "threads");
    assert.ok(after.length >= 5 && after.length <= 8, `after anchor ${after.length}`);
    assert.ok(after.every((e) => e.sentAt.getTime() - ANCHOR.getTime() >= 2 * HOUR && e.sentAt.getTime() - ANCHOR.getTime() <= 20 * HOUR));
    assert.ok(before.every((e) => ANCHOR.getTime() - e.sentAt.getTime() <= 10 * 24 * HOUR));
    assert.ok(noise.length >= 7 && noise.length <= 8, `noise ${noise.length}`);
    assert.ok(noise.filter((e) => isAutomatedEmail(e)).length >= 6);
    assert.ok(noise.some((e) => e.headers?.["list-unsubscribe"]));
    assert.equal(new Set(emails.map((e) => e.externalId)).size, emails.length, "unique ids");
    assert.equal(new Set(emails.map((e) => e.internetMessageId)).size, emails.length, "unique Message-IDs");
    assert.ok(all.some((f) => f.item === null), "one message is deleted upstream later");
  });

  it("contains the spec example, greeting only with a real first name", () => {
    const text = (w: ReturnType<typeof world>) => buildEmailFixtures(w).find((f) => f.key === "msg:calder-3")!.item!;
    const unnamed = extractNewContent(text(world()).bodyText, { senderName: "Dr. Henrik Sørensen" }).text;
    assert.match(unnamed, /^Hi,\n/);
    assert.match(unnamed, /please send the revised data package by Friday\. Once we review it, we can discuss expanding the study\./);
    assert.match(extractNewContent(text(world({ ceoFirstName: "CEO" })).bodyText).text, /^Hi,\n/);
    assert.match(extractNewContent(text(world({ ceoFirstName: "Alex" })).bodyText).text, /^Hi Alex,\n/);
  });

  it("covers the commitments, requests and decisions the Brain must find", () => {
    const body = emails.map((e) => e.bodyText).join("\n");
    for (const phrase of [
      "I'll send the updated proposal tomorrow",
      "Let me review and get back to you by Thursday",
      "I'll introduce you to Maya",
      "We will provide the updated SOW next week",
      "we will send the term sheet next week",
      "our legal team will send their comments back by Wednesday",
      "Legal will return their revised language on clause 7.3 by Friday",
      "revised electrophysiology dataset for compounds LB-2207 and LB-2219 by October 14",
      "We decided to go with the limited release",
      "I need your decision on the offer package",
      "40% compute credits",
      "AUC 0.88",
      "19 days against the 10 days",
      "Attached is the revised data package",
      "Halvorsen Capital",
    ]) {
      assert.ok(body.includes(phrase), phrase);
    }
    const fulfilled = emails.find((e) => e.bodyText.startsWith("Henrik,\n\nAttached is the revised data package"))!;
    assert.ok(fulfilled.sentAt > ANCHOR, "the fulfilment arrives after the anchor");
    assert.equal(fulfilled.attachments[0].filename, "Calder_revised_data_package.csv");
  });

  it("uses the seeded people's addresses, a new contact at a known company and an unknown firm", () => {
    const seeded = new Set([...TEAM, ...EXTERNAL_PEOPLE].map((p) => `${p.key}@${p.company ?? "cytohub"}.example`));
    const addresses = new Set(emails.flatMap((e) => [e.from, ...e.to, ...e.cc].map((p) => p.email)));
    for (const a of ["henrik@calder.example", "sarah@northbridge.example", "rachel@lumen.example", "karen@brightwater.example", "alex@aster.example", "ingrid@nhi.example"]) assert.ok(addresses.has(a), a);
    assert.ok(addresses.has("jan.richter@cellwave.example") && !seeded.has("jan.richter@cellwave.example"));
    assert.ok(addresses.has("erik.halvorsen@halvorsencapital.example"));
    const aurelius = emails.find((e) => e.from.email === "whitfield@aurelius.example")!;
    assert.match(aurelius.bodyText, /\nAurelius\n/, "signature uses the short company name");
  });

  it("threads awaiting the CEO and awaiting the other side", () => {
    const byThread = new Map<string, NormalizedEmail[]>();
    for (const e of before) byThread.set(e.threadExternalId, [...(byThread.get(e.threadExternalId) ?? []), e]);
    const last = [...byThread.values()].map((msgs) => msgs.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime()).at(-1)!).filter((m) => !isAutomatedEmail(m) && !m.externalId.includes("noise"));
    assert.ok(last.filter((m) => m.from.email !== "ceo@cytohub.example").length >= 3);
    assert.ok(last.filter((m) => m.from.email === "ceo@cytohub.example").length >= 2);
  });

  it("the adapter reveals the mailbox over time", async () => {
    const opts = { pageSize: 500, initialSince: new Date(ANCHOR.getTime() - 90 * 24 * HOUR) };
    const first = await mockEmailProvider.listChanges(ctxAt(ANCHOR), null, opts);
    assert.equal(first.items.length, before.length);
    const later = await mockEmailProvider.listChanges(ctxAt(new Date(ANCHOR.getTime() + 24 * HOUR)), first.cursor, opts);
    assert.equal(later.items.length, after.length);
    assert.deepEqual(later.deletedExternalIds, ["demo-msg-noise-cold-pitch"]);
    const none = await mockEmailProvider.listChanges(ctxAt(new Date(ANCHOR.getTime() + 25 * HOUR)), later.cursor, opts);
    assert.equal(none.items.length + none.deletedExternalIds.length, 0);
  });
});

describe("demo calendar", () => {
  const fixtures = buildCalendarFixtures(world());
  const events = (at: Date) => {
    const latest = new Map<string, NormalizedCalendarEvent>();
    for (const f of fixtures.filter((x) => x.revealAt <= at).sort((a, b) => a.revealAt.getTime() - b.revealAt.getTime())) latest.set(f.externalId, f.item!);
    return [...latest.values()];
  };

  it("has one event per seeded meeting with the same title and start", () => {
    const now = events(ANCHOR);
    const c = demoClock(ANCHOR, "America/New_York");
    for (const m of MEETINGS) {
      const e = now.find((x) => x.externalId === `demo-evt-${m.key}`);
      assert.ok(e, m.key);
      assert.equal(e.title, m.title);
      assert.equal(e.startsAt.toISOString(), c.seedMeeting(m.day, m.hour, m.minute ?? 0).toISOString(), m.key);
      assert.equal(e.endsAt.getTime() - e.startsAt.getTime(), m.durationMin * 60_000);
    }
  });

  it("covers the extra scenarios and only seeded attendee addresses for seeded people", () => {
    const now = events(ANCHOR);
    const titles = now.map((e) => e.title);
    for (const t of ["1:1 — Jonas Weber", "Final round: Laura Mitchell (VP Sales)", "Legal review: NHI publication embargo", "Product review: onboarding roadmap", "Dentist", "Boston Life Sciences CEO Dinner"]) assert.ok(titles.includes(t), t);
    assert.equal(now.find((e) => e.title.startsWith("Ostrava"))!.status, "CANCELLED");
    assert.equal(now.find((e) => e.title.startsWith("Cellwave"))!.ceoResponse, "DECLINED");
    const weekly = now.filter((e) => e.title === "Exec team weekly");
    assert.ok(weekly.length >= 4 && weekly.every((e) => e.isRecurring && e.seriesId === weekly[0].seriesId));
    const seeded = new Set(["ceo@cytohub.example", ...[...TEAM, ...EXTERNAL_PEOPLE].map((p) => `${p.key}@${p.company ?? "cytohub"}.example`)]);
    const seedEvents = now.filter((e) => MEETINGS.some((m) => `demo-evt-${m.key}` === e.externalId));
    for (const e of seedEvents) for (const a of e.attendees) assert.ok(seeded.has(a.email), `${e.title}: ${a.email}`);
    const inWindow = now.filter((e) => e.startsAt.getTime() >= ANCHOR.getTime() - 7 * 24 * HOUR && e.startsAt.getTime() <= ANCHOR.getTime() + 21 * 24 * HOUR);
    assert.ok(inWindow.length >= 22 && inWindow.length <= 40, `events in the 4-week window: ${inWindow.length}`);
  });

  it("reschedules the Helix diligence session ~3 hours after the anchor (same externalId)", () => {
    const id = `demo-evt-${HELIX_MOVE.meetingKey}`;
    const v1 = events(ANCHOR).find((e) => e.externalId === id)!;
    const v2 = events(new Date(ANCHOR.getTime() + 3 * HOUR)).find((e) => e.externalId === id)!;
    assert.notEqual(v1.startsAt.getTime(), v2.startsAt.getTime());
    const c = demoClock(ANCHOR, "America/New_York");
    assert.equal(v2.startsAt.toISOString(), new Date(dayStartInstant(c.workday(HELIX_MOVE.day), "America/New_York").getTime() + HELIX_MOVE.hour * HOUR).toISOString());
  });

  it("the adapter honors the sync window and reveals changes on later syncs", async () => {
    const opts = { pageSize: 500, windowStart: new Date(ANCHOR.getTime() - 90 * 24 * HOUR), windowEnd: new Date(ANCHOR.getTime() + 30 * 24 * HOUR) };
    const first = await mockCalendarProvider.listChanges(ctxAt(ANCHOR), null, opts);
    assert.ok(!first.items.some((e) => e.title === "Series B first close — closing call"), "outside the window");
    const later = await mockCalendarProvider.listChanges(ctxAt(new Date(ANCHOR.getTime() + 24 * HOUR)), first.cursor, opts);
    assert.deepEqual(later.items.map((e) => e.externalId).sort(), [`demo-evt-${HELIX_MOVE.meetingKey}`, "demo-evt-product-review"]);
  });
});
