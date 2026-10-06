import type { Metadata } from "next";
import { PageHeader } from "@/components/common/bits";
import { AiSection } from "@/components/settings/ai-section";
import { AppearanceForm } from "@/components/settings/appearance";
import { AttentionTargetsForm } from "@/components/settings/attention-targets";
import { PillarsManager } from "@/components/settings/pillars";
import { PriorityWeightsForm } from "@/components/settings/priority-weights";
import { ProfileForm } from "@/components/settings/profile-form";
import { SettingsSection } from "@/components/settings/section";
import { SettingsNav } from "@/components/settings/settings-nav";
import { SourcesList } from "@/components/settings/sources";
import { ThresholdsForm } from "@/components/settings/thresholds";
import { getCeoContext } from "@/server/context";
import { getSettingsData } from "@/server/queries/settings";
import { DEFAULT_THRESHOLDS } from "@/server/settings";
import { requirePage } from "@/server/security/session";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requirePage("settings.manage", "/settings");
  const [d, ceo] = await Promise.all([getSettingsData(), getCeoContext()]);

  return (
    <div className="mx-auto max-w-[1440px]">
      <PageHeader title="Settings" description="Tune how CytoHub Brain ranks work, measures your attention and what it listens to." />

      <div className="grid gap-6 xl:grid-cols-[188px_minmax(0,1fr)] xl:gap-8">
        <aside className="min-w-0">
          <SettingsNav />
        </aside>

        <div className="min-w-0 max-w-[1080px] space-y-8 pb-16">
          <SettingsSection id="profile" title="Profile" description="Who you are in the command center. Your timezone defines when “today” begins.">
            <ProfileForm profile={d.profile} timezones={d.timezones} />
          </SettingsSection>

          <SettingsSection
            id="pillars"
            title="Strategic pillars"
            description="The top of the execution graph — every goal, milestone and task rolls up to a pillar. Reorder to change how they’re listed everywhere."
          >
            <PillarsManager pillars={d.pillars} />
          </SettingsSection>

          <SettingsSection
            id="attention"
            title="CEO attention targets"
            description="Where your time should go. The Brain compares these targets with your calendar and task effort and flags drift."
          >
            <AttentionTargetsForm rows={d.attention.rows} windowDays={d.attention.windowDays} totalMinutes={d.attention.totalMinutes} strategicPct={d.attention.strategicPct} />
          </SettingsSection>

          <SettingsSection
            id="weights"
            title="CEO Priority Score weights"
            description="How much each factor counts when CytoHub Brain ranks your work. Higher weight means that factor moves tasks up the list."
          >
            <PriorityWeightsForm weights={d.weights} openTaskCount={d.openTaskCount} />
          </SettingsSection>

          <SettingsSection id="thresholds" title="Brain thresholds" description="When the Brain decides something deserves your attention.">
            <ThresholdsForm thresholds={d.thresholds} defaults={DEFAULT_THRESHOLDS} />
          </SettingsSection>

          <SettingsSection
            id="sources"
            title="CytoHub Brain sources"
            description="The systems the Brain reads during each refresh. Connectors activate when their credentials are present in the server environment."
          >
            <SourcesList sources={d.sources} now={ceo.now} timezone={ceo.timezone} />
          </SettingsSection>

          <SettingsSection id="ai" title="AI & automation" description="Claude upgrades the narrative layers; the scheduled refresh keeps the Brain current without you.">
            <AiSection ai={d.ai} />
          </SettingsSection>

          <SettingsSection id="appearance" title="Appearance">
            <AppearanceForm />
          </SettingsSection>
        </div>
      </div>
    </div>
  );
}
