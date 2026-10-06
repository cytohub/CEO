"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

const INTERVAL_MS = 30_000;
const STORAGE_KEY = "cytohub.health.autoRefresh";

// Preference store: localStorage when available, memory otherwise (private mode, blocked storage).
let memory = false;
const listeners = new Set<() => void>();
function read(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return memory;
  }
}
function write(value: boolean) {
  memory = value;
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    // Not persisted; the in-memory value still applies for this page.
  }
  listeners.forEach((l) => l());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** Re-fetch the server-rendered dashboard on demand or every 30 s (remembered per browser). */
export function AutoRefresh() {
  const router = useRouter();
  const on = useSyncExternalStore(subscribe, read, () => false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") startTransition(() => router.refresh());
    }, INTERVAL_MS);
    return () => clearInterval(t);
  }, [on, router]);

  return (
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-1.5 text-xs text-ink-2">
        <Switch
          size="sm"
          checked={on}
          onCheckedChange={write}
        />
        Auto-refresh
      </label>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => startTransition(() => router.refresh())}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
        Refresh
      </Button>
    </div>
  );
}
