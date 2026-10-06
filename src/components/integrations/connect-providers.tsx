"use client";

import { FlaskConical, Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import type { SourceProvider } from "@/generated/prisma/enums";
import { connectDemoAccount } from "@/server/actions/integrations";
import type { ProviderOption } from "@/server/queries/integrations";

/** "Add an account" rows: OAuth when the provider is configured, otherwise the missing env vars and a demo account. */
export function ConnectProviders({ providers, kindLabel }: { providers: ProviderOption[]; kindLabel: string }) {
  const { pending, run } = useAction();
  const [busy, setBusy] = useState<SourceProvider | null>(null);

  return (
    <div className="panel">
      <h3 className="border-b border-hairline px-4 py-2 text-2xs font-medium text-muted-foreground">Add {kindLabel.toLowerCase()} account</h3>
      <ul className="divide-y divide-hairline">
        {providers.map((p) => (
          <li key={p.provider} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-foreground">
                {p.label} <span className="font-normal text-muted-foreground">· {p.vendor}</span>
              </p>
              {p.configured ? (
                <p className="text-2xs text-muted-foreground">Read-only OAuth access{p.webhooks ? " · near real-time available" : ""}.</p>
              ) : (
                <p className="text-2xs text-muted-foreground">
                  Not configured — set{" "}
                  {p.missingEnv.map((v, i) => (
                    <span key={v}>
                      {i > 0 && (i === p.missingEnv.length - 1 ? " and " : ", ")}
                      <code className="rounded bg-muted px-1 font-mono text-[10.5px] text-ink-2">{v}</code>
                    </span>
                  ))}{" "}
                  on the server to connect a live account.
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              {p.configured && p.connectUrl ? (
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
    </div>
  );
}
