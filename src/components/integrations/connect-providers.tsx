"use client";

import { FlaskConical, KeyRound, Loader2, Plus, Webhook } from "lucide-react";
import { useState } from "react";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import type { SourceProvider } from "@/generated/prisma/enums";
import { KEY_SETUP } from "@/lib/connector-setup";
import { connectDemoAccount } from "@/server/actions/integrations";
import type { ProviderOption } from "@/server/queries/integrations";
import { KeyConnectDialog } from "./key-connect-dialog";

function howItConnects(p: ProviderOption): string {
  if (p.auth === "apiKey") return `Read-only ${KEY_SETUP[p.provider]?.keyLabel.toLowerCase() ?? "key"} you create in ${p.vendor}, stored encrypted.`;
  if (p.auth === "webhook") return `${p.vendor} posts signed meeting reports to CytoHub after each meeting.`;
  return `Sign in with ${p.vendor}; CytoHub only reads${p.webhooks ? " · near real-time available" : ""}.`;
}

/** "Add an account" rows: sign-in (OAuth), a pasted key, or a signed webhook; demo accounts where sample data exists. */
export function ConnectProviders({ providers, kindLabel }: { providers: ProviderOption[]; kindLabel: string }) {
  const { pending, run } = useAction();
  const [busy, setBusy] = useState<SourceProvider | null>(null);
  const [keyFor, setKeyFor] = useState<ProviderOption | null>(null);

  return (
    <div className="panel">
      <h3 className="border-b border-hairline px-4 py-2 text-2xs font-medium text-muted-foreground">Add {kindLabel.toLowerCase()} source</h3>
      <ul className="divide-y divide-hairline">
        {providers.map((p) => (
          <li key={p.provider} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
            <div className="min-w-[min(100%,16rem)] flex-1">
              <p className="text-[15px] font-medium text-foreground">
                {p.label} <span className="font-normal text-muted-foreground">· {p.vendor}</span>
              </p>
              {p.configured ? (
                <p className="text-2xs text-muted-foreground">{howItConnects(p)}</p>
              ) : (
                <p className="text-2xs text-muted-foreground">
                  Not configured — set{" "}
                  {p.missingEnv.map((v, i) => (
                    <span key={v}>
                      {i > 0 && (i === p.missingEnv.length - 1 ? " and " : ", ")}
                      <code className="rounded bg-muted px-1 font-mono text-[13.5px] text-ink-2">{v}</code>
                    </span>
                  ))}{" "}
                  on the server to connect a live account (see docs/CONNECTORS.md).
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              {p.auth === "apiKey" || p.auth === "webhook" ? (
                <Button size="sm" disabled={!p.configured} onClick={() => setKeyFor(p)}>
                  {p.auth === "webhook" ? <Webhook aria-hidden /> : <KeyRound aria-hidden />} Connect {p.label}
                </Button>
              ) : p.configured && p.connectUrl ? (
                <Button size="sm" asChild>
                  <a href={p.connectUrl}>
                    <Plus aria-hidden /> Connect {p.label}
                  </a>
                </Button>
              ) : (
                <Button size="sm" variant="outline" disabled aria-label={`Connect ${p.label} (not configured)`}>
                  <Plus aria-hidden /> Connect
                </Button>
              )}
              {p.demo && (
                <Button
                  size="sm"
                  variant={p.configured ? "ghost" : "secondary"}
                  disabled={pending}
                  onClick={async () => {
                    setBusy(p.provider);
                    await run(() => connectDemoAccount(p.provider));
                    setBusy(null);
                  }}
                >
                  {pending && busy === p.provider ? <Loader2 className="animate-spin" aria-hidden /> : <FlaskConical aria-hidden />}
                  Connect demo account
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {keyFor && (
        <KeyConnectDialog
          provider={keyFor.provider}
          webhookUrl={keyFor.webhookUrl}
          open
          onOpenChange={(o) => {
            if (!o) setKeyFor(null);
          }}
        />
      )}
    </div>
  );
}
