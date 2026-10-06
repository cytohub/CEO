"use client";

import { ArrowLeft, CheckCircle2, CircleDot, FilePlus2, Flag, Gavel, Loader2, Moon, Plus, RefreshCcw, Search, Sparkles, Target, UserPlus } from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { RESULT_ICONS } from "@/components/search/highlight";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { type CommandSearchHit, runDailyRefresh, searchBrain } from "@/server/actions/brain";
import { completeTask, listPickerTasks } from "@/server/actions/tasks";
import { RESULT_LABELS } from "@/server/ingestion/search/types";
import { navFor } from "./nav";
import { useCan, useUI } from "./ui-context";

type Page = "root" | "complete" | "delegate";

/** Questions get a one-line answer from the planner; keywords just list hits. */
const QUESTION = /^(what|which|who|whom|how|when|where|show|did|do|does|is|are|any)\b|\?$/i;

export function CommandBar() {
  const router = useRouter();
  const { commandOpen, setCommandOpen, openCreate, openChief, openDelegate, viewer } = useUI();
  // UI hints only: every action re-checks the capability on the server.
  const canEdit = useCan("workspace.edit");
  const canCockpit = useCan("cockpit.view");
  const canChief = useCan("chief.use");
  const canSearch = useCan("search.use");
  const { resolvedTheme, setTheme } = useTheme();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<Page>("root");
  const [hits, setHits] = useState<CommandSearchHit[]>([]);
  const [answer, setAnswer] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [pickerTasks, setPickerTasks] = useState<{ id: string; title: string; subtitle: string }[] | null>(null);
  const [pending, startTransition] = useTransition();
  const latest = useRef(0);

  // Reset when closed.
  useEffect(() => {
    if (!commandOpen) {
      const t = setTimeout(() => {
        setQuery("");
        setPage("root");
        setHits([]);
        setAnswer(null);
      }, 150);
      return () => clearTimeout(t);
    }
  }, [commandOpen]);

  // Debounced universal search on the root page; the latest request wins.
  useEffect(() => {
    if (!canSearch || page !== "root" || query.trim().length < 2) return;
    const seq = ++latest.current;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await searchBrain(query);
        if (seq !== latest.current) return;
        setHits(res.hits);
        setAnswer(QUESTION.test(query.trim()) ? res.answer : null);
      } catch {
        if (seq === latest.current) setHits([]);
      } finally {
        if (seq === latest.current) setSearching(false);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [query, page, canSearch]);
  const active = page === "root" && query.trim().length >= 2;
  const visibleHits = active ? hits : [];
  const visibleAnswer = active ? answer : null;

  useEffect(() => {
    if ((page === "complete" || page === "delegate") && pickerTasks === null) {
      listPickerTasks().then(setPickerTasks);
    }
  }, [page, pickerTasks]);

  const close = () => setCommandOpen(false);
  const run = (fn: () => void) => {
    close();
    fn();
  };

  const navItems = useMemo(() => navFor(viewer.capabilities).all, [viewer.capabilities]);
  const openSearchPage = () => run(() => router.push(`/search?q=${encodeURIComponent(query.trim())}`));

  return (
    <CommandDialog
      open={commandOpen}
      onOpenChange={setCommandOpen}
      title="Command bar"
      description="Search CytoHub Brain, navigate, or run a command"
      className="sm:max-w-xl"
    >
      <Command loop>
        <CommandInput
          placeholder={page === "root" ? "Search or ask CytoHub Brain, or type a command…" : page === "complete" ? "Complete which task?" : "Delegate which task?"}
          value={query}
          onValueChange={setQuery}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !query && page !== "root") {
              e.preventDefault();
              setPage("root");
            }
          }}
        />
        <CommandList className="max-h-[440px]">
          <CommandEmpty>{searching ? "Searching…" : "No results."}</CommandEmpty>

          {page !== "root" && (
            <CommandGroup heading={page === "complete" ? "Your open tasks" : "Tasks you could delegate"}>
              <CommandItem onSelect={() => setPage("root")} value="back">
                <ArrowLeft /> Back
              </CommandItem>
              {pickerTasks === null && (
                <CommandItem disabled value="loading">
                  <Loader2 className="animate-spin" /> Loading tasks…
                </CommandItem>
              )}
              {pickerTasks?.map((t) => (
                <CommandItem
                  key={t.id}
                  value={`${t.title} ${t.id}`}
                  onSelect={() => {
                    if (page === "complete") {
                      close();
                      startTransition(async () => {
                        const res = await completeTask(t.id);
                        if (res.ok) toast.success(`Completed “${t.title}”`);
                        else toast.error(res.error);
                      });
                    } else {
                      run(() => openDelegate(t.id));
                    }
                  }}
                >
                  {page === "complete" ? <CheckCircle2 /> : <UserPlus />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{t.title}</div>
                    <div className="truncate text-2xs text-muted-foreground">{t.subtitle}</div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {page === "root" && (
            <>
              {active && (
                <CommandGroup heading="Ask">
                  {canSearch && (
                    <CommandItem value={`search page ${query}`} keywords={[query]} onSelect={openSearchPage}>
                      <Search className="text-ink-3" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate">Search for “{query.trim()}”</div>
                        {visibleAnswer && <div className="line-clamp-2 text-2xs whitespace-normal text-muted-foreground">{visibleAnswer}</div>}
                      </div>
                      <CommandShortcut>↵</CommandShortcut>
                    </CommandItem>
                  )}
                  {canChief && query.trim().length > 2 && (
                    <CommandItem value={`ask chief ${query}`} keywords={[query]} onSelect={() => run(() => openChief(query))}>
                      <Sparkles className="text-brain" />
                      Ask Chief of Staff: “{query.trim()}”
                    </CommandItem>
                  )}
                </CommandGroup>
              )}

              {visibleHits.length > 0 && (
                <CommandGroup heading="CytoHub Brain">
                  {visibleHits.map((h) => {
                    const Icon = RESULT_ICONS[h.type];
                    return (
                      <CommandItem key={`${h.type}-${h.id}`} value={`${h.type} ${h.title} ${h.id}`} keywords={[query]} onSelect={() => run(() => router.push(h.href))}>
                        <Icon className="text-ink-3" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate">{h.title}</div>
                          {h.subtitle && <div className="truncate text-2xs text-muted-foreground">{h.subtitle}</div>}
                        </div>
                        <span className="shrink-0 text-2xs text-muted-foreground">{RESULT_LABELS[h.type].label}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}

              {(canEdit || canChief || canCockpit) && (
                <CommandGroup heading="Actions">
                  {canEdit && (
                    <>
                      <CommandItem onSelect={() => run(() => openCreate("task"))} value="Create task new">
                        <Plus /> Create task <CommandShortcut>C</CommandShortcut>
                      </CommandItem>
                      <CommandItem onSelect={() => run(() => openCreate("goal"))} value="Create goal">
                        <Target /> Create goal
                      </CommandItem>
                      <CommandItem onSelect={() => run(() => openCreate("milestone"))} value="Create milestone">
                        <Flag /> Create milestone
                      </CommandItem>
                      <CommandItem onSelect={() => run(() => openCreate("decision"))} value="Record decision">
                        <Gavel /> Record decision
                      </CommandItem>
                      <CommandItem onSelect={() => run(() => openCreate("resource"))} value="Add resource document link">
                        <FilePlus2 /> Add resource
                      </CommandItem>
                      <CommandItem
                        onSelect={() => {
                          setQuery("");
                          setPage("delegate");
                        }}
                        value="Delegate task"
                      >
                        <UserPlus /> Delegate task…
                      </CommandItem>
                      <CommandItem
                        onSelect={() => {
                          setQuery("");
                          setPage("complete");
                        }}
                        value="Complete task done"
                      >
                        <CheckCircle2 /> Complete task…
                      </CommandItem>
                    </>
                  )}
                  {canChief && (
                    <CommandItem onSelect={() => run(() => openChief())} value="Ask Chief of Staff AI assistant">
                      <Sparkles className="text-brain" /> Ask Chief of Staff <CommandShortcut>⌘J</CommandShortcut>
                    </CommandItem>
                  )}
                  {canCockpit && (
                    <CommandItem
                      value="Run Daily Brain Refresh"
                      disabled={pending}
                      onSelect={() => {
                        close();
                        startTransition(async () => {
                          const id = toast.loading("Running Daily Brain Refresh…");
                          const res = await runDailyRefresh();
                          if (res.ok) toast.success(res.message ?? "Brain refreshed", { id });
                          else toast.error(res.error, { id });
                        });
                      }}
                    >
                      <RefreshCcw /> Run Daily Refresh
                    </CommandItem>
                  )}
                </CommandGroup>
              )}

              <CommandSeparator />
              <CommandGroup heading="Navigate">
                {canCockpit && (
                  <CommandItem value="Open Today's priorities top 5" onSelect={() => run(() => router.push("/"))}>
                    <CircleDot /> Open Today’s Priorities <CommandShortcut>G T</CommandShortcut>
                  </CommandItem>
                )}
                {navItems
                  .filter((n) => n.href !== "/")
                  .map((n) => (
                    <CommandItem key={n.href} value={`Open ${n.label}`} onSelect={() => run(() => router.push(n.href))}>
                      <n.icon /> Open {n.label}
                      {n.chord && <CommandShortcut>G {n.chord.toUpperCase()}</CommandShortcut>}
                    </CommandItem>
                  ))}
                <CommandItem value="Toggle theme dark light mode" onSelect={() => run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))}>
                  <Moon /> Toggle light / dark mode
                </CommandItem>
              </CommandGroup>
            </>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
