/**
 * Small, label-carrying badges for ingestion metadata. No hooks — usable from
 * server and client components. Status is never color-alone.
 */
import {
  AlarmClock,
  Building2,
  CalendarDays,
  CheckSquare,
  FileDiff,
  FileText,
  Gavel,
  GitMerge,
  Handshake,
  Landmark,
  Lightbulb,
  Lock,
  Mail,
  NotebookPen,
  PencilLine,
  ShieldAlert,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import type { AttentionLevel, Confidence, ReferenceRole, Relevance, ReviewKind, Sensitivity, SourceItemKind, SourceProvider } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";
import { ATTENTION_LEVELS, CONFIDENCE, confidenceFromScore, RELEVANCE, SENSITIVITY, SOURCE_ITEM_KINDS, SOURCE_PROVIDERS } from "@/lib/intelligence";
import { TONE_DOT, TONE_SOFT, TONE_TEXT, ToneDot } from "@/components/common/status";
import { severityLabel, severityTone } from "./model";

const chip = "inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-2xs font-medium whitespace-nowrap";

export const SOURCE_KIND_ICON: Record<SourceItemKind, LucideIcon> = {
  EMAIL_MESSAGE: Mail,
  CALENDAR_EVENT: CalendarDays,
  DOCUMENT: FileText,
  MEETING_NOTES: NotebookPen,
};

export const REVIEW_KIND_ICON: Record<ReviewKind, LucideIcon> = {
  TASK: CheckSquare,
  COMMITMENT: Handshake,
  DEADLINE: AlarmClock,
  DECISION: Gavel,
  RISK: ShieldAlert,
  OPPORTUNITY: Lightbulb,
  MEETING: CalendarDays,
  ENTITY_MERGE: GitMerge,
  NEW_PERSON: UserPlus,
  NEW_COMPANY: Building2,
  NEW_INVESTOR: Landmark,
  FIELD_CHANGE: PencilLine,
  DOCUMENT_CHANGE: FileDiff,
};

export const REFERENCE_ROLE: Record<ReferenceRole, string> = {
  CREATED_FROM: "Created from",
  UPDATED_FROM: "Updated from",
  CORROBORATED_BY: "Corroborated by",
};

export function SourceKindIcon({ kind, className }: { kind: SourceItemKind; className?: string }) {
  const Icon = SOURCE_KIND_ICON[kind] ?? FileText;
  return <Icon className={cn("size-3.5 text-ink-3", className)} aria-label={SOURCE_ITEM_KINDS[kind]?.label} />;
}

export function providerLabel(provider: SourceProvider | null | undefined): string {
  return provider ? (SOURCE_PROVIDERS[provider]?.label ?? provider) : "Source";
}

/** "82% · High" — score when known, level otherwise. */
export function ConfidenceBadge({ level, score, className, compact }: { level?: Confidence | null; score?: number | null; className?: string; compact?: boolean }) {
  const lvl = level ?? (score != null ? confidenceFromScore(score) : null);
  if (!lvl) return null;
  const meta = CONFIDENCE[lvl];
  const pct = score != null ? `${Math.round(score * 100)}%` : null;
  return (
    <span className={cn(chip, "border border-border bg-surface text-ink-2", className)} title={`${meta.label}${pct ? ` (${pct})` : ""}`}>
      <ToneDot tone={meta.tone} />
      {pct ?? meta.label.replace(" confidence", "")}
      {!compact && <span className="text-muted-foreground">{pct ? meta.label.replace(" confidence", "").toLowerCase() : "confidence"}</span>}
    </span>
  );
}

export function AttentionBadge({ level, className }: { level: AttentionLevel; className?: string }) {
  const meta = ATTENTION_LEVELS[level];
  return (
    <span className={cn(chip, TONE_SOFT[meta.tone], TONE_TEXT[meta.tone], className)} title={meta.description}>
      <span className={cn("size-1.5 rounded-full", TONE_DOT[meta.tone])} aria-hidden />
      {meta.label}
    </span>
  );
}

export function RelevanceBadge({ level, score, className }: { level: Relevance; score?: number | null; className?: string }) {
  const meta = RELEVANCE[level];
  return (
    <span className={cn(chip, "border border-border bg-surface text-ink-2", className)} title={`CEO relevance: ${meta.label}${score != null ? ` (${Math.round(score * 100)})` : ""}`}>
      <ToneDot tone={meta.tone} />
      {meta.label}
      <span className="sr-only"> relevance</span>
    </span>
  );
}

export function SensitivityBadge({ level, className }: { level: Sensitivity; className?: string }) {
  const meta = SENSITIVITY[level];
  return (
    <span className={cn(chip, level === "INTERNAL" ? "bg-muted text-muted-foreground" : cn(TONE_SOFT[meta.tone], TONE_TEXT[meta.tone]), className)} title={meta.description}>
      {level !== "INTERNAL" && <Lock className="size-2.5" aria-hidden />}
      {meta.label}
    </span>
  );
}

/** Five-segment bar with a visible "n/5" label. */
export function LevelBars({ value, label, className }: { value: number; label: string; className?: string }) {
  const v = Math.max(0, Math.min(5, Math.round(value)));
  const tone = severityTone(v);
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)} title={`${label} ${v}/5`}>
      <span className="flex gap-0.5" aria-hidden>
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={cn("h-2 w-1 rounded-[1px]", n <= v ? TONE_DOT[tone] : "bg-track")} />
        ))}
      </span>
      <span className="text-2xs text-muted-foreground tabular">
        <span className="sr-only">{label} </span>
        {v}/5
      </span>
    </span>
  );
}

/** Labelled severity meter for risks. */
export function SeverityMeter({ severity, className }: { severity: number; className?: string }) {
  const v = Math.max(1, Math.min(5, Math.round(severity)));
  const tone = severityTone(v);
  return (
    <div className={cn("flex items-center gap-2", className)} role="meter" aria-valuemin={1} aria-valuemax={5} aria-valuenow={v} aria-label={`Severity ${v} of 5, ${severityLabel(v)}`}>
      <span className="flex gap-0.5" aria-hidden>
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={cn("h-1.5 w-3 rounded-full", n <= v ? TONE_DOT[tone] : "bg-track")} />
        ))}
      </span>
      <span className={cn("text-2xs font-medium", TONE_TEXT[tone])}>{severityLabel(v)}</span>
    </div>
  );
}

/** Quiet note shown when provenance rows were filtered out for this viewer. */
export function HiddenSourcesNote({ count, className, noun = "source" }: { count: number; className?: string; noun?: string }) {
  if (!count) return null;
  return (
    <p className={cn("flex items-center gap-1.5 text-2xs text-muted-foreground", className)}>
      <Lock className="size-3 shrink-0" aria-hidden />
      {count} {noun}
      {count === 1 ? "" : "s"} hidden by your access level
    </p>
  );
}

/** A verbatim quote from a source. */
export function Excerpt({ children, className }: { children: React.ReactNode; className?: string }) {
  return <blockquote className={cn("border-l-2 border-brain/40 pl-3 text-[15px] leading-relaxed text-ink-2 italic", className)}>{children}</blockquote>;
}
