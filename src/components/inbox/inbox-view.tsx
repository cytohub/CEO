"use client";

import { AlarmClock, ArrowRight, Check, CornerUpLeft, ExternalLink, EyeOff, FileSearch, Inbox as InboxIcon, ListPlus, Lock, MoreHorizontal, Sparkles, Target, UserPlus, X, Zap } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DueLabel, EmptyState } from "@/components/common/bits";
import { AttentionBadge, ConfidenceBadge, SourceKindIcon, providerLabel } from "@/components/intelligence/badges";
import { TONE_SOFT, TONE_TEXT } from "@/components/common/status";
import { useAction } from "@/components/common/use-action";
import { useUI } from "@/components/shell/ui-context";
import { addDays, dayKey, formatDateTime, formatDay, startOfWeek, timeAgo } from "@/lib/dates";
import { INBOX_TYPES } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { convertInboxToTask, dismissInboxItem, reopenInboxItem, resolveInboxItem, snoozeInboxItem } from "@/server/actions/inbox";
import type { InboxEntry } from "@/server/queries/inbox";

/** `now` is the server's render time, so relative times hydrate identically. */
export function InboxView({ items, today, now, timezone, status }: { items: InboxEntry[]; today: Date; now: Date; timezone: string; status: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selectedId = params.get("item") ?? items[0]?.id ?? null;
  const selected = items.find((i) => i.id === selectedId) ?? null;

  const select = (id: string) => {
    const p = new URLSearchParams(params.toString());
    p.set("item", id);
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };

  // j / k to move through the inbox.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || document.querySelector("[role=dialog]")) return;
      const idx = items.findIndex((i) => i.id === selectedId);
      if (e.key === "j" && idx < items.length - 1) select(items[idx + 1].id);
      if (e.key === "k" && idx > 0) select(items[idx - 1].id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (items.length === 0) {
    return (
      <div className="panel">
        <EmptyState icon={InboxIcon} title={status === "OPEN" ? "Inbox zero" : "Nothing here"} description={status === "OPEN" ? "Nothing needs your attention right now. CytoHub Brain will file new items on the next refresh." : undefined} />
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <ul className="panel max-h-[calc(100dvh-220px)] divide-y divide-hairline overflow-y-auto scrollbar-thin" aria-label="Inbox items">
        {items.map((i) => {
          const meta = INBOX_TYPES[i.type];
          const active = i.id === selectedId;
          return (
            <li key={i.id}>
              <button
                type="button"
                onClick={() => select(i.id)}
                aria-current={active ? "true" : undefined}
                className={cn("flex w-full gap-3 px-3.5 py-3 text-left transition-colors", active ? "bg-muted" : "hover:bg-muted/50")}
              >
                <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md", TONE_SOFT[meta.tone])}>
                  <meta.icon className={cn("size-3.5", TONE_TEXT[meta.tone])} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-2xs font-medium text-muted-foreground">{meta.label}</span>
                    <Urgency value={i.urgency} />
                    {i.attention && <AttentionBadge level={i.attention} className="h-4 px-1.5" />}
                    <span className="ml-auto shrink-0 text-2xs text-muted-foreground tabular">{timeAgo(i.createdAt, now)}</span>
                  </span>
                  <span className="mt-0.5 line-clamp-2 text-[13px] leading-snug font-medium text-foreground">{i.title}</span>
                  <span className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{i.recommendedAction}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {selected ? <InboxDetail key={selected.id} item={selected} today={today} now={now} timezone={timezone} /> : null}
    </div>
  );
}

function Urgency({ value }: { value: number }) {
  return (
    <span className="flex gap-0.5" aria-label={`Urgency ${value} of 5`} title={`Urgency ${value}/5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={cn("h-2 w-1 rounded-[1px]", n <= value ? (value >= 5 ? "bg-critical" : value >= 4 ? "bg-serious" : "bg-ink-3") : "bg-track")} />
      ))}
    </span>
  );
}

function InboxDetail({ item: i, today, now, timezone }: { item: InboxEntry; today: Date; now: Date; timezone: string }) {
  const meta = INBOX_TYPES[i.type];
  const { openEntity, openDelegate } = useUI();
  const router = useRouter();
  const { pending, run } = useAction();
  const [note, setNote] = useState("");
  const open = i.status === "OPEN";
  const nextMonday = addDays(startOfWeek(today), 7);
  // Items written by the ingestion pipeline carry attention, confidence and a source.
  const ingested = Boolean(i.attention || i.confidence || i.sourceItemId);
  const takeAction: { label: string; run: () => void } = i.decision
    ? { label: "Make the decision", run: () => router.push(`/decisions/${i.decision!.id}`) }
    : i.commitment
      ? { label: "Open commitment", run: () => router.push(`/commitments?highlight=${i.commitment!.id}`) }
      : i.task
        ? { label: "Open task", run: () => openEntity("task", i.task!.id) }
        : i.risk
          ? { label: "Open risk", run: () => router.push(`/risks?highlight=${i.risk!.id}`) }
          : i.opportunity
            ? { label: "Open opportunity", run: () => router.push(`/risks?tab=opportunities&highlight=${i.opportunity!.id}`) }
            : { label: "Convert to task", run: () => run(() => convertInboxToTask(i.id), { onSuccess: (d) => openEntity("task", d.taskId) }) };
  const delegate = () =>
    run(() => convertInboxToTask(i.id), {
      success: "Converted — choose who should own it",
      onSuccess: (d) => openDelegate(d.taskId),
    });

  const related: { label: string; kind: string; href?: string; onClick?: () => void }[] = [
    i.decision && { kind: "Decision", label: i.decision.title, href: `/decisions/${i.decision.id}` },
    i.task && { kind: "Task", label: i.task.title, onClick: () => openEntity("task", i.task!.id) },
    i.commitment && { kind: "Commitment", label: i.commitment.title, href: `/commitments?highlight=${i.commitment.id}` },
    i.risk && { kind: "Risk", label: i.risk.title, href: `/risks?highlight=${i.risk.id}` },
    i.opportunity && { kind: "Opportunity", label: i.opportunity.title, href: `/risks?tab=opportunities&highlight=${i.opportunity.id}` },
    i.goal && { kind: "Goal", label: i.goal.title, href: `/goals/${i.goal.id}` },
    i.company && { kind: "Company", label: i.company.name, href: `/resources/companies/${i.company.id}` },
    i.person && { kind: "Person", label: `${i.person.name}${i.person.title ? ` · ${i.person.title}` : ""}`, href: `/resources/people/${i.person.id}` },
    i.deal && { kind: "Deal", label: `${i.deal.name} · ${i.deal.stage}`, href: i.companyId ? `/resources/companies/${i.companyId}` : undefined },
  ].filter(Boolean) as { label: string; kind: string; href?: string; onClick?: () => void }[];

  return (
    <article className="panel flex min-w-0 flex-col" aria-labelledby="inbox-detail-title">
      <header className="border-b border-hairline px-5 py-4">
        <div className="flex items-center gap-2 text-xs">
          <meta.icon className={cn("size-3.5", TONE_TEXT[meta.tone])} aria-hidden />
          <span className="font-medium text-ink-2">{meta.label}</span>
          <Urgency value={i.urgency} />
          {i.dueDate && <span className="text-muted-foreground">· respond by {formatDay(i.dueDate)}</span>}
          <span className="ml-auto text-2xs text-muted-foreground">Filed {formatDateTime(i.createdAt, timezone)}</span>
        </div>
        <h2 id="inbox-detail-title" className="mt-2 text-lg leading-snug font-semibold tracking-tight">
          {i.title}
        </h2>
        {i.summary && <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{i.summary}</p>}
        {ingested && (
          <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-2xs text-muted-foreground">
            {i.attention && <AttentionBadge level={i.attention} />}
            {i.confidence && <ConfidenceBadge level={i.confidence} />}
            {i.strategicRelevance && (
              <span className="inline-flex items-center gap-1 text-ink-2" title="Strategic relevance">
                <Target className="size-3 text-ink-3" aria-hidden /> {i.strategicRelevance}
              </span>
            )}
            {i.dueDate && (
              <span className="inline-flex items-center gap-1">
                Deadline <DueLabel date={i.dueDate} today={today} />
              </span>
            )}
          </div>
        )}
        {i.source ? (
          <p className="mt-2 flex items-center gap-1.5 text-2xs text-muted-foreground">
            <SourceKindIcon kind={i.source.kind} className="size-3" />
            <span className="font-medium text-ink-2">{providerLabel(i.source.provider)}</span>
            {i.source.author && <span>· {i.source.author}</span>}
            <span>· {timeAgo(i.source.occurredAt, now)}</span>
          </p>
        ) : (
          i.sourceHidden && (
            <p className="mt-2 flex items-center gap-1.5 text-2xs text-muted-foreground">
              <Lock className="size-3" aria-hidden /> Source hidden by your access level
            </p>
          )
        )}
      </header>

      <div className="space-y-4 px-5 py-4">
        <section className="rounded-lg border border-border bg-surface-2/60 p-3.5">
          <h3 className="text-2xs font-semibold tracking-wide text-ink-3 uppercase">Why this needs CEO attention</h3>
          <p className="mt-1 text-[13px] leading-relaxed">{i.whyCeo}</p>
        </section>
        <section className="rounded-lg border border-brain/25 bg-brain-soft/60 p-3.5">
          <h3 className="flex items-center gap-1.5 text-2xs font-semibold tracking-wide text-brain uppercase">
            <Sparkles className="size-3" aria-hidden /> Recommended action
          </h3>
          <p className="mt-1 text-[13px] leading-relaxed font-medium">{i.recommendedAction}</p>
        </section>

        {related.length > 0 && (
          <section>
            <h3 className="eyebrow mb-2">Related information</h3>
            <ul className="divide-y divide-hairline rounded-lg border border-border">
              {related.map((r) => (
                <li key={r.kind + r.label}>
                  {r.href ? (
                    <Link href={r.href} className="flex items-center gap-3 px-3 py-2 text-[13px] hover:bg-muted/50">
                      <span className="w-16 shrink-0 text-2xs text-muted-foreground">{r.kind}</span>
                      <span className="min-w-0 flex-1 truncate">{r.label}</span>
                      <ExternalLink className="size-3.5 text-ink-3" aria-hidden />
                    </Link>
                  ) : (
                    <button type="button" onClick={r.onClick} className="flex w-full items-center gap-3 px-3 py-2 text-left text-[13px] hover:bg-muted/50">
                      <span className="w-16 shrink-0 text-2xs text-muted-foreground">{r.kind}</span>
                      <span className="min-w-0 flex-1 truncate">{r.label}</span>
                      <ArrowRight className="size-3.5 text-ink-3" aria-hidden />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {i.insight?.signal && (
          <p className="text-2xs text-muted-foreground">
            Source: {i.insight.signal.source.name} · {formatDateTime(i.insight.signal.occurredAt, timezone)} — “{i.insight.signal.title}”
          </p>
        )}
        {!open && i.resolution && (
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-ink-2">
            {i.status === "SNOOZED" && i.snoozedUntil ? `Snoozed until ${formatDateTime(i.snoozedUntil, timezone)}` : `Resolution: ${i.resolution}`}
          </p>
        )}
      </div>

      {ingested && open ? (
        <footer className="mt-auto space-y-2.5 border-t border-hairline px-5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={pending} onClick={takeAction.run} title={takeAction.label}>
              <Zap /> Take action
              <span className="hidden font-normal opacity-70 sm:inline">· {takeAction.label}</span>
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={delegate}>
              <UserPlus /> Delegate
            </Button>
            <SnoozeButton disabled={pending} today={today} nextMonday={nextMonday} onSnooze={(d) => run(() => snoozeInboxItem(i.id, dayKey(d)))} />
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => dismissInboxItem(i.id))}>
              <EyeOff /> Ignore
            </Button>
            <Button size="sm" variant="ghost" onClick={() => openEntity("provenance", `INBOX_ITEM:${i.id}`)}>
              <FileSearch /> Open source
            </Button>
          </div>
          <div className="flex min-w-[220px] gap-2">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Resolution note (optional)" aria-label="Resolution note" className="h-8" />
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => resolveInboxItem(i.id, note || null))}>
              <Check /> Done
            </Button>
          </div>
        </footer>
      ) : (
        <footer className="mt-auto flex flex-wrap items-center gap-2 border-t border-hairline px-5 py-3">
          {open ? (
            <>
              <div className="flex min-w-[220px] flex-1 gap-2">
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Resolution note (optional)" aria-label="Resolution note" className="h-8" />
                <Button size="sm" disabled={pending} onClick={() => run(() => resolveInboxItem(i.id, note || null))}>
                  <Check /> Done
                </Button>
              </div>
              {i.decision ? (
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/decisions/${i.decision.id}`}>Make the decision</Link>
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => run(() => convertInboxToTask(i.id), { onSuccess: (d) => openEntity("task", d.taskId) })}
                >
                  <ListPlus /> Convert to task
                </Button>
              )}
              <Popover>
                <PopoverTrigger asChild>
                  <Button size="sm" variant="outline" disabled={pending}>
                    <AlarmClock /> Snooze
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-48 p-1">
                  {[
                    ["Tomorrow", addDays(today, 1)],
                    ["In 3 days", addDays(today, 3)],
                    ["Next week", nextMonday],
                  ].map(([label, d]) => (
                    <button key={label as string} type="button" onClick={() => run(() => snoozeInboxItem(i.id, dayKey(d as Date)))} className="flex w-full justify-between rounded px-2 py-1.5 text-left text-[13px] hover:bg-muted">
                      {label as string}
                      <span className="text-2xs text-muted-foreground">{formatDay(d as Date)}</span>
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon-sm" variant="ghost" aria-label="More actions">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() =>
                      run(() => convertInboxToTask(i.id), {
                        success: "Converted — choose who should own it",
                        onSuccess: (d) => openDelegate(d.taskId),
                      })
                    }
                  >
                    <UserPlus /> Delegate…
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => run(() => dismissInboxItem(i.id))}>
                    <X /> Dismiss — not for me
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => reopenInboxItem(i.id))}>
                <CornerUpLeft /> Move back to inbox
              </Button>
              {ingested && (
                <Button size="sm" variant="ghost" onClick={() => openEntity("provenance", `INBOX_ITEM:${i.id}`)}>
                  <FileSearch /> Open source
                </Button>
              )}
            </>
          )}
        </footer>
      )}
    </article>
  );
}

function SnoozeButton({ disabled, today, nextMonday, onSnooze }: { disabled: boolean; today: Date; nextMonday: Date; onSnooze: (d: Date) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled}>
          <AlarmClock /> Snooze
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-48 p-1">
        {(
          [
            ["Tomorrow", addDays(today, 1)],
            ["In 3 days", addDays(today, 3)],
            ["Next week", nextMonday],
          ] as const
        ).map(([label, d]) => (
          <button key={label} type="button" onClick={() => onSnooze(d)} className="flex w-full justify-between rounded px-2 py-1.5 text-left text-[13px] hover:bg-muted">
            {label}
            <span className="text-2xs text-muted-foreground">{formatDay(d)}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
