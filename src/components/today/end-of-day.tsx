"use client";

import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/components/common/use-action";
import { completeEndOfDay } from "@/server/actions/dayplan";

export interface EodTask {
  id: string;
  title: string;
  done: boolean;
}

/**
 * End-of-day review: what got done, what rolls to tomorrow, and a short
 * reflection. Saved history feeds tomorrow's Brain refresh.
 */
export function EndOfDayDialog({ open, onOpenChange, tasks, notes }: { open: boolean; onOpenChange: (o: boolean) => void; tasks: EodTask[]; notes: string | null }) {
  const unfinished = tasks.filter((t) => !t.done);
  const [roll, setRoll] = useState<string[]>(unfinished.map((t) => t.id));
  const [text, setText] = useState(notes ?? "");
  const { pending, run } = useAction();
  const done = tasks.filter((t) => t.done).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>End-of-day review</DialogTitle>
          <DialogDescription>
            {done} of {tasks.length} priorities completed. Close the loop so tomorrow’s recommendations get smarter.
          </DialogDescription>
        </DialogHeader>
        <ul className="divide-y divide-hairline rounded-lg border border-border">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
              {t.done ? <CheckCircle2 className="size-4 text-good" aria-label="Done" /> : <Circle className="size-4 text-ink-3" aria-label="Not done" />}
              <span className={t.done ? "flex-1 text-muted-foreground line-through" : "flex-1"}>{t.title}</span>
              {!t.done && (
                <label className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                  <Checkbox checked={roll.includes(t.id)} onCheckedChange={(c) => setRoll((r) => (c ? [...r, t.id] : r.filter((x) => x !== t.id)))} />
                  Roll to tomorrow
                </label>
              )}
            </li>
          ))}
          {tasks.length === 0 && <li className="px-3 py-3 text-xs text-muted-foreground">No priorities were set today.</li>}
        </ul>
        <div className="grid gap-1.5">
          <label htmlFor="eod-notes" className="text-xs font-medium text-ink-2">
            Reflection — what moved the company forward? What got in the way?
          </label>
          <Textarea id="eod-notes" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={async () => {
              const res = await run(() => completeEndOfDay({ notes: text || null, rollOver: roll }));
              if (res.ok) onOpenChange(false);
            }}
          >
            {pending && <Loader2 className="animate-spin" />}
            Close the day
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
