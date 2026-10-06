"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, PersonSelect } from "@/components/common/fields";
import { useAction } from "@/components/common/use-action";
import { useUI } from "@/components/shell/ui-context";
import { dayKey } from "@/lib/dates";
import { delegateTask, fetchTaskDetail } from "@/server/actions/tasks";
import type { TaskDetail } from "@/server/queries/tasks";

export function DelegateDialog() {
  const { delegateTaskId, closeDelegate } = useUI();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [delegateId, setDelegateId] = useState<string | null>(null);
  const [dueDate, setDue] = useState("");
  const [expectations, setExpectations] = useState("");
  const { pending, run } = useAction();

  useEffect(() => {
    if (!delegateTaskId) return;
    let cancelled = false;
    fetchTaskDetail(delegateTaskId).then((t) => {
      if (cancelled || !t) return;
      setTask(t);
      setDelegateId(t.suggestedDelegate?.id ?? null);
      setDue(t.dueDate ? dayKey(t.dueDate) : "");
      setExpectations(t.description ?? "");
    });
    return () => {
      cancelled = true;
      setTask(null);
    };
  }, [delegateTaskId]);

  return (
    <Dialog open={Boolean(delegateTaskId)} onOpenChange={(o) => !o && closeDelegate()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delegate task</DialogTitle>
          <DialogDescription className="line-clamp-2">{task?.title ?? "Loading…"}</DialogDescription>
        </DialogHeader>
        {task?.suggestedDelegate && (
          <div className="flex items-start gap-2 rounded-lg bg-brain-soft px-3 py-2 text-xs text-ink-2">
            <Sparkles className="mt-0.5 size-3.5 shrink-0 text-brain" aria-hidden />
            <span>
              CytoHub Brain suggests <span className="font-medium text-foreground">{task.suggestedDelegate.name}</span> — this doesn’t require you personally and matches their area.
            </span>
          </div>
        )}
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!delegateTaskId || !delegateId) return;
            const res = await run(() => delegateTask(delegateTaskId, { delegateId, dueDate: dueDate || null, expectations: expectations || null }));
            if (res.ok) closeDelegate();
          }}
        >
          <Field label="Delegate to">
            <PersonSelect value={delegateId} onChange={setDelegateId} teamOnly placeholder="Choose a team member" />
          </Field>
          <Field label="Due date" htmlFor="del-due">
            <Input id="del-due" type="date" value={dueDate} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <Field label="Expectations" htmlFor="del-exp" hint="What does done look like? When do you want an update?">
            <Textarea id="del-exp" rows={3} value={expectations} onChange={(e) => setExpectations(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={closeDelegate}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !delegateId}>
              {pending && <Loader2 className="animate-spin" />}
              Delegate
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
