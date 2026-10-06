import { FileStack } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, PageHeader } from "@/components/common/bits";
import { SensitivityBadge, providerLabel } from "@/components/intelligence/badges";
import { DocFormatIcon } from "@/components/intelligence/documents/format-icon";
import { UploadButton } from "@/components/intelligence/documents/upload-button";
import { UrlSearch, UrlSelect } from "@/components/intelligence/url-filters";
import { DocumentType } from "@/generated/prisma/enums";
import { formatDateTime, timeAgo } from "@/lib/dates";
import { DOCUMENT_FORMATS, DOCUMENT_TYPES } from "@/lib/intelligence";
import { getDocuments } from "@/server/queries/documents";
import { requirePage } from "@/server/security/session";

export const metadata: Metadata = { title: "Documents" };

export default async function DocumentsPage(props: { searchParams: Promise<{ type?: string; company?: string; q?: string; changes?: string }> }) {
  const viewer = await requirePage("brain.view", "/documents");
  const sp = await props.searchParams;
  const type = sp.type && sp.type in DocumentType ? (sp.type as DocumentType) : null;
  const companyId = sp.company?.slice(0, 64) || null;
  const q = sp.q?.slice(0, 100) || null;
  const significant = sp.changes === "significant";
  const { docs, companies, types, timezone } = await getDocuments(viewer, { type, companyId, q, significant });
  const filtered = Boolean(type || companyId || q || significant);

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <PageHeader
        eyebrow="Sources"
        title="Documents"
        description="Decks, models, contracts and reports CytoHub Brain reads — with summaries, key facts and every version, so you see what changed between drafts."
        actions={<UploadButton />}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Suspense>
          <UrlSearch placeholder="Search titles, summaries, authors…" label="Search documents" />
          <UrlSelect param="type" options={types.map((t) => ({ value: t, label: DOCUMENT_TYPES[t].label }))} allLabel="All types" ariaLabel="Filter by type" className="w-[180px]" />
          <UrlSelect param="company" options={companies.map((c) => ({ value: c.id, label: c.name }))} allLabel="All companies" ariaLabel="Filter by company" className="w-[170px]" />
          <UrlSelect param="changes" options={[{ value: "significant", label: "Significant changes" }]} allLabel="Any changes" ariaLabel="Filter by changes" className="w-[170px]" />
        </Suspense>
        <span className="ml-auto text-2xs text-muted-foreground tabular" aria-live="polite">
          {docs.length} document{docs.length === 1 ? "" : "s"}
        </span>
      </div>

      {docs.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={FileStack}
            title={filtered ? "No documents match" : "No documents yet"}
            description={filtered ? "Try clearing a filter." : "Upload a file or connect Google Drive, OneDrive, SharePoint or Dropbox in Settings → Integrations."}
          />
        </div>
      ) : (
        <ul className="panel divide-y divide-hairline" aria-label="Documents">
          {docs.map((d) => {
            const latest = d.versions[0];
            const modified = d.modifiedAtSource ?? d.updatedAt;
            return (
              <li key={d.id}>
                <Link href={`/documents/${d.id}`} className="grid grid-cols-[32px_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 py-3 hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none md:grid-cols-[32px_minmax(0,1fr)_auto]">
                  <DocFormatIcon format={d.format} />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-foreground">{d.title}</span>
                      {latest?.isSignificant && <span className="rounded bg-serious-soft px-1.5 py-0.5 text-2xs font-medium text-serious-ink">Significant change</span>}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-2xs text-muted-foreground">
                      <span>{DOCUMENT_TYPES[d.docType].label}</span>
                      <span>· {DOCUMENT_FORMATS[d.format].label}</span>
                      <span>· v{d.currentVersion}</span>
                      {d.company && <span>· {d.company.name}</span>}
                      {d.author && <span>· {d.author}</span>}
                      <span>· {providerLabel(d.sourceItem.connection.provider)}</span>
                    </span>
                    {(latest?.isSignificant && latest.changeSummary) || d.summary ? <span className="mt-1 line-clamp-1 text-xs text-ink-2">{latest?.isSignificant && latest.changeSummary ? latest.changeSummary : d.summary}</span> : null}
                  </span>
                  <span className="col-start-2 flex items-center gap-2 md:col-start-auto md:flex-col md:items-end md:gap-1">
                    <SensitivityBadge level={d.sensitivity} />
                    <time className="text-2xs text-muted-foreground tabular" dateTime={modified.toISOString()} title={formatDateTime(modified, timezone)}>
                      Modified {timeAgo(modified)}
                    </time>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
