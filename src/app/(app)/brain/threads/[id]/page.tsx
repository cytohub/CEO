import { ArrowLeft, ArrowUpRight, Lock, Paperclip, Sparkles, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar, PageHeader, Panel } from "@/components/common/bits";
import { AttentionBadge, RelevanceBadge, SensitivityBadge, providerLabel } from "@/components/intelligence/badges";
import { DerivedList } from "@/components/intelligence/derived-list";
import { MESSAGE_DIRECTION } from "@/components/intelligence/labels";
import { formatBytes, personLabel, readPeople } from "@/components/intelligence/model";
import { ThreadSummaryCard } from "@/components/intelligence/thread-summary";
import { ViewSourceButton } from "@/components/intelligence/view-source";
import { formatDateTime } from "@/lib/dates";
import { CEO_CATEGORIES } from "@/lib/intelligence";
import { cn } from "@/lib/utils";
import { getThreadDetail } from "@/server/queries/threads";
import { audit } from "@/server/security/audit";
import { requirePage } from "@/server/security/session";

export const metadata: Metadata = { title: "Email thread" };

export default async function ThreadPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const viewer = await requirePage("brain.view", `/brain/threads/${id}`);
  const data = await getThreadDetail(viewer, id);
  if (!data) notFound();
  await audit({ action: "source.view", viewer, targetType: "EmailThread", targetId: id, metadata: { messages: data.messages.length } });
  const t = data.thread;
  const participants = readPeople(t.participants);

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <PageHeader
        eyebrow={
          <Link href="/brain/threads" className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="size-3" /> Email Threads
          </Link>
        }
        title={t.subject}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {t.relevance && <RelevanceBadge level={t.relevance} />}
            {t.category && <span>{CEO_CATEGORIES[t.category].label}</span>}
            {t.company && (
              <>
                <span>·</span>
                <Link href={`/resources/companies/${t.company.id}`} className="hover:text-foreground hover:underline">
                  {t.company.name}
                </Link>
              </>
            )}
            {t.deal && <span>· {t.deal.name} ({t.deal.stage})</span>}
            <span>
              · {t.messageCount} message{t.messageCount === 1 ? "" : "s"} · {providerLabel(t.connection.provider)}
            </span>
            {t.sensitivity !== "CONFIDENTIAL" && <SensitivityBadge level={t.sensitivity} />}
          </span>
        }
      />

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="min-w-0 space-y-4 xl:col-span-8">
          <ThreadSummaryCard data={data} />

          <section aria-labelledby="messages-title" className="space-y-2">
            <h2 id="messages-title" className="flex items-center gap-2 pt-1 text-[13px] font-semibold">
              Messages
              <span className="rounded bg-muted px-1.5 text-2xs font-medium text-muted-foreground tabular">{data.messages.length}</span>
            </h2>
            {data.hiddenMessages > 0 && (
              <p className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                <Lock className="size-3" aria-hidden /> {data.hiddenMessages} message{data.hiddenMessages === 1 ? "" : "s"} hidden by your access level
              </p>
            )}
            <ol className="relative space-y-3 before:absolute before:top-3 before:bottom-3 before:left-[15px] before:w-px before:bg-border">
              {data.messages.map((m) => {
                const to = readPeople(m.to);
                const cc = readPeople(m.cc);
                const fromCeo = m.fromEmail.toLowerCase() === data.ceoEmail;
                return (
                  <li key={m.id} className="relative flex gap-3">
                    <Avatar name={m.fromName ?? m.fromEmail} ceo={fromCeo} className="relative z-[1] mt-3 size-[30px] text-2xs ring-4 ring-background" />
                    <article className={cn("panel min-w-0 flex-1", m.direction === "OUTBOUND" && "bg-surface-2/50")} aria-label={`Message from ${m.fromName ?? m.fromEmail}`}>
                      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-hairline px-3.5 py-2">
                        <span className="text-[13px] font-medium">{fromCeo ? "You" : (m.fromName ?? m.fromEmail)}</span>
                        <span className="text-2xs text-muted-foreground">{MESSAGE_DIRECTION[m.direction]}</span>
                        {m.sourceItem.attention && <AttentionBadge level={m.sourceItem.attention} />}
                        <time className="ml-auto text-2xs text-muted-foreground tabular" dateTime={m.sentAt.toISOString()}>
                          {formatDateTime(m.sentAt, data.timezone)}
                        </time>
                      </header>
                      <div className="px-3.5 py-3">
                        <p className="mb-2 text-2xs text-muted-foreground">
                          To {to.map(personLabel).join(", ") || "—"}
                          {cc.length > 0 && ` · Cc ${cc.map(personLabel).join(", ")}`}
                        </p>
                        {m.sourceItem.contentPurgedAt ? (
                          <p className="text-xs text-muted-foreground">Content purged by the retention policy.</p>
                        ) : (
                          <div className="max-w-[72ch] text-[13px] leading-relaxed whitespace-pre-wrap">{m.sourceItem.text ?? m.sourceItem.snippet ?? ""}</div>
                        )}
                        {m.attachments.length > 0 && (
                          <ul className="mt-3 flex flex-wrap gap-1.5">
                            {m.attachments.map((a) => (
                              <li key={a.id}>
                                {a.documentId ? (
                                  <Link href={`/documents/${a.documentId}`} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
                                    <Paperclip className="size-3 text-ink-3" aria-hidden /> {a.filename}
                                    <span className="text-2xs text-muted-foreground">{formatBytes(a.sizeBytes)}</span>
                                  </Link>
                                ) : (
                                  <span className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">
                                    <Paperclip className="size-3" aria-hidden /> {a.filename}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <footer className="flex items-center gap-1 border-t border-hairline px-2 py-1">
                        <ViewSourceButton targetType="SOURCE_ITEM" targetId={m.sourceItem.id} label="View source" />
                        <Link href={`/sources/${m.sourceItem.id}`} className="ml-auto inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-2xs text-muted-foreground hover:bg-muted hover:text-foreground">
                          Full source <ArrowUpRight className="size-3" aria-hidden />
                        </Link>
                      </footer>
                    </article>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>

        <aside className="min-w-0 space-y-4 xl:col-span-4">
          <Panel title="Related records" icon={Sparkles} count={data.derived.records.length}>
            <DerivedList records={data.derived.records} hidden={data.derived.hidden} emptyTitle="Nothing derived yet" emptyDescription="Tasks, commitments, risks and decisions extracted from these messages will appear here." />
          </Panel>
          <Panel title="Participants" icon={Users} count={participants.length}>
            <ul className="space-y-1.5 p-3">
              {participants.map((p, i) => (
                <li key={`${p.email}-${i}`} className="flex items-center gap-2 text-[13px]">
                  <Avatar name={personLabel(p)} ceo={p.email?.toLowerCase() === data.ceoEmail} />
                  {p.personId ? (
                    <Link href={`/resources/people/${p.personId}`} className="truncate hover:underline">
                      {personLabel(p)}
                    </Link>
                  ) : (
                    <span className="truncate">{p.email?.toLowerCase() === data.ceoEmail ? "You" : personLabel(p)}</span>
                  )}
                  {p.email && <span className="ml-auto truncate text-2xs text-muted-foreground">{p.email}</span>}
                </li>
              ))}
            </ul>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
