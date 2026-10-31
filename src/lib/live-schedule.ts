/**
 * The live-update schedule, in the CEO's local time:
 *
 * - Connections set to "Hourly, work hours" sync every hour on weekdays from
 *   7 AM to 7 PM and stay quiet overnight and at weekends.
 * - The Brain writes the morning brief at 6:30 AM every day, then updates
 *   hourly on weekdays from 8 AM to 7 PM, so new deals, payments, signature
 *   requests and meeting notes reach the Inbox within the hour.
 */
import { addDays, dayKey, minuteOfDayInTz, toDay, zonedInstant } from "./dates";

export const WORK_HOURS = { weekdays: [1, 2, 3, 4, 5], start: 7 * 60, end: 19 * 60 } as const;
export const MORNING_BRIEF_MINUTE = 6 * 60 + 30;

/** "weekdays, 7 AM–7 PM" — for labels and help text. */
export const WORK_HOURS_LABEL = "weekdays, 7 AM–7 PM";

export function isWorkday(day: Date): boolean {
  return (WORK_HOURS.weekdays as readonly number[]).includes(day.getUTCDay());
}

export function inWorkHours(instant: Date, timeZone: string): boolean {
  const minute = minuteOfDayInTz(instant, timeZone);
  return isWorkday(toDay(instant, timeZone)) && minute >= WORK_HOURS.start && minute < WORK_HOURS.end;
}

/** The earliest moment at or after `at` that falls in work hours. */
export function nextWorkHoursInstant(at: Date, timeZone: string): Date {
  if (inWorkHours(at, timeZone)) return at;
  const day = toDay(at, timeZone);
  if (isWorkday(day) && minuteOfDayInTz(at, timeZone) < WORK_HOURS.start) return zonedInstant(day, WORK_HOURS.start, timeZone);
  for (let i = 1; i <= 7; i++) {
    const next = addDays(day, i);
    if (isWorkday(next)) return zonedInstant(next, WORK_HOURS.start, timeZone);
  }
  return at;
}

/** When the Brain updates on a calendar day, in minutes after local midnight. */
export function brainSlots(day: Date): number[] {
  const slots = [MORNING_BRIEF_MINUTE];
  if (isWorkday(day)) for (let m = WORK_HOURS.start + 60; m <= WORK_HOURS.end; m += 60) slots.push(m);
  return slots;
}

function hhmm(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}${String(minute % 60).padStart(2, "0")}`;
}

/** The latest Brain update due at `now` (a stable key and when it opened), or null before the morning brief. */
export function dueBrainSlot(now: Date, timeZone: string): { key: string; at: Date } | null {
  const day = toDay(now, timeZone);
  const minute = minuteOfDayInTz(now, timeZone);
  const due = brainSlots(day).filter((m) => m <= minute).pop();
  if (due === undefined) return null;
  return { key: `${dayKey(day)}T${hhmm(due)}`, at: zonedInstant(day, due, timeZone) };
}

/** The next scheduled Brain update after `now`. */
export function nextBrainSlot(now: Date, timeZone: string): Date {
  const day = toDay(now, timeZone);
  const minute = minuteOfDayInTz(now, timeZone);
  const next = brainSlots(day).find((m) => m > minute);
  return next === undefined ? zonedInstant(addDays(day, 1), MORNING_BRIEF_MINUTE, timeZone) : zonedInstant(day, next, timeZone);
}
