import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageHeader } from "@/components/common/bits";
import { Kbd } from "@/components/common/status";
import { InboxView } from "@/components/inbox/inbox-view";
import type { InboxStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";
import { getInbox } from "@/server/queries/inbox";
import { requirePage } from "@/server/security/session";

export const metadata: Metadata = { title: "Inbox" };

const TABS: { key: InboxStatus; label: string }[] = [
  { key: "OPEN", label: "Needs you" },
  { key: "SNOOZED", label: "Snoozed" },
  { key: "DONE", label: "Done" },
  { key: "DISMISSED", label: "Dismissed" },
];

export default async function InboxPage(props: { searchParams: Promise<{ status?: string }> }) {
  await requirePage("cockpit.view", "/inbox");
  const sp = await props.searchParams;
  const status = (TABS.find((t) => t.key === sp.status)?.key ?? "OPEN") as InboxStatus;
  const { items, counts, today, timezone } = await getInbox(status);

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <PageHeader
        title="CEO Inbox"
        description={
          <>
            Only what genuinely requires you — filed by CytoHub Brain with why it needs you and what to do. Navigate with <Kbd>J</Kbd> <Kbd>K</Kbd>.
          </>
        }
      />
      <nav aria-label="Inbox status" className="flex gap-1">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === "OPEN" ? "/inbox" : `/inbox?status=${t.key}`}
            aria-current={t.key === status ? "page" : undefined}
            className={cn("inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium", t.key === status ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
          >
            {t.label}
            {(counts[t.key] ?? 0) > 0 && <span className={cn("tabular", t.key === status ? "text-background/70" : "")}>{counts[t.key]}</span>}
          </Link>
        ))}
      </nav>
      <Suspense>
        <InboxView items={items} today={today} timezone={timezone} status={status} />
      </Suspense>
    </div>
  );
}
