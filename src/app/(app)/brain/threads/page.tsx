import { Handshake, Mails } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, PageHeader } from "@/components/common/bits";
import { StatusPill } from "@/components/common/status";
import { RelevanceBadge } from "@/components/intelligence/badges";
import { personLabel, readPeople } from "@/components/intelligence/model";
import { UrlSearch, UrlSelect } from "@/components/intelligence/url-filters";
import { CeoCategory, Relevance, ThreadStatus } from "@/generated/prisma/enums";
import { formatDateTime, timeAgo } from "@/lib/dates";
import { CEO_CATEGORIES, THREAD_STATUS } from "@/lib/intelligence";
import { getThreads } from "@/server/queries/threads";
import { requirePage } from "@/server/security/session";

export const metadata: Metadata = { title: "Email Threads" };

const RELEVANCE_OPTIONS = [
  { value: "CRITICAL", label: "Critical only" },
  { value: "HIGH", label: "High and above" },
  { value: "NORMAL", label: "Normal and above" },
  { value: "NOISE", label: "Everything (incl. noise)" },
];

export default async function ThreadsPage(props: { searchParams: Promise<{ status?: string; category?: string; relevance?: string; company?: string; q?: string }> }) {
  const viewer = await requirePage("brain.view", "/brain/threads");
  const sp = await props.searchParams;
  const status = sp.status && sp.status in ThreadStatus ? (sp.status as ThreadStatus) : null;
  const category = sp.category && sp.category in CeoCategory ? (sp.category as CeoCategory) : null;
  const minRelevance = sp.relevance && sp.relevance in Relevance ? (sp.relevance as Relevance) : null;
  const companyId = sp.company?.slice(0, 64) || null;
  const q = sp.q?.slice(0, 100) || null;
  const { threads, companies, awaitingYou, ceoEmail, timezone } = await getThreads(viewer, { status, category, minRelevance, companyId, q });
  const filtered = Boolean(status || category || minRelevance || companyId || q);

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <PageHeader
        eyebrow="Sources"
        title="Email Threads"
        description={
          <>
            Conversations CytoHub Brain follows, each with an evolving summary, open questions and the commitments in it. Newsletters and notifications are hidden unless you ask for them.
            {awaitingYou > 0 && (
              <span className="mt-1 block font-medium text-serious-ink">
                {awaitingYou} thread{awaitingYou === 1 ? "" : "s"} awaiting {viewer.role === "CEO" ? "your" : "the CEO’s"} reply
              </span>
            )}
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Suspense>
          <UrlSearch placeholder="Search subjects, summaries, companies…" label="Search threads" />
          <UrlSelect param="status" options={(Object.keys(THREAD_STATUS) as ThreadStatus[]).map((s) => ({ value: s, label: THREAD_STATUS[s].label }))} allLabel="Any status" ariaLabel="Filter by status" className="w-[170px]" />
          <UrlSelect param="category" options={(Object.keys(CEO_CATEGORIES) as CeoCategory[]).map((c) => ({ value: c, label: CEO_CATEGORIES[c].label }))} allLabel="Any category" ariaLabel="Filter by category" className="w-[170px]" />
          <UrlSelect param="relevance" options={RELEVANCE_OPTIONS} allLabel="Hide noise" ariaLabel="Minimum relevance" className="w-[180px]" />
          <UrlSelect param="company" options={companies.map((c) => ({ value: c.id, label: c.name }))} allLabel="All companies" ariaLabel="Filter by company" className="w-[170px]" />
        </Suspense>
        <span className="ml-auto text-2xs text-muted-foreground tabular" aria-live="polite">
          {threads.length} thread{threads.length === 1 ? "" : "s"}
        </span>
      </div>

      {threads.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={Mails}
            title={filtered ? "No threads match" : "No email threads yet"}
            description={filtered ? "Try clearing a filter." : "Connect a mailbox in Settings → Integrations; CytoHub Brain will follow the conversations that matter."}
          />
        </div>
      ) : (
        <ul className="panel divide-y divide-hairline" aria-label="Email threads">
          {threads.map((t) => {
            const st = THREAD_STATUS[t.status];
            const people = readPeople(t.participants).filter((p) => p.email?.toLowerCase() !== ceoEmail);
            return (
              <li key={t.id}>
                <Link href={`/brain/threads/${t.id}`} className="grid gap-x-4 gap-y-1 px-4 py-3 hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none md:grid-cols-[150px_minmax(0,1fr)_auto]">
                  <span className="flex items-start">
                    <StatusPill tone={st.tone} label={st.label} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-medium text-foreground">{t.subject}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-2xs text-muted-foreground">
                      <span className="max-w-[320px] truncate">{people.map(personLabel).slice(0, 3).join(", ") || "—"}</span>
                      {t.company && <span>· {t.company.name}</span>}
                      <span>
                        · {t.messageCount} message{t.messageCount === 1 ? "" : "s"}
                      </span>
                      {t.category && <span>· {CEO_CATEGORIES[t.category].label}</span>}
                      {t._count.commitments > 0 && (
                        <span className="inline-flex items-center gap-1">
                          · <Handshake className="size-3" aria-hidden /> {t._count.commitments}
                        </span>
                      )}
                    </span>
                    {t.summary && <span className="mt-1 line-clamp-1 text-xs text-ink-2">{t.summary}</span>}
                  </span>
                  <span className="flex items-center gap-2 md:flex-col md:items-end md:gap-1">
                    {t.relevance && <RelevanceBadge level={t.relevance} />}
                    <time className="text-2xs text-muted-foreground tabular" dateTime={t.lastMessageAt.toISOString()} title={formatDateTime(t.lastMessageAt, timezone)}>
                      {timeAgo(t.lastMessageAt)}
                    </time>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {!minRelevance && threads.length > 0 && <p className="text-center text-2xs text-muted-foreground">Newsletters, marketing and notifications are hidden — choose “Everything” to include them.</p>}
    </div>
  );
}
