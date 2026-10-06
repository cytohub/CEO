"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun, hint: "Warm-neutral surfaces" },
  { value: "dark", label: "Dark", icon: Moon, hint: "Low-glare for late reviews" },
  { value: "system", label: "System", icon: Monitor, hint: "Follow your OS setting" },
] as const;

export function AppearanceForm() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const current = mounted ? (theme ?? "system") : null;

  return (
    <div className="panel p-4">
      <div role="radiogroup" aria-label="Theme" className="grid gap-2 sm:grid-cols-3">
        {OPTIONS.map((o) => {
          const Icon = o.icon;
          const checked = current === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => setTheme(o.value)}
              onKeyDown={(e) => {
                if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
                e.preventDefault();
                const idx = OPTIONS.findIndex((x) => x.value === o.value);
                const next = OPTIONS[(idx + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : OPTIONS.length - 1)) % OPTIONS.length];
                setTheme(next.value);
                (e.currentTarget.parentElement?.querySelector(`[data-value="${next.value}"]`) as HTMLElement | null)?.focus();
              }}
              tabIndex={checked || (!current && o.value === "system") ? 0 : -1}
              data-value={o.value}
              className={cn(
                "flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                checked ? "border-foreground bg-surface-2" : "border-border hover:bg-muted/60",
              )}
            >
              <span className={cn("flex size-7 items-center justify-center rounded-md", checked ? "bg-foreground text-background" : "bg-muted text-ink-2")}>
                <Icon className="size-3.5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-foreground">{o.label}</span>
                <span className="block text-2xs text-muted-foreground">{o.hint}</span>
              </span>
              <span
                aria-hidden
                className={cn("ml-auto flex size-3.5 shrink-0 items-center justify-center rounded-full border", checked ? "border-foreground" : "border-input")}
              >
                {checked && <span className="size-1.5 rounded-full bg-foreground" />}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-2xs text-muted-foreground">
        {mounted ? (
          <>
            Currently showing <span className="font-medium text-ink-2">{resolvedTheme === "dark" ? "dark" : "light"}</span>
            {theme === "system" ? " (from your system)" : ""}. Saved in this browser.
          </>
        ) : (
          "Saved in this browser."
        )}
      </p>
    </div>
  );
}
