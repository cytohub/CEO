"use client";

import { Loader2, MessageSquarePlus, Pencil } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Field, PersonSelect, PillarSelect, SimpleSelect } from "@/components/common/fields";
import { useAction } from "@/components/common/use-action";
import type { GoalStatus, GoalType } from "@/generated/prisma/enums";
import { dayKey } from "@/lib/dates";
import { GOAL_STATUS, GOAL_TYPES } from "@/lib/domain";
import { addGoalNote, updateGoal } from "@/server/actions/goals";

export interface GoalEditable {
  id: string;
  title: string;
  description: string | null;
  type: GoalType;
  status: GoalStatus;
  progress: number;
  confidence: number;
  pillarId: string | null;
  ownerId: string | null;
  startDate: Date | null;
  targetDate: Date | null;
  risks: string | null;
  department: string | null;
  period: string | null;
}

/** Status, progress and confidence — the three numbers the CEO updates weekly. */
export function GoalQuickControls({ goal }: { goal: GoalEditable }) {
  const { pending, run } = useAction();
  const [progress, setProgress] = useState(goal.progress);
  const [confidence, setConfidence] = useState(goal.confidence);
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <div>
        <div className="mb-1.5 text-2xs font-medium text-muted-foreground">Status</div>
        <SimpleSelect
          size="sm"
          value={goal.status}
          onChange={(v) => v && run(() => updateGoal(goal.id, { status: v as GoalStatus }))}
          options={(Object.keys(GOAL_STATUS) as GoalStatus[]).map((s) => ({ value: s, label: GOAL_STATUS[s].label }))}
          ariaLabel="Goal status"
        />
      </div>
      <div>
        <div className="mb-1.5 flex justify-between text-2xs font-medium text-muted-foreground">
          <span>Progress</span>
          <span className="tabular">{progress}%</span>
        </div>
        <Slider value={[progress]} max={100} step={1} disabled={pending} onValueChange={([v]) => setProgress(v)} onValueCommit={([v]) => run(() => updateGoal(goal.id, { progress: v }))} aria-label="Progress" className="mt-3" />
      </div>
      <div>
        <div className="mb-1.5 flex justify-between text-2xs font-medium text-muted-foreground">
          <span>Confidence</span>
          <span className="tabular">{confidence}%</span>
        </div>
        <Slider value={[confidence]} max={100} step={5} disabled={pending} onValueChange={([v]) => setConfidence(v)} onValueCommit={([v]) => run(() => updateGoal(goal.id, { confidence: v }))} aria-label="Confidence" className="mt-3" />
      </div>
    </div>
  );
}

export function EditGoalButton({ goal }: { goal: GoalEditable }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useAction();
  const [form, setForm] = useState({
    title: goal.title,
    description: goal.description ?? "",
    type: goal.type,
    pillarId: goal.pillarId,
    ownerId: goal.ownerId,
    startDate: goal.startDate ? dayKey(goal.startDate) : "",
    targetDate: goal.targetDate ? dayKey(goal.targetDate) : "",
    department: goal.department ?? "",
    period: goal.period ?? "",
  });
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil /> Edit
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit goal</DialogTitle>
            <DialogDescription>Changes are recorded in the goal’s activity.</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const res = await run(() =>
                updateGoal(goal.id, {
                  ...form,
                  description: form.description || null,
                  startDate: form.startDate || null,
                  targetDate: form.targetDate || null,
                  department: form.department || null,
                  period: form.period || null,
                }),
              );
              if (res.ok) setOpen(false);
            }}
          >
            <Field label="Title" htmlFor="eg-title">
              <Input id="eg-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            </Field>
            <Field label="Description" htmlFor="eg-desc">
              <Textarea id="eg-desc" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Type">
                <SimpleSelect value={form.type} onChange={(v) => v && setForm({ ...form, type: v as GoalType })} options={(Object.keys(GOAL_TYPES) as GoalType[]).map((t) => ({ value: t, label: GOAL_TYPES[t].label }))} />
              </Field>
              <Field label="Strategic pillar">
                <PillarSelect value={form.pillarId} onChange={(v) => setForm({ ...form, pillarId: v })} />
              </Field>
              <Field label="Owner">
                <PersonSelect value={form.ownerId} onChange={(v) => setForm({ ...form, ownerId: v })} teamOnly />
              </Field>
              <Field label="Period" htmlFor="eg-period">
                <Input id="eg-period" value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} placeholder="e.g. 2026-Q4" />
              </Field>
              <Field label="Start" htmlFor="eg-start">
                <Input id="eg-start" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
              </Field>
              <Field label="Target" htmlFor="eg-target">
                <Input id="eg-target" type="date" value={form.targetDate} onChange={(e) => setForm({ ...form, targetDate: e.target.value })} />
              </Field>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="animate-spin" />} Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function GoalRisksEditor({ goalId, risks }: { goalId: string; risks: string | null }) {
  const { run } = useAction();
  return (
    <Textarea
      rows={3}
      defaultValue={risks ?? ""}
      placeholder="What could stop this goal? Be specific."
      aria-label="Risks"
      onBlur={(e) => {
        if ((e.target.value || null) !== risks) run(() => updateGoal(goalId, { risks: e.target.value || null }), { success: "Risks updated" });
      }}
    />
  );
}

export function GoalNoteForm({ goalId }: { goalId: string }) {
  const [text, setText] = useState("");
  const { pending, run } = useAction();
  return (
    <form
      className="flex gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await run(() => addGoalNote(goalId, text));
        if (res.ok) setText("");
      }}
    >
      <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note…" aria-label="New note" />
      <Button type="submit" size="sm" variant="outline" disabled={pending || !text.trim()}>
        <MessageSquarePlus /> Add
      </Button>
    </form>
  );
}
