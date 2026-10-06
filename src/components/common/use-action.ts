"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/server/actions/result";

/**
 * Run a server action with pending state and toast feedback.
 * Returns the result so callers can close dialogs on success.
 */
export function useAction() {
  const [pending, startTransition] = useTransition();
  function run<T>(fn: () => Promise<ActionResult<T>>, opts: { success?: string | false; onSuccess?: (data: T) => void } = {}) {
    return new Promise<ActionResult<T>>((resolve) => {
      startTransition(async () => {
        const res = await fn();
        if (res.ok) {
          if (opts.success !== false) toast.success(opts.success ?? res.message ?? "Saved");
          opts.onSuccess?.(res.data);
        } else {
          toast.error(res.error);
        }
        resolve(res);
      });
    });
  }
  return { pending, run };
}
