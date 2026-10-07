"use client";

import { History, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ChatComposer, ChatTranscript, useChiefChat, type ChatMessage } from "@/components/chief/chat";
import { cn } from "@/lib/utils";
import { createThread } from "@/server/actions/chief";
import { CapabilitiesDisclosure } from "./capabilities";
import { PromptGrid } from "./prompt-grid";
import { ThreadList, type ThreadSummary } from "./thread-list";

export interface ActiveThread {
  id: string;
  title: string;
  messages: ChatMessage[];
}

interface Mounted {
  /** React key for the chat pane — changing it remounts with `initial`. */
  key: string;
  /** Thread the mounted chat writes to (null for a fresh, unsaved conversation). */
  threadId: string | null;
  initial: ActiveThread | null;
  /** First question of a just-created thread, sent once the pane mounts. */
  autoAsk?: string;
}

/**
 * Full-page Chief of Staff: conversation history rail + transcript/composer.
 *
 * `?thread=` selects a conversation. A new conversation is created (server
 * action) when its first question is asked; the pane then remounts on that
 * thread and sends the question. Once the answer lands, the URL follows
 * without remounting the live chat.
 */
export function ChiefWorkspace({
  threads,
  active,
  engine,
  model,
  now,
}: {
  threads: ThreadSummary[];
  active: ActiveThread | null;
  engine: "claude" | "brain-rules";
  model: string;
  now: Date;
}) {
  const router = useRouter();
  const serverId = active?.id ?? null;
  const [mounted, setMounted] = useState<Mounted>({ key: serverId ?? "new", threadId: serverId, initial: active });
  const [prevServerId, setPrevServerId] = useState(serverId);
  const [historyOpen, setHistoryOpen] = useState(false);

  // URL-selected thread changed (history click, back/forward): remount unless it's already the live chat.
  if (serverId !== prevServerId) {
    setPrevServerId(serverId);
    if (serverId !== mounted.threadId) setMounted({ key: serverId ?? `new-${mounted.key}`, threadId: serverId, initial: active });
  }

  const startNew = useCallback(() => {
    setMounted((m) => ({ key: `new-${m.key}`, threadId: null, initial: null }));
    if (serverId) router.push("/chief-of-staff", { scroll: false });
  }, [router, serverId]);

  const startThread = useCallback(
    async (question: string) => {
      const res = await createThread(question);
      if (!res.ok) {
        toast.error(res.error);
        return false;
      }
      const { id, title } = res.data;
      setMounted({ key: id, threadId: id, initial: { id, title, messages: [] }, autoAsk: question });
      return true;
    },
    [],
  );

  // When an answer completes: point the URL at a newly started thread (which also
  // reloads history), otherwise just refresh history ordering and counts.
  const onSettled = useCallback(() => {
    if (mounted.threadId && mounted.threadId !== serverId) router.replace(`/chief-of-staff?thread=${mounted.threadId}`, { scroll: false });
    else router.refresh();
  }, [router, mounted.threadId, serverId]);

  const onDeleted = useCallback(
    (id: string) => {
      if (id === mounted.threadId) startNew();
    },
    [mounted.threadId, startNew],
  );

  // Threads with no messages yet (e.g. a question that never reached the API) stay out of history;
  // a conversation started here shows up immediately, before the server list catches up.
  const visibleThreads = threads.filter((t) => t.messageCount > 0 || t.id === mounted.threadId);
  if (mounted.threadId && mounted.initial && !threads.some((t) => t.id === mounted.threadId)) {
    visibleThreads.unshift({ id: mounted.threadId, title: mounted.initial.title, updatedAt: now, messageCount: 1 });
  }
  const activeTitle = mounted.threadId ? (threads.find((t) => t.id === mounted.threadId)?.title ?? mounted.initial?.title ?? "Conversation") : null;

  return (
    <div className="mx-auto flex h-[calc(100dvh-5.5rem)] max-w-[1440px] flex-col gap-3">
      <header className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Chief of Staff</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-muted-foreground">
            <span className="inline-flex h-5 items-center gap-1.5 rounded-full border border-border bg-surface px-2 text-2xs font-medium text-ink-2">
              <span className={cn("size-1.5 rounded-full", engine === "claude" ? "bg-brain" : "bg-good")} aria-hidden />
              {engine === "claude" ? `Claude · ${model}` : "CytoHub Brain rules engine"}
            </span>
            <span className="hidden min-w-0 sm:inline">
              {engine === "claude" ? (
                "Claude reasons over live CytoHub Brain data through read-only tools; every answer cites its sources."
              ) : (
                <>
                  Deterministic answers composed from live CytoHub Brain queries.{" "}
                  <Link href="/settings#ai" className="text-brand underline-offset-2 hover:underline">
                    Add Claude
                  </Link>{" "}
                  for open-ended reasoning.
                </>
              )}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" className="lg:hidden" onClick={() => setHistoryOpen(true)}>
            <History /> History
          </Button>
          <CapabilitiesDisclosure />
          <Button size="sm" variant="outline" onClick={startNew}>
            <Plus /> <span className="hidden sm:inline">New conversation</span>
            <span className="sr-only sm:hidden">New conversation</span>
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[264px_minmax(0,1fr)]">
        <aside aria-label="Conversation history" className="panel hidden min-h-0 flex-col lg:flex">
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-hairline px-3.5">
            <History className="size-3.5 text-ink-3" aria-hidden />
            <h2 className="text-[13.5px] font-semibold tracking-tight">Conversations</h2>
            <span className="rounded bg-muted px-1.5 text-2xs font-medium text-muted-foreground tabular">{visibleThreads.length}</span>
          </div>
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
            <ThreadList threads={visibleThreads} activeId={mounted.threadId} now={now} onDeleted={onDeleted} />
          </div>
        </aside>

        <section aria-label="Conversation" className="panel flex min-h-0 min-w-0 flex-col overflow-hidden">
          <ChatPane key={mounted.key} initial={mounted.initial} autoAsk={mounted.autoAsk} title={activeTitle} onStart={startThread} onSettled={onSettled} />
        </section>
      </div>

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="left" className="flex w-[300px] flex-col gap-0 p-0 sm:max-w-[300px]">
          <SheetHeader className="border-b border-border px-4 py-3">
            <SheetTitle className="text-sm">Conversations</SheetTitle>
            <SheetDescription className="text-2xs">{visibleThreads.length} saved</SheetDescription>
          </SheetHeader>
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
            <ThreadList threads={visibleThreads} activeId={mounted.threadId} now={now} onNavigate={() => setHistoryOpen(false)} onDeleted={onDeleted} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ChatPane({
  initial,
  autoAsk,
  title,
  onStart,
  onSettled,
}: {
  initial: ActiveThread | null;
  autoAsk?: string;
  title: string | null;
  onStart: (question: string) => Promise<boolean>;
  onSettled: () => void;
}) {
  const { messages, busy, ask } = useChiefChat(initial ? { threadId: initial.id, messages: initial.messages } : undefined);
  const [starting, setStarting] = useState<string | null>(null);

  // A brand-new conversation is saved first, then this pane remounts on it.
  const send = useCallback(
    async (q: string) => {
      const question = q.trim();
      if (!question || busy || starting) return;
      if (initial) return ask(question);
      setStarting(question);
      const okStarted = await onStart(question);
      if (!okStarted) setStarting(null);
    },
    [ask, busy, initial, onStart, starting],
  );

  // Send the first question of a just-created thread exactly once.
  const autoAsked = useRef(false);
  useEffect(() => {
    if (autoAsk && !autoAsked.current) {
      autoAsked.current = true;
      ask(autoAsk);
    }
  }, [autoAsk, ask]);

  // Refresh history (ordering, counts) when an answer completes.
  const settledRef = useRef(onSettled);
  useEffect(() => {
    settledRef.current = onSettled;
  });
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy) settledRef.current();
    wasBusy.current = busy;
  }, [busy]);

  const shown: ChatMessage[] = starting
    ? [
        { id: "starting-q", role: "user", content: starting },
        { id: "starting-a", role: "assistant", content: "", pending: true, status: "Starting conversation" },
      ]
    : messages;
  const empty = shown.length === 0;
  const questions = shown.filter((m) => m.role === "user").length;

  return (
    <>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-hairline px-4">
        <Sparkles className="size-3.5 text-brain" aria-hidden />
        <h2 className="min-w-0 truncate text-[13.5px] font-semibold tracking-tight">{title ?? starting ?? "New conversation"}</h2>
        {!empty && (
          <span className="ml-auto shrink-0 text-2xs text-muted-foreground tabular">
            {questions} question{questions === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
          {empty ? (
            <div className="space-y-6">
              <div className="flex flex-col items-center gap-2 pt-2 text-center sm:pt-6">
                <div className="flex size-10 items-center justify-center rounded-full bg-brain-soft">
                  <Sparkles className="size-5 text-brain" aria-hidden />
                </div>
                <h3 className="text-base font-semibold tracking-tight text-foreground">What do you want to know?</h3>
                <p className="max-w-md text-xs text-muted-foreground">
                  Ask anything about CytoHub. Answers draw on your priorities, goals, decisions, pipeline, calendar and the latest Brain intelligence.
                </p>
              </div>
              <PromptGrid onPick={send} disabled={busy || Boolean(starting)} />
            </div>
          ) : (
            <ChatTranscript messages={shown} />
          )}
        </div>
      </div>
      <div className="shrink-0 border-t border-hairline px-4 py-3 sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          <ChatComposer onSend={send} busy={busy || Boolean(starting)} autoFocus />
          <p className="mt-1.5 hidden text-2xs text-muted-foreground sm:block">Enter to send · Shift + Enter for a new line · Conversations are saved to your history</p>
        </div>
      </div>
    </>
  );
}
