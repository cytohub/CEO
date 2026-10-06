"use client";

import { Building2, CheckSquare, Gavel, Milestone, Target, User, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useUI } from "@/components/shell/ui-context";
import { cn } from "@/lib/utils";

export type ChipKind = "goal" | "milestone" | "task" | "decision" | "person" | "company";

export const CHIP_META: Record<ChipKind, { label: string; plural: string; icon: LucideIcon }> = {
  goal: { label: "Goal", plural: "Goals", icon: Target },
  milestone: { label: "Milestone", plural: "Milestones", icon: Milestone },
  task: { label: "Task", plural: "Tasks", icon: CheckSquare },
  decision: { label: "Decision", plural: "Decisions", icon: Gavel },
  person: { label: "Person", plural: "People", icon: User },
  company: { label: "Company", plural: "Companies", icon: Building2 },
};

const CHIP =
  "inline-flex h-5 max-w-[240px] min-w-0 items-center gap-1 rounded border border-border bg-surface px-1.5 text-2xs text-ink-2 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";

/** A linked entity: navigates (goal, decision, person, company) or opens the global sheet (task, milestone). */
export function EntityChip({ kind, id, label, className, muted }: { kind: ChipKind; id: string; label: string; className?: string; muted?: boolean }) {
  const { openEntity } = useUI();
  const meta = CHIP_META[kind];
  const Icon = meta.icon;
  const content = (
    <>
      <Icon className="size-3 shrink-0 text-ink-3" aria-hidden />
      <span className={cn("truncate", muted && "text-muted-foreground line-through")}>{label}</span>
    </>
  );
  const aria = `${meta.label}: ${label}`;
  if (kind === "task" || kind === "milestone") {
    return (
      <button type="button" onClick={() => openEntity(kind, id)} className={cn(CHIP, className)} aria-label={`Open ${aria.toLowerCase()}`} title={aria}>
        {content}
      </button>
    );
  }
  const href = kind === "goal" ? `/goals/${id}` : kind === "decision" ? `/decisions/${id}` : kind === "person" ? `/resources/people/${id}` : `/resources/companies/${id}`;
  return (
    <Link href={href} className={cn(CHIP, className)} aria-label={aria} title={aria}>
      {content}
    </Link>
  );
}

/** Open a task, milestone or meeting sheet from server-rendered lists. */
export function OpenEntityButton({
  kind,
  id,
  children,
  className,
  label,
}: {
  kind: "task" | "milestone" | "meeting";
  id: string;
  children: React.ReactNode;
  className?: string;
  label?: string;
}) {
  const { openEntity } = useUI();
  return (
    <button type="button" onClick={() => openEntity(kind, id)} className={cn("min-w-0 text-left", className)} aria-label={label}>
      {children}
    </button>
  );
}
