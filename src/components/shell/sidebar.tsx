"use client";

import { KeyRound, Keyboard, LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { USER_ROLES } from "@/lib/intelligence";
import { Kbd } from "@/components/common/status";
import { Avatar } from "@/components/common/bits";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { logout } from "@/server/actions/auth";
import type { ShellViewer } from "@/server/queries/shell";
import { isActive, navFor, type BadgeKey, type NavItem } from "./nav";
import { useUI } from "./ui-context";

export function CytoHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect x="1" y="1" width="22" height="22" rx="6" className="fill-foreground" />
      <circle cx="12" cy="12" r="6.25" fill="none" strokeWidth="1.8" className="stroke-background" strokeDasharray="30 9.3" strokeLinecap="round" transform="rotate(-30 12 12)" />
      <circle cx="12" cy="12" r="2.1" className="fill-brand" />
    </svg>
  );
}

export function SidebarNav({
  counts,
  viewer,
  onNavigate,
}: {
  counts: Record<BadgeKey, number>;
  viewer: ShellViewer;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { setShortcutsOpen } = useUI();
  const nav = navFor(viewer.capabilities);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center gap-2.5 px-4">
        <CytoHubMark className="size-6" />
        <div className="leading-tight">
          <div className="text-[14px] font-semibold tracking-tight text-foreground">CytoHub</div>
          <div className="text-2xs text-muted-foreground">CEO Command Center</div>
        </div>
      </div>

      <nav aria-label="Primary" className="scrollbar-thin flex-1 overflow-y-auto px-2 pt-2 pb-4">
        {nav.groups.map((group, gi) => (
          <div key={gi} className={cn(gi > 0 && "mt-4")}>
            {group.label && <div className="mb-1 px-2.5 text-2xs font-medium tracking-wide text-ink-3">{group.label}</div>}
            <ul className="space-y-px">
              {group.items.map((item) => (
                <NavLink key={item.href} item={item} active={isActive(item, pathname)} count={item.badge ? counts[item.badge] : 0} onNavigate={onNavigate} />
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-sidebar-border px-2 py-2">
        {nav.settings && (
          <ul className="space-y-px">
            <NavLink item={nav.settings} active={isActive(nav.settings, pathname)} count={0} onNavigate={onNavigate} />
          </ul>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="mt-1 flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13.5px] text-sidebar-foreground/80 hover:bg-sidebar-accent"
              aria-label={`Account menu for ${viewer.name}`}
            >
              <Avatar name={viewer.name} ceo={viewer.isCeo} className="size-5" />
              <span className="min-w-0 flex-1 truncate">{viewer.name}</span>
              <span className="text-2xs text-muted-foreground">{USER_ROLES[viewer.role].label}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="truncate text-[14px] font-medium">{viewer.name}</div>
              <div className="truncate text-2xs text-muted-foreground">{viewer.email}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setShortcutsOpen(true)}>
              <Keyboard /> Keyboard shortcuts <Kbd className="ml-auto">?</Kbd>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/account/password">
                <KeyRound /> Change password
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void logout()}>
              <LogOut /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function NavLink({ item, active, count, onNavigate }: { item: NavItem; active: boolean; count: number; onNavigate?: () => void }) {
  const Icon = item.icon;
  const urgent = item.badge === "overdue" || item.badge === "followUps";
  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[14px] transition-colors",
          active
            ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
            : "text-sidebar-foreground/85 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
        )}
      >
        <Icon className={cn("size-4 shrink-0", active ? "text-foreground" : "text-ink-3 group-hover:text-ink-2")} aria-hidden />
        <span className="flex-1 truncate">{item.label}</span>
        {count > 0 && (
          <span
            className={cn(
              "min-w-5 rounded px-1 text-center text-2xs font-medium tabular",
              urgent ? "bg-critical-soft text-critical-ink" : "bg-sidebar-accent text-ink-2 group-hover:bg-background",
            )}
            aria-label={`${count} ${item.badge}`}
          >
            {count}
          </span>
        )}
      </Link>
    </li>
  );
}
