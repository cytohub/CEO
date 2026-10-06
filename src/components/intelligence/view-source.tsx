"use client";

import { FileSearch, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUI } from "@/components/shell/ui-context";
import type { EntityType } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

/**
 * Opens the provenance sheet (`?provenance=TYPE:id`) for any record. Shows the
 * number of readable sources when the caller knows it.
 */
export function ViewSourceButton({
  targetType,
  targetId,
  count,
  hidden = 0,
  label = "Source",
  variant = "ghost",
  className,
}: {
  targetType: EntityType;
  targetId: string;
  count?: number;
  hidden?: number;
  label?: string;
  variant?: "ghost" | "outline";
  className?: string;
}) {
  const { openEntity } = useUI();
  const onlyHidden = count === 0 && hidden > 0;
  return (
    <Button
      type="button"
      variant={variant}
      size="xs"
      className={cn("text-muted-foreground", className)}
      onClick={(e) => {
        e.stopPropagation();
        openEntity("provenance", `${targetType}:${targetId}`);
      }}
      aria-label={`View source${count ? ` (${count})` : ""}${onlyHidden ? " — hidden by your access level" : ""}`}
      title={onlyHidden ? "Sources hidden by your access level" : "Where this came from"}
    >
      {onlyHidden ? <Lock aria-hidden /> : <FileSearch aria-hidden />}
      {label}
      {count !== undefined && count > 1 && <span className="tabular text-ink-3">{count}</span>}
    </Button>
  );
}
