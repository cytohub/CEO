"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  CompanySelect,
  Field,
  FocusAreaSelect,
  GoalSelect,
  MilestoneSelect,
  PersonSelect,
  PillarSelect,
  PrioritySelect,
  RatingInput,
  SimpleSelect,
} from "@/components/common/fields";
import { useAction } from "@/components/common/use-action";
import { useLookups, useUI, type CreateDefaults } from "@/components/shell/ui-context";
import type { FocusArea, GoalType, MilestoneType, Priority, ResourceType } from "@/generated/prisma/enums";
import { GOAL_TYPES, MILESTONE_TYPES, RESOURCE_TYPES } from "@/lib/domain";
import { FACTOR_META } from "@/server/brain/scoring";
import { createDecision } from "@/server/actions/decisions";
import { createGoal, createMilestone } from "@/server/actions/goals";
import { createResource } from "@/server/actions/resources";
import { createTask } from "@/server/actions/tasks";

export function CreateDialogs() {
  const { create, closeCreate } = useUI();
  const titles = {
    task: ["Create task", "CytoHub Brain scores it immediately so it lands in the right place."],
    goal: ["Create goal", "Goals roll up to a strategic pillar and down to milestones and tasks."],
    milestone: ["Create milestone", "A dated, verifiable checkpoint on the way to a goal."],
    decision: ["Record decision", "Capture the decision, the options and what you need to make the call."],
    resource: ["Add resource", "Link a document, model, contract or link to the work it supports."],
  } as const;
  const kind = create.kind;
  return (
    <Dialog open={kind !== null} onOpenChange={(o) => !o && closeCreate()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        {kind && (
          <>
            <DialogHeader>
              <DialogTitle>{titles[kind][0]}</DialogTitle>
              <DialogDescription>{titles[kind][1]}</DialogDescription>
            </DialogHeader>
            {kind === "task" && <TaskForm defaults={create.defaults} onDone={closeCreate} />}
            {kind === "goal" && <GoalForm defaults={create.defaults} onDone={closeCreate} />}
            {kind === "milestone" && <MilestoneForm defaults={create.defaults} onDone={closeCreate} />}
            {kind === "decision" && <DecisionForm defaults={create.defaults} onDone={closeCreate} />}
            {kind === "resource" && <ResourceForm defaults={create.defaults} onDone={closeCreate} />}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Footer({ pending, label, onCancel }: { pending: boolean; label: string; onCancel: () => void }) {
  return (
    <DialogFooter className="mt-2">
      <Button type="button" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />}
        {label}
      </Button>
    </DialogFooter>
  );
}

function TaskForm({ defaults, onDone }: { defaults?: CreateDefaults; onDone: () => void }) {
  const { ceoPersonId, milestones } = useLookups();
  const { pending, run } = useAction();
  const [title, setTitle] = useState(defaults?.title ?? "");
  const [description, setDescription] = useState("");
  const [focusArea, setFocusArea] = useState<FocusArea>("STRATEGY");
  const [priority, setPriority] = useState<Priority>("P2");
  const [dueDate, setDueDate] = useState(defaults?.dueDate ?? "");
  const [hardDeadline, setHard] = useState(false);
  const [goalId, setGoalId] = useState<string | null>(defaults?.goalId ?? null);
  const [milestoneId, setMilestoneId] = useState<string | null>(defaults?.milestoneId ?? null);
  const [ownerId, setOwnerId] = useState<string | null>(ceoPersonId);
  const [companyId, setCompanyId] = useState<string | null>(defaults?.companyId ?? null);
  const [est, setEst] = useState("60");
  const [showScoring, setShowScoring] = useState(false);
  const [impact, setImpact] = useState({ strategicImpact: 3, revenueImpact: 0, fundraisingImpact: 0, customerImpact: 0, scientificImpact: 0, riskLevel: 1, ceoUniqueness: 3, opportunityCost: 2 });

  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const ms = milestones.find((m) => m.id === milestoneId);
        const res = await run(() =>
          createTask({
            title,
            description: description || null,
            focusArea,
            priority,
            dueDate: dueDate || null,
            hardDeadline,
            goalId: goalId ?? ms?.goalId ?? null,
            milestoneId,
            ownerId,
            companyId,
            decisionId: defaults?.decisionId ?? null,
            estimatedMinutes: est ? Number(est) : null,
            ...impact,
          }),
        );
        if (res.ok) onDone();
      }}
    >
      <Field label="Task" htmlFor="task-title">
        <Input id="task-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs to happen?" required />
      </Field>
      <Field label="Description" htmlFor="task-desc">
        <Textarea id="task-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Context, definition of done…" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Priority">
          <PrioritySelect value={priority} onChange={setPriority} />
        </Field>
        <Field label="Due date" htmlFor="task-due">
          <Input id="task-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <Field label="Estimate (min)" htmlFor="task-est">
          <Input id="task-est" type="number" min={0} step={15} value={est} onChange={(e) => setEst(e.target.value)} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Focus area">
          <FocusAreaSelect value={focusArea} onChange={setFocusArea} />
        </Field>
        <Field label="Owner">
          <PersonSelect value={ownerId} onChange={setOwnerId} teamOnly />
        </Field>
        <Field label="Goal">
          <GoalSelect value={goalId} onChange={setGoalId} />
        </Field>
        <Field label="Milestone">
          <MilestoneSelect value={milestoneId} onChange={setMilestoneId} goalId={goalId} />
        </Field>
        <Field label="Company">
          <CompanySelect value={companyId} onChange={setCompanyId} />
        </Field>
        <label className="flex items-center gap-2 self-end pb-1.5 text-xs text-ink-2">
          <Switch checked={hardDeadline} onCheckedChange={setHard} /> Hard external deadline
        </label>
      </div>
      <div className="rounded-lg border border-border">
        <button type="button" onClick={() => setShowScoring((s) => !s)} className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-ink-2">
          CEO Priority Score inputs
          <span className="text-muted-foreground">{showScoring ? "Hide" : "Adjust"}</span>
        </button>
        {showScoring && (
          <div className="grid gap-2 border-t border-border p-3">
            {(
              [
                ["strategicImpact", "strategic"],
                ["revenueImpact", "revenue"],
                ["fundraisingImpact", "fundraising"],
                ["customerImpact", "customer"],
                ["scientificImpact", "scientific"],
                ["riskLevel", "risk"],
                ["ceoUniqueness", "uniqueness"],
                ["opportunityCost", "opportunity"],
              ] as const
            ).map(([field, factor]) => (
              <RatingInput
                key={field}
                label={FACTOR_META[factor].label}
                description={FACTOR_META[factor].description}
                value={impact[field]}
                onChange={(v) => setImpact((s) => ({ ...s, [field]: v }))}
              />
            ))}
          </div>
        )}
      </div>
      <Footer pending={pending} label="Create task" onCancel={onDone} />
    </form>
  );
}

function GoalForm({ defaults, onDone }: { defaults?: CreateDefaults; onDone: () => void }) {
  const { ceoPersonId, goals } = useLookups();
  const router = useRouter();
  const { pending, run } = useAction();
  const [title, setTitle] = useState(defaults?.title ?? "");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<GoalType>("QUARTERLY");
  const [pillarId, setPillarId] = useState<string | null>(defaults?.pillarId ?? null);
  const [ownerId, setOwnerId] = useState<string | null>(ceoPersonId);
  const [parentId, setParentId] = useState<string | null>(defaults?.goalId ?? null);
  const [startDate, setStart] = useState("");
  const [targetDate, setTarget] = useState("");
  const [confidence, setConfidence] = useState("70");
  const [department, setDepartment] = useState("");

  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await run(() =>
          createGoal({
            title,
            description: description || null,
            type,
            pillarId,
            ownerId,
            parentId,
            startDate: startDate || null,
            targetDate: targetDate || null,
            confidence: Number(confidence),
            department: department || null,
          }),
        );
        if (res.ok) {
          onDone();
          router.push(`/goals/${res.data.id}`);
        }
      }}
    >
      <Field label="Goal" htmlFor="goal-title">
        <Input id="goal-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Outcome, not activity — e.g. Sign two pharma MSAs" required />
      </Field>
      <Field label="Description" htmlFor="goal-desc">
        <Textarea id="goal-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type">
          <SimpleSelect value={type} onChange={(v) => v && setType(v as GoalType)} options={(Object.keys(GOAL_TYPES) as GoalType[]).map((t) => ({ value: t, label: GOAL_TYPES[t].label }))} />
        </Field>
        <Field label="Strategic pillar">
          <PillarSelect value={pillarId} onChange={setPillarId} />
        </Field>
        <Field label="Owner">
          <PersonSelect value={ownerId} onChange={setOwnerId} teamOnly />
        </Field>
        <Field label="Parent goal">
          <SimpleSelect value={parentId} onChange={setParentId} allowNone options={goals.filter((g) => g.type !== "QUARTERLY").map((g) => ({ value: g.id, label: g.title }))} />
        </Field>
        <Field label="Start" htmlFor="goal-start">
          <Input id="goal-start" type="date" value={startDate} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Target" htmlFor="goal-target">
          <Input id="goal-target" type="date" value={targetDate} onChange={(e) => setTarget(e.target.value)} />
        </Field>
        <Field label="Confidence (%)" htmlFor="goal-conf">
          <Input id="goal-conf" type="number" min={0} max={100} value={confidence} onChange={(e) => setConfidence(e.target.value)} />
        </Field>
        {type === "DEPARTMENT" && (
          <Field label="Department" htmlFor="goal-dept">
            <Input id="goal-dept" value={department} onChange={(e) => setDepartment(e.target.value)} />
          </Field>
        )}
      </div>
      <Footer pending={pending} label="Create goal" onCancel={onDone} />
    </form>
  );
}

