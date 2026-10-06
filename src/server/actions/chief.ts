"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { requireViewer } from "@/server/security/session";
import { revalidateAll } from "@/server/mutations";
import { attemptAs, fail, id, ok, type ActionResult } from "./result";

/**
 * Open a new Chief of Staff conversation before its first question is sent,
 * so the chat always posts an existing thread id to /api/chief-of-staff.
 * Titled like the API titles threads (first 80 characters of the question).
 */
export async function createThread(firstMessage: string): Promise<ActionResult<{ id: string; title: string }>> {
  return attemptAs("chief.use", async () => {
    const message = z.string().trim().min(1, "Ask a question first").max(4000).parse(firstMessage);
    const viewer = await requireViewer();
    const thread = await db.chatThread.create({ data: { title: message.slice(0, 80), userId: viewer.userId }, select: { id: true, title: true } });
    return ok(thread);
  });
}

/** Delete one of the viewer's Chief of Staff conversations (messages cascade). */
export async function deleteThread(threadId: string): Promise<ActionResult> {
  return attemptAs("chief.use", async () => {
    id.parse(threadId);
    const viewer = await requireViewer();
    const thread = await db.chatThread.findUnique({ where: { id: threadId }, select: { userId: true } });
    if (!thread || thread.userId !== viewer.userId) return fail("Conversation not found");
    await db.chatThread.delete({ where: { id: threadId } });
    revalidateAll();
    return ok(undefined, "Conversation deleted");
  });
}
