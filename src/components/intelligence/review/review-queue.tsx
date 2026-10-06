"use client";

import { Check, ChevronDown, ClipboardCheck, EyeOff, GitMerge, Loader2, Lock, Pencil, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/common/bits";
import { Kbd, TONE_SOFT } from "@/components/common/status";
import { useAction } from "@/components/common/use-action";
import { timeAgo } from "@/lib/dates";
import { REVIEW_KINDS } from "@/lib/intelligence";
import { cn } from "@/lib/utils";
import { resolveReview, type ReviewDecisionInput } from "@/server/actions/review";
import type { ReviewEntry } from "@/server/queries/review";
import { ConfidenceBadge, Excerpt, LevelBars, REVIEW_KIND_ICON, SensitivityBadge, SourceKindIcon, providerLabel } from "../badges";
import { buildEdit, proposalFields, setIn, validateEdit } from "../model";
import { ViewSourceButton } from "../view-source";
import { ProposalFieldsEditor, ProposalFieldsView } from "./proposal-fields";
import { DocumentChangeView, FieldChangeView, MergeCompare } from "./special-views";

interface CardHandle {
  approve: () => void;
  reject: () => void;
  edit: () => void;
  focus: () => void;
}

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable || el.getAttribute("role") === "combobox";
}

const HEADING: Partial<Record<ReviewEntry["kind"], string>> = {
  TASK: "Proposed task",
  COMMITMENT: "Proposed commitment",
  DEADLINE: "Proposed deadline",
  DECISION: "Proposed decision",
  RISK: "Proposed risk",
  OPPORTUNITY: "Proposed opportunity",
  MEETING: "Proposed meeting",
  ENTITY_MERGE: "Which record to keep",
  NEW_PERSON: "Proposed person",
  NEW_COMPANY: "Proposed company",
  NEW_INVESTOR: "Proposed investor",
  FIELD_CHANGE: "Proposed change",
  DOCUMENT_CHANGE: "Significant changes",
};

/**
 * Pending review cards with keyboard triage: j/k move, a approve, r reject,
 * e edit (ignored while typing or when a dialog is open).
 */
export function ReviewQueue({ items, names }: { items: ReviewEntry[]; names: Record<string, string> }) {
  const [resolved, setResolved] = useState<Set<string>>(() => new Set());
  const visible = useMemo(() => items.filter((i) => !resolved.has(i.id)), [items, resolved]);
  const [active, setActive] = useState(0);
  const idx = Math.min(active, Math.max(0, visible.length - 1));
  const handles = useRef(new Map<string, CardHandle>());
  const lastKey = useRef<{ key: string; at: number } | null>(null);

  const register = useCallback((id: string, h: CardHandle | null) => {
    if (h) handles.current.set(id, h);
    else handles.current.delete(id);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || document.querySelector("[role=dialog],[role=menu],[role=listbox]")) return;
      const key = e.key.toLowerCase();
      const prev = lastKey.current;
      lastKey.current = { key, at: Date.now() };
      // "g then k" is global navigation, not "previous card".
      if (prev?.key === "g" && Date.now() - prev.at < 1200) return;
      const current = visible[idx];
      if (!current) return;
      const h = handles.current.get(current.id);
      if (key === "j" || key === "k") {
        e.preventDefault();
        const next = Math.max(0, Math.min(visible.length - 1, idx + (key === "j" ? 1 : -1)));
        setActive(next);
        handles.current.get(visible[next].id)?.focus();
      } else if (key === "a") {
        e.preventDefault();
        h?.approve();
      } else if (key === "r") {
        e.preventDefault();
        h?.reject();
      } else if (key === "e") {
        e.preventDefault();
        h?.edit();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, idx]);

  const onResolved = useCallback((id: string) => {
    setResolved((s) => new Set(s).add(id));
    // Keep the same slot: the next card moves up into focus.
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>("[data-review-card][data-active=true]");
      el?.focus({ preventScroll: true });
    });
  }, []);

  if (visible.length === 0) {
    return (
      <div className="panel">
        <EmptyState icon={ClipboardCheck} title="Nothing to review" description="CytoHub Brain writes high-confidence intelligence on its own. Uncertain or high-impact conclusions will wait here for you." />
      </div>
    );
  }

  return (
    <ul className="space-y-3" aria-label="Pending review items">
      {visible.map((item, i) => (
        <li key={item.id}>
          <ReviewCard item={item} active={i === idx} names={names} onActivate={() => setActive(i)} onResolved={onResolved} register={register} />
        </li>
      ))}
    </ul>
  );
}

