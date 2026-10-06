"use client";

import { Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/common/fields";
import { cn } from "@/lib/utils";

/** Read/write one search param; filters live in the URL so views are shareable and server-filtered. */
export function useUrlParam() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const set = (updates: Record<string, string | null>) => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v == null || v === "") p.delete(k);
      else p.set(k, v);
    }
    const qs = p.toString();
    start(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };
  return { params, set, pending };
}

export function UrlSelect({
  param,
  options,
  allLabel,
  ariaLabel,
  className,
  defaultValue = null,
}: {
  param: string;
  options: { value: string; label: string }[];
  allLabel: string;
  ariaLabel: string;
  className?: string;
  defaultValue?: string | null;
}) {
  const { params, set } = useUrlParam();
  return (
    <SimpleSelect
      size="sm"
      className={cn("w-[170px]", className)}
      value={params.get(param) ?? defaultValue}
      onChange={(v) => set({ [param]: v })}
      allowNone
      noneLabel={allLabel}
      options={options}
      ariaLabel={ariaLabel}
    />
  );
}

/** Debounced search box bound to `?q=`. */
export function UrlSearch({ placeholder, label, className }: { placeholder: string; label: string; className?: string }) {
  const { params, set } = useUrlParam();
  const initial = params.get("q") ?? "";
  const [value, setValue] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setRef = useRef(set);
  useEffect(() => {
    setRef.current = set;
  });
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const update = (v: string) => {
    setValue(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setRef.current({ q: v.trim() || null }), 300);
  };
  return (
    <div className={cn("relative min-w-0 flex-1 basis-[200px] sm:max-w-xs", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
      <Input
        type="search"
        value={value}
        onChange={(e) => update(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.stopPropagation();
            update("");
          }
        }}
        aria-label={label}
        placeholder={placeholder}
        className="h-7 pr-7 pl-8 text-[13px] [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button type="button" onClick={() => update("")} className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded text-ink-3 hover:bg-muted hover:text-foreground" aria-label="Clear search">
          <X className="size-3" aria-hidden />
        </button>
      )}
    </div>
  );
}

/** Tab strip rendered as links (server-friendly), matching the Brain page tabs. */
export function TabLink({ href, active, children, count }: { href: string; active: boolean; children: React.ReactNode; count?: number }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "page" : undefined}
      className={cn(
        "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors",
        active ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      {count !== undefined && count > 0 && <span className={cn("rounded px-1 text-2xs tabular", active ? "bg-muted text-foreground" : "bg-muted text-muted-foreground")}>{count}</span>}
    </Link>
  );
}
