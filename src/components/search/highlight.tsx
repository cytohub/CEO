import {
  Brain,
  Building2,
  CalendarClock,
  CalendarDays,
  CheckSquare,
  CircleDollarSign,
  FileSearch,
  FileStack,
  FileText,
  FolderKanban,
  Gavel,
  Handshake,
  type LucideIcon,
  Mail,
  Milestone,
  NotebookPen,
  ShieldAlert,
  StickyNote,
  Target,
  TrendingUp,
  User,
} from "lucide-react";
import { RESULT_LABELS, type SearchResultType, type SnippetPart } from "@/server/ingestion/search/types";

export const RESULT_ICONS: Record<SearchResultType, LucideIcon> = {
  thread: Mail,
  document: FileText,
  event: CalendarDays,
  notes: NotebookPen,
  source: FileSearch,
  commitment: Handshake,
  task: CheckSquare,
  meeting: CalendarClock,
  decision: Gavel,
  milestone: Milestone,
  goal: Target,
  deal: CircleDollarSign,
  risk: ShieldAlert,
  opportunity: TrendingUp,
  company: Building2,
  person: User,
  project: FolderKanban,
  resource: FileStack,
  note: StickyNote,
  insight: Brain,
};

/** Display order and labels for every result type. */
export const HIT_TYPES: { type: SearchResultType; label: string; plural: string; icon: LucideIcon }[] = (Object.keys(RESULT_ICONS) as SearchResultType[]).map((type) => ({
  type,
  label: RESULT_LABELS[type].label,
  plural: RESULT_LABELS[type].plural,
  icon: RESULT_ICONS[type],
}));

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Splits `text` around case-insensitive occurrences of the query or any of the terms (no HTML injection). */
export function splitMatches(text: string, query: string | string[]): { text: string; match: boolean }[] {
  const terms = (Array.isArray(query) ? query : [query]).map((t) => t.trim()).filter((t) => t.length >= 2);
  if (!terms.length) return [{ text, match: false }];
  const pattern = [...new Set(terms)].sort((a, b) => b.length - a.length).map(escapeRe).join("|");
  // With a capturing group, split() alternates [outside, match, outside, match, …].
  return text
    .split(new RegExp(`(${pattern})`, "gi"))
    .map((t, i) => ({ text: t, match: i % 2 === 1 }))
    .filter((p) => p.text.length > 0);
}

const MARK = "rounded-[3px] bg-warning/25 px-px text-foreground";

export function Highlight({ text, query }: { text: string; query: string | string[] }) {
  return (
    <>
      {splitMatches(text, query).map((p, i) =>
        p.match ? (
          <mark key={i} className={MARK}>
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

/** Renders pre-split snippet parts (from ts_headline or term matching) as text + <mark>. */
export function HighlightParts({ parts }: { parts: SnippetPart[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.match ? (
          <mark key={i} className={MARK}>
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}
