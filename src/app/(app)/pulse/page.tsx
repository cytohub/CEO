import { AlertTriangle, ArrowRight, CalendarDays, CheckCircle2, Gavel, Handshake, ShieldAlert, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/common/bits";
import { StatusPill, TONE_DOT, TONE_TEXT } from "@/components/common/status";
import { ProcessedChart } from "@/components/health/processed-chart";
import { LiveRefresh } from "@/components/pulse/live-refresh";
import { Button } from "@/components/ui/button";
import { dayFromKey, dayKeyInTz, formatDateTime, formatDay, formatDayFull, formatDayLong, formatTime, relativeDay, timeAgo } from "@/lib/dates";
import { formatNumber } from "@/lib/format";
import { inWorkHours, WORK_HOURS_LABEL } from "@/lib/live-schedule";
import { cn } from "@/lib/utils";
import { getPulseData, type PulseData, type PulseFlag } from "@/server/queries/pulse";
import { requirePage } from "@/server/security/session";

export const metadata: Metadata = { title: "Daily Pulse" };

const TONE_WORD: Partial<Record<PulseFlag["tone"], string>> = { critical: "Needs attention", serious: "Needs attention", warning: "Watch", good: "Clear" };

function FlagTile({ flag }: { flag: PulseFlag }) {
  const alert = flag.tone === "critical" || flag.tone === "serious" || flag.tone === "warning";
  const Icon = alert ? AlertTriangle : CheckCircle2;
  return (
    <Link href={flag.href} className="panel relative flex min-w-0 flex-col gap-1.5 overflow-hidden py-3.5 pr-4 pl-5 transition-colors hover:bg-muted/40">
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", TONE_DOT[flag.tone])} />
      <span className="flex items-start gap-1.5 text-2xs font-medium tracking-wide text-muted-foreground uppercase">
        <Icon className={cn("mt-px size-3.5 shrink-0", TONE_TEXT[flag.tone])} aria-hidden />
        <span className="line-clamp-2">{flag.label}</span>
        {TONE_WORD[flag.tone] && <span className="sr-only"> · {TONE_WORD[flag.tone]}</span>}
      </span>
      <span className={cn("text-[28px] leading-tight font-semibold tracking-tight tabular", flag.tone === "critical" || flag.tone === "serious" ? TONE_TEXT[flag.tone] : "text-foreground")}>{flag.value}</span>
      <span className="line-clamp-2 text-2xs text-muted-foreground">{flag.detail}</span>
    </Link>
  );
}

/** Minutes since the last sync after which, during work hours, the page says it’s behind. */
const STALE_MINUTES = 150;

function Freshness({ f, timezone }: { f: PulseData["freshness"]; timezone: string }) {
  const integrations = (label: string) => (
    <Link href="/settings/integrations" className="font-medium text-brand hover:underline">
      {label}
    </Link>
  );
  if (!f.sources || !f.lastSync) {
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className={cn("size-2 rounded-full", TONE_DOT.neutral)} aria-hidden />
        {f.sources ? "Connected — waiting for the first sync." : "No live sources yet."}
        {integrations(f.sources ? "See Integrations →" : "Connect them in Integrations →")}
      </p>
    );
  }
  const behind =
    f.hourlySources > 0 && inWorkHours(f.now, timezone) && (!f.lastHourlySync || f.now.getTime() - f.lastHourlySync.getTime() > STALE_MINUTES * 60_000);
  const nextDay = dayKeyInTz(f.nextBrain, timezone);
  const next =
    nextDay === dayKeyInTz(f.now, timezone)
      ? formatTime(f.nextBrain, timezone)
      : nextDay === dayKeyInTz(new Date(f.now.getTime() + 86_400_000), timezone)
        ? `tomorrow, ${formatTime(f.nextBrain, timezone)}`
        : formatDateTime(f.nextBrain, timezone);
  const items = [
    <>
      Synced {timeAgo(f.lastSync, f.now)}
      {behind && <> — {integrations("check Integrations")}</>}
    </>,
    f.lastBrain && <>Brain updated {timeAgo(f.lastBrain, f.now)}</>,
    <>Next update {next}</>,
    <>Hourly on {WORK_HOURS_LABEL}</>,
  ].filter(Boolean);
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground max-sm:gap-x-3">
      <span className={cn("inline-flex items-center gap-1.5 font-medium", behind ? "text-warning-ink" : "text-foreground")}>
        <span className={cn("size-2 rounded-full", TONE_DOT[behind ? "warning" : "good"])} aria-hidden />
        {behind ? "Behind schedule" : "Live"}
      </span>
      {items.map((item, i) => (
        <span key={i}>
          {/* Phones wrap without separators rather than leave one dangling. */}
          <span aria-hidden className="mr-2 max-sm:hidden">
            ·
          </span>
          {item}
        </span>
      ))}
    </p>
  );
}

