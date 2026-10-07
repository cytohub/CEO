"use client";

import { Check, Clock, Gavel, Loader2, Pencil, Plus, RotateCcw, Trash2, Undo2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/common/fields";
import { useAction } from "@/components/common/use-action";
import { cn } from "@/lib/utils";
import { recordDecision, recordOutcome, setDecisionStatus, updateDecision } from "@/server/actions/decisions";
import type { DecisionDetail } from "@/server/queries/decisions";

type Option = DecisionDetail["options"][number];

/** The moment of truth: pick an option, state the decision, record the rationale. */
export function MakeDecision({ decision }: { decision: DecisionDetail }) {
  const recommended = decision.options.find((o) => o.recommended);
  const [choice, setChoice] = useState<string | null>(recommended?.id ?? null);
  const [text, setText] = useState(recommended?.title ?? "");
  const [rationale, setRationale] = useState("");
  const { pending, run } = useAction();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => recordDecision(decision.id, { finalDecision: text, chosenOptionId: choice, rationale: rationale || null }));
      }}
    >
      {decision.options.length > 0 && (
        <fieldset>
          <legend className="mb-1.5 text-xs font-medium text-ink-2">Choose an option</legend>
          <div className="grid gap-1.5">
            {decision.options.map((o) => (
              <label key={o.id} className={cn("flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-[15px] transition-colors", choice === o.id ? "border-foreground bg-muted" : "border-border hover:bg-muted/50")}>
                <input
                  type="radio"
                  name="option"
                  value={o.id}
                  checked={choice === o.id}
                  onChange={() => {
                    setChoice(o.id);
                    setText(o.title);
                  }}
                  className="accent-foreground"
                />
                <span className="flex-1">{o.title}</span>
                {o.recommended && <span className="text-2xs font-medium text-brain">Recommended</span>}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <Field label="Final decision" htmlFor="final">
        <Textarea id="final" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="State the decision in one or two sentences." required />
      </Field>
      <Field label="Rationale (optional)" htmlFor="rationale">
        <Textarea id="rationale" rows={2} value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Why this option? What would make you revisit it?" />
      </Field>
      <Button type="submit" disabled={pending || !text.trim()} className="w-full">
        {pending ? <Loader2 className="animate-spin" /> : <Gavel />} Record decision
      </Button>
    </form>
  );
}

export function StatusControls({ decision }: { decision: DecisionDetail }) {
  const { pending, run } = useAction();
  const [waitingOpen, setWaitingOpen] = useState(false);
  const [waitingOn, setWaitingOn] = useState(decision.waitingOn ?? "");
  return (
    <div className="flex flex-wrap gap-1.5">
      {decision.status !== "WAITING_INFO" && decision.status !== "DECIDED" && (
        <Button variant="outline" size="sm" onClick={() => setWaitingOpen(true)}>
          <Clock /> Waiting for info
        </Button>
      )}
      {decision.status !== "DEFERRED" && decision.status !== "DECIDED" && (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => setDecisionStatus(decision.id, "DEFERRED"), { success: "Deferred" })}>
          <Undo2 /> Defer
        </Button>
      )}
      {(decision.status === "WAITING_INFO" || decision.status === "DEFERRED" || decision.status === "DECIDED") && (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => setDecisionStatus(decision.id, "NEEDED"), { success: "Reopened" })}>
          <RotateCcw /> {decision.status === "DECIDED" ? "Reopen" : "Ready to decide"}
        </Button>
      )}
      <Dialog open={waitingOpen} onOpenChange={setWaitingOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>What information is missing?</DialogTitle>
            <DialogDescription>The Brain will chase it if it stays open for more than a week.</DialogDescription>
          </DialogHeader>
          <Textarea rows={3} value={waitingOn} onChange={(e) => setWaitingOn(e.target.value)} aria-label="Waiting on" placeholder="e.g. Jonas’s cost model for both options" />
          <DialogFooter>
            <Button
              disabled={pending || !waitingOn.trim()}
              onClick={async () => {
                const res = await run(() => setDecisionStatus(decision.id, "WAITING_INFO", waitingOn), { success: "Marked as waiting for information" });
                if (res.ok) setWaitingOpen(false);
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function OutcomeEditor({ decision }: { decision: DecisionDetail }) {
  const [outcome, setOutcome] = useState(decision.outcome ?? "");
  const [lessons, setLessons] = useState(decision.lessonsLearned ?? "");
  const { pending, run } = useAction();
  const dirty = outcome !== (decision.outcome ?? "") || lessons !== (decision.lessonsLearned ?? "");
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => recordOutcome(decision.id, { outcome: outcome || null, lessonsLearned: lessons || null }));
      }}
    >
      <Field label="Outcome — what actually happened?" htmlFor="outcome">
        <Textarea id="outcome" rows={3} value={outcome} onChange={(e) => setOutcome(e.target.value)} />
      </Field>
      <Field label="Lessons learned" htmlFor="lessons">
        <Textarea id="lessons" rows={3} value={lessons} onChange={(e) => setLessons(e.target.value)} />
      </Field>
      <Button type="submit" size="sm" variant="outline" disabled={pending || !dirty}>
        <Check /> Save
      </Button>
    </form>
  );
}

