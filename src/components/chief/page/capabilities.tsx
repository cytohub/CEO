"use client";

import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Mirrors the CytoHub Brain tools available to the Chief of Staff (src/server/chief/claude-engine.ts). */
const TOOLS: [string, string][] = [
  ["Priorities & inbox", "Today’s Top 5, the brief headline and open CEO inbox items"],
  ["Tasks", "Overdue, due soon, delegable, waiting, postponed and blocked work"],
  ["Goals & milestones", "Status, progress, confidence, risks and what’s due"],
  ["Decisions", "Pending calls, decisions waiting on information, recent outcomes"],
  ["Calendar", "Meetings and deadlines ahead"],
  ["Attention allocation", "Where your time went versus your targets"],
  ["Pipelines", "Pharma, investor and partnership deals"],
  ["Delegation", "What to hand off and what needs follow-up"],
  ["Recent intelligence", "Brain insights and what changed"],
  ["Relationships", "Investors, customers and partners overdue for contact"],
  ["Scoreboard", "ARR, revenue, cash & runway, science and team metrics"],
  ["Time sinks", "Work that took far longer than planned or had low impact"],
  ["Search", "Everything CytoHub Brain has indexed"],
  ["Entity context", "Everything about a company, person, goal or deal"],
  ["Meeting prep", "A brief for your next important meeting"],
];

export function CapabilitiesDisclosure() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm">
          <Eye /> <span className="hidden sm:inline">What it can see</span>
          <span className="sr-only sm:hidden">What the Chief of Staff can see</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] p-0">
        <div className="border-b border-hairline px-3.5 py-2.5">
          <div className="text-[14px] font-semibold">What the Chief of Staff can see</div>
          <p className="mt-0.5 text-2xs text-muted-foreground">Read-only access to live CytoHub Brain data. It can’t change anything — you act on its answers.</p>
        </div>
        <ul className="scrollbar-thin max-h-[min(60dvh,420px)] divide-y divide-hairline overflow-y-auto">
          {TOOLS.map(([name, detail]) => (
            <li key={name} className="px-3.5 py-1.5">
              <div className="text-xs font-medium text-foreground">{name}</div>
              <div className="text-2xs text-muted-foreground">{detail}</div>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
