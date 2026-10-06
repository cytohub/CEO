"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { getCeoContext } from "@/server/context";
import { revalidateAll } from "@/server/mutations";
import { attempt, fail, id, ok, type ActionResult } from "./result";

/**
 * Open a new Chief of Staff conversation before its first question is sent,
 * so the chat always posts an existing thread id to /api/chief-of-staff.
 * Titled like the API titles threads (first 80 characters of the question).
 */
export async function createThread(firstMessage: string): Promise<ActionResult<{ id: string; title: string }>> {
  return attempt(async () => {
    const message = z.string().trim().min(1, "Ask a question first").max(4000).parse(firstMessage);
    const ceo = await getCeoContext();
    const thread = await db.chatThread.create({ data: { title: message.slice(0, 80), userId: ceo.userId }, select: { id: true, title: true } });
    return ok(thread);
  });
}

/** Delete one of the CEO's Chief of Staff conversations (messages cascade). */
export async function deleteThread(threadId: string): Promise<ActionResult> {
  return attempt(async () => {
    id.parse(threadId);
    const ceo = await getCeoContext();
    const thread = await db.chatThread.findUnique({ where: { id: threadId }, select: { userId: true } });
    if (!thread || thread.userId !== ceo.userId) return fail("Conversation not found");
    await db.chatThread.delete({ where: { id: threadId } });
    revalidateAll();
    return ok(undefined, "Conversation deleted");
  });
}
