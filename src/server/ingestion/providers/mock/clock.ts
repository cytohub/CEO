/**
 * Time helpers for demo fixtures. Every fixture is placed relative to the
 * connection's demo anchor (settings.demoAnchor) and phrased in the CEO's
 * timezone, so "by Friday" or "October 14" always reads naturally no matter
 * when the demo was created. Meeting placement mirrors prisma/seed.ts exactly
 * (calendar-day offset, weekend-shifted, local wall-clock hour), so calendar
 * fixtures line up with the seeded meetings.
 */
import { DAY_MS, addDays, dayKey, dayKeyInTz, dayStartInstant, today as todayIn } from "@/lib/dates";

const HOUR = 3_600_000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface DemoClock {
  anchor: Date;
  timezone: string;
  /** The anchor's calendar day in the CEO timezone (00:00 UTC Date). */
  today: Date;
  /** anchor + h hours. */
  hours(h: number): Date;
  /** Calendar day `offset` days from today, shifted off weekends (seed semantics). */
  workday(offset: number): Date;
  /** Local wall-clock time on a calendar day. */
  at(day: Date, hour: number, minute?: number): Date;
  /** Seed meeting start: day 0 is today (no weekend shift), others use workday(). */
  seedMeeting(day: number, hour: number, minute?: number): Date;
  /** Calendar day an instant falls on in the CEO timezone. */
  dayOf(instant: Date): Date;
  weekdayOf(day: Date): Weekday;
  /** "October 14" for a calendar day. */
  monthDay(day: Date): string;
  /** "Tuesday, October 13" for a calendar day. */
  longDay(day: Date): string;
  /** Name of the next `weekday` strictly after the instant's day ("Friday", or "next Friday" when a week away). */
  nextWeekdayPhrase(from: Date, weekday: Weekday): string;
  /** "Thursday" when within six days of `from`, else "Tuesday, October 13". */
  dayPhrase(from: Date, day: Date): string;
  /** "10:00 am" / "1:30 pm". */
  clockTime(instant: Date): string;
}

export function demoClock(anchor: Date, timezone: string): DemoClock {
  const today = todayIn(timezone, anchor);
  const dayOf = (instant: Date) => new Date(`${dayKeyInTz(instant, timezone)}T00:00:00.000Z`);
  const workday = (offset: number) => {
    let d = addDays(today, offset);
    const dow = d.getUTCDay();
    if (offset >= 0) {
      if (dow === 6) d = addDays(d, 2);
      if (dow === 0) d = addDays(d, 1);
    } else {
      if (dow === 6) d = addDays(d, -1);
      if (dow === 0) d = addDays(d, -2);
    }
    return d;
  };
  const at = (day: Date, hour: number, minute = 0) => new Date(dayStartInstant(day, timezone).getTime() + hour * HOUR + minute * 60_000);
  const weekdayOf = (day: Date) => WEEKDAYS[day.getUTCDay()];
  const monthDay = (day: Date) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric" }).format(day);
  const longDay = (day: Date) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" }).format(day);
  return {
    anchor,
    timezone,
    today,
    hours: (h) => new Date(anchor.getTime() + h * HOUR),
    workday,
    at,
    seedMeeting: (day, hour, minute = 0) => at(day === 0 ? today : workday(day), hour, minute),
    dayOf,
    weekdayOf,
    monthDay,
    longDay,
    nextWeekdayPhrase(from, weekday) {
      const start = dayOf(from);
      const target = WEEKDAYS.indexOf(weekday);
      let diff = (target - start.getUTCDay() + 7) % 7;
      if (diff === 0) diff = 7;
      return diff === 7 ? `next ${weekday}` : weekday;
    },
    dayPhrase(from, day) {
      const diff = Math.round((day.getTime() - dayOf(from).getTime()) / DAY_MS);
      if (diff === 0) return "today";
      if (diff === 1) return "tomorrow";
      if (diff > 1 && diff < 7) return weekdayOf(day);
      return longDay(day);
    },
    clockTime(instant) {
      return new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(instant).replace("AM", "am").replace("PM", "pm");
    },
  };
}

/** Last calendar day of the month containing `day`. */
export function endOfMonthDay(day: Date): Date {
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0));
}

export { dayKey };
