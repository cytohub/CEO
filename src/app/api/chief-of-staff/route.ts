import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { claudeEnabled } from "@/server/ai/claude";
import { isAnthropicError, streamClaudeAnswer } from "@/server/chief/claude-engine";
import { answerWithRules } from "@/server/chief/rules";
import type { Citation } from "@/server/chief/tools";
import { loadCeoContext } from "@/server/context";
import { audit } from "@/server/security/audit";
import { LIMITS, rateLimit } from "@/server/security/rate-limit";
import { forbiddenResponse, isSameOrigin } from "@/server/security/request";
import { can, getViewer } from "@/server/security/session";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const bodySchema = z.object({
  message: z.string().trim().min(1).max(4000),
  threadId: z.string().nullish(),
});

/**
 * POST /api/chief-of-staff — streams newline-delimited JSON events:
 *   {type:"meta", threadId, engine} · {type:"status", text} · {type:"delta", text}
 *   {type:"done", citations} · {type:"error", message}
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return forbiddenResponse("Cross-site request blocked");
  const viewer = await getViewer();
  if (!viewer) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(viewer, "chief.use")) {
    await audit({ action: "auth.denied", viewer, outcome: "DENIED", metadata: { capability: "chief.use", route: "/api/chief-of-staff" } });
    return forbiddenResponse();
  }
  const limit = await rateLimit("chief", viewer.userId, LIMITS.chief);
  if (!limit.ok) return Response.json({ error: "Too many questions — try again shortly." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } });

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const ceo = await loadCeoContext();
  // Threads are private to the signed-in user.
  const thread = body.threadId
    ? await db.chatThread.findFirst({ where: { id: body.threadId, userId: viewer.userId }, include: { messages: { orderBy: { createdAt: "asc" }, take: 40 } } })
    : null;
  const activeThread = thread ?? (await db.chatThread.create({ data: { title: body.message.slice(0, 80), userId: viewer.userId }, include: { messages: true } }));
  await db.chatMessage.create({ data: { threadId: activeThread.id, role: "USER", content: body.message } });

  const engine = claudeEnabled() ? "claude" : "brain-rules";
  const encoder = new TextEncoder();
  const history = activeThread.messages.slice(-12).map((m) => ({ role: m.role === "USER" ? ("user" as const) : ("assistant" as const), content: m.content }));

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      send({ type: "meta", threadId: activeThread.id, engine });
      let answer = "";
      const citations: Citation[] = [];
      let usedEngine = engine;
      try {
        if (engine === "claude") {
          try {
            for await (const ev of streamClaudeAnswer(ceo, history, body.message, citations, viewer)) {
              if (ev.type === "delta") answer += ev.text;
              send(ev);
            }
          } catch (error) {
            // Degrade gracefully to the rules engine if the API is unavailable.
            console.error("[chief] Claude failed, falling back to rules", isAnthropicError(error) ? `${error.status} ${error.message}` : error);
            if (answer) throw error;
            usedEngine = "brain-rules";
            send({ type: "status", text: "Claude unavailable — answering from CytoHub Brain rules" });
          }
        }
        if (usedEngine === "brain-rules") {
          send({ type: "status", text: "Querying CytoHub Brain" });
          const res = await answerWithRules(ceo, body.message, viewer);
          answer = res.markdown;
          citations.push(...res.citations);
          send({ type: "delta", text: answer });
        }
        const unique = [...new Map(citations.map((c) => [`${c.type}:${c.id}`, c])).values()].slice(0, 12);
        await db.chatMessage.create({ data: { threadId: activeThread.id, role: "ASSISTANT", content: answer, citations: unique as unknown as Prisma.InputJsonValue, engine: usedEngine } });
        await db.chatThread.update({ where: { id: activeThread.id }, data: { updatedAt: new Date() } });
        send({ type: "done", citations: unique, engine: usedEngine });
      } catch (error) {
        console.error("[chief] failed", error);
        send({ type: "error", message: "The Chief of Staff couldn’t complete that answer. Try again." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
