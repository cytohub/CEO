import { AlertTriangle, ArrowUpRight, AtSign, CalendarDays, ExternalLink, FileText, Mail, Paperclip, Sparkles, Trash2, Video } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Avatar, KeyValue, PageHeader, Panel } from "@/components/common/bits";
import { StatusPill } from "@/components/common/status";
import { AttentionBadge, RelevanceBadge, SensitivityBadge, SourceKindIcon, providerLabel } from "@/components/intelligence/badges";
import { DerivedList } from "@/components/intelligence/derived-list";
import { EVENT_STATUS, MENTION_RESOLUTION, MENTION_ROLE, MESSAGE_DIRECTION, PIPELINE_STAGE, PROCESSING_STATUS, RESPONSE_STATUS } from "@/components/intelligence/labels";
import { formatBytes, personLabel, readPeople, safeHttpUrl } from "@/components/intelligence/model";
import type { ResponseStatus } from "@/generated/prisma/enums";
import { formatDateTime, formatTime, timeAgo } from "@/lib/dates";
import { CEO_CATEGORIES, CONNECTION_MODE, DOCUMENT_FORMATS, DOCUMENT_TYPES, MEETING_CATEGORIES, SOURCE_ITEM_KINDS } from "@/lib/intelligence";
import { cn } from "@/lib/utils";
import { getCeoContext } from "@/server/context";
import { getSourceDetail, type SourceDetail } from "@/server/queries/provenance";
import { audit } from "@/server/security/audit";
import { requirePage } from "@/server/security/session";

export const metadata: Metadata = { title: "Source" };