/**
 * Daily Pulse: where things stand today on one page — the Brain's takeaway,
 * standing flags, the calls only the CEO can make, the investor pipeline and
 * meetings held. Every figure is read live from the workspace.
 */
export default async function PulsePage() {
  await requirePage("cockpit.view", "/pulse");
  const d = await getPulseData();
  const meetingsTotal = d.meetings.reduce((s, m) => s + m.count, 0);

  return (
    <div className="mx-auto max-w-[1440px] space-y-7">
      <LiveRefresh />
      <div className="space-y-3">
        <PageHeader
          className="pb-0"
          eyebrow={`CytoHub · Daily Pulse · ${formatDayFull(d.today)}`}
          title="Where things stand today"
          description={
            d.takeaway ? (
              <>
                {d.takeaway.text}
                {!d.takeaway.isToday && <span className="text-ink-3"> (from the {formatDayLong(d.takeaway.date)} brief)</span>}
              </>
            ) : (
              "No Daily Brief yet. The Brain writes one at 6:30 each morning, or run a refresh on Today, and its takeaway appears here."
            )
          }
          actions={
            <Button size="sm" variant="outline" asChild>
              <Link href="/">
                <Sparkles aria-hidden /> Open Today
              </Link>
            </Button>
          }
        />
        <Freshness f={d.freshness} timezone={d.timezone} />
      </div>

      <section aria-labelledby="pulse-flags">
        <h2 id="pulse-flags" className="sr-only">
          Standing flags
        </h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-3">
          {d.flags.map((f) => (
            <FlagTile key={f.id} flag={f} />
          ))}
        </div>
      </section>

      <section aria-labelledby="pulse-calls">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <div>
            <h2 id="pulse-calls" className="text-[17px] font-semibold tracking-tight">
              Needs your call
            </h2>
            <p className="text-xs text-muted-foreground">What the Brain found but can’t settle without you.</p>
          </div>
          {d.reviewPending > 0 && (
            <Link href="/brain/review" className="text-xs font-medium text-brand hover:underline">
              {formatNumber(d.reviewPending)} more in the Review Queue →
            </Link>
          )}
        </div>
        {d.calls.length ? (
          <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-3">
            {d.calls.map((c) => (
              <li key={c.id}>
                <Link href="/inbox" className="panel flex h-full flex-col gap-2 border-l-[3px] border-l-warning px-4 py-3.5 transition-colors hover:bg-muted/40">
                  <span className="flex items-start justify-between gap-2">
                    <span className="text-[15px] leading-snug font-medium text-foreground">{c.title}</span>
                    {c.due && <span className={cn("shrink-0 text-2xs font-medium tabular", c.due <= d.today ? "text-critical-ink" : "text-muted-foreground")}>{relativeDay(c.due, d.today)}</span>}
                  </span>
                  <span className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">{c.why}</span>
                  <span className="mt-auto flex items-start gap-1.5 text-xs font-medium text-brand">
                    <ArrowRight className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    <span className="line-clamp-2">{c.action}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="panel">
            <EmptyState compact icon={Gavel} title="Nothing needs your call right now" description="Decisions, approvals and escalations the Brain files to your Inbox appear here." />
          </div>
        )}
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-[1.3fr_1fr]">
        <section aria-labelledby="pulse-fundraising" className="panel overflow-hidden">
          <div className="border-b border-hairline px-4 py-3">
            <h2 id="pulse-fundraising" className="text-[17px] font-semibold tracking-tight">
              Fundraising pipeline
            </h2>
            <p className="text-xs text-muted-foreground">Every open investor conversation, plus anyone who committed or declined in the last 60 days.</p>
          </div>
          {d.investors.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[15px]">
                <caption className="sr-only">Fundraising pipeline</caption>
                <thead>
                  <tr className="border-b border-hairline text-left text-2xs font-medium tracking-wide text-muted-foreground uppercase">
                    <th scope="col" className="px-4 py-2 font-medium">
                      Investor
                    </th>
                    <th scope="col" className="py-2 pr-4 pl-2 font-medium sm:pr-2">
                      Status
                    </th>
                    <th scope="col" className="py-2 pr-4 pl-2 font-medium max-sm:hidden">
                      Note
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {d.investors.map((i) => (
                    <tr key={i.id} className="align-top">
                      <td className="px-4 py-2.5">
                        <span className="font-medium text-foreground">{i.investor}</span>
                        {/* Phones: the note sits under the name instead of in a narrow column. */}
                        {i.note && <span className="mt-0.5 block text-xs text-muted-foreground sm:hidden">{i.note}</span>}
                      </td>
                      <td className="py-2.5 pr-4 pl-2 sm:pr-2">
                        <StatusPill tone={i.tone} label={i.status} />
                      </td>
                      <td className="py-2.5 pr-4 pl-2 text-xs text-muted-foreground max-sm:hidden">{i.note || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              compact
              icon={Handshake}
              title={d.connected.crm ? "No investor conversations yet" : "Connect HubSpot to see your investors"}
              description={
                d.connected.crm
                  ? "Deals in HubSpot pipelines named for investors or fundraising show here."
                  : "Your fundraising pipeline comes from HubSpot deals, updated every hour."
              }
              action={
                !d.connected.crm && (
                  <Button size="sm" variant="outline" asChild>
                    <Link href="/settings/integrations#crm">Connect HubSpot</Link>
                  </Button>
                )
              }
            />
          )}
        </section>

        <section aria-labelledby="pulse-meetings" className="panel overflow-hidden">
          <div className="border-b border-hairline px-4 py-3">
            <h2 id="pulse-meetings" className="text-[17px] font-semibold tracking-tight">
              Meetings logged
            </h2>
            <p className="text-xs text-muted-foreground">Meetings held per day over the last two weeks, from your calendar and meeting notes.</p>
          </div>
          {meetingsTotal > 0 ? (
            <ProcessedChart
              series={d.meetings}
              noun={{ one: "meeting", many: "meetings" }}
              label="Meetings per day"
              summary={
                <>
                  <span className="font-medium text-foreground tabular">{formatNumber(meetingsTotal)}</span> meetings, {formatDay(dayFromKey(d.meetings[0].day))}–
                  {formatDay(dayFromKey(d.meetings[d.meetings.length - 1].day))} ·{" "}
                  <span className="font-medium text-foreground tabular">{formatNumber(d.meetingsWithNotes)}</span> with notes
                </>
              }
            />
          ) : (
            <EmptyState
              compact
              icon={d.connected.calendar || d.connected.notes ? CalendarDays : ShieldAlert}
              title={d.connected.calendar || d.connected.notes ? "No meetings in the last two weeks" : "Connect your calendar or meeting notes"}
              description="Outlook Calendar, Granola and Read AI all feed this chart."
              action={
                !(d.connected.calendar || d.connected.notes) && (
                  <Button size="sm" variant="outline" asChild>
                    <Link href="/settings/integrations#calendar">Connect a calendar</Link>
                  </Button>
                )
              }
            />
          )}
        </section>
      </div>
    </div>
  );
}
