import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { daysFrom, findDates, formatDayShort, resolveDate } from "./dates";

const NY = "America/New_York";
/** Tuesday 2026-10-06, 10:00 in New York. */
const TUE = new Date("2026-10-06T14:00:00Z");

function day(text: string, ref = TUE, tz = NY): string | null {
  return resolveDate(text, ref, tz)?.date ?? null;
}

describe("dates: relative days", () => {
  it("today / tonight / EOD / COB are the reference day", () => {
    for (const t of ["today", "tonight", "by EOD", "end of day", "by the end of the day", "COB", "close of business", "this afternoon"]) assert.equal(day(t), "2026-10-06", t);
  });
  it("tomorrow and the day after", () => {
    assert.equal(day("tomorrow"), "2026-10-07");
    assert.equal(day("tomorrow morning"), "2026-10-07");
    assert.equal(day("the day after tomorrow"), "2026-10-08");
  });
  it("keeps the preposition in the phrase", () => {
    const d = resolveDate("Please send the revised data package by Friday.", TUE, NY)!;
    assert.deepEqual([d.date, d.text, d.hard], ["2026-10-09", "by Friday", true]);
  });
});

describe("dates: weekdays", () => {
  it("bare / on / by / this <weekday> is the next occurrence counting today", () => {
    assert.equal(day("Friday"), "2026-10-09");
    assert.equal(day("on Friday"), "2026-10-09");
    assert.equal(day("this Friday"), "2026-10-09");
    assert.equal(day("by Tuesday"), "2026-10-06", "Tuesday on a Tuesday is today");
    assert.equal(day("on Monday"), "2026-10-12");
  });
  it("'by Friday' written on a Friday means today", () => {
    assert.equal(day("by Friday", new Date("2026-10-09T13:00:00Z")), "2026-10-09");
  });
  it("next <weekday> is strictly after today", () => {
    assert.equal(day("next Tuesday"), "2026-10-13");
    assert.equal(day("next Friday"), "2026-10-09");
    assert.equal(day("this coming Tuesday"), "2026-10-13");
  });
  it("abbreviations need a preposition (\"sat\" and \"wed\" are words)", () => {
    assert.equal(day("by Fri."), "2026-10-09");
    assert.equal(day("on Thu"), "2026-10-08");
    assert.equal(day("the samples sat in the freezer"), null);
    assert.equal(day("Fri"), null);
  });
  it("crosses month and year boundaries", () => {
    assert.equal(day("on Monday", new Date("2026-10-29T15:00:00Z")), "2026-11-02");
    assert.equal(day("next Monday", new Date("2026-12-30T15:00:00Z")), "2027-01-04");
  });
});

describe("dates: weeks", () => {
  it("end of (the) week / EOW / this week = Friday of the current week", () => {
    for (const t of ["by the end of the week", "end of week", "EOW", "this week", "later this week"]) assert.equal(day(t), "2026-10-09", t);
  });
  it("end of week on a weekend rolls to next Friday", () => {
    assert.equal(day("end of the week", new Date("2026-10-10T15:00:00Z")), "2026-10-16");
    assert.equal(day("end of the week", new Date("2026-10-11T15:00:00Z")), "2026-10-16");
  });
  it("next week = Monday of next week (documented choice)", () => {
    const d = resolveDate("We will send the term sheet next week", TUE, NY)!;
    assert.deepEqual([d.date, d.text, d.hard], ["2026-10-12", "next week", false]);
    assert.equal(day("early next week"), "2026-10-12");
    assert.equal(day("next week", new Date("2026-10-12T15:00:00Z")), "2026-10-19", "said on a Monday");
    assert.equal(day("next week", new Date("2026-10-11T15:00:00Z")), "2026-10-12", "said on a Sunday");
    assert.equal(day("next week", new Date("2026-12-30T15:00:00Z")), "2027-01-04");
  });
  it("end of next week = Friday of next week", () => {
    assert.equal(day("by the end of next week"), "2026-10-16");
  });
});

describe("dates: calendar dates", () => {
  it("month name + day, with and without year and ordinal", () => {
    assert.equal(day("October 14th, 2026"), "2026-10-14");
    assert.equal(day("Oct 14"), "2026-10-14");
    assert.equal(day("Oct. 14"), "2026-10-14");
    assert.equal(day("Sept 3"), "2026-09-03", "a month ago stays in the past");
    assert.equal(day("Friday, October 9"), "2026-10-09");
    assert.equal(resolveDate("Can we meet on Friday, October 9 at 2pm?", TUE, NY)!.text, "on Friday, October 9");
  });
  it("day + month", () => {
    assert.equal(day("14 October"), "2026-10-14");
    assert.equal(day("the 14th of October"), "2026-10-14");
    assert.equal(day("3 March 2027"), "2027-03-03");
  });
  it("infers the year: recent past stays, older past rolls forward", () => {
    assert.equal(day("Sept 30"), "2026-09-30", "6 days ago");
    assert.equal(day("Aug 1"), "2026-08-01", "~2 months ago");
    assert.equal(day("March 3"), "2027-03-03", "7 months ago → next March");
    assert.equal(day("January 15", new Date("2026-12-30T15:00:00Z")), "2027-01-15");
    assert.equal(day("December 20", new Date("2027-01-05T15:00:00Z")), "2026-12-20");
  });
  it("ISO and US numeric dates", () => {
    assert.equal(day("2026-10-20"), "2026-10-20");
    assert.equal(day("due 10/14"), "2026-10-14");
    assert.equal(day("10/14/2026"), "2026-10-14");
    assert.equal(day("10/14/26"), "2026-10-14");
    assert.equal(day("3/4 of the hearts"), null, "fractions are not dates");
    assert.equal(day("1/2"), null);
    assert.equal(day("24/7 support"), null);
    assert.equal(day("2/30"), null, "invalid day");
  });
  it("the 14th", () => {
    assert.equal(day("by the 14th"), "2026-10-14");
    assert.equal(day("the 14th", new Date("2026-10-29T15:00:00Z")), "2026-11-14");
    assert.equal(day("the 31st", new Date("2026-11-05T15:00:00Z")), "2026-12-31", "November has no 31st");
    assert.equal(day("the 21st century"), null);
  });
});