function MilestoneForm({ defaults, onDone }: { defaults?: CreateDefaults; onDone: () => void }) {
  const { ceoPersonId } = useLookups();
  const { pending, run } = useAction();
  const [title, setTitle] = useState(defaults?.title ?? "");
  const [type, setType] = useState<MilestoneType>("OTHER");
  const [goalId, setGoalId] = useState<string | null>(defaults?.goalId ?? null);
  const [ownerId, setOwnerId] = useState<string | null>(ceoPersonId);
  const [dueDate, setDue] = useState(defaults?.dueDate ?? "");
  const [successMetric, setSuccess] = useState("");
  const [description, setDescription] = useState("");
  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await run(() => createMilestone({ title, type, goalId, ownerId, dueDate, successMetric: successMetric || null, description: description || null }));
        if (res.ok) onDone();
      }}
    >
      <Field label="Milestone" htmlFor="ms-title">
        <Input id="ms-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Brightwater MSA signed" required />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type">
          <SimpleSelect value={type} onChange={(v) => v && setType(v as MilestoneType)} options={(Object.keys(MILESTONE_TYPES) as MilestoneType[]).map((t) => ({ value: t, label: MILESTONE_TYPES[t].label }))} />
        </Field>
        <Field label="Due date" htmlFor="ms-due">
          <Input id="ms-due" type="date" value={dueDate} onChange={(e) => setDue(e.target.value)} required />
        </Field>
        <Field label="Goal">
          <GoalSelect value={goalId} onChange={setGoalId} />
        </Field>
        <Field label="Owner">
          <PersonSelect value={ownerId} onChange={setOwnerId} teamOnly />
        </Field>
      </div>
      <Field label="Success criterion" htmlFor="ms-success" hint="How will you know it's done? Be specific.">
        <Input id="ms-success" value={successMetric} onChange={(e) => setSuccess(e.target.value)} placeholder="e.g. Signed MSA ≥ $1.4M over three years" />
      </Field>
      <Field label="Description" htmlFor="ms-desc">
        <Textarea id="ms-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Footer pending={pending} label="Create milestone" onCancel={onDone} />
    </form>
  );
}

