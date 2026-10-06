"use client";

import {
  ArrowLeft,
  Building2,
  CalendarClock,
  CheckCircle2,
  CheckSquare,
  CircleDot,
  FilePlus2,
  FileText,
  Flag,
  Gavel,
  Lightbulb,
  Loader2,
  Moon,
  Plus,
  RefreshCcw,
  Sparkles,
  Target,
  User,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
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
import { runDailyRefresh, searchBrain } from "@/server/actions/brain";
import { completeTask, listPickerTasks } from "@/server/actions/tasks";
import type { SearchHit, SearchHitType } from "@/server/brain/search";
import { navFor } from "./nav";
import { useUI } from "./ui-context";

const HIT_LABEL: Record<SearchHitType, string> = {
  task: "Task",
  goal: "Goal",
  milestone: "Milestone",
  decision: "Decision",
  person: "Person",
  company: "Company",
  resource: "Resource",
  insight: "Insight",
  meeting: "Meeting",
};

const HIT_ICON: Record<SearchHitType, LucideIcon> = {
  task: CheckSquare,
  goal: Target,
  milestone: Flag,
  decision: Gavel,
  person: User,
  company: Building2,
  resource: FileText,
  insight: Lightbulb,
  meeting: CalendarClock,
};

type Page = "root" | "complete" | "delegate";

export function CommandBar() {
  const router = useRouter();
  const { commandOpen, setCommandOpen, openCreate, openChief, openDelegate, viewer } = useUI();
  const { resolvedTheme, setTheme } = useTheme();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<Page>("root");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [pickerTasks, setPickerTasks] = useState<{ id: string; title: string; subtitle: string }[] | null>(null);
  const [pending, startTransition] = useTransition();

  // Reset when closed.
  useEffect(() => {
    if (!commandOpen) {
      const t = setTimeout(() => {
        setQuery("");
        setPage("root");
        setHits([]);
      }, 150);
      return () => clearTimeout(t);
    }
  }, [commandOpen]);

  // Debounced Brain search on the root page.
  useEffect(() => {
    if (page !== "root" || query.trim().length < 2) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await searchBrain(query);
        if (!cancelled) setHits(res);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, page]);
  const visibleHits = page === "root" && query.trim().length >= 2 ? hits : [];

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
          placeholder={page === "root" ? "Search CytoHub Brain or type a command…" : page === "complete" ? "Complete which task?" : "Delegate which task?"}
          value={query}
          onValueChange={setQuery}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !query && page !== "root") {
              e.preventDefault();
              setPage("root");
            }
          }}
        />
        <CommandList className="max-h-[420px]">
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
              {query.trim().length > 2 && (
                <CommandGroup heading="Chief of Staff">
                  <CommandItem value={`ask ${query}`} keywords={[query]} onSelect={() => run(() => openChief(query))}>
                    <Sparkles className="text-brain" />
                    Ask: “{query}”
                    <CommandShortcut>↵</CommandShortcut>
                  </CommandItem>
                </CommandGroup>
              )}

              {visibleHits.length > 0 && (
                <CommandGroup heading="CytoHub Brain">
                  {visibleHits.map((h) => {
                    const Icon = HIT_ICON[h.type];
                    return (
                      <CommandItem key={`${h.type}-${h.id}`} value={`${h.type} ${h.title} ${h.id}`} keywords={[query]} onSelect={() => run(() => router.push(h.href))}>
                        <Icon className="text-ink-3" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate">{h.title}</div>
                          {h.subtitle && <div className="truncate text-2xs text-muted-foreground">{h.subtitle}</div>}
                        </div>
                        <span className="text-2xs text-muted-foreground">{HIT_LABEL[h.type]}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}

              <CommandGroup heading="Actions">
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
                <CommandItem onSelect={() => run(() => openChief())} value="Ask Chief of Staff AI assistant">
                  <Sparkles className="text-brain" /> Ask Chief of Staff <CommandShortcut>⌘J</CommandShortcut>
                </CommandItem>
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
              </CommandGroup>

              <CommandSeparator />
              <CommandGroup heading="Navigate">
                <CommandItem value="Open Today's priorities top 5" onSelect={() => run(() => router.push("/"))}>
                  <CircleDot /> Open Today’s Priorities <CommandShortcut>G T</CommandShortcut>
                </CommandItem>
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
