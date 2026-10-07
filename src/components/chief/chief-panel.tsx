"use client";

import { Maximize2, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useUI } from "@/components/shell/ui-context";
import { ChatComposer, ChatTranscript, NewThreadButton, SuggestedPrompts, useChiefChat } from "./chat";

/** Global slide-over Chief of Staff (⌘J). */
export function ChiefOfStaffPanel() {
  const { chief, closeChief } = useUI();
  const { threadId, messages, busy, ask, reset } = useChiefChat();
  const handled = useRef(0);

  // A prompt handed over from the command bar is sent once.
  useEffect(() => {
    if (chief.open && chief.prompt && handled.current !== chief.nonce) {
      handled.current = chief.nonce;
      ask(chief.prompt);
    }
  }, [chief, ask]);

  return (
    <Sheet open={chief.open} onOpenChange={(o) => !o && closeChief()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-[520px]">
        <SheetHeader className="flex-row items-center gap-2 border-b border-border px-4 py-3 pr-12">
          <div className="flex size-7 items-center justify-center rounded-full bg-brain-soft">
            <Sparkles className="size-4 text-brain" aria-hidden />
          </div>
          <div className="min-w-0">
            <SheetTitle className="text-sm">Chief of Staff</SheetTitle>
            <SheetDescription className="text-2xs">Grounded in CytoHub Brain</SheetDescription>
          </div>
          <div className="ml-auto flex items-center gap-1">
            {messages.length > 0 && <NewThreadButton onClick={reset} />}
            <Button variant="ghost" size="icon-sm" asChild>
              <Link href={threadId ? `/chief-of-staff?thread=${threadId}` : "/chief-of-staff"} onClick={closeChief} aria-label="Open full page">
                <Maximize2 />
              </Link>
            </Button>
          </div>
        </SheetHeader>
        <div className="scrollbar-thin flex-1 overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <div className="space-y-4">
              <p className="text-[14px] text-muted-foreground">Ask anything about the company. Answers draw on priorities, goals, decisions, pipeline, calendar and recent intelligence.</p>
              <SuggestedPrompts onPick={ask} />
            </div>
          ) : (
            <ChatTranscript messages={messages} />
          )}
        </div>
        <div className="border-t border-border p-3">
          <ChatComposer onSend={ask} busy={busy} autoFocus />
        </div>
      </SheetContent>
    </Sheet>
  );
}
