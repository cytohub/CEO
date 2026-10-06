import { Banknote, Brain, Briefcase, CalendarClock, Check, FileText, type LucideIcon, MessageSquare, Microscope, Users } from "lucide-react";
import { StatusPill } from "@/components/common/status";
import type { SourceCategory } from "@/generated/prisma/enums";
import { formatDateTime, timeAgo } from "@/lib/dates";
import type { Tone } from "@/lib/domain";
import { formatNumber } from "@/lib/format";
import type { SourceRow } from "@/server/queries/settings";
import { SectionFooter } from "./section";
import { SourceToggle } from "./source-toggle";

const CATEGORY: Record<SourceCategory, { label: string; icon: LucideIcon }> = {
  WORKSPACE: { label: "Workspace", icon: Brain },
  COMMUNICATION: { label: "Communication", icon: MessageSquare },
  CALENDAR: { label: "Calendar", icon: CalendarClock },
  CRM: { label: "CRM", icon: Briefcase },
  DOCUMENTS: { label: "Documents", icon: FileText },
  FINANCE: { label: "Finance", icon: Banknote },
  SCIENCE: { label: "Science", icon: Microscope },
  PEOPLE: { label: "People", icon: Users },
};

const STATE: Record<SourceRow["state"], { label: string; tone: Tone }> = {
  connected: { label: "Connected", tone: "good" },
  sample: { label: "Sample data", tone: "brain" },
  not_connected: { label: "Not connected", tone: "neutral" },
  disabled: { label: "Disabled", tone: "neutral" },
  syncing: { label: "Syncing", tone: "info" },
  error: { label: "Error", tone: "critical" },
};

export function SourcesList({ sources, now, timezone }: { sources: SourceRow[]; now: Date; timezone: string }) {
  const enabled = sources.filter((s) => s.state !== "disabled").length;
  const live = sources.filter((s) => s.state === "connected").length;
  const sample = sources.filter((s) => s.state === "sample").length;
  return (
    <div className="panel @container">
      <ul className="divide-y divide-hairline">
        {sources.map((s) => {
          const cat = CATEGORY[s.category];
          const Icon = cat.icon;
          const state = STATE[s.state];
          return (
            <li key={s.key} className="grid grid-cols-[32px_minmax(0,1fr)_auto] gap-x-3 gap-y-2 px-4 py-3 @2xl:grid-cols-[32px_minmax(0,1fr)_150px_auto]">
              <div className="flex size-8 items-center justify-center rounded-lg border border-border bg-surface-2">
                <Icon className="size-4 text-ink-3" aria-hidden />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h3 className="text-[13px] font-medium text-foreground">{s.name}</h3>
                  <span className="text-2xs text-muted-foreground">
                    {s.provider} · {cat.label}
                  </span>
                  <StatusPill tone={state.tone} label={state.label} />
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{s.description}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  <span className="mr-0.5 text-2xs text-ink-3">Extracts</span>
                  {s.extracts.map((x) => (
                    <span key={x} className="rounded border border-border bg-surface-2 px-1.5 text-2xs text-ink-2">
                      {x}
                    </span>
                  ))}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1 text-2xs text-muted-foreground">
                  {s.credentialEnv.length === 0 ? (
                    <span>Built in — no credentials needed.</span>
                  ) : (
                    <>
                      <span className="mr-0.5 text-ink-3">To connect, set</span>
                      {s.credentialEnv.map((v) => (
                        <code key={v} className="rounded bg-muted px-1 font-mono text-[10.5px] text-ink-2">
                          {v}
                        </code>
                      ))}
                      {s.credentialsPresent ? (
                        <span className="ml-1 inline-flex items-center gap-0.5 text-good-ink">
                          <Check className="size-3" aria-hidden /> credentials present
                        </span>
                      ) : (
                        <span className="ml-1">· not set</span>
                      )}
                    </>
                  )}
                </div>
                {s.error && <p className="mt-1 text-2xs text-critical-ink">Last error: {s.error}</p>}
              </div>
              <dl className="col-start-2 flex flex-wrap gap-x-4 gap-y-0.5 text-2xs @2xl:col-start-auto @2xl:block @2xl:space-y-0.5 @2xl:text-right">
                <div className="flex gap-1 @2xl:justify-end">
                  <dt className="text-muted-foreground">Last sync</dt>
                  <dd className="text-ink-2 tabular" title={s.lastSyncAt ? formatDateTime(s.lastSyncAt, timezone) : undefined}>
                    {s.lastSyncAt ? timeAgo(s.lastSyncAt, now) : "never"}
                  </dd>
                </div>
                <div className="flex gap-1 @2xl:justify-end">
                  <dt className="text-muted-foreground">Indexed</dt>
                  <dd className="text-ink-2 tabular">{s.key === "workspace" ? "live graph" : `${formatNumber(s.itemsIndexed)} items`}</dd>
                </div>
              </dl>
              <div className="col-start-3 row-start-1 pt-1 @2xl:col-start-auto @2xl:row-start-auto">
                <SourceToggle sourceKey={s.key} name={s.name} enabled={s.state !== "disabled"} alwaysOn={s.alwaysOn} registered={s.registered} />
              </div>
            </li>
          );
        })}
      </ul>
      <SectionFooter
        hint={`${enabled} of ${sources.length} sources enabled · ${live} live · ${sample} on sample data. Disabled sources are skipped by the Daily Brain Refresh; their indexed history is kept.`}
      />
    </div>
  );
}
