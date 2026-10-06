"use server";

import { attemptAs, ok, type ActionResult } from "@/server/actions/result";
import { getCeoContext } from "@/server/context";
import { auditCsv, auditFiltersSchema, getAuditExportRows } from "@/server/queries/audit";
import { audit } from "@/server/security/audit";
import { requireViewer } from "@/server/security/session";

const exportSchema = auditFiltersSchema.omit({ page: true });

/** CSV of the filtered audit log (capped); the client turns it into a download. The export itself is audited. */
export async function exportAuditCsv(filters: Record<string, string | undefined>): Promise<ActionResult<{ csv: string; filename: string; rows: number; truncated: boolean }>> {
  return attemptAs("audit.view", async () => {
    const f = exportSchema.parse(filters);
    const viewer = await requireViewer();
    const ceo = await getCeoContext();
    const { rows, truncated } = await getAuditExportRows(f, ceo.timezone);
    await audit({ action: "audit.export", viewer, metadata: { filters: f, rows: rows.length, truncated } });
    const stamp = new Date().toISOString().slice(0, 10);
    return ok(
      { csv: auditCsv(rows), filename: `cytohub-audit-${stamp}.csv`, rows: rows.length, truncated },
      truncated ? `Exported the newest ${rows.length.toLocaleString("en-US")} entries — narrow the filters for older ones` : `Exported ${rows.length.toLocaleString("en-US")} entries`,
    );
  });
}
