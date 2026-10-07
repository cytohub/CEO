import { Clock, Sparkles } from "lucide-react";
import { StatusPill } from "@/components/common/status";

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1 font-mono text-[13px] text-ink-2">{children}</code>;
}

function Block({ children, label }: { children: string; label: string }) {
  return (
    <pre aria-label={label} className="scrollbar-thin overflow-x-auto rounded-md border border-hairline bg-surface-2 px-3 py-2 font-mono text-[13px] leading-relaxed text-ink-2">
      {children}
    </pre>
  );
}

export function AiSection({ ai }: { ai: { claudeEnabled: boolean; model: string; cronSecretSet: boolean; disabledByFlag: boolean } }) {
  return (
    <div className="@container panel">
      <div className="grid divide-y divide-hairline @3xl:grid-cols-2 @3xl:divide-x @3xl:divide-y-0">
        <div className="min-w-0 space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-brain-soft">
              <Sparkles className="size-3.5 text-brain" aria-hidden />
            </div>
            <h3 className="text-[15px] font-semibold">Claude</h3>
            <StatusPill
              tone={ai.claudeEnabled ? "good" : "neutral"}
              label={ai.claudeEnabled ? "Configured" : ai.disabledByFlag ? "Disabled by flag" : "Not configured"}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {ai.claudeEnabled ? (
              <>
                The Chief of Staff, Prepare Me and the daily brief narrative run on <Code>{ai.model}</Code>, reasoning over CytoHub Brain through read-only tools.
              </>
            ) : (
              <>
                Every Brain feature works without an API key: the Chief of Staff answers from the deterministic CytoHub Brain rules engine. Add Claude for natural-language reasoning across priorities, pipeline and calendar.
              </>
            )}
          </p>
          <div className="space-y-1.5">
            <div className="eyebrow">{ai.claudeEnabled ? "Configuration" : "To enable"}</div>
            <ol className="list-decimal space-y-1 pl-4 text-xs text-ink-2 marker:text-ink-3">
              <li>
                Set <Code>ANTHROPIC_API_KEY</Code> in the server environment (<Code>.env</Code>).
              </li>
              <li>
                Optional: <Code>CYTOHUB_CLAUDE_MODEL</Code> (default <Code>{ai.model}</Code>) and <Code>CYTOHUB_CHIEF_EFFORT</Code> (low · medium · high).
              </li>
              <li>Restart the server. If Claude is unreachable, answers fall back to the rules engine automatically.</li>
            </ol>
            {ai.disabledByFlag && (
              <p className="text-2xs text-muted-foreground">
                <Code>CYTOHUB_DISABLE_CLAUDE=true</Code> is set — remove it to turn Claude back on.
              </p>
            )}
          </div>
        </div>

        <div className="min-w-0 space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-surface-2 ring-1 ring-border">
              <Clock className="size-3.5 text-ink-3" aria-hidden />
            </div>
            <h3 className="text-[15px] font-semibold">Scheduled Daily Brain Refresh</h3>
            <StatusPill tone={ai.cronSecretSet ? "good" : "warning"} label={ai.cronSecretSet ? "CRON_SECRET set" : "CRON_SECRET missing"} />
          </div>
          <p className="text-xs text-muted-foreground">
            Run the refresh before your day starts so the brief, Inbox and Top 5 are ready when you open Today. Manual refresh from Today always works.
          </p>
          <div className="space-y-1.5">
            <div className="eyebrow">From a cron or scheduler</div>
            <Block label="HTTP scheduled refresh">{`curl -X GET https://<your-host>/api/brain/refresh \\
  -H "Authorization: Bearer $CRON_SECRET"`}</Block>
          </div>
          <div className="space-y-1.5">
            <div className="eyebrow">From the server</div>
            <Block label="CLI scheduled refresh">{`# weekdays at 6:45 in the server's timezone
45 6 * * 1-5  cd /srv/cytohub && npm run brain:refresh`}</Block>
          </div>
        </div>
      </div>
    </div>
  );
}
