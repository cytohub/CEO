import {
  Activity,
  BarChart3,
  Brain,
  CalendarDays,
  CalendarRange,
  CheckSquare,
  ClipboardCheck,
  FileStack,
  Flag,
  FolderOpen,
  Gauge,
  Gavel,
  Handshake,
  Inbox,
  type LucideIcon,
  Mails,
  Milestone,
  NotebookPen,
  Search,
  Settings,
  ShieldAlert,
  Sparkles,
  Sun,
  Target,
  Users,
} from "lucide-react";
import type { Capability } from "@/server/security/rbac";

export type BadgeKey = "inbox" | "decisions" | "overdue" | "followUps" | "review" | "commitments";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Second key of a "g then x" chord. */
  chord?: string;
  badge?: BadgeKey;
  match?: (path: string) => boolean;
  /** Hidden from viewers without this capability (enforced again on the server). */
  capability: Capability;
}

export const NAV_GROUPS: { label: string | null; items: NavItem[] }[] = [
  {
    label: null,
    items: [
      { href: "/", label: "Today", icon: Sun, chord: "t", match: (p) => p === "/", capability: "cockpit.view" },
      { href: "/brain", label: "Brain", icon: Brain, chord: "b", match: (p) => p === "/brain", capability: "brain.view" },
      { href: "/inbox", label: "Inbox", icon: Inbox, chord: "i", badge: "inbox", capability: "cockpit.view" },
      { href: "/brain/review", label: "Review Queue", icon: ClipboardCheck, chord: "q", badge: "review", capability: "review.resolve" },
    ],
  },
  {
    label: "Execute",
    items: [
      { href: "/tasks", label: "Tasks", icon: CheckSquare, chord: "k", badge: "overdue", capability: "workspace.view" },
      { href: "/commitments", label: "Commitments", icon: Handshake, chord: "l", badge: "commitments", capability: "workspace.view" },
      { href: "/decisions", label: "Decisions", icon: Gavel, chord: "d", badge: "decisions", capability: "workspace.view" },
      { href: "/upcoming", label: "Upcoming", icon: CalendarRange, chord: "u", capability: "workspace.view" },
      { href: "/delegation", label: "Delegation", icon: Users, chord: "e", badge: "followUps", capability: "workspace.view" },
    ],
  },
  {
    label: "Strategy",
    items: [
      { href: "/goals", label: "Goals", icon: Target, chord: "g", capability: "workspace.view" },
      { href: "/milestones", label: "Milestones", icon: Milestone, chord: "m", capability: "workspace.view" },
      { href: "/risks", label: "Risks & Opportunities", icon: ShieldAlert, chord: "f", capability: "workspace.view" },
      { href: "/scoreboard", label: "Scoreboard", icon: BarChart3, chord: "s", capability: "workspace.view" },
      { href: "/resources", label: "Resources", icon: FolderOpen, chord: "r", capability: "workspace.view" },
    ],
  },
  {
    label: "Sources",
    items: [
      { href: "/brain/threads", label: "Email Threads", icon: Mails, chord: "h", capability: "brain.view" },
      { href: "/documents", label: "Documents", icon: FileStack, chord: "j", capability: "brain.view" },
      { href: "/brain/ingestion", label: "Ingestion Health", icon: Activity, chord: "n", capability: "health.view" },
    ],
  },
  {
    label: "Review",
    items: [
      { href: "/review/weekly", label: "Weekly Review", icon: NotebookPen, chord: "w", capability: "cockpit.view" },
      { href: "/review/monthly", label: "Monthly Review", icon: CalendarDays, chord: "o", capability: "cockpit.view" },
      { href: "/performance", label: "CEO Performance", icon: Gauge, chord: "p", capability: "performance.view" },
    ],
  },
  {
    label: "Assist",
    items: [
      { href: "/chief-of-staff", label: "Chief of Staff", icon: Sparkles, chord: "c", capability: "chief.use" },
      { href: "/search", label: "Search", icon: Search, chord: "/", capability: "search.use" },
    ],
  },
];

export const SETTINGS_ITEM: NavItem = { href: "/settings", label: "Settings", icon: Settings, chord: ",", capability: "settings.manage" };

export const ALL_NAV: NavItem[] = [...NAV_GROUPS.flatMap((g) => g.items), SETTINGS_ITEM];

/** Navigation filtered to what a viewer may open. */
export function navFor(capabilities: readonly Capability[]) {
  return {
    groups: NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => capabilities.includes(i.capability)) })).filter((g) => g.items.length),
    settings: capabilities.includes(SETTINGS_ITEM.capability) ? SETTINGS_ITEM : null,
    all: ALL_NAV.filter((i) => capabilities.includes(i.capability)),
  };
}

export function isActive(item: NavItem, path: string) {
  return item.match ? item.match(path) : path === item.href || path.startsWith(`${item.href}/`);
}

export const FLAG_ICON = Flag;