function ReviewCard({
  item,
  active,
  names,
  onActivate,
  onResolved,
  register,
}: {
  item: ReviewEntry;
  active: boolean;
  names: Record<string, string>;
  onActivate: () => void;
  onResolved: (id: string) => void;
  register: (id: string, h: CardHandle | null) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>(() => ({ ...item.proposal }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [keepId, setKeepId] = useState<string | null>(item.merge?.keep?.id ?? null);
  const { pending, run } = useAction();
  const meta = REVIEW_KINDS[item.kind];
  const Icon = REVIEW_KIND_ICON[item.kind];
  const isMerge = item.kind === "ENTITY_MERGE";
  const canEdit = !isMerge && item.kind !== "DOCUMENT_CHANGE";
  const fields = useMemo(() => proposalFields(item.kind, editing ? draft : item.proposal), [item.kind, item.proposal, editing, draft]);
  const keepLabel = isMerge ? [item.merge?.keep, item.merge?.other].find((s) => s?.id === keepId)?.label : null;

  const decide = useCallback(
    (decision: ReviewDecisionInput) => {
      if (pending) return;
      run(() => resolveReview(item.id, { ...decision, note: note.trim() || undefined }), { onSuccess: () => onResolved(item.id) });
    },
    [pending, run, item.id, note, onResolved],
  );

  const toggleEdit = useCallback(() => {
    if (!canEdit) return;
    setEditing((e) => {
      if (e) {
        setDraft({ ...item.proposal });
        setErrors({});
      }
      return !e;
    });
    if (!editing) requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>("[data-proposal-editor] input:not([type=hidden]), [data-proposal-editor] textarea, [data-proposal-editor] button")?.focus());
  }, [canEdit, editing, item.proposal]);

  const approve = useCallback(() => {
    if (isMerge) {
      if (keepId) decide({ action: "MERGE", mergeIntoId: keepId });
      return;
    }
    if (!editing) return decide({ action: "APPROVE" });
    const edited = buildEdit(item.kind, draft);
    const errs = validateEdit(item.kind, item.proposal, edited);
    setErrors(errs);
    if (Object.keys(errs).length) {
      toast.error("Check the highlighted fields");
      return;
    }
    decide({ action: "EDIT", edited });
  }, [isMerge, keepId, editing, item.kind, item.proposal, draft, decide]);

  useEffect(() => {
    register(item.id, { approve, reject: () => decide({ action: "REJECT" }), edit: toggleEdit, focus: () => ref.current?.focus() });
    return () => register(item.id, null);
  }, [register, item.id, approve, decide, toggleEdit]);

  const titleId = `review-${item.id}-title`;
  const hint = (k: string) =>
    active && (
      <Kbd className="ml-0.5 hidden h-4 min-w-4 border-current/25 bg-transparent px-0.5 text-[9px] text-current opacity-70 sm:inline-flex" aria-hidden>
        {k}
      </Kbd>
    );

  return (
    <article
      ref={ref}
      tabIndex={-1}
      data-review-card
      data-active={active}
      aria-labelledby={titleId}
      aria-busy={pending || undefined}
      onFocusCapture={onActivate}
      onMouseDown={onActivate}
      className={cn("panel relative overflow-hidden transition-shadow outline-none", active ? "ring-1 ring-foreground/15 focus-visible:ring-2 focus-visible:ring-ring/50" : "opacity-[0.97]")}
    >
      {active && <span className="absolute inset-y-0 left-0 w-0.5 bg-brand" aria-hidden />}
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-4 pt-3.5">
        <span className={cn("flex size-6 items-center justify-center rounded-md", TONE_SOFT.brain)}>
          <Icon className="size-3.5 text-brain" aria-hidden />
        </span>
        <span className="text-xs font-medium text-ink-2">{meta.label}</span>
        <span className="hidden truncate text-2xs text-muted-foreground md:inline">· {meta.description}</span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <LevelBars value={item.impact} label="Impact" />
          <ConfidenceBadge level={item.confidence} score={item.confidenceScore} />
          {item.sensitivity !== "CONFIDENTIAL" && <SensitivityBadge level={item.sensitivity} />}
          <span className="text-2xs text-muted-foreground tabular" title={item.createdAt.toISOString()}>
            {timeAgo(item.createdAt)}
          </span>
        </span>
      </header>
      <h2 id={titleId} className="px-4 pt-2 text-[15px] leading-snug font-semibold tracking-tight">
        {item.title}
      </h2>

      <div className="grid gap-4 px-4 py-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="min-w-0 space-y-3">
          <section className="rounded-lg border border-border bg-surface-2/60 p-3">
            <h3 className="eyebrow">Why this needs review</h3>
            <p className="mt-1 text-[13px] leading-relaxed">{item.reason}</p>
          </section>
          {(item.source || item.excerpt || item.sourceHidden) && (
            <section aria-label="Source">
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-2xs text-muted-foreground">
                {item.source ? (
                  <>
                    <SourceKindIcon kind={item.source.kind} className="size-3" />
                    <span className="font-medium text-ink-2">{providerLabel(item.source.provider)}</span>
                    {item.source.author && <span>· {item.source.author}</span>}
                    <span>· {timeAgo(item.source.occurredAt)}</span>
                    <ViewSourceButton targetType="SOURCE_ITEM" targetId={item.source.id} label="View source" className="ml-auto -my-1" />
                  </>
                ) : item.sourceHidden ? (
                  <span className="inline-flex items-center gap-1">
                    <Lock className="size-3" aria-hidden /> Source hidden by your access level
                  </span>
                ) : null}
              </div>
              {item.excerpt && <Excerpt className="mt-2">“{item.excerpt}”</Excerpt>}
            </section>
          )}
        </div>

        <section className="min-w-0 rounded-lg border border-border p-3" aria-label={HEADING[item.kind] ?? "Proposal"}>
          <div className="mb-2.5 flex items-center gap-2">
            <h3 className="eyebrow">{HEADING[item.kind] ?? "Proposal"}</h3>
            {editing && <span className="rounded bg-brand-soft px-1.5 text-2xs font-medium text-brand">Editing</span>}
            {canEdit && (
              <Button type="button" size="xs" variant="ghost" className="ml-auto text-muted-foreground" onClick={toggleEdit} disabled={pending} aria-pressed={editing}>
                {editing ? <Undo2 /> : <Pencil />}
                {editing ? "Discard edits" : "Edit"}
                {hint("E")}
              </Button>
            )}
          </div>
          {isMerge && item.merge && <MergeCompare merge={item.merge} keepId={keepId} onKeep={setKeepId} disabled={pending} />}
          {item.kind === "FIELD_CHANGE" && <FieldChangeView item={item} draftTo={editing ? draft.to : undefined} names={names} />}
          {item.kind === "DOCUMENT_CHANGE" && <DocumentChangeView item={item} />}
          {!isMerge && (
            <div className={cn(item.kind === "FIELD_CHANGE" || item.kind === "DOCUMENT_CHANGE" ? "mt-3" : "")} data-proposal-editor>
              {editing ? (
                <ProposalFieldsEditor
                  fields={fields}
                  draft={draft}
                  errors={errors}
                  names={names}
                  idPrefix={item.id}
                  onChange={(path, value, name) => {
                    setDraft((d) => {
                      let next = setIn(d, path, value);
                      if (name) next = setIn(next, [name.key], name.value);
                      return next;
                    });
                    if (errors[path[0]])
                      setErrors((cur) => {
                        const next = { ...cur };
                        delete next[path[0]];
                        return next;
                      });
                  }}
                />
              ) : (
                <ProposalFieldsView fields={item.kind === "FIELD_CHANGE" ? fields.filter((f) => f.key !== "to") : fields} names={names} />
              )}
            </div>
          )}
        </section>
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-hairline px-4 py-2.5">
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label={`Note for “${item.title}”`} maxLength={1000} className="h-7 min-w-0 flex-1 basis-[200px] text-[13px]" />
        <div className="flex flex-wrap items-center gap-1.5">
          {isMerge ? (
            <Button size="sm" onClick={approve} disabled={pending || !keepId}>
              {pending ? <Loader2 className="animate-spin" /> : <GitMerge />}
              <span className="max-w-[220px] truncate">Merge into {keepLabel ?? "selected"}</span>
              {hint("A")}
            </Button>
          ) : (
            <Button size="sm" onClick={approve} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <Check />}
              {editing ? "Save & approve" : "Approve"}
              {hint("A")}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => decide({ action: "REJECT" })} disabled={pending}>
            <X /> {isMerge ? "Not duplicates" : "Reject"}
            {hint("R")}
          </Button>
          {!isMerge && item.candidates.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" disabled={pending}>
                  <GitMerge /> Merge <ChevronDown className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="text-2xs">Same as an existing record</DropdownMenuLabel>
                {item.candidates.map((c) => (
                  <DropdownMenuItem key={c.entityId} onSelect={() => decide({ action: "MERGE", mergeIntoId: c.entityId })}>
                    <span className="min-w-0 flex-1 truncate">{c.label}</span>
                    {c.score != null && <span className="text-2xs text-muted-foreground tabular">{Math.round(c.score * 100)}%</span>}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button size="sm" variant="ghost" onClick={() => decide({ action: "IGNORE" })} disabled={pending} title="Not worth tracking — dismiss without a verdict">
            <EyeOff /> Ignore
          </Button>
        </div>
      </footer>
    </article>
  );
}
