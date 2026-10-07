"use client";

import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/common/fields";

export function FilterToolbar({
  query,
  onQuery,
  searchLabel,
  placeholder,
  type,
  onType,
  typeOptions,
  shown,
  total,
  noun,
  children,
}: {
  query: string;
  onQuery: (q: string) => void;
  searchLabel: string;
  placeholder: string;
  type: string | null;
  onType: (t: string | null) => void;
  typeOptions: { value: string; label: string }[];
  shown: number;
  total: number;
  noun: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 flex-1 basis-[220px] sm:max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
        <Input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && query) {
              e.stopPropagation();
              onQuery("");
            }
          }}
          aria-label={searchLabel}
          placeholder={placeholder}
          className="h-7 pr-7 pl-8 text-[15px] [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQuery("")}
            className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded text-ink-3 hover:bg-muted hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="size-3" aria-hidden />
          </button>
        )}
      </div>
      <SimpleSelect size="sm" className="w-[176px]" value={type} onChange={onType} allowNone noneLabel="All types" options={typeOptions} ariaLabel="Filter by type" />
      {children}
      <span className="ml-auto text-2xs text-muted-foreground tabular" aria-live="polite">
        {shown === total ? `${total} ${noun}` : `${shown} of ${total} ${noun}`}
      </span>
    </div>
  );
}
