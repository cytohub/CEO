import {
  BarChart3,
  Brain,
  CalendarRange,
  CheckSquare,
  Flag,
  FolderOpen,
  Gauge,
  Gavel,
  Inbox,
  type LucideIcon,
  Milestone,
  NotebookPen,
  Search,
  Settings,
  Sparkles,
  Sun,
  Target,
  CalendarDays,
  Users,
} from "lucide-react";

export type BadgeKey = "inbox" | "decisions" | "overdue" | "followUps";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Second key of a "g then x" chord. */
  chord?: string;
  badge?: BadgeKey;
  match?: (path: string) => boolean;
}

export const NAV_GROUPS: { label: string | null; items: NavItem[] }[] = [
  {
    label: null,
    items: [
      { href: "/", label: "Today", icon: Sun, chord: "t", match: (p) => p === "/" },
      { href: "/brain", label: "Brain", icon: Brain, chord: "b" },
      { href: "/inbox", label: "Inbox", icon: Inbox, chord: "i", badge: "inbox" },
    ],
  },
  {
    label: "Execute",
    items: [
      { href: "/tasks", label: "Tasks", icon: CheckSquare, chord: "k", badge: "overdue" },
      { href: "/decisions", label: "Decisions", icon: Gavel, chord: "d", badge: "decisions" },
      { href: "/upcoming", label: "Upcoming", icon: CalendarRange, chord: "u" },
      { href: "/delegation", label: "Delegation", icon: Users, chord: "e", badge: "followUps" },
    ],
  },
  {
    label: "Strategy",
    items: [
      { href: "/goals", label: "Goals", icon: Target, chord: "g" },
      { href: "/milestones", label: "Milestones", icon: Milestone, chord: "m" },
      { href: "/scoreboard", label: "Scoreboard", icon: BarChart3, chord: "s" },
      { href: "/resources", label: "Resources", icon: FolderOpen, chord: "r" },
    ],
  },
  {
    label: "Review",
    items: [
      { href: "/review/weekly", label: "Weekly Review", icon: NotebookPen, chord: "w" },
      { href: "/review/monthly", label: "Monthly Review", icon: CalendarDays, chord: "o" },
      { href: "/performance", label: "CEO Performance", icon: Gauge, chord: "p" },
    ],
  },
  {
    label: "Assist",
    items: [
      { href: "/chief-of-staff", label: "Chief of Staff", icon: Sparkles, chord: "c" },
      { href: "/search", label: "Search", icon: Search, chord: "/" },
    ],
  },
];

export const SETTINGS_ITEM: NavItem = { href: "/settings", label: "Settings", icon: Settings, chord: "," };

export const ALL_NAV: NavItem[] = [...NAV_GROUPS.flatMap((g) => g.items), SETTINGS_ITEM];

export function isActive(item: NavItem, path: string) {
  return item.match ? item.match(path) : path === item.href || path.startsWith(`${item.href}/`);
}

export const FLAG_ICON = Flag;
