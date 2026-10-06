"use client";

import { AlertTriangle, CalendarDays, FileText, FlaskConical, Loader2, Lock, Mail, Radio, RefreshCw, Unplug, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { StatusPill } from "@/components/common/status";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Sensitivity, SourceKind, SyncFrequency } from "@/generated/prisma/enums";
import { formatDateTime, timeAgo } from "@/lib/dates";
import { formatNumber } from "@/lib/format";
import { CONNECTION_MODE, CONNECTION_STATUS, SENSITIVITY, SYNC_FREQUENCY } from "@/lib/intelligence";
import { cn } from "@/lib/utils";
import { runSyncNow, updateConnectionSettings } from "@/server/actions/integrations";
import type { ConnectionCard as Card } from "@/server/queries/integrations";
import { DisconnectDialog } from "./disconnect-dialog";
import { timeUntil } from "./labels";
import { RunsTable } from "./runs-table";

export const KIND_ICON: Record<SourceKind, LucideIcon> = { EMAIL: Mail, CALENDAR: CalendarDays, DOCUMENTS: FileText };

const FREQUENCIES: SyncFrequency[] = ["MANUAL", "HOURLY", "DAILY", "REALTIME"];
const SENSITIVITIES: Sensitivity[] = ["INTERNAL", "CONFIDENTIAL", "RESTRICTED"];

function When({ instant, now, timezone, future }: { instant: Date | null; now: Date; timezone: string; future?: boolean }) {
  if (!instant) return <span className="text-muted-foreground">{future ? "Not scheduled" : "Never"}</span>;
  return (
    <span>
      <span className="text-foreground">{future ? timeUntil(instant, now) : timeAgo(instant, now)}</span>
      <span className="block text-2xs text-muted-foreground tabular">{formatDateTime(instant, timezone)}</span>
    </span>
  );
}

