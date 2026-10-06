"use client";

import { Menu, Moon, Search, Sparkles, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { formatTime, timeAgo } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Kbd } from "@/components/common/status";
import type { ShellData } from "@/server/queries/shell";
import { useUI } from "./ui-context";

export function Topbar({ brain, timezone }: { brain: ShellData["brain"]; timezone: string }) {
  const { setCommandOpen, openChief, setMobileNavOpen, viewer } = useUI();
  const canChief = viewer.capabilities.includes("chief.use");
  const canBrain = viewer.capabilities.includes("brain.view");
  return (
    <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-4">
      <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation">
        <Menu />
      </Button>

      <button
        type="button"
        onClick={() => setCommandOpen(true)}
        className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-left text-[13px] text-muted-foreground transition-colors hover:border-input hover:text-foreground sm:max-w-md"
        aria-label="Open command bar"
      >
        <Search className="size-3.5 shrink-0" aria-hidden />
        <span className="flex-1 truncate">Search CytoHub Brain or run a command…</span>
        <span className="hidden items-center gap-0.5 sm:flex">
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      <div className="ml-auto flex items-center gap-1.5">
        {canBrain && <BrainStatusPill brain={brain} timezone={timezone} />}
        {canChief && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" onClick={() => openChief()} className="gap-1.5">
                <Sparkles className="size-3.5 text-brain" aria-hidden />
                <span className="hidden sm:inline">Chief of Staff</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Ask your AI Chief of Staff <Kbd className="ml-1">⌘J</Kbd>
            </TooltipContent>
          </Tooltip>
        )}
        <ThemeToggle />
      </div>
    </header>
  );
}

function BrainStatusPill({ brain, timezone }: { brain: ShellData["brain"]; timezone: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    // Relative time is client-only to avoid hydration mismatch; refresh each minute.
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);
  const healthy = brain.status === "SUCCEEDED" || brain.status === "PARTIAL";
  const stale = !brain.refreshedToday;
  const tone = brain.status === "RUNNING" ? "bg-brand animate-pulse" : !healthy ? "bg-critical" : stale ? "bg-warning" : "bg-good";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href="/brain"
          className="hidden h-8 items-center gap-2 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:flex"
        >
          <span className={cn("size-1.5 rounded-full", tone)} aria-hidden />
          <span className="font-medium text-ink-2">Brain</span>
          <span className="tabular">
            {brain.lastRefreshAt ? (now ? timeAgo(brain.lastRefreshAt, now) : formatTime(brain.lastRefreshAt, timezone)) : "never refreshed"}
          </span>
        </Link>
      </TooltipTrigger>
      <TooltipContent>
        {brain.lastRefreshAt ? `Last Daily Brain Refresh at ${formatTime(brain.lastRefreshAt, timezone)}` : "CytoHub Brain has not run yet"}
        {stale ? " · not refreshed today" : ""}
      </TooltipContent>
    </Tooltip>
  );
}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();
  const dark = mounted && resolvedTheme === "dark";
  return (
    <Button variant="ghost" size="icon-sm" onClick={() => setTheme(dark ? "light" : "dark")} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}>
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}

const noopSubscribe = () => () => {};
/** True only on the client after hydration (no effect-driven re-render). */
export function useMounted() {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}