export function RecommendationEditor({ decision }: { decision: DecisionDetail }) {
  const { run } = useAction();
  return (
    <Textarea
      rows={3}
      defaultValue={decision.recommendation ?? ""}
      aria-label="Recommendation"
      placeholder="What do you or your team recommend?"
      onBlur={(e) => (e.target.value || null) !== decision.recommendation && run(() => updateDecision(decision.id, { recommendation: e.target.value || null }), { success: "Recommendation saved" })}
    />
  );
}

const toLines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

export function EditOptions({ decision }: { decision: DecisionDetail }) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState(() =>
    decision.options.map((o: Option) => ({ title: o.title, description: o.description ?? "", pros: o.pros.join("\n"), cons: o.cons.join("\n"), risks: o.risks.join("\n"), recommended: o.recommended })),
  );
  const { pending, run } = useAction();
  return (
    <>
      <Button variant="ghost" size="xs" onClick={() => setOpen(true)}>
        <Pencil /> Edit options
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Options</DialogTitle>
            <DialogDescription>One line per pro, con and risk.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {opts.map((o, i) => (
              <fieldset key={i} className="space-y-2 rounded-lg border border-border p-3">
                <legend className="sr-only">Option {i + 1}</legend>
                <div className="flex items-center gap-2">
                  <Input value={o.title} onChange={(e) => setOpts((s) => s.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} placeholder={`Option ${i + 1}`} aria-label={`Option ${i + 1} title`} />
                  <label className="flex shrink-0 items-center gap-1.5 text-2xs text-muted-foreground">
                    <Switch checked={o.recommended} onCheckedChange={(v) => setOpts((s) => s.map((x, j) => ({ ...x, recommended: j === i ? v : v ? false : x.recommended })))} /> Recommended
                  </label>
                  <Button variant="ghost" size="icon-sm" aria-label={`Remove option ${i + 1}`} onClick={() => setOpts((s) => s.filter((_, j) => j !== i))}>
                    <Trash2 />
                  </Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {(["pros", "cons", "risks"] as const).map((k) => (
                    <Textarea key={k} rows={3} value={o[k]} onChange={(e) => setOpts((s) => s.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} placeholder={k[0].toUpperCase() + k.slice(1)} aria-label={`Option ${i + 1} ${k}`} className="text-xs" />
                  ))}
                </div>
              </fieldset>
            ))}
            <Button variant="outline" size="sm" onClick={() => setOpts((s) => [...s, { title: "", description: "", pros: "", cons: "", risks: "", recommended: false }])}>
              <Plus /> Add option
            </Button>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={pending}
              onClick={async () => {
                const res = await run(() =>
                  updateDecision(decision.id, {
                    options: opts.filter((o) => o.title.trim()).map((o) => ({ title: o.title.trim(), description: o.description || null, pros: toLines(o.pros), cons: toLines(o.cons), risks: toLines(o.risks), recommended: o.recommended })),
                  }),
                );
                if (res.ok) setOpen(false);
              }}
            >
              Save options
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
