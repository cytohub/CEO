"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { disconnectAccount } from "@/server/actions/integrations";

const OPTIONS = [
  {
    value: "keep",
    label: "Keep ingested history",
    description: "Stop syncing and forget the credentials. Messages, events, documents and everything the Brain derived from them stay.",
  },
  {
    value: "delete",
    label: "Delete ingested items",
    description: "Also remove the items ingested from this account. Provenance snapshots and records you confirmed are kept, per the retention policy.",
  },
] as const;

export function DisconnectDialog({
  open,
  onOpenChange,
  connectionId,
  title,
  provider,
  items,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  title: string;
  provider: string;
  items: number;
}) {
  const [choice, setChoice] = useState<"keep" | "delete">("keep");
  const { pending, run } = useAction();
  const name = `disconnect-${connectionId}`;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setChoice("keep");
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Disconnect {provider}?</DialogTitle>
          <DialogDescription className="break-words">
            {title} · {formatNumber(items)} item{items === 1 ? "" : "s"} ingested. Syncing stops immediately and push notifications are cancelled.
          </DialogDescription>
        </DialogHeader>
        <fieldset className="grid gap-2">
          <legend className="sr-only">What happens to ingested data</legend>
          {OPTIONS.map((o) => (
            <label
              key={o.value}
              className={cn(
                "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                choice === o.value ? (o.value === "delete" ? "border-destructive/50 bg-critical-soft" : "border-ring/50 bg-brand-soft") : "border-border hover:bg-muted/50",
              )}
            >
              <input type="radio" name={name} value={o.value} checked={choice === o.value} onChange={() => setChoice(o.value)} className="mt-0.5 accent-[var(--brand)]" />
              <span className="min-w-0">
                <span className="block text-[15px] font-medium text-foreground">
                  {o.label}
                  {o.value === "keep" && <span className="ml-1.5 text-2xs font-normal text-muted-foreground">Recommended</span>}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{o.description}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={async () => {
              const res = await run(() => disconnectAccount(connectionId, { deleteData: choice === "delete" }));
              if (res.ok) onOpenChange(false);
            }}
          >
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            {choice === "delete" ? "Disconnect and delete" : "Disconnect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
