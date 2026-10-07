"use client";

import { ArrowUp, Loader2, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Citation } from "@/server/chief/tools";

export const SUGGESTED_PROMPTS = [
  "What should I focus on today?",
  "What am I forgetting?",
  "What is most likely to become a problem?",
  "What should I delegate?",
  "Which investor needs follow-up?",
  "What customers require attention?",
  "What goals are slipping?",
  "What changed this week?",
  "Prepare me for my next important meeting.",
  "What are my highest leverage actions?",
  "What should I stop doing?",
  "What decisions am I avoiding?",
  "Show me everything related to Brightwater",
];

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  engine?: string;
  status?: string;
  pending?: boolean;
  error?: boolean;
}

export function useChiefChat(initial?: { threadId?: string | null; messages?: ChatMessage[] }) {
  const [threadId, setThreadId] = useState<string | null>(initial?.threadId ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>(initial?.messages ?? []);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abort.current?.abort();
    setThreadId(null);
    setMessages([]);
    setBusy(false);
  }, []);

  const ask = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || busy) return;
      setBusy(true);
      const assistantId = `a-${Date.now()}`;
      setMessages((m) => [...m, { id: `u-${Date.now()}`, role: "user", content: q }, { id: assistantId, role: "assistant", content: "", pending: true, status: "Thinking" }]);
      const update = (patch: Partial<ChatMessage> | ((m: ChatMessage) => Partial<ChatMessage>)) =>
        setMessages((all) => all.map((m) => (m.id === assistantId ? { ...m, ...(typeof patch === "function" ? patch(m) : patch) } : m)));

      const controller = new AbortController();
      abort.current = controller;
      try {
        const res = await fetch("/api/chief-of-staff", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: q, threadId }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`Request failed (${res.status})`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const ev = JSON.parse(line) as { type: string; [k: string]: unknown };
            if (ev.type === "meta") {
              setThreadId(ev.threadId as string);
              update({ engine: ev.engine as string });
            } else if (ev.type === "status") update({ status: ev.text as string });
            else if (ev.type === "delta") update((m) => ({ content: m.content + (ev.text as string), status: undefined }));
            else if (ev.type === "done") update({ pending: false, status: undefined, citations: ev.citations as Citation[], engine: ev.engine as string });
            else if (ev.type === "error") update({ pending: false, error: true, status: undefined, content: ev.message as string });
          }
        }
        update({ pending: false, status: undefined });
      } catch (e) {
        if ((e as Error).name !== "AbortError") update({ pending: false, error: true, status: undefined, content: "I couldn’t reach CytoHub Brain. Check your connection and try again." });
      } finally {
        setBusy(false);
        abort.current = null;
      }
    },
    [busy, threadId],
  );

  return { threadId, messages, busy, ask, reset };
}

export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <h3 className="mt-4 mb-1.5 text-[14px] font-semibold first:mt-0">{children}</h3>,
        h2: ({ children }) => <h3 className="mt-4 mb-1.5 text-[14px] font-semibold first:mt-0">{children}</h3>,
        h3: ({ children }) => <h3 className="mt-4 mb-1.5 text-[14px] font-semibold first:mt-0">{children}</h3>,
        p: ({ children }) => <p className="my-1.5 leading-relaxed">{children}</p>,
        ul: ({ children }) => <ul className="my-1.5 space-y-1 pl-4 [&>li]:list-disc [&>li]:marker:text-ink-3">{children}</ul>,
        ol: ({ children }) => <ol className="my-1.5 space-y-1 pl-5 [&>li]:list-decimal [&>li]:marker:text-ink-3">{children}</ol>,
        li: ({ children }) => <li className="pl-0.5 leading-relaxed">{children}</li>,
        strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
        em: ({ children }) => <em className="text-muted-foreground">{children}</em>,
        a: ({ href, children }) => (
          <Link href={href ?? "#"} className="text-brand underline-offset-2 hover:underline">
            {children}
          </Link>
        ),
        code: ({ children }) => <code className="rounded bg-muted px-1 font-mono text-xs">{children}</code>,
        table: ({ children }) => <table className="my-2 w-full text-xs">{children}</table>,
        th: ({ children }) => <th className="border-b border-border py-1 text-left font-medium">{children}</th>,
        td: ({ children }) => <td className="border-b border-hairline py-1 pr-2 align-top">{children}</td>,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

export function ChatTranscript({ messages, className }: { messages: ChatMessage[]; className?: string }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages]);
  return (
    <div className={cn("space-y-5", className)} aria-live="polite">
      {messages.map((m) =>
        m.role === "user" ? (
          <div key={m.id} className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl rounded-br-md bg-foreground px-3.5 py-2 text-[14px] text-background">{m.content}</div>
          </div>
        ) : (
          <div key={m.id} className="flex gap-3">
            <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-brain-soft">
              <Sparkles className="size-3.5 text-brain" aria-hidden />
            </div>
            <div className="min-w-0 flex-1 text-[14px] text-ink-2">
              {m.content ? <Markdown>{m.content}</Markdown> : null}
              {m.status && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" aria-hidden /> {m.status}…
                </p>
              )}
              {m.error && <p className="text-xs text-critical-ink">Something went wrong.</p>}
              {!m.pending && m.citations && m.citations.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {m.citations.map((c) => (
                    <Link
                      key={`${c.type}-${c.id}`}
                      href={c.href}
                      className="inline-flex max-w-[220px] items-center gap-1 rounded-md border border-border bg-surface px-1.5 py-0.5 text-2xs text-ink-2 hover:bg-muted"
                    >
                      <span className="text-muted-foreground capitalize">{c.type}</span>
                      <span className="truncate">{c.label}</span>
                    </Link>
                  ))}
                </div>
              )}
              {!m.pending && m.engine && (
                <p className="mt-2 text-2xs text-muted-foreground">{m.engine === "claude" ? "Answered by Claude using CytoHub Brain tools" : "Answered by CytoHub Brain rules engine"}</p>
              )}
            </div>
          </div>
        ),
      )}
      <div ref={end} />
    </div>
  );
}

export function ChatComposer({ onSend, busy, autoFocus, placeholder = "Ask your Chief of Staff…" }: { onSend: (q: string) => void; busy: boolean; autoFocus?: boolean; placeholder?: string }) {
  const [value, setValue] = useState("");
  return (
    <form
      className="flex items-end gap-2 rounded-xl border border-border bg-surface p-2 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20"
      onSubmit={(e) => {
        e.preventDefault();
        if (!value.trim()) return;
        onSend(value);
        setValue("");
      }}
    >
      <textarea
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (value.trim() && !busy) {
              onSend(value);
              setValue("");
            }
          }
        }}
        rows={1}
        placeholder={placeholder}
        aria-label="Message the Chief of Staff"
        className="field-sizing-content max-h-40 min-h-8 flex-1 resize-none bg-transparent px-1.5 py-1 text-[14px] outline-none placeholder:text-muted-foreground"
      />
      <Button type="submit" size="icon-sm" disabled={busy || !value.trim()} aria-label="Send">
        {busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
      </Button>
    </form>
  );
}

export function SuggestedPrompts({ onPick, className, limit }: { onPick: (q: string) => void; className?: string; limit?: number }) {
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {SUGGESTED_PROMPTS.slice(0, limit).map((p) => (
        <button key={p} type="button" onClick={() => onPick(p)} className="rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-ink-2 transition-colors hover:border-input hover:bg-muted hover:text-foreground">
          {p}
        </button>
      ))}
    </div>
  );
}

export function NewThreadButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick}>
      <Plus /> New conversation
    </Button>
  );
}
