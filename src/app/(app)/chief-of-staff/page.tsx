import type { Metadata } from "next";
import type { ChatMessage } from "@/components/chief/chat";
import { ChiefWorkspace, type ActiveThread } from "@/components/chief/page/chief-workspace";
import { db } from "@/lib/db";
import { CLAUDE_MODEL, claudeEnabled } from "@/server/ai/claude";
import type { Citation } from "@/server/chief/tools";
import { getCeoContext } from "@/server/context";
import { requirePage } from "@/server/security/session";

export const metadata: Metadata = { title: "Chief of Staff" };

function toCitations(value: unknown): Citation[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.filter(
    (c): c is Citation =>
      typeof c === "object" && c !== null && typeof (c as Citation).id === "string" && typeof (c as Citation).href === "string" && typeof (c as Citation).label === "string",
  );
  return list.length ? list : undefined;
}

export default async function ChiefOfStaffPage(props: { searchParams: Promise<{ thread?: string | string[] }> }) {
  const viewer = await requirePage("chief.use", "/chief-of-staff");
  const sp = await props.searchParams;
  const threadParam = Array.isArray(sp.thread) ? sp.thread[0] : sp.thread;
  const ceo = await getCeoContext();

  const [threads, thread] = await Promise.all([
    db.chatThread.findMany({
      where: { userId: viewer.userId },
      orderBy: { updatedAt: "desc" },
      take: 60,
      select: { id: true, title: true, updatedAt: true, _count: { select: { messages: true } } },
    }),
    threadParam
      ? db.chatThread.findFirst({
          where: { id: threadParam, userId: viewer.userId },
          select: { id: true, title: true, messages: { orderBy: { createdAt: "asc" }, select: { id: true, role: true, content: true, citations: true, engine: true } } },
        })
      : null,
  ]);

  const active: ActiveThread | null = thread
    ? {
        id: thread.id,
        title: thread.title,
        messages: thread.messages.map<ChatMessage>((m) => ({
          id: m.id,
          role: m.role === "USER" ? "user" : "assistant",
          content: m.content,
          citations: toCitations(m.citations),
          engine: m.engine ?? undefined,
        })),
      }
    : null;

  return (
    <ChiefWorkspace
      threads={threads.map((t) => ({ id: t.id, title: t.title, updatedAt: t.updatedAt, messageCount: t._count.messages }))}
      active={active}
      engine={claudeEnabled() ? "claude" : "brain-rules"}
      model={CLAUDE_MODEL}
      now={ceo.now}
    />
  );
}
