import { Brain, Building2, CalendarClock, CheckSquare, FileText, Gavel, type LucideIcon, Milestone, Target, User } from "lucide-react";
import type { SearchHitType } from "@/server/brain/search";

export const HIT_TYPES: { type: SearchHitType; label: string; plural: string; icon: LucideIcon }[] = [
  { type: "task", label: "Task", plural: "Tasks", icon: CheckSquare },
  { type: "goal", label: "Goal", plural: "Goals", icon: Target },
  { type: "milestone", label: "Milestone", plural: "Milestones", icon: Milestone },
  { type: "decision", label: "Decision", plural: "Decisions", icon: Gavel },
  { type: "meeting", label: "Meeting", plural: "Meetings", icon: CalendarClock },
  { type: "company", label: "Company", plural: "Companies", icon: Building2 },
  { type: "person", label: "Person", plural: "People", icon: User },
  { type: "resource", label: "Resource", plural: "Resources", icon: FileText },
  { type: "insight", label: "Insight", plural: "Brain insights", icon: Brain },
];

/** Splits `text` around case-insensitive occurrences of `query` (no HTML injection). */
export function splitMatches(text: string, query: string): { text: string; match: boolean }[] {
  const q = query.trim();
  if (!q) return [{ text, match: false }];
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // With a capturing group, split() alternates [outside, match, outside, match, …].
  return text
    .split(new RegExp(`(${escaped})`, "gi"))
    .map((t, i) => ({ text: t, match: i % 2 === 1 }))
    .filter((p) => p.text.length > 0);
}

export function Highlight({ text, query }: { text: string; query: string }) {
  return (
    <>
      {splitMatches(text, query).map((p, i) =>
        p.match ? (
          <mark key={i} className="rounded-[3px] bg-warning/25 px-px text-foreground">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}
