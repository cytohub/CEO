import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/shell/auth-shell";
import { homePathFor } from "@/server/security/rbac";
import { PASSWORD_CHANGE_PATH, getSessionViewer } from "@/server/security/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · CytoHub" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const viewer = await getSessionViewer();
  if (viewer) redirect(viewer.mustChangePassword ? PASSWORD_CHANGE_PATH : homePathFor(viewer.role));
  const { next } = await searchParams;

  return (
    <AuthShell footer={<p className="mt-6 text-xs text-muted-foreground">Accounts are created by your CytoHub administrator. Every sign-in is logged.</p>}>
      <h1 className="text-[22px] font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1 text-[13px] text-muted-foreground">Welcome back. Use your work email and password.</p>
      <LoginForm next={typeof next === "string" ? next : undefined} />
    </AuthShell>
  );
}