export function ConnectionCard({ c, now, timezone }: { c: Card; now: Date; timezone: string }) {
  const Icon = KIND_ICON[c.kind];
  const status = CONNECTION_STATUS[c.status];
  const sync = useAction();
  const save = useAction();
  const [frequency, setFrequency] = useState(c.syncFrequency);
  const [includeNoise, setIncludeNoise] = useState(c.includeNoise);
  const [sensitivity, setSensitivity] = useState(c.defaultSensitivity);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const broken = c.status === "NEEDS_REAUTH" || c.status === "ERROR";
  const title = c.accountEmail ?? c.label;
  const idp = `conn-${c.id}`;

  function update(patch: Parameters<typeof updateConnectionSettings>[1], revert: () => void) {
    save.run(() => updateConnectionSettings(c.id, patch)).then((res) => {
      if (!res.ok) revert();
    });
  }

  return (
    <article id={`connection-${c.id}`} aria-labelledby={`${idp}-title`} className="panel scroll-mt-16 @container">
      <header className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2">
          <Icon className="size-4 text-ink-3" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 id={`${idp}-title`} className="min-w-0 truncate text-[13px] font-medium text-foreground" title={title}>
              {title}
            </h3>
            <span className="inline-flex h-5 items-center gap-1 rounded border border-border bg-surface-2 px-1.5 text-2xs font-medium text-ink-2">
              {c.mode === "DEMO" ? <FlaskConical className="size-3" aria-hidden /> : <Radio className="size-3" aria-hidden />}
              {CONNECTION_MODE[c.mode].label}
            </span>
            <StatusPill tone={status.tone} label={status.label} />
          </div>
          <p className="mt-0.5 text-2xs text-muted-foreground">
            {c.providerLabel} · {c.vendor}
            {c.accountEmail && c.label !== c.accountEmail ? ` · ${c.label}` : ""}
            {c.webhookActive ? " · push notifications on" : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {c.syncable && (
            <Button
              size="sm"
              variant="outline"
              disabled={sync.pending || c.status === "NEEDS_REAUTH"}
              onClick={() => sync.run(() => runSyncNow(c.id))}
              aria-label={`Run sync now for ${title}`}
            >
              {sync.pending ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
              {sync.pending ? "Syncing…" : "Run sync now"}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setDisconnectOpen(true)} aria-label={`Disconnect ${title}`}>
            <Unplug aria-hidden /> Disconnect
          </Button>
        </div>
      </header>

      {broken && (
        <div role="alert" className={cn("mx-4 mb-3 flex flex-wrap items-start gap-x-3 gap-y-2 rounded-md px-3 py-2 text-xs", c.status === "ERROR" ? "bg-critical-soft" : "bg-serious-soft")}>
          <AlertTriangle className={cn("mt-0.5 size-3.5 shrink-0", c.status === "ERROR" ? "text-critical-ink" : "text-serious-ink")} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground">
              {c.status === "NEEDS_REAUTH" ? "Access expired or was revoked — reconnect to resume syncing." : "The last sync failed. It will retry automatically; reconnect if it keeps failing."}
            </p>
            {c.lastError && (
              <p className="mt-0.5 font-mono text-[11px] break-words text-ink-2">
                {c.lastError}
                {c.lastErrorAt && <span className="font-sans text-muted-foreground"> · {timeAgo(c.lastErrorAt, now)}</span>}
              </p>
            )}
          </div>
          {c.reconnectUrl ? (
            <Button size="sm" asChild>
              <a href={c.reconnectUrl}>Reconnect</a>
            </Button>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0} className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Button size="sm" disabled tabIndex={-1}>
                    Reconnect
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{c.missingEnv.length ? `Not configured — set ${c.missingEnv.join(", ")}` : "Reconnect isn’t available for this source"}</TooltipContent>
            </Tooltip>
          )}
        </div>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-hairline px-4 py-3 text-xs @2xl:grid-cols-4">
        <div className="min-w-0">
          <dt className="text-2xs font-medium text-muted-foreground">Last sync</dt>
          <dd className="mt-0.5">
            <When instant={c.lastSyncAt} now={now} timezone={timezone} />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-2xs font-medium text-muted-foreground">Next sync</dt>
          <dd className="mt-0.5">
            {frequency === "MANUAL" ? <span className="text-muted-foreground">Manual only</span> : <When instant={c.nextSyncAt} now={now} timezone={timezone} future />}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-2xs font-medium text-muted-foreground">Items ingested</dt>
          <dd className="mt-0.5 text-foreground tabular">{formatNumber(c.itemsIngested)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-2xs font-medium text-muted-foreground">Last success</dt>
          <dd className="mt-0.5">
            <When instant={c.lastSuccessAt} now={now} timezone={timezone} />
          </dd>
        </div>
      </dl>

      <div className="border-t border-hairline px-4 py-3">
        <h4 className="flex items-center gap-1.5 text-2xs font-medium text-muted-foreground">
          <Lock className="size-3" aria-hidden /> Permissions{c.permissions.length > 0 && c.permissions.every((p) => p.readOnly) ? " · read-only" : ""}
        </h4>
        {c.permissions.length ? (
          <ul className="mt-1.5 flex flex-wrap gap-1">
            {c.permissions.map((p) => (
              <li key={p.scope} title={p.scope} className="rounded border border-border bg-surface-2 px-1.5 text-2xs text-ink-2">
                {p.label}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-2xs text-muted-foreground">No provider permissions (sample data / uploads).</p>
        )}
      </div>

      {c.syncable && (
        <div className="grid gap-x-6 gap-y-3 border-t border-hairline px-4 py-3 @2xl:grid-cols-3">
          <div className="grid gap-1">
            <label htmlFor={`${idp}-freq`} className="text-2xs font-medium text-muted-foreground">
              Sync frequency
            </label>
            <Select
              value={frequency}
              disabled={save.pending}
              onValueChange={(v) => {
                const prev = frequency;
                setFrequency(v as SyncFrequency);
                update({ syncFrequency: v as SyncFrequency }, () => setFrequency(prev));
              }}
            >
              <SelectTrigger id={`${idp}-freq`} size="sm" className="w-full text-[13px]">
                {/* Explicit label: Radix fills the value only after hydration. */}
                <SelectValue>{SYNC_FREQUENCY[frequency].label}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {FREQUENCIES.map((f) => (
                  <SelectItem key={f} value={f} disabled={f === "REALTIME" && !c.supportsRealtime}>
                    {SYNC_FREQUENCY[f].label}
                    {f === "REALTIME" && !c.supportsRealtime ? " (not supported)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-2xs text-muted-foreground">{SYNC_FREQUENCY[frequency].description}</p>
          </div>
          <div className="grid content-start gap-1">
            <span id={`${idp}-noise-label`} className="text-2xs font-medium text-muted-foreground">
              Newsletters &amp; notifications
            </span>
            <div className="flex h-7 items-center gap-2">
              <Switch
                checked={includeNoise}
                disabled={save.pending}
                aria-labelledby={`${idp}-noise-label`}
                aria-describedby={`${idp}-noise-hint`}
                onCheckedChange={(v) => {
                  setIncludeNoise(v);
                  update({ includeNoise: v }, () => setIncludeNoise(!v));
                }}
              />
              <span className="text-[13px] text-foreground">{includeNoise ? "Included" : "Skipped"}</span>
            </div>
            <p id={`${idp}-noise-hint`} className="text-2xs text-muted-foreground">
              Off by default: marketing, newsletters and automated notifications are stored but not analyzed.
            </p>
          </div>
          <div className="grid content-start gap-1">
            <label htmlFor={`${idp}-sens`} className="text-2xs font-medium text-muted-foreground">
              Default sensitivity
            </label>
            <Select
              value={sensitivity}
              disabled={save.pending}
              onValueChange={(v) => {
                const prev = sensitivity;
                setSensitivity(v as Sensitivity);
                update({ defaultSensitivity: v as Sensitivity }, () => setSensitivity(prev));
              }}
            >
              <SelectTrigger id={`${idp}-sens`} size="sm" className="w-full text-[13px]">
                <SelectValue>{SENSITIVITY[sensitivity].label}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {SENSITIVITIES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SENSITIVITY[s].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-2xs text-muted-foreground">{SENSITIVITY[sensitivity].description} Classification can raise it per item.</p>
          </div>
        </div>
      )}

      <div className="border-t border-hairline">
        <h4 className="px-4 pt-2.5 pb-1 text-2xs font-medium text-muted-foreground">Recent runs</h4>
        <RunsTable runs={c.runs} now={now} timezone={timezone} caption={`Last runs for ${title}`} />
      </div>

      <DisconnectDialog open={disconnectOpen} onOpenChange={setDisconnectOpen} connectionId={c.id} title={title} provider={c.providerLabel} items={c.itemsIngested} />
    </article>
  );
}