describe("dates: periods and offsets", () => {
  it("in / within N days, weeks, months, business days", () => {
    assert.equal(day("in 3 days"), "2026-10-09");
    assert.equal(day("in two weeks"), "2026-10-20");
    assert.equal(day("within 30 days"), "2026-11-05");
    assert.equal(day("in a week"), "2026-10-13");
    assert.equal(day("in 2 months"), "2026-12-06");
    assert.equal(day("in 5 business days"), "2026-10-13");
    assert.equal(day("a couple of weeks from now"), "2026-10-20");
    assert.equal(day("in two weeks", new Date("2026-12-30T15:00:00Z")), "2027-01-13");
  });
  it("end of month / quarter / year", () => {
    assert.equal(day("by end of month"), "2026-10-31");
    assert.equal(day("EOM", new Date("2026-02-10T15:00:00Z")), "2026-02-28");
    assert.equal(day("end of next month"), "2026-11-30");
    assert.equal(day("end of the quarter"), "2026-12-31");
    assert.equal(day("EOQ", new Date("2026-05-02T15:00:00Z")), "2026-06-30");
    assert.equal(day("end of Q1"), "2027-03-31");
    assert.equal(day("end of Q3"), "2026-09-30", "just ended");
    assert.equal(day("year-end"), "2026-12-31");
  });
  it("mid-, end of, beginning of <Month>", () => {
    assert.equal(day("mid-November"), "2026-11-15");
    assert.equal(day("middle of January"), "2027-01-15");
    assert.equal(day("end of November"), "2026-11-30");
    assert.equal(day("beginning of December"), "2026-12-01");
  });
});

describe("dates: hard deadlines", () => {
  it("by / no later than / before / due / deadline / within are hard", () => {
    for (const t of ["by Friday", "no later than Friday", "before Friday", "due Friday", "due by Oct 14", "deadline: Oct 14", "within 10 days"]) assert.equal(resolveDate(t, TUE, NY)!.hard, true, t);
    assert.equal(resolveDate("The deadline for the pre-read is Monday", TUE, NY)!.hard, true);
  });
  it("on / next week / bare weekday are soft", () => {
    for (const t of ["on Friday", "next week", "Friday", "mid-November"]) assert.equal(resolveDate(t, TUE, NY)!.hard, false, t);
  });
  it("resolveDate prefers the hard date in a sentence", () => {
    const d = resolveDate("Let's talk on Monday, but please send it by Friday.", TUE, NY)!;
    assert.equal(d.text, "by Friday");
    assert.equal(findDates("Let's talk on Monday, but please send it by Friday.", TUE, NY).length, 2);
  });
});

describe("dates: timezone and DST", () => {
  it("uses the CEO's local day, not UTC", () => {
    // Thu 22:00 in New York is already Friday in UTC.
    const lateThursday = new Date("2026-10-09T02:00:00Z");
    assert.equal(day("by Friday", lateThursday), "2026-10-09");
    assert.equal(day("today", lateThursday), "2026-10-08");
    // 01:00 Friday in Tokyo is still Thursday in UTC.
    assert.equal(day("today", new Date("2026-10-08T16:00:00Z"), "Asia/Tokyo"), "2026-10-09");
    assert.equal(day("by Friday", new Date("2026-10-08T16:00:00Z"), "Asia/Tokyo"), "2026-10-09");
  });
  it("is stable across the November DST change (New York)", () => {
    // 2026-11-01 02:00 EDT → 01:00 EST.
    assert.equal(day("tomorrow", new Date("2026-11-01T03:30:00Z")), "2026-11-01", "Oct 31 23:30 EDT");
    assert.equal(day("tomorrow", new Date("2026-11-01T04:30:00Z")), "2026-11-02", "Nov 1 00:30 EDT");
    assert.equal(day("in 1 week", new Date("2026-10-30T15:00:00Z")), "2026-11-06");
    assert.equal(day("next week", new Date("2026-10-31T15:00:00Z")), "2026-11-02");
  });
  it("is stable across the March DST change (New York) and in Europe", () => {
    assert.equal(day("tomorrow", new Date("2026-03-08T04:30:00Z")), "2026-03-08", "Mar 7 23:30 EST");
    assert.equal(day("in 1 week", new Date("2026-03-08T04:30:00Z")), "2026-03-14");
    assert.equal(day("by Monday", new Date("2026-10-24T23:30:00Z"), "Europe/London"), "2026-10-26", "BST ends Oct 25");
  });
});

describe("dates: helpers", () => {
  it("formats and counts days", () => {
    assert.equal(formatDayShort("2026-10-09"), "Fri, Oct 9");
    assert.equal(daysFrom("2026-10-09", TUE, NY), 3);
    assert.equal(daysFrom("2026-10-05", TUE, NY), -1);
  });
  it("returns nothing for text without dates", () => {
    assert.deepEqual(findDates("Thanks for the call. Let's keep going.", TUE, NY), []);
    assert.deepEqual(findDates("", TUE, NY), []);
  });
});
