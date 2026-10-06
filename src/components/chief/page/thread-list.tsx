"use client";

import { MessageSquare, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAction } from "@/components/common/use-action";
import { timeAgo } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { deleteThread } from "@/server/actions/chief";

export interface ThreadSummary {
  id: string;
  title: string;
  updatedAt: Date;
  messageCount: number;
}

export function ThreadList({
  threads,
  activeId,
  now,
  onNavigate,
  onDeleted,
}: {
  threads: ThreadSummary[];
  activeId: string | null;
  now: Date;
  onNavigate?: () => void;
  onDeleted: (id: string) => void;
}) {
  const [confirm, setConfirm] = useState<ThreadSummary | null>(null);
  const { pending, run } = useAction();

  if (threads.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1.5 px-4 py-10 text-center">
        <MessageSquare className="size-4 text-ink-3" aria-hidden />
        <p className="text-xs font-medium text-foreground">No conversations yet</p>
        <p className="text-2xs text-muted-foreground">Your questions and answers are saved here.</p>
      </div>
    );
  }

  return (
    <>
      <ul className="space-y-0.5 p-1.5">
        {threads.map((t) => {
          const active = t.id === activeId;
          return (
            <li key={t.id} className="group relative">
              <Link
                href={`/chief-of-staff?thread=${t.id}`}
                scroll={false}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "block rounded-md py-1.5 pr-8 pl-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "bg-muted text-foreground" : "text-ink-2 hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <span className={cn("block truncate text-[13px]", active && "font-medium")}>{t.title}</span>
                <span className="block text-2xs text-muted-foreground tabular">
                  {timeAgo(t.updatedAt, now)} · {t.messageCount} message{t.messageCount === 1 ? "" : "s"}
                </span>
              </Link>
              <button
                type="button"
                onClick={() => setConfirm(t)}
                aria-label={`Delete conversation “${t.title}”`}
                className="absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 items-center justify-center rounded text-ink-3 opacity-0 transition-opacity outline-none group-hover:opacity-100 hover:bg-background hover:text-critical-ink focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring max-lg:opacity-100"
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
            <AlertDialogDescription>“{confirm?.title}” and its answers will be removed permanently.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={() => {
                const target = confirm;
                if (!target) return;
                run(() => deleteThread(target.id), { onSuccess: () => onDeleted(target.id) });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
