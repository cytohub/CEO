"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useUI } from "@/components/shell/ui-context";
import { cn } from "@/lib/utils";

type EntityKind = "task" | "milestone" | "meeting";

/**
 * Link that opens a global entity sheet (`?task=` / `?milestone=` / `?meeting=`)
 * while preserving the page's own params (e.g. `?week=`).
 */
export function EntityLink({ kind, id, className, children, title }: { kind: EntityKind; id: string; className?: string; children: React.ReactNode; title?: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params = new URLSearchParams(searchParams.toString());
  params.set(kind, id);
  return (
    <Link href={`${pathname}?${params.toString()}`} scroll={false} className={className} title={title}>
      {children}
    </Link>
  );
}

/** Compact action that opens a task sheet via openEntity. */
export function OpenTaskButton({ taskId, label = "Open", className }: { taskId: string; label?: string; className?: string }) {
  const { openEntity } = useUI();
  return (
    <Button variant="ghost" size="xs" className={cn("text-muted-foreground", className)} onClick={() => openEntity("task", taskId)} aria-label={`${label} task`}>
      {label}
      <ArrowUpRight aria-hidden />
    </Button>
  );
}
