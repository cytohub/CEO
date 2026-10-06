import { AlertTriangle, CalendarDays, CheckCircle2, FileText, Mail } from "lucide-react";
import type { Metadata } from "next";
import { AdminPage, AdminSection } from "@/components/admin/admin-page";
import { EmptyState } from "@/components/common/bits";
import { ConnectProviders } from "@/components/integrations/connect-providers";
import { ConnectionCard } from "@/components/integrations/connection-card";
import { SOURCE_PROVIDERS } from "@/lib/intelligence";
import { cn } from "@/lib/utils";
import { providerFromSlug } from "@/server/ingestion/providers/oauth";
import { getIntegrationsData } from "@/server/queries/integrations";
import { requirePage } from "@/server/security/session";

export const metadata: Metadata = { title: "Integrations" };
// "Run sync now" drains the queue for up to 20 s inside the server action.
export const maxDuration = 60;

const KIND_ICON = { EMAIL: Mail, CALENDAR: CalendarDays, DOCUMENTS: FileText } as const;

/** OAuth outcomes the connect/callback routes redirect back with. */
const OAUTH_ERRORS: Record<string, string> = {
  access_denied: "Access wasn’t granted — the sign-in was cancelled or a permission was declined.",
  rate_limited: "Too many connection attempts. Wait a few minutes and try again.",
  invalid_state: "The sign-in expired or didn’t match this browser session. Start again.",
  missing_code: "The provider didn’t return an authorization code. Start again.",
  not_configured: "This provider isn’t configured on the server.",
  invalid_connection: "That connection can’t be reconnected.",
  unknown_provider: "Unknown provider.",
};

type SP = Record<string, string | string[] | undefined>;

function oauthOutcome(sp: SP): { ok: boolean; message: string } | null {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const slug = one(sp.connected) ?? one(sp.provider);
  const provider = slug && /^[a-z-]{2,40}$/.test(slug) ? providerFromSlug(slug) : null;
  const name = provider ? SOURCE_PROVIDERS[provider].label : "The account";
  if (one(sp.connected)) return { ok: true, message: `${name} connected. The first sync runs shortly — or run it now below.` };
  const code = one(sp.error);
  if (!code || !/^[a-z_]{1,40}$/.test(code)) return null;
  return { ok: false, message: `${provider ? `${name}: ` : ""}${OAUTH_ERRORS[code] ?? `The connection failed (${code}).`}` };
}

export default async function IntegrationsPage(props: { searchParams: Promise<SP> }) {
  const viewer = await requirePage("integrations.manage", "/settings/integrations");
  const [data, outcome] = await Promise.all([getIntegrationsData(), props.searchParams.then(oauthOutcome)]);
  const total = data.sections.reduce((s, x) => s + x.connections.length, 0);

  return (
    <AdminPage
      capabilities={viewer.capabilities}
      current="/settings/integrations"
      title="Integrations"
      description="The accounts CytoHub Brain reads: email, calendars and document stores. Access is read-only; credentials are encrypted and never leave the server."
    >
      {outcome && (
        <div
          role={outcome.ok ? "status" : "alert"}
          className={cn("-mt-4 flex items-start gap-2 rounded-lg border px-3.5 py-2.5 text-xs text-foreground", outcome.ok ? "border-good/30 bg-good-soft" : "border-critical/30 bg-critical-soft")}
        >
          {outcome.ok ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-good-ink" aria-hidden /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-critical-ink" aria-hidden />}
          {outcome.message}
        </div>
      )}
      {data.sections.map((section) => (
        <AdminSection
          key={section.kind}
          id={section.kind.toLowerCase()}
          title={section.label}
          description={`${section.description} ${section.connections.length ? `${section.connections.length} connected.` : ""}`}
        >
          <div className="space-y-3">
            {section.connections.length === 0 ? (
              <div className="panel">
                <EmptyState
                  compact
                  icon={KIND_ICON[section.kind]}
                  title={`No ${section.label.toLowerCase()} account connected`}
                  description="Connect an account below — or a demo account to try the pipeline end to end with sample CytoHub data."
                />
              </div>
            ) : (
              section.connections.map((c) => <ConnectionCard key={c.id} c={c} now={data.now} timezone={data.timezone} />)
            )}
            <ConnectProviders providers={section.providers} kindLabel={section.label} />
          </div>
        </AdminSection>
      ))}
      <p className="text-2xs text-muted-foreground">
        {total} connected account{total === 1 ? "" : "s"}
        {data.disconnected ? ` · ${data.disconnected} disconnected (history kept per the retention policy)` : ""}. Times are shown in {data.timezone}.
      </p>
    </AdminPage>
  );
}
