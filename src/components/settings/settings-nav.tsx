"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { SETTINGS_SECTIONS } from "./section";

/**
 * Anchor navigation for the settings page. Sticky rail on desktop, wrapped
 * chips on mobile. Tracks the section in view (scroll-spy).
 */
export function SettingsNav({ links = [] }: { links?: { href: string; label: string }[] }) {
  const [active, setActive] = useState<string>(SETTINGS_SECTIONS[0].id);

  useEffect(() => {
    const els = SETTINGS_SECTIONS.map((s) => document.getElementById(s.id)).filter((e): e is HTMLElement => Boolean(e));
    if (els.length === 0) return;
    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.set(e.target.id, e.boundingClientRect.top);
          else visible.delete(e.target.id);
        }
        // The topmost visible section wins; at page bottom prefer the last one.
        const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
        if (atBottom) {
          setActive(SETTINGS_SECTIONS[SETTINGS_SECTIONS.length - 1].id);
          return;
        }
        const first = SETTINGS_SECTIONS.find((s) => visible.has(s.id));
        if (first) setActive(first.id);
      },
      { rootMargin: "-56px 0px -55% 0px", threshold: 0 },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <nav aria-label="Settings sections" className="xl:sticky xl:top-16">
      <ul className="flex flex-wrap gap-1.5 xl:flex-col xl:gap-0.5">
        {SETTINGS_SECTIONS.map((s) => {
          const current = active === s.id;
          return (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                aria-current={current ? "location" : undefined}
                onClick={() => setActive(s.id)}
                className={cn(
                  "block rounded-md border px-2.5 py-1 text-xs transition-colors xl:border-transparent xl:py-1.5 xl:text-[14px]",
                  current
                    ? "border-border bg-surface font-medium text-foreground xl:bg-muted"
                    : "border-border bg-surface text-muted-foreground hover:bg-muted hover:text-foreground xl:bg-transparent",
                )}
              >
                {s.label}
              </a>
            </li>
          );
        })}
      </ul>
      {links.length > 0 && (
        <>
          <h3 className="mt-3 mb-1 hidden px-2.5 text-2xs font-medium tracking-[0.06em] text-ink-3 uppercase xl:block">Administration</h3>
          <ul className="mt-1.5 flex flex-wrap gap-1.5 xl:mt-0 xl:flex-col xl:gap-0.5" aria-label="Administration">
            {links.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="block rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground xl:border-transparent xl:bg-transparent xl:py-1.5 xl:text-[14px]"
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </nav>
  );
}
