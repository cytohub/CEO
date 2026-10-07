import Link from "next/link";
import { ArrowUpRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { daysBetween, formatDay, relativeDay } from "@/lib/dates";
import { initials } from "@/lib/format";
import { pillarColorVar } from "@/lib/domain";

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  eyebrow?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pb-5", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A cockpit module: compact header, dense body. */
export function Panel({
  title,
  icon: Icon,
  count,
  href,
  hrefLabel = "View all",
  actions,
  children,
  className,
  bodyClassName,
  id,
}: {
  title: React.ReactNode;
  icon?: LucideIcon;
  count?: number;
  href?: string;
  hrefLabel?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("panel flex min-w-0 flex-col", className)} aria-labelledby={id ? `${id}-title` : undefined}>
      <div className="flex min-h-10 shrink-0 items-center gap-2 border-b border-hairline px-3.5 py-1">
        {Icon && <Icon className="size-3.5 shrink-0 text-ink-3" aria-hidden />}
        <h2 id={id ? `${id}-title` : undefined} className="min-w-0 truncate text-[12.5px] font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        {count !== undefined && <span className="shrink-0 rounded bg-muted px-1.5 text-2xs font-medium text-muted-foreground tabular">{count}</span>}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {actions}
          {href && (
            <Link href={href} className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-2xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={hrefLabel}>
              <span className="max-sm:hidden">{hrefLabel}</span>
              <ArrowUpRight className="size-3" aria-hidden />
            </Link>
          )}
        </div>
      </div>
      <div className={cn("min-h-0 flex-1", bodyClassName)}>{children}</div>
    </section>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact,
}: {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "gap-1.5 px-4 py-6" : "gap-2 px-6 py-14", className)}>
      {Icon && (
        <div className="mb-1 flex size-9 items-center justify-center rounded-full border border-border bg-surface-2">
          <Icon className="size-4 text-ink-3" aria-hidden />
        </div>
      )}
      <p className="text-[13px] font-medium text-foreground">{title}</p>
      {description && <p className="max-w-sm text-xs text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function PillarTag({ name, color, className, compact }: { name: string; color: string; className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 text-xs text-ink-2", className)} title={name}>
      <span aria-hidden className="size-2 shrink-0 rounded-[3px]" style={{ background: pillarColorVar(color) }} />
      <span className={cn("truncate", compact && "max-w-[140px]")}>{name}</span>
    </span>
  );
}

export function Avatar({ name, className, ceo }: { name: string; className?: string; ceo?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold",
        ceo ? "bg-foreground text-background" : "bg-surface-2 text-ink-2 ring-1 ring-border",
        className,
      )}
    >
      {ceo ? "Me" : initials(name.replace(/^(Dr\.|Prof\.)\s+/, ""))}
    </span>
  );
}

export function PersonName({ person, className }: { person: { name: string; isCeo?: boolean } | null | undefined; className?: string }) {
  if (!person) return <span className={cn("text-muted-foreground", className)}>Unassigned</span>;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <Avatar name={person.name} ceo={person.isCeo} />
      <span className="truncate">{person.isCeo ? "You" : person.name}</span>
    </span>
  );
}

/** Due date with an overdue/today tone. Date must be a calendar day. */
export function DueLabel({ date, today, className, done }: { date: Date | null | undefined; today: Date; className?: string; done?: boolean }) {
  if (!date) return <span className={cn("text-muted-foreground", className)}>No date</span>;
  const d = daysBetween(today, date);
  const tone = done ? "text-muted-foreground" : d < 0 ? "text-critical-ink font-medium" : d === 0 ? "text-serious-ink font-medium" : d <= 2 ? "text-foreground" : "text-muted-foreground";
  return (
    <time dateTime={date.toISOString().slice(0, 10)} title={formatDay(date, true)} className={cn("tabular whitespace-nowrap", tone, className)}>
      {done ? formatDay(date) : relativeDay(date, today)}
    </time>
  );
}

export function Sparkline({
  values,
  className,
  width = 96,
  height = 24,
  strokeClass = "stroke-ink-3",
  lastClass = "fill-brand",
}: {
  values: number[];
  className?: string;
  width?: number;
  height?: number;
  strokeClass?: string;
  lastClass?: string;
}) {
  if (values.length < 2) return <div style={{ width, height }} className={className} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 3;
  const pts = values.map((v, i) => [pad + (i * (width - pad * 2)) / (values.length - 1), pad + (1 - (v - min) / span) * (height - pad * 2)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden>
      <path d={d} fill="none" className={cn("stroke-[1.5]", strokeClass)} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r={2.5} className={cn("stroke-surface stroke-[1.5]", lastClass)} />
    </svg>
  );
}

export function Stat({ label, value, hint, className }: { label: string; value: React.ReactNode; hint?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-2xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tracking-tight text-foreground">{value}</div>
      {hint && <div className="mt-0.5 text-2xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function KeyValue({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid grid-cols-[120px_1fr] items-start gap-3 py-1.5 text-[13px]", className)}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-foreground">{children}</dd>
    </div>
  );
}
