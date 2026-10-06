import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/common/bits";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Capability } from "@/server/security/rbac";
import { type AdminHref, adminLinksFor } from "./admin-links";

/**
 * Layout for Settings sub-pages: same header and left rail as Settings, with
 * the rail listing the administration pages this viewer may open.
 */
export function AdminPage({
  capabilities,
  current,
  title,
  description,
  actions,
  children,
}: {
  capabilities: readonly Capability[];
  current: AdminHref;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const general = capabilities.includes("settings.manage") ? [{ href: "/settings", label: "General" }] : [];
  const links = [...general, ...adminLinksFor(capabilities)];
  return (
    <div className="mx-auto max-w-[1440px]">
      <PageHeader
        eyebrow={
          general.length ? (
            <Link href="/settings" className="inline-flex items-center gap-1 hover:text-foreground">
              <ArrowLeft className="size-3" aria-hidden /> Settings
            </Link>
          ) : (
            "Administration"
          )
        }
        title={title}
        description={description}
        actions={actions}
      />
      <div className="grid gap-6 xl:grid-cols-[188px_minmax(0,1fr)] xl:gap-8">
        <aside className="min-w-0">
          <nav aria-label="Administration" className="xl:sticky xl:top-16">
            <ul className="flex flex-wrap gap-1.5 xl:flex-col xl:gap-0.5">
              {links.map((l) => {
                const active = l.href === current;
                return (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "block rounded-md border px-2.5 py-1 text-xs transition-colors xl:border-transparent xl:py-1.5 xl:text-[13px]",
                        active
                          ? "border-border bg-surface font-medium text-foreground xl:bg-muted"
                          : "border-border bg-surface text-muted-foreground hover:bg-muted hover:text-foreground xl:bg-transparent",
                      )}
                    >
                      {l.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </aside>
        <div className="min-w-0 max-w-[1080px] space-y-8 pb-16">{children}</div>
      </div>
    </div>
  );
}

/** A titled block inside an admin page (mirrors SettingsSection). */
export function AdminSection({
  id,
  title,
  description,
  actions,
  children,
  className,
}: {
  id: string;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className={cn("scroll-mt-16", className)}>
      <div className="mb-2.5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 id={`${id}-heading`} className="text-[15px] font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          {description && <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** Skeleton for admin pages (loading.tsx). */
export function AdminPageSkeleton({ label, blocks = [220, 360] }: { label: string; blocks?: number[] }) {
  return (
    <div className="mx-auto max-w-[1440px]" aria-busy aria-label={`Loading ${label}`}>
      <Skeleton className="h-3 w-16" />
      <Skeleton className="mt-2 h-7 w-48" />
      <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      <div className="mt-7 grid gap-6 xl:grid-cols-[188px_minmax(0,1fr)] xl:gap-8">
        <div className="hidden space-y-2 xl:block">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-6 w-36" />
          ))}
        </div>
        <div className="max-w-[1080px] space-y-8">
          {blocks.map((h, i) => (
            <div key={i} className="space-y-2.5">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-3.5 w-80 max-w-full" />
              <Skeleton className="w-full rounded-lg" style={{ height: h }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
