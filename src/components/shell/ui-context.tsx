"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { Lookups } from "@/server/queries/shell";

export type CreateKind = "task" | "goal" | "milestone" | "decision" | "resource";

export interface CreateDefaults {
  goalId?: string;
  milestoneId?: string;
  pillarId?: string;
  companyId?: string;
  decisionId?: string;
  title?: string;
  dueDate?: string;
}

interface UIState {
  lookups: Lookups;
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
  chief: { open: boolean; prompt?: string; nonce: number };
  openChief: (prompt?: string) => void;
  closeChief: () => void;
  create: { kind: CreateKind | null; defaults?: CreateDefaults };
  openCreate: (kind: CreateKind, defaults?: CreateDefaults) => void;
  closeCreate: () => void;
  delegateTaskId: string | null;
  openDelegate: (taskId: string) => void;
  closeDelegate: () => void;
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
  /** Open an entity sheet via the URL (`?task=` / `?milestone=`), preserving the current page. */
  openEntity: (kind: "task" | "milestone" | "meeting", id: string) => void;
  closeEntity: (kind: "task" | "milestone" | "meeting") => void;
}

const UIContext = createContext<UIState | null>(null);

export function UIProvider({ lookups, children }: { lookups: Lookups; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [commandOpen, setCommandOpen] = useState(false);
  const [chief, setChief] = useState<{ open: boolean; prompt?: string; nonce: number }>({ open: false, nonce: 0 });
  const [create, setCreate] = useState<{ kind: CreateKind | null; defaults?: CreateDefaults }>({ kind: null });
  const [delegateTaskId, setDelegateTaskId] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const openEntity = useCallback(
    (kind: "task" | "milestone" | "meeting", id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(kind, id);
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );
  const closeEntity = useCallback(
    (kind: "task" | "milestone" | "meeting") => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete(kind);
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const value = useMemo<UIState>(
    () => ({
      lookups,
      commandOpen,
      setCommandOpen,
      chief,
      openChief: (prompt?: string) => setChief((c) => ({ open: true, prompt, nonce: c.nonce + 1 })),
      closeChief: () => setChief((c) => ({ ...c, open: false, prompt: undefined })),
      create,
      openCreate: (kind, defaults) => setCreate({ kind, defaults }),
      closeCreate: () => setCreate({ kind: null }),
      delegateTaskId,
      openDelegate: setDelegateTaskId,
      closeDelegate: () => setDelegateTaskId(null),
      shortcutsOpen,
      setShortcutsOpen,
      mobileNavOpen,
      setMobileNavOpen,
      openEntity,
      closeEntity,
    }),
    [lookups, commandOpen, chief, create, delegateTaskId, shortcutsOpen, mobileNavOpen, openEntity, closeEntity],
  );

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUI() {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error("useUI must be used inside <UIProvider>");
  return ctx;
}

export function useLookups() {
  return useUI().lookups;
}