export default async function SourcePage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const viewer = await requirePage("search.use", `/sources/${id}`);
  const data = await getSourceDetail(viewer, id);
  if (!data) notFound();
  await audit({ action: "source.view", viewer, targetType: "SourceItem", targetId: id });
  const { timezone } = await getCeoContext();
  const { item } = data;
  const original = safeHttpUrl(item.externalUrl ?? item.document?.url);
  const status = PROCESSING_STATUS[item.status];

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <SourceKindIcon kind={item.kind} className="size-3" /> Source · {SOURCE_ITEM_KINDS[item.kind].label}
          </span>
        }
        title={item.title}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium text-ink-2">{providerLabel(item.connection.provider)}</span>
            <span>·</span>
            <span>{item.connection.label}</span>
            {item.connection.mode === "DEMO" && <span className="rounded bg-muted px-1.5 text-2xs">{CONNECTION_MODE.DEMO.label}</span>}
            <span>·</span>
            <time dateTime={item.occurredAt.toISOString()}>{formatDateTime(item.occurredAt, timezone)}</time>
          </span>
        }
        actions={
          <>
            {data.threadReadable && item.emailMessage && (
              <Button size="sm" variant="outline" asChild>
                <Link href={`/brain/threads/${item.emailMessage.thread.id}`}>
                  <Mail /> Open thread
                </Link>
              </Button>
            )}
            {item.document && (
              <Button size="sm" variant="outline" asChild>
                <Link href={`/documents/${item.document.id}`}>
                  <FileText /> Open document
                </Link>
              </Button>
            )}
            {original && (
              <Button size="sm" variant="ghost" asChild>
                <a href={original} target="_blank" rel="noopener noreferrer">
                  Open original <ExternalLink />
                </a>
              </Button>
            )}
          </>
        }
      />

      {item.contentPurgedAt && (
        <p className="panel flex items-start gap-2 px-4 py-3 text-[13px] text-ink-2">
          <Trash2 className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
          <span>
            The content of this item was purged on {formatDateTime(item.contentPurgedAt, timezone)} by the retention policy. Metadata, provenance and everything derived from it are kept.
          </span>
        </p>
      )}

      <section className="panel grid gap-x-8 px-4 py-2 md:grid-cols-2" aria-label="Classification and processing">
        <dl>
          <KeyValue label="CEO relevance">
            <span className="flex flex-wrap items-center gap-1.5">
              {item.relevance ? <RelevanceBadge level={item.relevance} score={item.relevanceScore} /> : <span className="text-muted-foreground">Not classified</span>}
              {item.category && <span className="text-xs text-ink-2">{CEO_CATEGORIES[item.category].label}</span>}
              {item.relevanceScore != null && <span className="text-2xs text-muted-foreground tabular">score {Math.round(item.relevanceScore * 100)}</span>}
            </span>
          </KeyValue>
          {item.relevanceReasons.length > 0 && (
            <KeyValue label="Why">
              <ul className="flex flex-wrap gap-1">
                {item.relevanceReasons.map((r) => (
                  <li key={r} className="rounded bg-muted px-1.5 py-0.5 text-2xs text-ink-2">
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </li>
                ))}
              </ul>
            </KeyValue>
          )}
          <KeyValue label="Attention">{item.attention ? <AttentionBadge level={item.attention} /> : <span className="text-muted-foreground">—</span>}</KeyValue>
          <KeyValue label="Sensitivity">
            <SensitivityBadge level={item.sensitivity} />
          </KeyValue>
        </dl>
        <dl>
          <KeyValue label="Processing">
            <span className="flex flex-wrap items-center gap-1.5">
              <StatusPill tone={status.tone} label={status.label} />
              <span className="text-xs text-ink-2">{PIPELINE_STAGE[item.stage]}</span>
              {item.attempts > 1 && <span className="text-2xs text-muted-foreground">{item.attempts} attempts</span>}
            </span>
          </KeyValue>
          {item.processingError && (
            <KeyValue label="Error">
              <span className="flex items-start gap-1.5 text-xs text-critical-ink">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {item.processingError}
              </span>
            </KeyValue>
          )}
          <KeyValue label="Occurred">{formatDateTime(item.occurredAt, timezone)}</KeyValue>
          <KeyValue label="Ingested">
            {formatDateTime(item.ingestedAt, timezone)} <span className="text-muted-foreground">· {timeAgo(item.ingestedAt)}</span>
          </KeyValue>
          {(item.processedAt || item.extractionEngine) && (
            <KeyValue label="Extracted">
              {item.processedAt ? formatDateTime(item.processedAt, timezone) : "—"}
              {item.extractionEngine && <span className="text-muted-foreground"> · {item.extractionEngine === "claude" ? "Claude" : "Brain rules"}</span>}
            </KeyValue>
          )}
          {item.version > 1 && <KeyValue label="Version">{item.version}</KeyValue>}
        </dl>
      </section>

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="min-w-0 space-y-4 xl:col-span-8">
          {item.emailMessage && <EmailContent data={data} timezone={timezone} />}
          {item.calendarEvent && <CalendarContent event={item.calendarEvent} timezone={timezone} />}
          {item.document && <DocumentContent data={data} timezone={timezone} />}
          {item.kind === "MEETING_NOTES" && (
            <Panel title="Meeting notes" icon={FileText}>
              <div className="space-y-3 p-4">
                {item.meeting && (
                  <Link href={`?meeting=${item.meeting.id}`} scroll={false} className="inline-flex items-center gap-1 text-xs text-brand hover:underline">
                    {item.meeting.title} <ArrowUpRight className="size-3" aria-hidden />
                  </Link>
                )}
                <BodyText text={item.text} purged={Boolean(item.contentPurgedAt)} />
              </div>
            </Panel>
          )}
        </div>
        <aside className="min-w-0 space-y-4 xl:col-span-4">
          <Panel title="Derived intelligence" icon={Sparkles} count={data.derived.records.length}>
            <DerivedList records={data.derived.records} hidden={data.derived.hidden} />
          </Panel>
          <Panel title="People & companies" icon={AtSign} count={data.mentions.length}>
            {data.mentions.length === 0 ? (
              <p className="px-3.5 py-3 text-xs text-muted-foreground">No mentions extracted.</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5 p-3">
                {data.mentions.map((m) => {
                  const label = m.resolved?.name ?? m.text;
                  const title = `${MENTION_ROLE[m.role]} · ${MENTION_RESOLUTION[m.resolution]} · ${Math.round(m.confidence * 100)}%${m.email ? ` · ${m.email}` : ""}`;
                  const cls = cn(
                    "inline-flex max-w-full items-center gap-1.5 rounded-full border py-0.5 pr-2 pl-0.5 text-xs",
                    m.resolved ? "border-border hover:bg-muted" : "border-dashed border-border text-muted-foreground",
                  );
                  const inner = (
                    <>
                      <Avatar name={label} className={m.entityType === "COMPANY" ? "rounded-md" : undefined} />
                      <span className="truncate">{label}</span>
                      <span className="text-2xs text-muted-foreground">{m.resolved ? MENTION_ROLE[m.role] : MENTION_RESOLUTION[m.resolution]}</span>
                    </>
                  );
                  return (
                    <li key={m.id} className="max-w-full" title={title}>
                      {m.resolved?.href ? (
                        <Link href={m.resolved.href} className={cls}>
                          {inner}
                        </Link>
                      ) : (
                        <span className={cls}>{inner}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function BodyText({ text, purged }: { text: string | null; purged: boolean }) {
  if (purged || !text) return <p className="text-xs text-muted-foreground">{purged ? "Content purged by retention." : "No text extracted."}</p>;
  return <div className="max-w-[72ch] text-[13px] leading-relaxed whitespace-pre-wrap text-foreground">{text}</div>;
}

function Recipients({ label, value }: { label: string; value: unknown }) {
  const people = readPeople(value);
  if (!people.length) return null;
  return (
    <KeyValue label={label} className="grid-cols-[64px_1fr] py-1">
      <span className="text-ink-2">{people.map((p) => (p.name && p.email ? `${p.name} <${p.email}>` : personLabel(p))).join(", ")}</span>
    </KeyValue>
  );
}

function EmailContent({ data, timezone }: { data: SourceDetail; timezone: string }) {
  const m = data.item.emailMessage!;
  return (
    <Panel title="Email" icon={Mail} actions={<span className="text-2xs text-muted-foreground">{MESSAGE_DIRECTION[m.direction]}</span>}>
      <dl className="border-b border-hairline px-4 py-2.5">
        <KeyValue label="From" className="grid-cols-[64px_1fr] py-1">
          <span>
            {m.fromName && <span className="font-medium">{m.fromName} </span>}
            <span className="text-muted-foreground">&lt;{m.fromEmail}&gt;</span>
          </span>
        </KeyValue>
        <Recipients label="To" value={m.to} />
        <Recipients label="Cc" value={m.cc} />
        <KeyValue label="Date" className="grid-cols-[64px_1fr] py-1">
          {formatDateTime(m.sentAt, timezone)}
        </KeyValue>
        <KeyValue label="Subject" className="grid-cols-[64px_1fr] py-1">
          <span className="font-medium">{m.subject}</span>
        </KeyValue>
        <KeyValue label="Thread" className="grid-cols-[64px_1fr] py-1">
          {data.threadReadable ? (
            <Link href={`/brain/threads/${m.thread.id}`} className="inline-flex items-center gap-1 text-brand hover:underline">
              {m.thread.subject} <ArrowUpRight className="size-3" aria-hidden />
            </Link>
          ) : (
            <span className="text-muted-foreground">Hidden by your access level</span>
          )}
        </KeyValue>
      </dl>
      <div className="px-4 py-4">
        <h3 className="eyebrow mb-2">New content in this message</h3>
        <BodyText text={data.item.text} purged={Boolean(data.item.contentPurgedAt)} />
      </div>
      {data.attachments.length > 0 && (
        <div className="border-t border-hairline px-4 py-3">
          <h3 className="eyebrow mb-2">Attachments</h3>
          <ul className="space-y-1">
            {data.attachments.map((a) => (
              <li key={a.id} className="flex items-center gap-2 text-[13px]">
                <Paperclip className="size-3.5 text-ink-3" aria-hidden />
                {a.documentId ? (
                  <Link href={`/documents/${a.documentId}`} className="truncate hover:underline">
                    {a.filename}
                  </Link>
                ) : (
                  <span className="truncate">{a.filename}</span>
                )}
                <span className="ml-auto shrink-0 text-2xs text-muted-foreground">{formatBytes(a.sizeBytes)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function CalendarContent({ event: e, timezone }: { event: NonNullable<SourceDetail["item"]["calendarEvent"]>; timezone: string }) {
  const attendees = readPeople(e.attendees).map((p, i) => ({ ...p, response: (Array.isArray(e.attendees) ? (e.attendees[i] as { responseStatus?: ResponseStatus } | null)?.responseStatus : undefined) ?? "NEEDS_ACTION" }));
  const conference = safeHttpUrl(e.conferenceUrl);
  const st = EVENT_STATUS[e.status];
  return (
    <Panel title="Calendar event" icon={CalendarDays} actions={<StatusPill tone={st.tone} label={st.label} />}>
      <dl className="px-4 py-2.5">
        <KeyValue label="When">
          {e.allDay ? "All day · " : ""}
          {formatDateTime(e.startsAt, timezone)}–{formatTime(e.endsAt, timezone)}
          {e.previousStartsAt && <span className="ml-2 rounded bg-warning-soft px-1.5 py-0.5 text-2xs text-warning-ink">Moved from {formatDateTime(e.previousStartsAt, timezone)}</span>}
        </KeyValue>
        {e.category && <KeyValue label="Category">{MEETING_CATEGORIES[e.category].label}</KeyValue>}
        <KeyValue label="Organizer">{e.organizerName ?? e.organizerEmail ?? "—"}</KeyValue>
        {e.location && <KeyValue label="Location">{e.location}</KeyValue>}
        {conference && (
          <KeyValue label="Conference">
            <a href={conference} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
              <Video className="size-3.5" aria-hidden /> Join link
            </a>
          </KeyValue>
        )}
        {e.isRecurring && <KeyValue label="Recurrence">{e.recurrence ?? "Recurring"}</KeyValue>}
        {e.meeting && (
          <KeyValue label="Meeting">
            <Link href={`?meeting=${e.meeting.id}`} scroll={false} className="inline-flex items-center gap-1 text-brand hover:underline">
              {e.meeting.title} <ArrowUpRight className="size-3" aria-hidden />
            </Link>
          </KeyValue>
        )}
      </dl>
      {attendees.length > 0 && (
        <div className="border-t border-hairline px-4 py-3">
          <h3 className="eyebrow mb-2">Attendees ({attendees.length})</h3>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {attendees.map((a, i) => {
              const r = RESPONSE_STATUS[a.response as ResponseStatus] ?? RESPONSE_STATUS.NEEDS_ACTION;
              return (
                <li key={`${a.email}-${i}`} className="flex items-center gap-2 text-[13px]">
                  <Avatar name={personLabel(a)} />
                  <span className="min-w-0 flex-1 truncate" title={a.email ?? undefined}>
                    {personLabel(a)}
                  </span>
                  <StatusPill tone={r.tone} label={r.label} />
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {e.description && (
        <div className="border-t border-hairline px-4 py-3">
          <h3 className="eyebrow mb-2">Description</h3>
          <p className="text-[13px] whitespace-pre-wrap text-ink-2">{e.description}</p>
        </div>
      )}
    </Panel>
  );
}

function DocumentContent({ data, timezone }: { data: SourceDetail; timezone: string }) {
  const d = data.item.document!;
  const v = d.versions[0];
  return (
    <Panel
      title="Document"
      icon={FileText}
      actions={
        <Link href={`/documents/${d.id}`} className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-2xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
          Versions & key facts <ArrowUpRight className="size-3" aria-hidden />
        </Link>
      }
    >
      <dl className="grid gap-x-8 px-4 py-2.5 md:grid-cols-2">
        <KeyValue label="Type">{DOCUMENT_TYPES[d.docType].label}</KeyValue>
        <KeyValue label="Format">
          {DOCUMENT_FORMATS[d.format].label}
          {d.sizeBytes ? <span className="text-muted-foreground"> · {formatBytes(d.sizeBytes)}</span> : null}
        </KeyValue>
        <KeyValue label="Version">
          v{d.currentVersion}
          {v?.isSignificant && <span className="ml-2 rounded bg-serious-soft px-1.5 py-0.5 text-2xs font-medium text-serious-ink">Significant change</span>}
        </KeyValue>
        <KeyValue label="Modified">{d.modifiedAtSource ? formatDateTime(d.modifiedAtSource, timezone) : "—"}</KeyValue>
        {d.author && <KeyValue label="Author">{d.author}</KeyValue>}
        {v?.pageCount != null && <KeyValue label="Pages">{v.pageCount}</KeyValue>}
      </dl>
      {v?.changeSummary && (
        <p className="mx-4 mb-3 rounded-md border border-brain/20 bg-brain-soft/60 px-3 py-2 text-xs text-ink-2">
          <span className="font-medium text-brain">Latest change · </span>
          {v.changeSummary}
        </p>
      )}
      <div className="border-t border-hairline px-4 py-4">
        <h3 className="eyebrow mb-2">Extracted text</h3>
        <div className="max-h-[520px] overflow-y-auto scrollbar-thin">
          <BodyText text={data.item.text} purged={Boolean(data.item.contentPurgedAt)} />
        </div>
      </div>
    </Panel>
  );
}
