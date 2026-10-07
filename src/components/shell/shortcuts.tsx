"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/common/status";
import { navFor } from "./nav";
import { useUI } from "./ui-context";

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/**
 * Global keyboard model (Linear-style):
 *   ⌘K command bar · ⌘J Chief of Staff · C create task · ? shortcuts
 *   G then T/B/I/K/D/U/E/G/M/S/R/W/O/P/C/, to navigate
 */
export function KeyboardShortcuts() {
  const router = useRouter();
  const { setCommandOpen, commandOpen, openChief, openCreate, setShortcutsOpen, viewer } = useUI();
  const allNav = navFor(viewer.capabilities).all;
  const canChief = viewer.capabilities.includes("chief.use");
  const canCreate = viewer.capabilities.includes("workspace.edit");
  const chord = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen(!commandOpen);
        return;
      }
      if (mod && e.key.toLowerCase() === "j") {
        e.preventDefault();
        if (canChief) openChief();
        return;
      }
      if (mod || e.altKey || isTyping(e.target) || document.querySelector("[role=dialog]")) return;

      const key = e.key.toLowerCase();
      const pending = chord.current;
      if (pending && pending.key === "g" && Date.now() - pending.at < 1200) {
        chord.current = null;
        const target = allNav.find((n) => n.chord === key);
        if (target) {
          e.preventDefault();
          router.push(target.href);
        }
        return;
      }
      if (key === "g") {
        chord.current = { key: "g", at: Date.now() };
        return;
      }
      if (key === "c") {
        e.preventDefault();
        if (canCreate) openCreate("task");
      } else if (key === "?") {
        e.preventDefault();
        setShortcutsOpen(true);
      } else if (key === "/") {
        e.preventDefault();
        setCommandOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, setCommandOpen, commandOpen, openChief, openCreate, setShortcutsOpen, allNav, canChief, canCreate]);

  return null;
}

export function ShortcutsDialog() {
  const { shortcutsOpen, setShortcutsOpen, viewer } = useUI();
  const allNav = navFor(viewer.capabilities).all;
  const general: [string[], string][] = [
    [["⌘", "K"], "Command bar & search"],
    [["⌘", "J"], "Ask Chief of Staff"],
    [["C"], "Create task"],
    [["/"], "Search"],
    [["?"], "Keyboard shortcuts"],
  ];
  return (
    <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Move through the command center without touching the mouse.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <div className="eyebrow mb-2">General</div>
            <ul className="space-y-1.5">
              {general.map(([keys, label]) => (
                <li key={label} className="flex items-center justify-between gap-3 text-[14px]">
                  <span className="text-ink-2">{label}</span>
                  <span className="flex gap-0.5">
                    {keys.map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="eyebrow mb-2">Go to (press G, then)</div>
            <ul className="space-y-1.5">
              {allNav.filter((n) => n.chord).map((n) => (
                <li key={n.href} className="flex items-center justify-between gap-3 text-[14px]">
                  <span className="text-ink-2">{n.label}</span>
                  <span className="flex gap-0.5">
                    <Kbd>G</Kbd>
                    <Kbd>{n.chord!.toUpperCase()}</Kbd>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
