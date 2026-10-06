"use client";

import { Check, Copy, KeyRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Shows a generated password exactly once. Nothing stores it: closing the
 * dialog drops it from memory, and the server only keeps the scrypt hash.
 */
export function OneTimePasswordDialog({ value, who, onClose }: { value: { password: string; email: string } | null; who: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog
      open={Boolean(value)}
      onOpenChange={(o) => {
        if (!o) {
          setCopied(false);
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4 text-ink-3" aria-hidden /> One-time password
          </DialogTitle>
          <DialogDescription>
            Share it with {who} over a secure channel. It is shown only once — CytoHub stores just a hash and can’t display it again.
          </DialogDescription>
        </DialogHeader>
        {value && (
          <div className="grid gap-2">
            <div className="text-2xs text-muted-foreground">
              Sign-in email <span className="font-medium text-foreground">{value.email}</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
              <code data-testid="one-time-password" className="min-w-0 flex-1 font-mono text-[13px] break-all text-foreground select-all">
                {value.password}
              </code>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(value.password);
                    setCopied(true);
                    toast.success("Password copied");
                  } catch {
                    toast.error("Couldn’t copy — select the password and copy it manually");
                  }
                }}
              >
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
