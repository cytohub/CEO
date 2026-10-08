"use client";

import { AlertCircle, Check, Copy, ExternalLink, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { SourceProvider } from "@/generated/prisma/enums";
import { KEY_SETUP } from "@/lib/connector-setup";
import { SOURCE_PROVIDERS } from "@/lib/intelligence";
import { connectKeyAccount } from "@/server/actions/integrations";

/**
 * Paste a vendor key (HubSpot service key, Brex token, Granola API key) or a
 * Read AI webhook signing key. The key goes straight to a server action that
 * checks it with the vendor and stores it encrypted; it is never shown again.
 */
export function KeyConnectDialog({
  provider,
  open,
  onOpenChange,
  connectionId,
  webhookUrl,
}: {
  provider: SourceProvider;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Replace the key of this connection. */
  connectionId?: string;
  webhookUrl?: string | null;
}) {
  const meta = SOURCE_PROVIDERS[provider];
  const setup = KEY_SETUP[provider];
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { pending, run } = useAction();
  const idp = `key-${provider.toLowerCase()}`;
  if (!setup) return null;
  const replacing = Boolean(connectionId);

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setKey("");
      setError(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{replacing ? `Replace the ${meta.label} ${setup.keyLabel.toLowerCase()}` : `Connect ${meta.label}`}</DialogTitle>
          <DialogDescription>
            {meta.auth === "webhook" ? `${meta.label} sends each meeting report to CytoHub as it finishes.` : `CytoHub reads ${meta.label} with a read-only ${setup.keyLabel.toLowerCase()} you create.`}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            const res = await run(() => connectKeyAccount(provider, key, connectionId ?? null));
            if (res.ok) close(false);
            else setError(res.error);
          }}
        >
          <ol className="grid list-decimal gap-1.5 pl-5 text-[15px] text-ink-2 marker:text-muted-foreground">
            {setup.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>

          {meta.auth === "webhook" && (
            <div className="grid gap-1.5">
              <span className="text-xs font-medium text-ink-2">Webhook URL</span>
              {webhookUrl ? (
                <div className="flex items-center gap-1.5">
                  <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-surface-2 px-2.5 py-1.5 font-mono text-[13px] text-foreground">{webhookUrl}</code>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(webhookUrl);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      } catch {
                        setCopied(false);
                      }
                    }}
                  >
                    {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              ) : (
                <p className="text-2xs text-critical-ink">Set APP_ORIGIN on the server so the webhook URL is known.</p>
              )}
            </div>
          )}

          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-ink-2">Read-only permissions</span>
            <ul className="flex flex-wrap gap-1">
              {setup.permissions.map((p) => (
                <li key={p} className="rounded border border-border bg-surface-2 px-1.5 font-mono text-[12.5px] text-ink-2">
                  {p}
                </li>
              ))}
            </ul>
          </div>

          <div className="grid gap-1.5">
            <label htmlFor={`${idp}-input`} className="text-xs font-medium text-ink-2">
              {setup.keyLabel}
            </label>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
              <Input
                id={`${idp}-input`}
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="off"
                className="h-10 pl-8 font-mono"
                aria-invalid={error ? true : undefined}
                aria-describedby={`${idp}-hint`}
                maxLength={4000}
                required
              />
            </div>
            <p id={`${idp}-hint`} className="flex items-start gap-1.5 text-2xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-good-ink" aria-hidden />
              Checked with {meta.vendor} before it is saved, then stored encrypted on the server. It is never shown again; replace it here if it changes.
            </p>
          </div>

          {setup.note && <p className="text-2xs text-muted-foreground">{setup.note}</p>}

          {error && (
            <p role="alert" className="flex items-start gap-1.5 rounded-md bg-critical-soft px-2.5 py-2 text-[14px] text-critical-ink">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {error}
            </p>
          )}

          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="link" className="h-auto px-0 text-muted-foreground" asChild>
              <a href={setup.docsUrl} target="_blank" rel="noreferrer noopener">
                {meta.vendor} instructions <ExternalLink aria-hidden />
              </a>
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || key.trim().length < 16}>
                {pending && <Loader2 className="animate-spin" aria-hidden />}
                {pending ? "Checking…" : replacing ? "Replace key" : "Connect"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
