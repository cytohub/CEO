import { Handshake, Lock, Sparkles, Target, type LucideIcon } from "lucide-react";
import { CytoHubMark } from "./sidebar";

function Brand({ className }: { className?: string }) {
  return (
    <div className={className}>
      <div className="flex items-center gap-2.5">
        <CytoHubMark className="size-8" />
        <div className="leading-tight">
          <div className="text-[16px] font-semibold tracking-tight">CytoHub</div>
          <div className="text-xs text-muted-foreground">CEO Command Center</div>
        </div>
      </div>
    </div>
  );
}

function Feature({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2">
        <Icon className="size-3.5 text-foreground" aria-hidden />
      </span>
      <div>
        <div className="text-[14px] font-medium text-foreground">{title}</div>
        <div className="text-[14px] leading-relaxed text-ink-2">{text}</div>
      </div>
    </li>
  );
}

/**
 * Frame for sign-in and password pages: a brand panel (always dark) beside the
 * form on wide screens; on phones, the form with the brand above it.
 */
export function AuthShell({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh bg-background lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <aside className="dark relative hidden overflow-hidden bg-background text-foreground lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <div aria-hidden className="auth-glow pointer-events-none absolute inset-0" />
        <div aria-hidden className="auth-grid pointer-events-none absolute inset-0" />
        <Brand className="relative" />
        <div className="relative max-w-md">
          <p className="text-[30px] leading-[1.15] font-semibold tracking-tight text-foreground">Know what needs you before the day starts.</p>
          <p className="mt-4 text-[15px] leading-relaxed text-ink-2">
            CytoHub Brain reads your email, calendar and documents and turns them into one morning brief, a ranked Top 5 and a record of every commitment.
          </p>
          <ul className="mt-10 space-y-5">
            <Feature icon={Sparkles} title="Daily intelligence brief" text="What changed overnight, what is at risk, and what only you can decide." />
            <Feature icon={Target} title="Today’s Top 5" text="Ranked by CEO impact, not by whoever emailed last." />
            <Feature icon={Handshake} title="Every commitment tracked" text="What you promised and what you are owed, from mail and meetings." />
          </ul>
        </div>
        <p className="relative flex items-center gap-1.5 text-xs text-ink-3">
          <Lock className="size-3" aria-hidden /> Confidential company intelligence. Every sign-in is logged.
        </p>
      </aside>

      <div className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-[380px]">
          <Brand className="mb-8 lg:hidden" />
          {children}
          {footer}
        </div>
      </div>
    </main>
  );
}
