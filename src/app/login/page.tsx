import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CytoHubMark } from "@/components/shell/sidebar";
import { homePathFor } from "@/server/security/rbac";
import { getViewer } from "@/server/security/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · CytoHub" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const viewer = await getViewer();
  if (viewer) redirect(homePathFor(viewer.role));
  const { next } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-[360px]">
        <div className="mb-6 flex items-center gap-2.5">
          <CytoHubMark className="size-8" />
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-tight">CytoHub</div>
            <div className="text-xs text-muted-foreground">CEO Command Center</div>
          </div>
        </div>
        <div className="panel p-5">
          <h1 className="text-base font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">Company intelligence is confidential. Access is logged.</p>
          <LoginForm next={typeof next === "string" ? next : undefined} />
        </div>
        <p className="mt-4 text-center text-2xs text-muted-foreground">Accounts are created by your CytoHub administrator.</p>
      </div>
    </main>
  );
}
