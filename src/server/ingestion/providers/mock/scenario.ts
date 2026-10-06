/**
 * Facts shared by the demo email and calendar fixtures so both sources tell
 * the same story (the Helix diligence session that moves, meeting times that
 * emails refer to).
 */
import { MEETINGS } from "../../../../../prisma/seed-data";
import type { DemoClock } from "./clock";

export type SeedMeeting = (typeof MEETINGS)[number];

export function seedMeeting(key: string): SeedMeeting {
  const m = MEETINGS.find((x) => x.key === key);
  if (!m) throw new Error(`Unknown seed meeting: ${key}`);
  return m;
}

export function seedMeetingStart(clock: DemoClock, key: string): Date {
  const m = seedMeeting(key);
  return clock.seedMeeting(m.day, m.hour, m.minute ?? 0);
}

/** Helix asks to move the diligence session; the updated invite lands ~3 hours after the anchor. */
export const HELIX_MOVE = { meetingKey: "mHelixDiligence", day: 7, hour: 10, minute: 0, emailHours: 2.5, inviteHours: 3 } as const;

export function helixMovedStart(clock: DemoClock): Date {
  return clock.at(clock.workday(HELIX_MOVE.day), HELIX_MOVE.hour, HELIX_MOVE.minute);
}

/** Lumen's new deliverable date (~8 days out). */
export function lumenDatasetDue(clock: DemoClock): Date {
  return clock.workday(8);
}