function DecisionForm({ defaults, onDone }: { defaults?: CreateDefaults; onDone: () => void }) {
  const router = useRouter();
  const { pending, run } = useAction();
  const [title, setTitle] = useState(defaults?.title ?? "");
  const [context, setContext] = useState("");
  const [deadline, setDeadline] = useState("");
  const [impact, setImpact] = useState(4);
  const [goalId, setGoalId] = useState<string | null>(defaults?.goalId ?? null);
  const [recommendation, setRecommendation] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await run(() =>
          createDecision({
            title,
            context: context || null,
            deadline: deadline || null,
            strategicImpact: Math.max(1, impact),
            goalId,
            recommendation: recommendation || null,
            options: options.filter((o) => o.trim()).map((o) => ({ title: o.trim(), pros: [], cons: [], risks: [], recommended: false })),
          }),
        );
        if (res.ok) {
          onDone();
          router.push(`/decisions/${res.data.id}`);
        }
      }}
    >
      <Field label="Decision" htmlFor="dec-title">
        <Input id="dec-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Phrase it as a question — e.g. Open a Boston lab in 2027?" required />
      </Field>
      <Field label="Context" htmlFor="dec-context">
        <Textarea id="dec-context" rows={3} value={context} onChange={(e) => setContext(e.target.value)} placeholder="Why now? What's at stake?" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Deadline" htmlFor="dec-deadline">
          <Input id="dec-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </Field>
        <Field label="Goal">
          <GoalSelect value={goalId} onChange={setGoalId} />
        </Field>
      </div>
      <RatingInput label="Strategic impact" description="1 = minor, 5 = company-defining" value={impact} onChange={setImpact} />
      <Field label="Options">
        <div className="grid gap-2">
          {options.map((o, i) => (
            <Input key={i} value={o} onChange={(e) => setOptions((s) => s.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Option ${i + 1}`} aria-label={`Option ${i + 1}`} />
          ))}
          {options.length < 6 && (
            <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={() => setOptions((s) => [...s, ""])}>
              Add option
            </Button>
          )}
        </div>
      </Field>
      <Field label="Recommendation (optional)" htmlFor="dec-rec">
        <Textarea id="dec-rec" rows={2} value={recommendation} onChange={(e) => setRecommendation(e.target.value)} />
      </Field>
      <Footer pending={pending} label="Record decision" onCancel={onDone} />
    </form>
  );
}

function ResourceForm({ defaults, onDone }: { defaults?: CreateDefaults; onDone: () => void }) {
  const { pending, run } = useAction();
  const [title, setTitle] = useState(defaults?.title ?? "");
  const [type, setType] = useState<ResourceType>("DOCUMENT");
  const [url, setUrl] = useState("");
  const [summary, setSummary] = useState("");
  const [goalId, setGoalId] = useState<string | null>(defaults?.goalId ?? null);
  const [milestoneId, setMilestoneId] = useState<string | null>(defaults?.milestoneId ?? null);
  const [companyId, setCompanyId] = useState<string | null>(defaults?.companyId ?? null);
  const [tags, setTags] = useState("");
  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await run(() =>
          createResource({
            title,
            type,
            url: url || null,
            summary: summary || null,
            tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
            goalIds: goalId ? [goalId] : [],
            milestoneIds: milestoneId ? [milestoneId] : [],
            companyIds: companyId ? [companyId] : [],
            decisionIds: defaults?.decisionId ? [defaults.decisionId] : [],
          }),
        );
        if (res.ok) onDone();
      }}
    >
      <Field label="Title" htmlFor="res-title">
        <Input id="res-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} required />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type">
          <SimpleSelect value={type} onChange={(v) => v && setType(v as ResourceType)} options={(Object.keys(RESOURCE_TYPES) as ResourceType[]).map((t) => ({ value: t, label: RESOURCE_TYPES[t].label }))} />
        </Field>
        <Field label="Link" htmlFor="res-url">
          <Input id="res-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        </Field>
      </div>
      <Field label="Summary" htmlFor="res-summary">
        <Textarea id="res-summary" rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Goal">
          <GoalSelect value={goalId} onChange={setGoalId} />
        </Field>
        <Field label="Milestone">
          <MilestoneSelect value={milestoneId} onChange={setMilestoneId} />
        </Field>
        <Field label="Company">
          <CompanySelect value={companyId} onChange={setCompanyId} />
        </Field>
      </div>
      <Field label="Tags" htmlFor="res-tags" hint="Comma separated">
        <Input id="res-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
      </Field>
      <Footer pending={pending} label="Add resource" onCancel={onDone} />
    </form>
  );
}
