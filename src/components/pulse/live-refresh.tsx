"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Keeps a server-rendered page current while it stays open: re-fetches every
 * few minutes while the tab is visible, and straight away when someone comes
 * back to a tab that has gone stale. Renders nothing.
 */
export function LiveRefresh({ everyMs = 5 * 60_000 }: { everyMs?: number }) {
  const router = useRouter();
  const last = useRef(0);

  useEffect(() => {
    last.current = Date.now();
    const refresh = () => {
      last.current = Date.now();
      router.refresh();
    };
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, everyMs);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - last.current >= everyMs) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [everyMs, router]);

  return null;
}
