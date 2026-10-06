import type { Metadata } from "next";
import { AdminPage, AdminSection } from "@/components/admin/admin-page";
import { DeletionWorkflow } from "@/components/admin/deletion-workflow";
import { RetentionForm } from "@/components/admin/retention-form";
import { db } from "@/lib/db";
import { getCeoContext } from "@/server/context";
import { DEFAULT_RETENTION, getRetentionPolicy } from "@/server/ingestion/retention-policy";
import { requirePage } from "@/server/security/session";

export const metadata: Metadata = { title: "Retention" };
export const maxDuration = 60;

export default async function RetentionPage() {
  const viewer = await requirePage("retention.manage", "/settings/retention");
  const [policy, ceo] = await Promise.all([getRetentionPolicy(db), getCeoContext()]);

  return (
    <AdminPage
      capabilities={viewer.capabilities}
      current="/settings/retention"
      title="Retention"
      description="How long CytoHub keeps raw content, and what happens when a source is deleted. Provenance snapshots and metadata survive purges, so company history is never silently lost."
    >
      <AdminSection id="policy" title="Retention policy" description="Applied by the nightly sweep. Preview shows what each rule would purge right now.">
        <RetentionForm policy={policy} defaults={DEFAULT_RETENTION} />
      </AdminSection>
      <AdminSection
        id="deletion"
        title="Delete a source item’s data"
        description="For erasure requests and mistakes: trace everything derived from one message, event or document, then redact its content or delete unconfirmed derived records."
      >
        <DeletionWorkflow timezone={ceo.timezone} />
      </AdminSection>
    </AdminPage>
  );
}
