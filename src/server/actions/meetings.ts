"use server";

import { requireCapability } from "@/server/security/session";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { buildPrepBrief, type PrepBrief } from "@/server/brain/prepare";
import { logActivity, revalidateAll } from "@/server/mutations";
import { attempt, fail, ok, type ActionResult } from "./result";

export interface MeetingDetail {
  id: string;
  title: string;
  type: string;
  startsAt: Date;
  endsAt: Date;
  location: string | null;
  objective: string | null;
  importance: number;
  company: { id: string; name: string } | null;
  goal: { id: string; title: string } | null;
  attendees: { id: string; name: string; title: string | null; isCeo: boolean }[];
  prepBrief: PrepBrief | null;
  preparedAt: Date | null;
}

export async function fetchMeetingDetail(meetingId: string): Promise<MeetingDetail | null> {
  await requireCapability("workspace.view");
  const m = await db.meeting.findUnique({
    where: { id: meetingId },
    include: {
      company: { select: { id: true, name: true } },
      goal: { select: { id: true, title: true } },
      attendees: { select: { id: true, name: true, title: true, isCeo: true } },
    },
  });
  if (!m) return null;
  return {
    id: m.id,
    title: m.title,
    type: m.type,
    startsAt: m.startsAt,
    endsAt: m.endsAt,
    location: m.location,
    objective: m.objective,
    importance: m.importance,
    company: m.company,
    goal: m.goal,
    attendees: m.attendees,
    prepBrief: (m.prepBrief as unknown as PrepBrief | null) ?? null,
    preparedAt: m.preparedAt,
  };
}

/** Generate (or regenerate) the Prepare Me brief and cache it on the meeting. */
export async function prepareMeeting(meetingId: string): Promise<ActionResult<PrepBrief>> {
  return attempt(async () => {
    const meeting = await db.meeting.findUnique({ where: { id: meetingId }, select: { id: true, title: true, companyId: true } });
    if (!meeting) return fail("Meeting not found");
    const brief = await buildPrepBrief(meetingId);
    await db.meeting.update({ where: { id: meetingId }, data: { prepBrief: brief as unknown as Prisma.InputJsonValue, preparedAt: new Date() } });
    await logActivity(db, { type: "MEETING_PREPARED", summary: `Prepared for ${meeting.title}`, meetingId, companyId: meeting.companyId });
    // The "meeting prep" insight is resolved once the CEO is prepared.
    await db.brainInsight.updateMany({ where: { fingerprint: `meeting-prep:${meetingId}`, status: { in: ["NEW", "ACKNOWLEDGED"] } }, data: { status: "ACTIONED" } });
    revalidateAll();
    return ok(brief, brief.engine === "claude" ? "Brief prepared by Chief of Staff" : "Brief prepared");
  });
}
