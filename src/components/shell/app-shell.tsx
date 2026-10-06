"use client";

import { Suspense } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import type { ShellData } from "@/server/queries/shell";
import { ChiefOfStaffPanel } from "@/components/chief/chief-panel";
import { CreateDialogs } from "@/components/dialogs/create-dialogs";
import { DelegateDialog } from "@/components/dialogs/delegate-dialog";
import { EntitySheets } from "@/components/tasks/entity-sheets";
import { CommandBar } from "./command-bar";
import { KeyboardShortcuts, ShortcutsDialog } from "./shortcuts";
import { SidebarNav } from "./sidebar";
import { Topbar } from "./topbar";
import { UIProvider, useUI } from "./ui-context";

export function AppShell({ shell, children }: { shell: ShellData; children: React.ReactNode }) {
  return (
    <UIProvider lookups={shell.lookups} viewer={shell.viewer}>
      <div className="flex min-h-dvh">
        <aside className="sticky top-0 hidden h-dvh w-[232px] shrink-0 border-r border-sidebar-border bg-sidebar lg:block">
          <SidebarNav counts={shell.counts} viewer={shell.viewer} />
        </aside>
        <MobileNav shell={shell} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar brain={shell.brain} timezone={shell.ceo.timezone} />
          <main id="main" className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8">
            {children}
          </main>
        </div>
      </div>
      <CommandBar />
      <KeyboardShortcuts />
      <ShortcutsDialog />
      <ChiefOfStaffPanel />
      <CreateDialogs />
      <DelegateDialog />
      <Suspense>
        <EntitySheets />
      </Suspense>
    </UIProvider>
  );
}

function MobileNav({ shell }: { shell: ShellData }) {
  const { mobileNavOpen, setMobileNavOpen } = useUI();
  return (
    <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
      <SheetContent side="left" className="w-[260px] bg-sidebar p-0 sm:max-w-[260px]" showCloseButton={false}>
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SidebarNav counts={shell.counts} viewer={shell.viewer} onNavigate={() => setMobileNavOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
