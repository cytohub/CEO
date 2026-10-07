import { cn } from "@/lib/utils";

export const SETTINGS_SECTIONS = [
  { id: "profile", label: "Profile" },
  { id: "pillars", label: "Strategic pillars" },
  { id: "attention", label: "Attention targets" },
  { id: "weights", label: "Priority Score weights" },
  { id: "thresholds", label: "Brain thresholds" },
  { id: "sources", label: "Brain sources" },
  { id: "ai", label: "AI & automation" },
  { id: "appearance", label: "Appearance" },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

/** A titled settings block: heading + description above a panel. */
export function SettingsSection({
  id,
  title,
  description,
  actions,
  children,
  className,
}: {
  id: SettingsSectionId;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={`settings-${id}-heading`} data-settings-section className={cn("scroll-mt-16", className)}>
      <div className="mb-2.5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 id={`settings-${id}-heading`} className="text-[16px] font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          {description && <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** Footer row inside a settings panel: hint on the left, actions on the right. */
export function SectionFooter({ hint, children, className }: { hint?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-hairline px-4 py-2.5", className)}>
      <div className="min-w-0 text-2xs text-muted-foreground">{hint}</div>
      {children && <div className="ml-auto flex items-center gap-2">{children}</div>}
    </div>
  );
}
