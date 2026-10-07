"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const setup = /DATABASE_URL|db:seed|No CEO user|connect|ECONNREFUSED|does not exist/i.test(error.message);
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-3 py-24 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-critical-soft">
        <AlertTriangle className="size-5 text-critical-ink" aria-hidden />
      </div>
      <h1 className="text-base font-semibold">{setup ? "CytoHub Brain can’t reach its data" : "Something went wrong"}</h1>
      <p className="text-[14px] text-muted-foreground">
        {setup ? (
          <>
            Check that PostgreSQL is running and <code className="rounded bg-muted px-1">DATABASE_URL</code> is set, then run{" "}
            <code className="rounded bg-muted px-1">npm run db:setup</code> to migrate and load the CytoHub workspace.
          </>
        ) : (
          "This view failed to load. Your data is safe — try again."
        )}
      </p>
      {error.digest && <p className="font-mono text-2xs text-muted-foreground">Ref {error.digest}</p>}
      <Button variant="outline" size="sm" onClick={reset} className="mt-2">
        <RotateCcw /> Try again
      </Button>
    </div>
  );
}
