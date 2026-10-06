"use client";

import { Button } from "@/components/ui/button";
import { useUI, type CreateDefaults, type CreateKind } from "@/components/shell/ui-context";

/** Server-component-friendly trigger for the global create dialogs. */
export function CreateButton({
  kind,
  label,
  icon,
  defaults,
  variant = "default",
  size = "sm",
}: {
  kind: CreateKind;
  label: string;
  icon?: React.ReactNode;
  defaults?: CreateDefaults;
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "sm" | "default" | "xs";
}) {
  const { openCreate } = useUI();
  return (
    <Button variant={variant} size={size} onClick={() => openCreate(kind, defaults)}>
      {icon}
      {label}
    </Button>
  );
}
