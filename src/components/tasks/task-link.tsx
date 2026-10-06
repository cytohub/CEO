"use client";

import { useUI } from "@/components/shell/ui-context";
import { cn } from "@/lib/utils";

/** Opens the global task sheet without leaving the page. */
export function TaskLink({ id, title, className }: { id: string; title: string; className?: string }) {
  const { openEntity } = useUI();
  return (
    <button type="button" onClick={() => openEntity("task", id)} className={cn("max-w-full text-left text-foreground hover:underline", className)}>
      {title}
    </button>
  );
}

export function MilestoneLink({ id, title, className }: { id: string; title: string; className?: string }) {
  const { openEntity } = useUI();
  return (
    <button type="button" onClick={() => openEntity("milestone", id)} className={cn("max-w-full text-left text-foreground hover:underline", className)}>
      {title}
    </button>
  );
}

export function MeetingLink({ id, title, className }: { id: string; title: string; className?: string }) {
  const { openEntity } = useUI();
  return (
    <button type="button" onClick={() => openEntity("meeting", id)} className={cn("max-w-full text-left text-foreground hover:underline", className)}>
      {title}
    </button>
  );
}
