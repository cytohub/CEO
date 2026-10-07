import { ArrowLeft, ExternalLink, FileSearch, FolderOpen, History, Info, ListChecks, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { KeyValue, PageHeader, Panel } from "@/components/common/bits";
import { RelevanceBadge, SensitivityBadge, providerLabel } from "@/components/intelligence/badges";
import { DerivedList } from "@/components/intelligence/derived-list";
import { DocFormatIcon } from "@/components/intelligence/documents/format-icon";
import { UploadButton } from "@/components/intelligence/documents/upload-button";
import { VersionTimeline } from "@/components/intelligence/documents/version-timeline";
import { formatBytes, readKeyFacts, safeHttpUrl } from "@/components/intelligence/model";
import { formatDateTime } from "@/lib/dates";
import { CEO_CATEGORIES, DOCUMENT_FORMATS, DOCUMENT_TYPES } from "@/lib/intelligence";
import { getDocumentDetail } from "@/server/queries/documents";
import { audit } from "@/server/security/audit";
import { requirePage } from "@/server/security/session";

export const metadata: Metadata = { title: "Document" };

export default async function DocumentPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const viewer = await requirePage("search.use", `/documents/${id}`);
  const data = await getDocumentDetail(viewer, id);
  if (!data) notFound();
  await audit({ action: "source.view", viewer, targetType: "Document", targetId: id });
  const { doc: d, timezone } = data;
  const facts = readKeyFacts(d.keyFacts);
  const original = safeHttpUrl(d.url ?? d.sourceItem.externalUrl);
  const latest = d.versions[0];
  const isUpload = d.sourceItem.connection.provider === "LOCAL_UPLOAD";

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <PageHeader
        eyebrow={
          <Link href="/documents" className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="size-3" /> Documents
          </Link>
        }
        title={
          <span className="flex items-start gap-3">
            <DocFormatIcon format={d.format} className="mt-0.5 shrink-0" />
            <span>{d.title}</span>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{DOCUMENT_TYPES[d.docType].label}</span>
            <span>· {DOCUMENT_FORMATS[d.format].label}</span>
            <span>· v{d.currentVersion}</span>
            {d.modifiedAtSource && <span>· modified {formatDateTime(d.modifiedAtSource, timezone)}</span>}
            {d.company && (
              <>
                <span>·</span>
                <Link href={`/resources/companies/${d.company.id}`} className="hover:text-foreground hover:underline">
                  {d.company.name}
                </Link>
              </>
            )}
            <SensitivityBadge level={d.sensitivity} />
            {latest?.isSignificant && <span className="rounded bg-serious-soft px-1.5 py-0.5 text-2xs font-medium text-serious-ink">Significant change</span>}
          </span>
        }
        actions={
          <>
            {isUpload && <UploadButton documentId={d.id} label="New version" variant="outline" />}
            <Button size="sm" variant="outline" asChild>
              <Link href={`/sources/${d.sourceItem.id}`}>
                <FileSearch /> View source
              </Link>
            </Button>
            {d.resource && (
              <Button size="sm" variant="ghost" asChild>
                <Link href={`/resources?resource=${d.resource.id}`}>
                  <FolderOpen /> Resource Center
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

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="min-w-0 space-y-4 xl:col-span-8">
          <section className="panel p-4" aria-labelledby="doc-summary">
            <h2 id="doc-summary" className="mb-1.5 flex items-center gap-1.5 text-2xs font-semibold tracking-wide text-brain uppercase">
              <Sparkles className="size-3" aria-hidden /> Summary
            </h2>
            {d.summary ? <p className="text-[15px] leading-relaxed">{d.summary}</p> : <p className="text-xs text-muted-foreground">No summary yet — CytoHub Brain writes one after parsing.</p>}
            {latest?.changeSummary && latest.version > 1 && latest.changeSummary !== d.summary && (
              <p className="mt-3 rounded-md border border-brain/20 bg-brain-soft/60 px-3 py-2 text-xs text-ink-2">
                <span className="font-medium text-brain">What changed in v{latest.version} · </span>
                {latest.changeSummary}
              </p>
            )}
          </section>

          <Panel title="Key facts" icon={ListChecks} count={facts.length}>
            {facts.length === 0 ? (
              <p className="px-4 py-3 text-xs text-muted-foreground">No key figures extracted.</p>
            ) : (
              <dl className="grid sm:grid-cols-2">
                {facts.map((f, i) => (
                  <div key={`${f.label}-${i}`} className="border-t border-hairline px-4 py-3 first:border-t-0 sm:odd:border-r sm:[&:nth-child(2)]:border-t-0">
                    <dt className="text-2xs text-muted-foreground">{f.label}</dt>
                    <dd className="mt-0.5 text-[17px] font-semibold tabular">{f.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Panel>

          <Panel title="Versions" icon={History} count={d.versions.length}>
            <VersionTimeline versions={d.versions} timezone={timezone} />
          </Panel>

          {d.sourceItem.text && !d.sourceItem.contentPurgedAt && (
            <details className="panel group">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-[14.5px] font-semibold">
                Extracted text
                <span className="text-2xs font-normal text-muted-foreground group-open:hidden">· show</span>
              </summary>
              <div className="max-h-[560px] overflow-y-auto border-t border-hairline px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap scrollbar-thin">{d.sourceItem.text}</div>
            </details>
          )}
        </div>

        <aside className="min-w-0 space-y-4 xl:col-span-4">
          <Panel title="Derived intelligence" icon={Sparkles} count={data.derived.records.length}>
            <DerivedList records={data.derived.records} hidden={data.derived.hidden} emptyDescription="Tasks, risks, insights and changes extracted from this document will appear here." />
          </Panel>
          <Panel title="Details" icon={Info}>
            <dl className="px-3.5 py-2">
              <KeyValue label="Source">
                {providerLabel(d.sourceItem.connection.provider)} <span className="text-muted-foreground">· {d.sourceItem.connection.label}</span>
              </KeyValue>
              {d.author && <KeyValue label="Author">{d.author}</KeyValue>}
              {d.sizeBytes != null && <KeyValue label="Size">{formatBytes(d.sizeBytes)}</KeyValue>}
              {d.path && <KeyValue label="Path">{d.path}</KeyValue>}
              {d.createdAtSource && <KeyValue label="Created">{formatDateTime(d.createdAtSource, timezone)}</KeyValue>}
              {d.docTypeConfidence != null && (
                <KeyValue label="Classified">
                  {DOCUMENT_TYPES[d.docType].label} <span className="text-muted-foreground">· {Math.round(d.docTypeConfidence * 100)}%</span>
                </KeyValue>
              )}
              {d.sourceItem.relevance && (
                <KeyValue label="Relevance">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <RelevanceBadge level={d.sourceItem.relevance} />
                    {d.sourceItem.category && <span className="text-xs text-ink-2">{CEO_CATEGORIES[d.sourceItem.category].label}</span>}
                  </span>
                </KeyValue>
              )}
              {d.project && <KeyValue label="Project">{d.project.name}</KeyValue>}
            </dl>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
